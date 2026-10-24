/**
 * Cloud status refresh: a light, frequent read of what each cloud reports
 * about its devices (CLOUD_STATUS_INTERVAL, default 5 minutes), between the
 * hourly full syncs. It only updates devices a sync already created and owned
 * by that integration: status, IP, firmware, connection state, config state.
 * It never creates, adopts or renames a device; that is sync's job.
 *
 * Changes are pushed as `device:status:update` and drive the cloud alerts
 * (device.cloud-offline, device.cloud-config) as soon as they happen, rather
 * than at the next sync. A change from a known status is also recorded as a
 * DeviceEvent (`cloud.<status>`, source `cloud`).
 *
 * Runs on its schedule and whenever the Mist event stream sees a device start
 * or stop reporting (services/cloud/cloud-stream.service.js). A write is
 * conditional on the status it read, so two overlapping refreshes report a
 * change once.
 *
 * Each refresh stamps its integration once (CloudStatusCheck) and broadcasts
 * `cloud:status:checked`; unchanged devices are never written.
 */

const { getPrisma } = require('../config/database');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { ENV_ARUBA_INTEGRATION_ID } = require('./cloud-providers/cloud-provider-factory');
const deviceService = require('./device.service');
const deviceEvents = require('./device-events.service');
const { effectiveStatus } = require('../utils/device-status');
const logger = require('../utils/logger');

const DEVICE_FIELDS = {
  id: true,
  name: true,
  serial: true,
  managementMode: true,
  pingStatus: true,
  cloudStatus: true,
  ipAddress: true,
  firmwareVersion: true,
  lastSeen: true,
  cloudCheckedAt: true,
  cloudLastSeen: true,
  cloudConnectionStatus: true,
  cloudManagedSource: true,
  metadata: true,
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const newest = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b) || null;

