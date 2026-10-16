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
 *     metadata }       // provider-specific leftovers, persisted to Device.metadata
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

  /**
   * Capability probe used by transport routing and the UI.
   * @param {string} capability - 'inventory' | 'status' | 'config-backup' | 'test'
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

  /** Helper for subclasses: throw a typed unsupported-capability error. */
  unsupported(capability, detail) {
    throw new CapabilityError(
      `${this.label} does not support "${capability}"${detail ? `: ${detail}` : ''}`,
      { provider: this.providerType, capability }
    );
  }
}

module.exports = BaseCloudProvider;
