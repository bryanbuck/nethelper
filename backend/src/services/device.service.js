const { getPrisma } = require('../config/database');
const { normalizeSerial, normalizeMac } = require('../utils/device-key');
const { effectiveStatus, statusWhere } = require('../utils/device-status');
const { localPollAvailability } = require('../utils/transport-router');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { ENV_ARUBA_INTEGRATION_ID } = require('./cloud-providers/cloud-provider-factory');
const alertService = require('./alert.service');
const deviceEvents = require('./device-events.service');
const { debugLog, Services } = require('../utils/debug-logger');

// Create service-specific logger
const logger = debugLog.createLogger(Services.DEVICE);

// What a person may set through POST/PUT /devices. Every other column is
// system-owned: written by cloud sync, the Central probe, the ping monitor,
// connection tests or the live monitor.
const EDITABLE_FIELDS = [
  'name', 'type', 'vendor', 'platform', 'model', 'ipAddress', 'macAddress', 'location',
  'serial', 'managementMode', 'cloudIntegrationId', 'apiCredentialId',
];
/** The listed keys of obj whose values are defined. */
const pickDefined = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// Optional columns where a blank form field means "none".
const BLANK_AS_NULL = ['ipAddress', 'macAddress', 'location', 'platform', 'cloudIntegrationId', 'apiCredentialId'];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Device table sort keys → orderBy. `status` is derived (effectiveStatus), so
// it sorts by ping then cloud status, which is close but not exact.
const SORT_FIELDS = {
  name: (dir) => [{ name: dir }],
  type: (dir) => [{ type: dir }],
  managementMode: (dir) => [{ managementMode: dir }],
  ipAddress: (dir) => [{ ipAddress: { sort: dir, nulls: 'last' } }],
  location: (dir) => [{ location: { sort: dir, nulls: 'last' } }],
  cloudStatus: (dir) => [{ cloudStatus: dir }],
  lastSeen: (dir) => [{ lastSeen: { sort: dir, nulls: 'last' } }],
  status: (dir) => [{ pingStatus: { sort: dir, nulls: 'last' } }, { cloudStatus: dir }],
};
const DEFAULT_ORDER = [{ pingStatus: 'asc' }, { name: 'asc' }];

// Why an active integration couldn't be loaded, in words an admin can act on.
function skippedReason(error) {
  if (/decrypt|encrypted text|ENCRYPTION_KEY/i.test(error || '')) {
    return `its credentials can't be decrypted (${error}). If ENCRYPTION_KEY changed, run npm run key:rotate, or re-enter the credentials in Settings.`;
  }
  return `it can't be loaded: ${error}`;
}

function deviceOrderBy(sortBy, sortOrder) {
  const dir = sortOrder === 'desc' ? 'desc' : 'asc';
  const order = SORT_FIELDS[sortBy] ? SORT_FIELDS[sortBy](dir) : DEFAULT_ORDER;
  // Ties broken by id so pages don't shuffle rows between requests
  return [...order, { id: 'asc' }];
}

