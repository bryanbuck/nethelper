/**
 * Device identity: which serial number and MAC are real.
 *
 * A Device row's serial/MAC may have been typed in by hand, including
 * placeholders ("STUDIO", cc:cc:cc:...). Two sources are authoritative:
 *   1. the cloud plane's inventory (it reports what the hardware told it), and
 *   2. the device itself, read directly (AOS-CX chassis product_info, Junos
 *      chassis inventory), which works for locally managed devices too.
 * Cloud is asked first; the device is the fallback. If neither answers, the
 * identity is unknown and a person has to say which row is right.
 */

const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const DeviceAPIFactory = require('./device-api/device-api-factory');
const CXSwitchAPI = require('./device-api/cx-switch-api');
const settingsService = require('./settings.service');
const { normalizeMac } = require('../utils/device-key');
const { debugLog, Services } = require('../utils/debug-logger');

const logger = debugLog.createLogger(Services.DEVICE);

const DEVICE_READ_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Cloud inventory entries that are one of these rows: same serial, or same
 * MAC. Pure, for testing.
 * @returns {Object[]} distinct NormalizedCloudDevice entries (by serial)
 */
function matchInventory(inventory, rows) {
  const serials = new Set(rows.map((r) => r.serial).filter(Boolean));
  const macs = new Set(rows.map((r) => normalizeMac(r.macAddress)).filter(Boolean));
  const hits = new Map();
  for (const entry of inventory || []) {
    if (!entry?.serial) continue;
    if (serials.has(entry.serial) || macs.has(normalizeMac(entry.macAddress))) hits.set(entry.serial, entry);
  }
  return [...hits.values()];
}

class DeviceIdentityService {
  /**
   * Ask each cloud integration that owns one of the rows.
   * @returns {Promise<{serial, macAddress, source: 'cloud', label}|null>}
   */
  async fromCloud(rows) {
    const integrationIds = [...new Set(rows.map((r) => r.cloudIntegrationId).filter(Boolean))];
    const found = [];
    for (const id of integrationIds) {
      try {
        const provider = await CloudProviderFactory.forIntegration(id);
        const hits = matchInventory(await provider.listInventory(), rows);
        hits.forEach((entry) => found.push({ entry, label: provider.label }));
      } catch (error) {
        logger.warn('Cloud identity lookup failed', { integrationId: id, error: error.message });
      }
    }
    // Two different cloud devices match these rows: the cloud can't say which.
    const serials = new Set(found.map((f) => f.entry.serial));
    if (serials.size !== 1) return null;
    const { entry, label } = found[0];
    return { serial: entry.serial, macAddress: normalizeMac(entry.macAddress), source: 'cloud', label };
  }

  /**
   * Read serial/MAC from the device. Needs an IP and a linked credential.
   * @returns {Promise<{serial, macAddress}|null>}
   */
  async readFromDevice(device) {
    if (!device.ipAddress || !device.apiCredentialId) return null;
    const credentials = await settingsService.getDeviceCredentialsForUse(device.id);
    if (!credentials) return null;

    let api;
    try {
      api = DeviceAPIFactory.createDeviceAPI(device, credentials);
    } catch {
      return null; // no direct API for this platform (e.g. SSH-only)
    }
    if (api instanceof CXSwitchAPI) {
      try {
        await api.login();
        return await api.getIdentity();
      } finally {
        await api.logout().catch(() => {});
      }
    }
    return api.getIdentity();
  }

  /**
   * Ask the devices themselves (one read per distinct IP).
   * @returns {Promise<{serial, macAddress, source: 'device', label}|null>}
   */
  async fromDevice(rows) {
    const seen = new Set();
    for (const row of rows) {
      if (!row.ipAddress || seen.has(row.ipAddress)) continue;
      seen.add(row.ipAddress);
      try {
        const identity = await withTimeout(this.readFromDevice(row), DEVICE_READ_TIMEOUT_MS, `Reading ${row.name}`);
        if (identity?.serial) {
          return {
            serial: identity.serial,
            macAddress: normalizeMac(identity.macAddress),
            source: 'device',
            label: `the device at ${row.ipAddress}`,
          };
        }
      } catch (error) {
        logger.warn('Device identity read failed', { deviceId: row.id, error: error.message });
      }
    }
    return null;
  }

  /**
   * The real serial/MAC for rows that are one device, or null if unknown.
   * @param {Object[]} rows - full Device rows
   */
  async resolve(rows) {
    return (await this.fromCloud(rows)) || this.fromDevice(rows);
  }
}

const service = new DeviceIdentityService();
module.exports = service;
module.exports.matchInventory = matchInventory;
