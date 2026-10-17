const { getPrisma } = require('../config/database');
const { normalizeSerial, normalizeMac } = require('../utils/device-key');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { ENV_ARUBA_INTEGRATION_ID } = require('./cloud-providers/cloud-provider-factory');
const alertService = require('./alert.service');
const { debugLog, Services } = require('../utils/debug-logger');

// Create service-specific logger
const logger = debugLog.createLogger(Services.DEVICE);

class DeviceService {
  async getDevices(filters = {}) {
    try {
      const prisma = getPrisma();
      const { type, status, location, search, platform, credential } = filters;

      const where = {};

      if (type) where.type = type;
      if (platform) where.platform = platform;
      // credential: 'none' | 'any' | an ApiCredential id
      if (credential === 'none') where.apiCredentialId = null;
      else if (credential === 'any') where.apiCredentialId = { not: null };
      else if (credential) where.apiCredentialId = credential;
      // Filter by pingStatus as primary status, fallback to cloudStatus
      if (status) {
        where.OR = [
          { pingStatus: status },
          { AND: [{ pingStatus: null }, { cloudStatus: status }] }
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
        // Use pingStatus as primary, fallback to cloudStatus
        status: device.pingStatus || device.cloudStatus || 'offline',
        // Include both statuses for frontend display
        pingStatus: device.pingStatus,
        cloudStatus: device.cloudStatus,
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
          cloudIntegration: {
            select: { id: true, name: true, provider: true },
          },
          executions: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: {
              automation: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                },
              },
            },
          },
        },
      });

      // Same status mapping as getDevices(), so a fetched row matches a listed one.
      return device && { ...device, status: device.pingStatus || device.cloudStatus || 'offline' };
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
          serial: normalizeSerial(deviceData.serial) ?? null,
          name: deviceData.name,
          type: deviceData.type,
          vendor: deviceData.vendor || 'aruba',
          platform: deviceData.platform || null,
          model: deviceData.model,
          ipAddress: deviceData.ipAddress,
          macAddress: deviceData.macAddress,
          location: deviceData.location,
          cloudStatus: deviceData.cloudStatus || deviceData.status || 'offline',
          managementMode: deviceData.managementMode || 'direct',
          cloudIntegrationId: deviceData.cloudIntegrationId || null,
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

      const data = { ...updateData };
      if ('serial' in data) data.serial = normalizeSerial(data.serial);
      // Toggled only via PATCH /devices/:id/live-monitoring, which checks the
      // device can actually be watched and starts/stops the monitor.
      delete data.liveMonitoring;

      const device = await prisma.device.update({
        where: { id: deviceId },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });

      logger.success('Device updated', { deviceId, changes: Object.keys(updateData) });
      // A watched device may have a new IP, platform, or credential.
      require('./live/state-monitor.service').refresh(device).catch((error) => {
        logger.warn('Live monitor refresh failed', { deviceId, error: error.message });
      });
      return device;
    } catch (error) {
      logger.error('Update device error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async deleteDevice(deviceId) {
    try {
      const prisma = getPrisma();

      await require('./live/state-monitor.service').forget(deviceId);
      alertService.forgetDevice(deviceId);
      await prisma.device.delete({
        where: { id: deviceId },
      });
      // Its alerts cascaded with it; refresh everyone's counts.
      alertService.emitUpdated([]).catch(() => {});

      logger.success('Device deleted', { deviceId });
    } catch (error) {
      logger.error('Delete device error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Sync device inventory from every active cloud integration (or a single
   * one when integrationId is given). Multiple integrations — including
   * several tenants of the same provider — sync side by side; each device is
   * attributed to its owning integration via cloudIntegrationId. Upserts are
   * serial-keyed: a device already owned by another integration is updated,
   * with ownership following the most recent sync that saw it.
   *
   * @param {string} [integrationId] - CloudIntegration id to sync alone
   * @returns {Promise<{created, updated, total, integrations: Array}>}
   */
  async syncDevicesFromCloud(integrationId = null) {
    const providers = integrationId
      ? [await CloudProviderFactory.forIntegration(integrationId)]
      : await CloudProviderFactory.activeProviders();

    if (providers.length === 0) {
      throw new Error('No active cloud integrations configured. Add one in Settings.');
    }

    const totals = { created: 0, updated: 0, adopted: 0, total: 0, integrations: [] };

    for (const provider of providers) {
      const summary = { integrationId: provider.id, name: provider.label, created: 0, updated: 0, adopted: 0, total: 0, error: null };
      try {
        const devices = await provider.listInventory();
        summary.total = devices.length;
        // The env-var fallback integration has no DB row to reference.
        const ownerId = provider.id === ENV_ARUBA_INTEGRATION_ID ? null : provider.id;
        for (const normalized of devices) {
          try {
            const result = await this.upsertCloudDevice(normalized, ownerId);
            if (result === 'created') summary.created++;
            else summary.updated++;
            if (result === 'adopted') summary.adopted++;
          } catch (deviceError) {
            logger.error('Error processing device', { error: deviceError.message, serial: normalized.serial });
          }
        }
        logger.success(`Device sync completed for ${provider.label}`, summary);
        alertService.clear('sync.failed', { subjectKey: provider.id });
      } catch (error) {
        summary.error = error.message;
        logger.error(`Device sync failed for ${provider.label}`, { error: error.message });
        alertService.raise('sync.failed', {
          subjectKey: provider.id,
          title: `Device sync failed for ${provider.label}`,
          message: error.message,
          data: { integrationId: provider.id },
        });
        // Keep syncing the remaining integrations; report per-integration errors.
      }
      totals.created += summary.created;
      totals.updated += summary.updated;
      totals.adopted += summary.adopted;
      totals.total += summary.total;
      totals.integrations.push(summary);
    }

    // Preserve the historical all-or-nothing error for the single-tenant
    // case: if every integration failed, surface the first failure.
    if (totals.integrations.length > 0 && totals.integrations.every((s) => s.error)) {
      throw new Error(totals.integrations[0].error);
    }

    // Rows sync couldn't prove are the same device (IP match only, or an
    // ambiguous MAC) are left for a person to merge; tell the UI how many.
    try {
      const deviceMerge = require('./device-merge.service');
      totals.possibleDuplicates = (await deviceMerge.findDuplicateGroups()).length;
    } catch (error) {
      logger.warn('Duplicate check after sync failed', { error: error.message });
    }

    return totals;
  }

  /** @deprecated Use syncDevicesFromCloud(); kept as an alias for one release. */
  async syncDevicesFromAruba() {
    return this.syncDevicesFromCloud();
  }

  /** Upsert one NormalizedCloudDevice, stamping its owning integration. */
  async upsertCloudDevice(normalized, cloudIntegrationId) {
    if (!normalized.serial) {
      // Cloud devices are matched by serial; without one there is nothing to key on.
      throw new Error(`Cloud device "${normalized.name || 'unnamed'}" has no serial; skipped`);
    }
    const prisma = getPrisma();
    const existingDevice = await prisma.device.findUnique({
      where: { serial: normalized.serial },
    });
    // A device added by hand (no serial) that this cloud now reports: adopt
    // it rather than create a duplicate, but only on proof, i.e. exactly one
    // serial-less row with the same MAC. Weaker matches (IP, name) are left
    // to findDuplicateGroups() and a person.
    const adoptable = existingDevice ? null : await this.findAdoptableDevice(normalized.macAddress);

    const deviceData = {
      name: normalized.name,
      type: normalized.type,
      vendor: normalized.vendor,
      platform: normalized.platform,
      model: normalized.model,
      ipAddress: normalized.ipAddress,
      macAddress: normalized.macAddress,
      location: normalized.site || null,
      cloudStatus: normalized.status,
      managementMode: 'cloud',
      cloudIntegrationId,
      firmwareVersion: normalized.firmwareVersion,
      // Never clear a lastSeen that ping or the live monitor recorded.
      ...(normalized.lastSeen && { lastSeen: normalized.lastSeen }),
      metadata: normalized.metadata || {},
    };

    if (existingDevice) {
      await this.updateDevice(existingDevice.id, deviceData);
      this.alertCloudStatus(existingDevice.id, existingDevice.name, normalized);
      return 'updated';
    }
    if (adoptable) {
      // Keep the name the user gave it; everything else comes from the cloud.
      const { name: _cloudName, ...adopted } = deviceData;
      await this.updateDevice(adoptable.id, { serial: normalized.serial, ...adopted });
      this.alertCloudStatus(adoptable.id, adoptable.name, normalized);
      logger.info('Cloud sync adopted an existing device by MAC', {
        deviceId: adoptable.id, serial: normalized.serial, mac: normalizeMac(normalized.macAddress),
      });
      return 'adopted';
    }
    const created = await this.createDevice({ serial: normalized.serial, ...deviceData });
    if (created?.id) this.alertCloudStatus(created.id, created.name, normalized);
    return 'created';
  }

  /**
   * Open or clear device.cloud-offline from the status sync just saw. Called
   * on every sync, so a device that stays offline doesn't count again.
   */
  alertCloudStatus(deviceId, name, normalized) {
    const subject = { subjectKey: deviceId, deviceId };
    if (normalized.status === 'offline') {
      alertService.raise('device.cloud-offline', {
        ...subject,
        title: `${name || normalized.name} is offline in the cloud`,
        message: 'Its cloud management plane reports the device offline.',
        data: { serial: normalized.serial },
      }, { bump: false });
    } else {
      alertService.clear('device.cloud-offline', subject);
    }
  }

  /** The single serial-less device with this MAC, or null (none, or ambiguous). */
  async findAdoptableDevice(macAddress) {
    const mac = normalizeMac(macAddress);
    if (!mac) return null;
    const candidates = await getPrisma().device.findMany({
      where: { serial: null, macAddress: { not: null } },
      select: { id: true, name: true, macAddress: true },
    });
    const matches = candidates.filter((d) => normalizeMac(d.macAddress) === mac);
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * @param {string} [integrationId] - sync only this cloud integration;
   *   omit to sync every active one.
   */
  async queueDeviceSync(integrationId = null) {
    try {
      const { getQueue } = require('../config/bull');
      const deviceSyncQueue = getQueue('deviceSync');

      const job = await deviceSyncQueue.add('syncDevices', { integrationId }, {
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
              cloudStatus: true,
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
          status: device.pingStatus || device.cloudStatus || 'offline',
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