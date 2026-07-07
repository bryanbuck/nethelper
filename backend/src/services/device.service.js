const { getPrisma } = require('../config/database');
const arubaCentralService = require('./aruba-central.service');
const { debugLog, Services } = require('../utils/debug-logger');

// Create service-specific logger
const logger = debugLog.createLogger(Services.DEVICE);

class DeviceService {
  async getDevices(filters = {}) {
    try {
      const prisma = getPrisma();
      const { type, status, location, search } = filters;

      const where = {};

      if (type) where.type = type;
      // Filter by pingStatus as primary status, fallback to centralStatus
      if (status) {
        where.OR = [
          { pingStatus: status },
          { AND: [{ pingStatus: null }, { centralStatus: status }] }
        ];
      }
      if (location) where.location = { contains: location, mode: 'insensitive' };

      if (search) {
        const searchConditions = [
          { name: { contains: search, mode: 'insensitive' } },
          { serial: { contains: search, mode: 'insensitive' } },
          { ipAddress: { contains: search, mode: 'insensitive' } },
        ];

        if (where.OR) {
          // If we already have OR conditions from status filter, combine with AND
          where.AND = [
            { OR: where.OR },
            { OR: searchConditions }
          ];
          delete where.OR;
        } else {
          where.OR = searchConditions;
        }
      }

      const devices = await prisma.device.findMany({
        where,
        include: {
          apiCredential: {
            select: {
              id: true,
              name: true,
              type: true,
              lastTested: true,
              lastTestStatus: true,
            },
          },
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
          { pingStatus: 'asc' },
          { name: 'asc' },
        ],
      });

      // Map pingStatus to status field for frontend compatibility
      return devices.map(device => ({
        ...device,
        // Use pingStatus as primary, fallback to centralStatus
        status: device.pingStatus || device.centralStatus || 'offline',
        // Include both statuses for frontend display
        pingStatus: device.pingStatus,
        centralStatus: device.centralStatus,
      }));
    } catch (error) {
      logger.error('Get devices error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async getDevice(deviceId) {
    try {
      const prisma = getPrisma();

      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        include: {
          apiCredential: {
            select: {
              id: true,
              name: true,
              type: true,
              lastTested: true,
              lastTestStatus: true,
            },
          },
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
      logger.error('Get device error', { error: error.message, stack: error.stack });
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
          centralStatus: deviceData.centralStatus || deviceData.status || 'offline',
          managementMode: deviceData.managementMode || 'direct',
          firmwareVersion: deviceData.firmwareVersion,
          apiCredentialId: deviceData.apiCredentialId || null,
          metadata: deviceData.metadata || {},
        },
      });

      logger.success('Device created', { deviceId: device.id, serial: device.serial });
      return device;
    } catch (error) {
      logger.error('Create device error', { error: error.message, stack: error.stack });
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

      logger.success('Device updated', { deviceId, changes: Object.keys(updateData) });
      return device;
    } catch (error) {
      logger.error('Update device error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async deleteDevice(deviceId) {
    try {
      const prisma = getPrisma();

      await prisma.device.delete({
        where: { id: deviceId },
      });

      logger.success('Device deleted', { deviceId });
    } catch (error) {
      logger.error('Delete device error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async syncDevicesFromAruba() {
    try {
      logger.progress('Starting device sync from Aruba Central');

      // Get devices from Aruba Central using the unified endpoint
      // Note: The new API returns {items: [], count, total, next}
      const response = await arubaCentralService.getAllDevices({ limit: 100 });
      const arubaDevices = response.items || [];
      const prisma = getPrisma();

      logger.info('Received devices from Aruba Central', {
        count: arubaDevices.length,
        total: response.total
      });

      let created = 0;
      let updated = 0;

      for (const arubaDevice of arubaDevices) {
        try {
          // Check if device exists
          const existingDevice = await prisma.device.findUnique({
            where: { serial: arubaDevice.serial },
          });

          const deviceData = {
            name: arubaDevice.deviceName || arubaDevice.serial,
            type: this.mapDeviceType(arubaDevice.deviceType),
            model: arubaDevice.model,
            ipAddress: arubaDevice.ipv4 || arubaDevice.ipv6,
            macAddress: arubaDevice.macAddress,
            location: arubaDevice.location,
            centralStatus: this.mapDeviceStatus(arubaDevice.status),
            managementMode: 'central',
            firmwareVersion: arubaDevice.firmwareVersion,
            lastSeen: arubaDevice.lastSeen ? new Date(arubaDevice.lastSeen * 1000) : null,
            metadata: {
              siteId: arubaDevice.siteId,
              deployment: arubaDevice.deployment,
              health: arubaDevice.health,
              uptime: arubaDevice.upTime,
              // Switch-specific fields
              stackId: arubaDevice.stackId,
              switchRole: arubaDevice.switchRole,
              // Firmware details
              firmwareBackupVersion: arubaDevice.firmwareBackupVersion,
              firmwareStatus: arubaDevice.firmwareStatus,
              firmwareRecommendedVersion: arubaDevice.firmwareRecommendedVersion,
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
          logger.error('Error processing device', { error: deviceError.message, serial: arubaDevice.serial });
        }
      }

      logger.success('Device sync completed', {
        created,
        updated,
        total: arubaDevices.length,
        accessPoints: arubaDevices.filter(d => d.deviceType === 'ACCESS_POINT').length,
        switches: arubaDevices.filter(d => d.deviceType === 'SWITCH').length,
        gateways: arubaDevices.filter(d => d.deviceType === 'GATEWAY').length
      });
      return { created, updated, total: arubaDevices.length };
    } catch (error) {
      logger.error('Device sync error', { error: error.message, stack: error.stack });
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

      logger.success('Device sync job queued', { jobId: job.id });
      return job;
    } catch (error) {
      logger.error('Queue device sync error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  mapDeviceType(arubaType) {
    const typeMap = {
      // New API format (v1alpha1)
      'ACCESS_POINT': 'access_point',
      'SWITCH': 'switch',
      'GATEWAY': 'gateway',

      // Legacy API formats (kept for compatibility)
      'ap': 'access_point',
      'access_point': 'access_point',
      'iap': 'access_point',
      'instant_ap': 'access_point',

      'switch': 'switch',
      'cx': 'switch',
      'aos_switch': 'switch',
      'aos-s': 'switch',
      'aos-cx': 'switch',

      'gateway': 'gateway',
      'gw': 'gateway',
      'mobility_controller': 'gateway',
      'controller': 'gateway',
      'mc': 'gateway'
    };

    // Handle both uppercase (new API) and lowercase (legacy)
    const deviceType = typeMap[arubaType] || typeMap[arubaType?.toLowerCase()];
    if (!deviceType) {
      logger.warn('Unknown device type encountered', { arubaType });
      return 'access_point'; // Default fallback
    }
    return deviceType;
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
              pingStatus: true,
              centralStatus: true,
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

      // Map pingStatus to status for each device in the groups
      return groups.map(group => ({
        ...group,
        devices: group.devices.map(device => ({
          ...device,
          status: device.pingStatus || device.centralStatus || 'offline',
        })),
      }));
    } catch (error) {
      logger.error('Get device groups error', { error: error.message, stack: error.stack });
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

      logger.success('Device group created', { groupId: group.id, name: group.name });
      return group;
    } catch (error) {
      logger.error('Create device group error', { error: error.message, stack: error.stack });
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

      logger.success('Device group updated', { groupId, changes: Object.keys(updateData) });
      return group;
    } catch (error) {
      logger.error('Update device group error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async deleteDeviceGroup(groupId) {
    try {
      const prisma = getPrisma();

      await prisma.deviceGroup.delete({
        where: { id: groupId },
      });

      logger.success('Device group deleted', { groupId });
    } catch (error) {
      logger.error('Delete device group error', { error: error.message, stack: error.stack });
      throw error;
    }
  }
}

module.exports = new DeviceService();