function emit(event, payload) {
  try {
    // Lazy: the socket server isn't up in tests or CLI scripts.
    const { getIO } = require('../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch (error) {
    logger.debug(`cloud-status: could not emit ${event}: ${error.message}`);
  }
}

/**
 * The columns that change for one device, or an empty object. Like sync, a
 * missing IP/firmware never clears a known one, and the switch's own answer
 * (switch-rest) outranks the cloud's connection state.
 */
function statusPatch(device, report, now = new Date()) {
  const patch = {};
  const statusChanged = report.status && report.status !== device.cloudStatus;
  if (statusChanged) patch.cloudStatus = report.status;
  if (report.ipAddress && report.ipAddress !== device.ipAddress) patch.ipAddress = report.ipAddress;
  if (report.firmwareVersion && report.firmwareVersion !== device.firmwareVersion) patch.firmwareVersion = report.firmwareVersion;
  if (report.cloudConnectionStatus && device.cloudManagedSource !== 'switch-rest'
    && report.cloudConnectionStatus !== device.cloudConnectionStatus) {
    patch.cloudConnectionStatus = report.cloudConnectionStatus;
  }
  // Central's last-seen for an online device is "now", so only a status
  // change or an offline device's real last-seen time is worth a write.
  const lastSeen = report.lastSeen ? new Date(report.lastSeen) : null;
  if (lastSeen && (statusChanged || report.status !== 'online')
    && (!device.lastSeen || lastSeen > new Date(device.lastSeen))) {
    patch.lastSeen = lastSeen;
  }
  // cloudLastSeen only matters once the device stops being online (until
  // then the integration's last refresh is the newer answer), so it is
  // written on status changes and offline reports, not every refresh.
  // device.cloudCheckedAt is the last time the cloud was read before this one.
  if (statusChanged && report.status === 'online') {
    patch.cloudLastSeen = lastSeen || now;
  } else if (report.status && report.status !== 'online') {
    const lastAlive = lastSeen || (statusChanged && device.cloudStatus === 'online' ? device.cloudCheckedAt : null);
    if (lastAlive && (!device.cloudLastSeen || new Date(lastAlive) > new Date(device.cloudLastSeen))) {
      patch.cloudLastSeen = new Date(lastAlive);
    }
  }
  const metadata = isPlainObject(device.metadata) ? device.metadata : {};
  if (report.configStatus !== undefined && report.configStatus !== null && report.configStatus !== metadata.configStatus) {
    patch.metadata = { ...metadata, configStatus: report.configStatus };
  }
  return patch;
}

class CloudStatusService {
  /**
   * Refresh one integration's devices.
   * @returns {Promise<{integrationId, name, devices, updated, statusChanges}>}
   */
  async refreshProvider(provider) {
    const statuses = await provider.listStatuses();
    // The env-var fallback integration has no row; its devices have no owner id.
    const ownerId = provider.id === ENV_ARUBA_INTEGRATION_ID ? null : provider.id;
    const devices = await getPrisma().device.findMany({
      where: { cloudIntegrationId: ownerId, managementMode: 'cloud', serial: { in: [...statuses.keys()] } },
      select: DEVICE_FIELDS,
    });

    const summary = { integrationId: provider.id, name: provider.label, devices: devices.length, updated: 0, statusChanges: 0 };
    const now = new Date();
    // The previous refresh is when a device going offline now was last seen online.
    const previous = await getPrisma().cloudStatusCheck.findUnique({ where: { integrationId: provider.id } })
      .catch(() => null);
    for (const device of devices) {
      const report = statuses.get(device.serial);
      const patch = statusPatch({ ...device, cloudCheckedAt: newest(device.cloudCheckedAt, previous?.checkedAt) }, report, now);
      if (!Object.keys(patch).length) continue;
      try {
        const { count } = await getPrisma().device.updateMany({
          where: { id: device.id, cloudStatus: device.cloudStatus },
          data: patch,
        });
        if (!count) continue; // another refresh changed it first
      } catch (error) {
        logger.warn(`cloud-status: could not update ${device.name}: ${error.message}`);
        continue;
      }
      summary.updated++;
      if (patch.cloudStatus) {
        summary.statusChanges++;
        await deviceEvents.recordStateIfChanged(device, 'cloud.', patch.cloudStatus, 'cloud', { provider: provider.providerType });
        deviceService.alertCloudStatus(device.id, device.name, { status: patch.cloudStatus, serial: device.serial });
        emit('device:status:update', {
          deviceId: device.id,
          deviceName: device.name,
          status: effectiveStatus({ ...device, cloudStatus: patch.cloudStatus }),
          cloudStatus: patch.cloudStatus,
          ...(patch.lastSeen && { lastSeen: patch.lastSeen }),
          ...(patch.cloudLastSeen && { cloudLastSeen: patch.cloudLastSeen }),
          cloudCheckedAt: now,
        });
      }
      // A device that just came online is checked too: offline ones never open it.
      if (patch.metadata || patch.cloudStatus) {
        deviceService.alertCloudConfig(device.id, device.name, { ...report, serial: device.serial });
      }
    }
    // A status this process hasn't compared with the device's history yet
    // (first refresh after start) starts or corrects its cloud lane.
    for (const device of devices) {
      const status = statuses.get(device.serial)?.status;
      if (status) await deviceEvents.recordStateOnce(device, 'cloud.', status, 'cloud', { provider: provider.providerType });
    }
    // One write per refresh, not per device: "the cloud had a status for its
    // devices as of now". The device page uses it as the cloud's last sighting
    // of a device it reports online (device.service withCloudChecks()).
    try {
      await getPrisma().cloudStatusCheck.upsert({
        where: { integrationId: provider.id },
        create: { integrationId: provider.id, checkedAt: now },
        update: { checkedAt: now },
      });
      emit('cloud:status:checked', { integrationId: ownerId, checkedAt: now });
    } catch (error) {
      logger.warn(`cloud-status: could not stamp ${provider.label}'s refresh: ${error.message}`);
    }
    return summary;
  }

  /**
   * Refresh every active integration. One integration failing doesn't stop
   * the others; a failure is logged, not alerted (the hourly sync raises
   * sync.failed when the cloud stays unreachable).
   */
  async refreshAll() {
    const providers = await CloudProviderFactory.activeProviders();
    const results = [];
    for (const provider of providers) {
      try {
        results.push(await this.refreshProvider(provider));
      } catch (error) {
        logger.warn(`cloud-status: refresh failed for ${provider.label}: ${error.message}`);
        results.push({ integrationId: provider.id, name: provider.label, error: error.message });
      }
    }
    return results;
  }
}

module.exports = new CloudStatusService();
module.exports.statusPatch = statusPatch;
