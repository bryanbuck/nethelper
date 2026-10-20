/**
 * Cloud status refresh: a light, frequent read of what each cloud reports
 * about its devices (CLOUD_STATUS_INTERVAL, default 5 minutes), between the
 * hourly full syncs. It only updates devices a sync already created and owned
 * by that integration: status, IP, firmware, connection state, config state.
 * It never creates, adopts or renames a device; that is sync's job.
 *
 * Changes are pushed as `device:status:update` and drive the cloud alerts
 * (device.cloud-offline, device.cloud-config) as soon as they happen, rather
 * than at the next sync.
 */

const { getPrisma } = require('../config/database');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { ENV_ARUBA_INTEGRATION_ID } = require('./cloud-providers/cloud-provider-factory');
const deviceService = require('./device.service');
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
  cloudConnectionStatus: true,
  cloudManagedSource: true,
  metadata: true,
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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
function statusPatch(device, report) {
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
    for (const device of devices) {
      const report = statuses.get(device.serial);
      const patch = statusPatch(device, report);
      if (!Object.keys(patch).length) continue;
      try {
        await getPrisma().device.update({ where: { id: device.id }, data: patch });
      } catch (error) {
        logger.warn(`cloud-status: could not update ${device.name}: ${error.message}`);
        continue;
      }
      summary.updated++;
      if (patch.cloudStatus) {
        summary.statusChanges++;
        deviceService.alertCloudStatus(device.id, device.name, { status: patch.cloudStatus, serial: device.serial });
        emit('device:status:update', {
          deviceId: device.id,
          deviceName: device.name,
          status: effectiveStatus({ ...device, cloudStatus: patch.cloudStatus }),
          cloudStatus: patch.cloudStatus,
          ...(patch.lastSeen && { lastSeen: patch.lastSeen }),
        });
      }
      // A device that just came online is checked too: offline ones never open it.
      if (patch.metadata || patch.cloudStatus) {
        deviceService.alertCloudConfig(device.id, device.name, { ...report, serial: device.serial });
      }
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