class DeviceService {
  /**
   * List devices. Without options.limit, returns every matching row (an
   * array). With it, returns one page: { devices, total, summary }, where
   * total counts the matching rows and summary counts the whole fleet by
   * effective status.
   */
  async getDevices(filters = {}, options = {}) {
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
      // The same status the list shows (ping first, then the cloud; see utils/device-status.js)
      if (status) where.OR = statusWhere(status).OR;
      if (location) where.location = { contains: location, mode: 'insensitive' };

      if (search) {
        const searchConditions = [
          { name: { contains: search, mode: 'insensitive' } },
          { serial: { contains: search, mode: 'insensitive' } },
          { ipAddress: { contains: search, mode: 'insensitive' } },
          { model: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
          { macAddress: { contains: search, mode: 'insensitive' } },
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

      const { page, limit, sortBy, sortOrder } = options;
      const paged = Number.isInteger(limit) && limit > 0;

      const devices = await prisma.device.findMany({
        where,
        ...(paged && { skip: (Math.max(page || 1, 1) - 1) * limit, take: limit }),
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
          // The table and device page label the cloud plane ("Central", "Mist").
          cloudIntegration: {
            select: { id: true, name: true, provider: true },
          },
          _count: {
            select: {
              executions: true,
            },
          },
        },
        orderBy: deviceOrderBy(sortBy, sortOrder),
      });

      // Map pingStatus to status field for frontend compatibility
      const rows = devices.map(device => ({
        ...device,
        // Ping first, then the cloud; warning when only ping says it's down
        status: effectiveStatus(device),
        // Include both statuses for frontend display
        pingStatus: device.pingStatus,
        cloudStatus: device.cloudStatus,
      }));
      if (!paged) return rows;

      const [total, summary] = await Promise.all([
        prisma.device.count({ where }),
        this.getStatusSummary(),
      ]);
      return { devices: rows, total, summary };
    } catch (error) {
      logger.error('Get devices error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /** Fleet-wide device counts by effective status (utils/device-status.js). */
  async getStatusSummary() {
    const prisma = getPrisma();
    const [total, online, offline, warning] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: statusWhere('online') }),
      prisma.device.count({ where: statusWhere('offline') }),
      prisma.device.count({ where: statusWhere('warning') }),
    ]);
    return { total, online, offline, warning };
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

      if (!device) return null;
      // Same status mapping as getDevices(), so a fetched row matches a listed one.
      // systemPoll tells the device page whether polling the device can work.
      return {
        ...device,
        status: effectiveStatus(device),
        systemPoll: localPollAvailability(device),
        sameIpDevices: await this.findSameIpDevices(device),
      };
    } catch (error) {
      logger.error('Get device error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Other devices with this device's IP address. When the cloud reports this
   * device offline but its address answers ping, a device here that its cloud
   * reports online with the same IP is what answers (a cloud keeps an offline
   * device's last IP after another device took it). Rows with the same IP and
   * no serial are duplicates instead (findDuplicateGroups).
   */
  async findSameIpDevices(device) {
    if (!device.ipAddress) return [];
    const rows = await getPrisma().device.findMany({
      where: { ipAddress: device.ipAddress, id: { not: device.id } },
      select: {
        id: true, name: true, serial: true, managementMode: true, pingStatus: true, cloudStatus: true,
        cloudIntegration: { select: { name: true, provider: true } },
      },
      orderBy: { name: 'asc' },
      take: 10,
    });
    return rows.map((row) => ({ ...row, status: effectiveStatus(row) }));
  }

  /**
   * The fields of a request body a person may write (EDITABLE_FIELDS), with
   * blanks stored as null and a blank model left unchanged. Used by the
   * create/update routes; internal writers (sync) call createDevice and
   * updateDevice with system-owned fields directly.
   */
  editableFields(body = {}) {
    const data = {};
    for (const field of EDITABLE_FIELDS) {
      if (!(field in body) || body[field] === undefined) continue;
      const value = typeof body[field] === 'string' ? body[field].trim() : body[field];
      if (field === 'model' && !value) continue;
      data[field] = BLANK_AS_NULL.includes(field) && !value ? null : value;
    }
    return data;
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
          // Required column; the API treats it as optional (same default as a discovery import).
          model: deviceData.model || 'Unknown',
          ipAddress: deviceData.ipAddress,
          macAddress: deviceData.macAddress,
          location: deviceData.location,
          cloudStatus: deviceData.cloudStatus || 'offline',
          managementMode: deviceData.managementMode || 'direct',
          cloudIntegrationId: deviceData.cloudIntegrationId || null,
          firmwareVersion: deviceData.firmwareVersion,
          apiCredentialId: deviceData.apiCredentialId || null,
          metadata: deviceData.metadata || {},
          // From cloud sync only (the routes pass editableFields()), which
          // reports these for a new device as it does for a known one.
          ...(deviceData.lastSeen && { lastSeen: deviceData.lastSeen }),
          ...pickDefined(deviceData, ['cloudConnectionStatus', 'cloudManaged', 'cloudManagedSource', 'cloudManagedCheckedAt']),
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
      // Written only by connection tests; a new credential makes the last one stale.
      for (const field of ['apiTestStatus', 'apiLastTested', 'apiResponseTime', 'apiError']) delete data[field];
      if ('apiCredentialId' in data) {
        const current = await prisma.device.findUnique({ where: { id: deviceId }, select: { apiCredentialId: true } });
        if (current && current.apiCredentialId !== (data.apiCredentialId || null)) {
          Object.assign(data, { apiTestStatus: null, apiLastTested: null, apiResponseTime: null, apiError: null });
        }
      }

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
    const { providers, skipped } = integrationId
      ? { providers: [await CloudProviderFactory.forIntegration(integrationId)], skipped: [] }
      : await CloudProviderFactory.activeIntegrations();

    // An active integration that can't be loaded (credentials that won't
    // decrypt, an unimplemented provider) hasn't recovered: alert on it.
    for (const integration of skipped) {
      alertService.raise('sync.failed', {
        subjectKey: integration.id,
        title: `Device sync failed for ${integration.name}`,
        message: skippedReason(integration.error),
        data: { integrationId: integration.id },
      });
    }

    if (providers.length === 0) {
      if (skipped.length) {
        throw new Error(`No cloud integration could be loaded: ${skipped.map((s) => `${s.name} (${skippedReason(s.error)})`).join('; ')}`);
      }
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

    // A full sync runs every integration that can sync, so a sync.failed
    // alert for any other (deleted, deactivated, or the env fallback once a
    // real integration exists) would never be cleared by a later success.
    if (!integrationId) {
      await alertService.clearExcept('sync.failed', [...providers.map((p) => p.id), ...skipped.map((s) => s.id)]);
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

  /**
   * A cloud status change sync saw first (the status refresh usually does)
   * becomes a `cloud.<status>` DeviceEvent, like the refresh's, so the
   * device's history has no gap. A new device records its first status.
   */
  recordCloudTransition(device, normalized) {
    if (!normalized.status || normalized.status === device.cloudStatus) return;
    deviceEvents.recordStateIfChanged(device, 'cloud.', normalized.status, 'cloud', { via: 'sync' });
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

    const current = existingDevice || adoptable;
    const deviceData = {
      name: normalized.name,
      type: normalized.type,
      vendor: normalized.vendor,
      platform: normalized.platform,
      model: normalized.model,
      macAddress: normalized.macAddress,
      location: normalized.site || null,
      cloudStatus: normalized.status,
      managementMode: 'cloud',
      cloudIntegrationId,
      // A provider that couldn't read live stats this time reports no IP or
      // firmware; keep the known values (losing the IP would also cut off
      // local reads such as NETCONF backups).
      ...(normalized.ipAddress && { ipAddress: normalized.ipAddress }),
      ...(normalized.firmwareVersion && { firmwareVersion: normalized.firmwareVersion }),
      // Never clear a lastSeen that ping or the live monitor recorded.
      ...(normalized.lastSeen && { lastSeen: normalized.lastSeen }),
      cloudCheckedAt: new Date(),
      ...((normalized.status === 'online' || normalized.lastSeen) && {
        cloudLastSeen: normalized.lastSeen || new Date(),
      }),
      ...this.cloudManagedFields(normalized, current),
      // Merged, so keys other writers keep in metadata survive a sync.
      metadata: { ...(isPlainObject(current?.metadata) ? current.metadata : {}), ...(normalized.metadata || {}) },
    };

    if (existingDevice) {
      await this.updateDevice(existingDevice.id, deviceData);
      this.recordCloudTransition(existingDevice, normalized);
      this.alertCloudStatus(existingDevice.id, existingDevice.name, normalized);
      this.alertCloudConfig(existingDevice.id, existingDevice.name, normalized);
      return 'updated';
    }
    if (adoptable) {
      // Keep the name the user gave it; everything else comes from the cloud.
      const { name: _cloudName, ...adopted } = deviceData;
      await this.updateDevice(adoptable.id, { serial: normalized.serial, ...adopted });
      this.recordCloudTransition(adoptable, normalized);
      this.alertCloudStatus(adoptable.id, adoptable.name, normalized);
      this.alertCloudConfig(adoptable.id, adoptable.name, normalized);
      logger.info('Cloud sync adopted an existing device by MAC', {
        deviceId: adoptable.id, serial: normalized.serial, mac: normalizeMac(normalized.macAddress),
      });
      return 'adopted';
    }
    const created = await this.createDevice({ serial: normalized.serial, ...deviceData });
    if (created?.id) {
      this.recordCloudTransition({ ...created, cloudStatus: null }, normalized);
      this.alertCloudStatus(created.id, created.name, normalized);
      this.alertCloudConfig(created.id, created.name, normalized);
    }
    return 'created';
  }

  /**
   * Cloud-ownership fields a provider reported, if any. A switch's own answer
   * (the AOS-CX Central probe, source switch-rest) outranks the cloud's
   * inventory, so sync never overwrites it.
   */
  cloudManagedFields(normalized, current) {
    const fields = {};
    if (normalized.cloudConnectionStatus && current?.cloudManagedSource !== 'switch-rest') {
      fields.cloudConnectionStatus = normalized.cloudConnectionStatus;
    }
    if (typeof normalized.cloudManaged === 'boolean' && current?.cloudManagedSource !== 'switch-rest') {
      fields.cloudManaged = normalized.cloudManaged;
      fields.cloudManagedSource = normalized.cloudManagedSource || 'cloud-inventory';
      fields.cloudManagedCheckedAt = new Date();
    }
    return fields;
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

  /**
   * Open or clear device.cloud-config from the cloud's config sync state.
   * Only an online device opens one (an offline device's config can't be in
   * sync); a state that means neither (`configInSync: null`) changes nothing.
   * @param {{ status, configInSync, configStatus?, metadata?, serial? }} report
   */
  alertCloudConfig(deviceId, name, report) {
    const subject = { subjectKey: deviceId, deviceId };
    if (report.configInSync === true) {
      alertService.clear('device.cloud-config', subject);
    } else if (report.configInSync === false && report.status === 'online') {
      const state = report.configStatus ?? report.metadata?.configStatus;
      alertService.raise('device.cloud-config', {
        ...subject,
        title: `${name || report.name} config is out of sync`,
        message: `Its cloud reports the device is not running the config the cloud intends${state ? ` ("${state}")` : ''}.`,
        data: { serial: report.serial, configStatus: state || null },
      }, { bump: false });
    }
  }

  /** The single serial-less device with this MAC, or null (none, or ambiguous). */
  async findAdoptableDevice(macAddress) {
    const mac = normalizeMac(macAddress);
    if (!mac) return null;
    const candidates = await getPrisma().device.findMany({
      where: { serial: null, macAddress: { not: null } },
      select: { id: true, name: true, macAddress: true, metadata: true, cloudManagedSource: true },
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
              managementMode: true,
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
          status: effectiveStatus(device),
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