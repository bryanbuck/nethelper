const { CapabilityError } = require('./errors');

/**
 * Base Cloud Provider
 *
 * Interface for cloud management planes (Aruba Central, Juniper Mist,
 * Cisco Meraki). One instance per CloudIntegration row — a single tenant/org
 * of one provider. Multiple integrations, including several of the same
 * provider, may be active at the same time; nothing here is a singleton.
 *
 * This is the many-devices analog of device-api/base-device-api.js (which
 * talks to ONE device directly). Cloud-managed devices do not get a DeviceAPI
 * client; they route through their integration's provider instance.
 *
 * Subclasses receive the integration row with credentials ALREADY decrypted
 * (the factory handles decryption) and must implement the methods marked
 * required. Optional methods throw CapabilityError by default so callers can
 * distinguish "provider can't do this" from real failures.
 *
 * All device-returning methods must yield NormalizedCloudDevice objects:
 *   { serial, name, model, macAddress, ipAddress,
 *     type,            // Prisma DeviceType value
 *     vendor,          // Prisma Vendor value
 *     platform,        // constants/vendors.js platform id or null
 *     status,          // Prisma DeviceStatus value
 *     firmwareVersion, site, lastSeen,   // nullable extras
 *     metadata,        // provider-specific leftovers, merged into Device.metadata
 *     // optional, when the plane knows who owns the device's config:
 *     cloudManaged, cloudManagedSource, cloudConnectionStatus }
 */
class BaseCloudProvider {
  /**
   * @param {Object} integration - CloudIntegration row (or equivalent) with
   *   decrypted `credentials`; needs at least { id, provider, name, baseUrl, credentials }
   */
  constructor(integration) {
    if (!integration || !integration.baseUrl || !integration.credentials) {
      throw new Error(`${this.constructor.name} requires an integration with baseUrl and credentials`);
    }
    this.integration = integration;
  }

  get id() {
    return this.integration.id;
  }

  get providerType() {
    return this.integration.provider;
  }

  get label() {
    return `${this.integration.name} (${this.integration.provider})`;
  }

  /** Verify credentials/reachability. @returns {Promise<{success, message, details?}>} */
  async testConnection() {
    throw new Error(`testConnection() is not implemented for ${this.providerType}`);
  }

  /** Full device inventory of this tenant/org. @returns {Promise<Array>} NormalizedCloudDevice[] */
  async listInventory() {
    throw new Error(`listInventory() is not implemented for ${this.providerType}`);
  }

  /** Current status of one device. @returns {Promise<{status, lastSeen, raw}>} */
  async getDeviceStatus(serial) { // eslint-disable-line no-unused-vars
    this.unsupported('status');
  }

  /** Device configuration from the cloud plane. @returns {Promise<{text, format, source}>} */
  async getDeviceConfiguration(serial) { // eslint-disable-line no-unused-vars
    this.unsupported('config-backup');
  }

  /** Push config to a device through the cloud plane. No provider does this yet. */
  async updateDeviceConfiguration(serial, configuration) { // eslint-disable-line no-unused-vars
    this.unsupported('config-write');
  }

  /** Ask the cloud plane to take a config backup of its own. */
  async backupConfiguration(serial) { // eslint-disable-line no-unused-vars
    this.unsupported('config-backup');
  }

  /** Run a CLI command on a device through the cloud plane. */
  async executeCommand(serial, command) { // eslint-disable-line no-unused-vars
    this.unsupported('command-execution');
  }

  /** Time-series stats for one device. */
  async getDeviceStats(serial, metric, duration) { // eslint-disable-line no-unused-vars
    this.unsupported('stats');
  }

  /**
   * Configuration scopes above the device that this plane holds config for
   * (a Mist org and its sites; Central's global scope, site collections,
   * sites and device groups). Access points are configured here rather than
   * per device, so this is where their config is backed up.
   * @returns {Promise<Array<{ scopeType: 'org'|'site-collection'|'site'|'device-group', scopeId: string, name: string }>>}
   */
  async listConfigScopes() {
    this.unsupported('scope-backup');
  }

  /**
   * Snapshot one scope's configuration (see listConfigScopes).
   * @param {{ scopeType, scopeId, name }} scope
   * @returns {Promise<{text, format, source}>}
   */
  async getScopeConfiguration(scope) { // eslint-disable-line no-unused-vars
    this.unsupported('scope-backup');
  }

  /**
   * LLDP neighbors the cloud plane knows for one device (e.g. a Mist AP's
   * uplink switch and port), normalized as in services/topology/neighbor.js.
   * Not implemented by any provider yet: the response fields need checking
   * against a live tenant first (docs/ROADMAP_AND_TODO.md, Network Map).
   * @returns {Promise<{neighbors: Object[], identity: {chassisId, sysName}}>}
   */
  async getNeighbors(device) { // eslint-disable-line no-unused-vars
    this.unsupported('topology');
  }

  /**
   * Capability probe used by transport routing and the UI.
   * @param {string} capability - 'inventory' | 'status' | 'config-backup' | 'scope-backup' | 'topology' | 'test'
   * @returns {boolean}
   */
  supports(capability) { // eslint-disable-line no-unused-vars
    return false;
  }

  /**
   * Helper for subclasses: a failed testConnection() result that keeps the
   * diagnostics (endpoint, status, provider error, suggested actions) the
   * error carries in `details`, so the settings UI can show more than a toast.
   */
  testFailure(error) {
    return {
      success: false,
      message: error.message,
      ...(error.details && { details: error.details }),
    };
  }

  /** Stable JSON: sorted keys, so diffs show real changes, not key reordering. */
  canonicalJson(value) {
    const sortKeys = (node) => {
      if (Array.isArray(node)) return node.map(sortKeys);
      if (node && typeof node === 'object') {
        return Object.keys(node)
          .sort()
          .reduce((acc, key) => {
            acc[key] = sortKeys(node[key]);
            return acc;
          }, {});
      }
      return node;
    };
    return JSON.stringify(sortKeys(value), null, 2);
  }

  /** Helper for subclasses: throw a typed unsupported-capability error. */
  unsupported(capability, detail) {
    throw new CapabilityError(
      `${this.label} does not support "${capability}"${detail ? `: ${detail}` : ''}`,
      { provider: this.providerType, capability }
    );
  }
}

module.exports = BaseCloudProvider;
