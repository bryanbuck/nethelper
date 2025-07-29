const { getPrisma } = require('../config/database');
const arubaCentralService = require('./aruba-central.service');
const logger = require('../utils/logger');

class DeviceService {
  async getDevices(filters = {}) {
    try {
      const prisma = getPrisma();
      const { type, status, location, search } = filters;

      const where = {};
      
      if (type) where.type = type;
      if (status) where.status = status;
      if (location) where.location = { contains: location, mode: 'insensitive' };
      
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { serial: { contains: search, mode: 'insensitive' } },
          { ipAddress: { contains: search, mode: 'insensitive' } },
        ];
      }

      const devices = await prisma.device.findMany({
        where,
        include: {
          deviceGroups: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              executions: true,
            },
          },
        },
        orderBy: [
          { status: 'asc' },
          { name: 'asc' },
        ],
      });

      return devices;
    } catch (error) {
      logger.error('Get devices error:', error);
      throw error;
    }
  }

  async getDevice(deviceId) {
    try {
      const prisma = getPrisma();

      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        include: {
          deviceGroups: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
          executions: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: {
              automation: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                },
              },
            },
          },
        },
      });

      return device;
    } catch (error) {
      logger.error('Get device error:', error);
      throw error;
    }
  }

  async createDevice(deviceData) {
    try {
      const prisma = getPrisma();

      const device = await prisma.device.create({
        data: {
          serial: deviceData.serial,
          name: deviceData.name,
          type: deviceData.type,
          model: deviceData.model,
          ipAddress: deviceData.ipAddress,
          macAddress: deviceData.macAddress,
          location: deviceData.location,
          status: deviceData.status || 'offline',
          firmwareVersion: deviceData.firmwareVersion,
          metadata: deviceData.metadata || {},
        },
      });

      logger.info('Device created', { deviceId: device.id, serial: device.serial });
      return device;
    } catch (error) {
      logger.error('Create device error:', error);
      throw error;
    }
  }

  async updateDevice(deviceId, updateData) {
    try {
      const prisma = getPrisma();

      const device = await prisma.device.update({
        where: { id: deviceId },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
      });

      logger.info('Device updated', { deviceId, changes: Object.keys(updateData) });
      return device;
    } catch (error) {
      logger.error('Update device error:', error);
      throw error;
    }
  }

  async deleteDevice(deviceId) {
    try {
      const prisma = getPrisma();

      await prisma.device.delete({
        where: { id: deviceId },
      });

      logger.info('Device deleted', { deviceId });
    } catch (error) {
      logger.error('Delete device error:', error);
      throw error;
    }
  }

  async syncDevicesFromAruba() {
    try {
      logger.info('Starting device sync from Aruba Central');

      // Get devices from Aruba Central
      const arubaDevices = await arubaCentralService.getDevices();
      const prisma = getPrisma();

      let created = 0;
      let updated = 0;

      for (const arubaDevice of arubaDevices) {
        try {
          // Check if device exists
          const existingDevice = await prisma.device.findUnique({
            where: { serial: arubaDevice.serial },
          });

          const deviceData = {
            name: arubaDevice.name || arubaDevice.serial,
            type: this.mapDeviceType(arubaDevice.device_type),
            model: arubaDevice.model,
            ipAddress: arubaDevice.ip_address,
            macAddress: arubaDevice.mac_address,
            location: arubaDevice.site,
            status: this.mapDeviceStatus(arubaDevice.status),
            firmwareVersion: arubaDevice.firmware_version,
            lastSeen: arubaDevice.last_modified ? new Date(arubaDevice.last_modified * 1000) : null,
            metadata: {
              group_id: arubaDevice.group_id,
              labels: arubaDevice.labels || [],
              uptime: arubaDevice.uptime,
            },
          };

          if (existingDevice) {
            // Update existing device
            await this.updateDevice(existingDevice.id, deviceData);
            updated++;
          } else {
            // Create new device
            await this.createDevice({
              serial: arubaDevice.serial,
              ...deviceData,
            });
            created++;
          }
        } catch (deviceError) {
          logger.error('Error processing device:', deviceError, { serial: arubaDevice.serial });
        }
      }

      logger.info('Device sync completed', { created, updated, total: arubaDevices.length });
      return { created, updated, total: arubaDevices.length };
    } catch (error) {
      logger.error('Device sync error:', error);
      throw error;
    }
  }

  async queueDeviceSync() {
    try {
      const { getQueue } = require('../config/bull');
      const deviceSyncQueue = getQueue('deviceSync');
      
      const job = await deviceSyncQueue.add('syncDevices', {}, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      });

      logger.info('Device sync job queued', { jobId: job.id });
      return job;
    } catch (error) {
      logger.error('Queue device sync error:', error);
      throw error;
    }
  }

  mapDeviceType(arubaType) {
    const typeMap = {
      'ap': 'access_point',
      'access_point': 'access_point',
      'switch': 'switch',
      'gateway': 'gateway',
      'gw': 'gateway',
      'cx': 'switch',
      'aos_switch': 'switch',
    };

    return typeMap[arubaType?.toLowerCase()] || 'access_point';
  }

  mapDeviceStatus(arubaStatus) {
    const statusMap = {
      'Up': 'online',
      'Down': 'offline',
      'Warning': 'warning',
      'Maintenance': 'maintenance',
    };

    return statusMap[arubaStatus] || 'offline';
  }

  async getDeviceGroups() {
    try {
      const prisma = getPrisma();

      const groups = await prisma.deviceGroup.findMany({
        include: {
          devices: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
              status: true,
            },
          },
          _count: {
            select: {
              devices: true,
              automations: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      return groups;
    } catch (error) {
      logger.error('Get device groups error:', error);
      throw error;
    }
  }

  async createDeviceGroup(groupData) {
    try {
      const prisma = getPrisma();

      const group = await prisma.deviceGroup.create({
        data: {
          name: groupData.name,
          description: groupData.description,
          devices: {
            connect: (groupData.deviceIds || []).map(id => ({ id })),
          },
        },
        include: {
          devices: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
            },
          },
        },
      });

      logger.info('Device group created', { groupId: group.id, name: group.name });
      return group;
    } catch (error) {
      logger.error('Create device group error:', error);
      throw error;
    }
  }

  async updateDeviceGroup(groupId, updateData) {
    try {
      const prisma = getPrisma();

      const updatePayload = {
        name: updateData.name,
        description: updateData.description,
      };

      if (updateData.deviceIds !== undefined) {
        updatePayload.devices = {
          set: updateData.deviceIds.map(id => ({ id })),
        };
      }

      const group = await prisma.deviceGroup.update({
        where: { id: groupId },
        data: updatePayload,
        include: {
          devices: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
            },
          },
        },
      });

      logger.info('Device group updated', { groupId, changes: Object.keys(updateData) });
      return group;
    } catch (error) {
      logger.error('Update device group error:', error);
      throw error;
    }
  }

  async deleteDeviceGroup(groupId) {
    try {
      const prisma = getPrisma();

      await prisma.deviceGroup.delete({
        where: { id: groupId },
      });

      logger.info('Device group deleted', { groupId });
    } catch (error) {
      logger.error('Delete device group error:', error);
      throw error;
    }
  }
}

module.exports = new DeviceService();