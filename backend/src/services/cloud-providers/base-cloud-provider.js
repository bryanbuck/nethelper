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
 *     cloudManaged, cloudManagedSource, cloudConnectionStatus,
 *     // optional: true/false when the device runs the config the cloud
 *     // intends, null when the cloud's answer means neither
 *     configInSync }
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
   * Every neighbor the cloud plane knows, for all of its devices in one pass:
   * a few org- or site-wide reads rather than a call per device (Mist allows
   * 5,000 requests/hour per org). Neighbors are normalized as in
   * services/topology/neighbor.js. topology.service reads this once per
   * collection run and per integration.
   * @returns {Promise<Map<string, {neighbors: Object[], identity: {chassisId, sysName}, online: boolean}>>}
   *   by device serial; a device the cloud has no neighbor data for is absent
   */
  async listNeighbors() {
    this.unsupported('topology');
  }

  /**
   * Current status of every device, for the cloud status refresh
   * (services/cloud-status.service.js), which only updates rows sync made.
   * Defaults to a full inventory read; a provider with a cheaper read
   * overrides it.
   * @returns {Promise<Map<string, CloudDeviceStatus>>} by serial, where
   *   CloudDeviceStatus = { status, lastSeen, ipAddress, firmwareVersion,
   *   cloudConnectionStatus, configInSync, configStatus }
   */
  async listStatuses() {
    const devices = await this.listInventory();
    return new Map(devices.filter((d) => d.serial).map((d) => [d.serial, this.statusOf(d)]));
  }

  /**
   * What this cloud knows holds an IPv4 address, for "Who has this address?"
   * (services/address-lookup.service.js): its own devices and the clients it
   * has seen with that IP. A few org-wide reads, never one per device.
   * @param {string} ip
   * @returns {Promise<AddressHolder[]>} where AddressHolder =
   *   { kind: 'device'|'client', name, mac, serial, model,
   *     status: 'online'|'offline'|'connected'|'disconnected'|null, lastSeen,
   *     manufacturer, connectedTo: { name, serial, mac, port, vlan, ssid } | null }
   */
  async findByAddress(ip) { // eslint-disable-line no-unused-vars
    this.unsupported('address-lookup');
  }

  /**
   * Alarms the cloud raised since `since`, for the read-only mirror
   * (services/cloud-alarm.service.js). Device-related alarms only; types
   * that only repeat what NetHelper already records (device offline/online,
   * restarts) are left out by the provider.
   * @param {{ since: Date }} options
   * @returns {Promise<{ alarms: NormalizedAlarm[], activeIds: string[]|null }>}
   *   activeIds: every stateful alarm the cloud holds active now (a stored
   *   active alarm missing from it has cleared), or null when the provider
   *   has no such list. NormalizedAlarm = { externalId, type, name,
   *   category, severity: 'critical'|'warning'|'info', stateful,
   *   status: 'active'|'cleared'|'event', raisedAt, lastSeenAt, clearedAt,
   *   clearedReason, summary, siteName, count, serials: [], macs: [],
   *   hostnames: [], data }
   */
  async listAlarms(options) { // eslint-disable-line no-unused-vars
    this.unsupported('alarms');
  }

  /**
   * Channels for openEventStream(), e.g. one per site. Read again when the
   * stream reconnects and periodically, so new sites are picked up.
   * @returns {Promise<string[]>}
   */
  async listEventChannels() {
    this.unsupported('events');
  }

  /**
   * An unopened push stream from the cloud plane (services/cloud/): an
   * EventEmitter with open(), close(), subscribe(), unsubscribe() and the
   * events `open`, `data` ({ channel, data }) and `close` ({ code, error }).
   * The stream is read-only; services/cloud/cloud-stream.service.js owns
   * reconnects and what the data means.
   */
  openEventStream(channels) { // eslint-disable-line no-unused-vars
    this.unsupported('events');
  }

  /** The status fields of a NormalizedCloudDevice. */
  statusOf(device) {
    return {
      status: device.status,
      lastSeen: device.lastSeen || null,
      ipAddress: device.ipAddress || null,
      firmwareVersion: device.firmwareVersion || null,
      cloudConnectionStatus: device.cloudConnectionStatus || null,
      configInSync: typeof device.configInSync === 'boolean' ? device.configInSync : null,
      configStatus: device.metadata?.configStatus ?? null,
    };
  }

  /**
   * Capability probe used by transport routing and the UI.
   * @param {string} capability - 'inventory' | 'status' | 'config-backup' | 'scope-backup' | 'topology' | 'events' | 'address-lookup' | 'alarms' | 'test'
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
