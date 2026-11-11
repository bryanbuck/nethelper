const axios = require('axios');
const BaseCloudProvider = require('./base-cloud-provider');
const { redactConfigSecrets } = require('../../utils/config-redact');
const { CLOUD_PROVIDERS } = require('../../constants/vendors');
const { parseMerakiNeighbors } = require('../topology/parsers/meraki');
const { normalizeMac } = require('../../utils/device-key');
const logger = require('../../utils/logger');

/**
 * Cisco Meraki cloud provider (Dashboard API v1). PREVIEW: written from
 * Cisco's OpenAPI spec (github.com/meraki/openapi, v1.76, read 2026-11-10)
 * and not yet run against a live organization. docs/MERAKI.md lists what
 * first contact has to confirm.
 *
 * Auth is an API key sent as `Authorization: Bearer <key>`. A key belongs to a
 * dashboard administrator and sees every organization that admin can, so the
 * integration also names the organization.
 *
 * Endpoints used (all GET; NetHelper never writes to Meraki):
 *   /organizations, /administered/identities/me        - credential check
 *   /organizations/:id/inventory/devices               - every claimed device, assigned or not
 *   /organizations/:id/devices                         - assigned devices: LAN IP, firmware, name
 *   /organizations/:id/devices/availabilities          - status (Meraki refreshes it every 5 min)
 *   /organizations/:id/networks                        - network names (a network is NetHelper's "site")
 *   /devices/:serial + per-product sub-resources       - a device's settings snapshot
 *   /organizations/:id/... and /networks/:id/...       - scope snapshots (ORG_SECTIONS, NETWORK_SECTIONS)
 *   /organizations/:id/switch/ports/topology/discovery/byDevice, /switch/ports/bySwitch,
 *   /networks/:id/topology/linkLayer                   - LLDP/CDP neighbors and switch port VLANs
 *   /networks/:id/clients?ip=                          - who holds an IP (clients are per network)
 *   /organizations/:id/assurance/alerts                - health alerts
 *
 * Config-backup semantics: Meraki has no running-config. A "config" is a
 * snapshot of the settings the Dashboard API returns for a device, or for an
 * organization / network (where most Meraki configuration lives), as canonical
 * JSON so it checksums and diffs.
 *
 * Rate limit: 10 requests/second per organization, shared with every other
 * API client of the org. Calls are spaced out per organization and a 429 is
 * retried after its Retry-After.
 *
 * There is no push stream NetHelper can open (webhooks only, which need a
 * public endpoint), so Meraki stays on the periodic status refresh.
 */

// Largest page each endpoint accepts (spec), capped at 1000.
const PER_PAGE = { default: 1000, alerts: 300, switchPorts: 50, discovery: 20 };
const MAX_PAGES = 200;
const MAX_REDIRECTS = 3;
const MAX_RATE_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30 * 1000;

// One queue per organization, shared by every provider instance (the factory
// builds a new instance per call), so concurrent jobs stay under the org's limit.
const queues = new Map();

// How far back findByAddress looks for clients, and how many networks it asks.
const ADDRESS_TIMESPAN = 7 * 24 * 60 * 60;
const ADDRESS_MAX_NETWORKS = 20;

// Health alerts NetHelper already records itself: device offline and back
// (the cloud status refresh).
const ALARM_SKIP_TYPES = new Set(['unreachable']);
const ALARM_SEVERITY = { critical: 'critical', warning: 'warning', informational: 'info', info: 'info' };
const humanizeType = (type) => String(type || 'alert').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Meraki productType -> Prisma DeviceType. Anything else (camera, sensor,
// systemsManager, ...) is `other`: inventoried, never backed up.
const PRODUCT_TYPES = {
  wireless: 'access_point',
  switch: 'switch',
  appliance: 'gateway',
  cellularGateway: 'gateway',
  campusGateway: 'controller',
  wirelessController: 'controller',
};

// Device-record fields that are state, not settings: they would make every
// DHCP renewal or firmware upgrade look like a config change.
const DEVICE_STATE_FIELDS = ['lanIp', 'wan1Ip', 'wan2Ip', 'firmware', 'configurationUpdatedAt', 'url'];

// A device's settings snapshot: sub-resources of /devices/:serial by productType.
const DEVICE_SECTIONS = {
  all: { managementInterface: 'managementInterface' },
  switch: {
    switchPorts: 'switch/ports',
    routingInterfaces: 'switch/routing/interfaces',
    staticRoutes: 'switch/routing/staticRoutes',
    warmSpare: 'switch/warmSpare',
  },
  wireless: {
    radioSettings: 'wireless/radio/settings',
    bluetoothSettings: 'wireless/bluetooth/settings',
  },
  appliance: { uplinkSettings: 'appliance/uplinks/settings' },
};

// An organization's scope snapshot: /organizations/:id/<path>. `paged` reads
// follow the Link header.
const ORG_SECTIONS = {
  loginSecurity: { path: 'loginSecurity' },
  snmp: { path: 'snmp' },
  alertProfiles: { path: 'alerts/profiles' },
  configTemplates: { path: 'configTemplates' },
  policyObjects: { path: 'policyObjects', paged: true },
  policyObjectGroups: { path: 'policyObjects/groups', paged: true },
  adaptivePolicySettings: { path: 'adaptivePolicy/settings' },
};

// A network's (or a configuration template's) scope snapshot:
// /networks/:id/<path>, by the product types the network holds.
const NETWORK_SECTIONS = {
  all: {
    settings: 'settings',
    snmp: 'snmp',
    alertSettings: 'alerts/settings',
    groupPolicies: 'groupPolicies',
    vlanProfiles: 'vlanProfiles',
    netflow: 'netflow',
    trafficAnalysis: 'trafficAnalysis',
  },
  wireless: {
    wirelessSsids: 'wireless/ssids',
    wirelessRfProfiles: 'wireless/rfProfiles',
    wirelessSettings: 'wireless/settings',
    wirelessBluetoothSettings: 'wireless/bluetooth/settings',
    wirelessAlternateManagementInterface: 'wireless/alternateManagementInterface',
    wirelessEthernetPortProfiles: 'wireless/ethernet/ports/profiles',
  },
  switch: {
    switchSettings: 'switch/settings',
    switchStp: 'switch/stp',
    switchMtu: 'switch/mtu',
    switchAccessControlLists: 'switch/accessControlLists',
    switchAccessPolicies: 'switch/accessPolicies',
    switchLinkAggregations: 'switch/linkAggregations',
    switchStacks: 'switch/stacks',
    switchQosRules: 'switch/qosRules',
    switchQosRulesOrder: 'switch/qosRules/order',
    switchStormControl: 'switch/stormControl',
    switchDhcpServerPolicy: 'switch/dhcpServerPolicy',
    switchDscpToCosMappings: 'switch/dscpToCosMappings',
    switchPortSchedules: 'switch/portSchedules',
    switchOspf: 'switch/routing/ospf',
    switchMulticast: 'switch/routing/multicast',
    switchAlternateManagementInterface: 'switch/alternateManagementInterface',
  },
  appliance: {
    applianceSettings: 'appliance/settings',
    applianceVlansSettings: 'appliance/vlans/settings',
    applianceVlans: 'appliance/vlans',
    applianceSingleLan: 'appliance/singleLan',
    appliancePorts: 'appliance/ports',
    applianceStaticRoutes: 'appliance/staticRoutes',
    applianceFirewallSettings: 'appliance/firewall/settings',
    applianceL3FirewallRules: 'appliance/firewall/l3FirewallRules',
    applianceL7FirewallRules: 'appliance/firewall/l7FirewallRules',
    applianceInboundFirewallRules: 'appliance/firewall/inboundFirewallRules',
    applianceOneToOneNatRules: 'appliance/firewall/oneToOneNatRules',
    applianceOneToManyNatRules: 'appliance/firewall/oneToManyNatRules',
    appliancePortForwardingRules: 'appliance/firewall/portForwardingRules',
    applianceContentFiltering: 'appliance/contentFiltering',
    applianceIntrusion: 'appliance/security/intrusion',
    applianceMalware: 'appliance/security/malware',
    applianceTrafficShaping: 'appliance/trafficShaping',
    applianceTrafficShapingRules: 'appliance/trafficShaping/rules',
    applianceUplinkBandwidth: 'appliance/trafficShaping/uplinkBandwidth',
    applianceUplinkSelection: 'appliance/trafficShaping/uplinkSelection',
    applianceSiteToSiteVpn: 'appliance/vpn/siteToSiteVpn',
    applianceBgp: 'appliance/vpn/bgp',
    applianceWarmSpare: 'appliance/warmSpare',
    applianceSsids: 'appliance/ssids',
  },
};

// Per enabled SSID: /networks/:id/wireless/ssids/:number/<path>.
const SSID_SECTIONS = {
  l3FirewallRules: 'firewall/l3FirewallRules',
  l7FirewallRules: 'firewall/l7FirewallRules',
  trafficShapingRules: 'trafficShaping/rules',
};

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Epoch seconds, epoch milliseconds or an ISO string -> Date, else null. */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value < 1e11 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The `rel=next` URL of an RFC 5988 Link header, or null. */
function nextLink(header) {
  for (const part of String(header || '').split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (match) return match[1];
  }
  return null;
}

/** The site a host belongs to: its last two labels (api.meraki.com and n123.meraki.com -> meraki.com). */
const siteOf = (hostname) => String(hostname).toLowerCase().split('.').slice(-2).join('.');

class MerakiProvider extends BaseCloudProvider {
  /**
   * @param {Object} integration - { id, provider, name, baseUrl,
   *   credentials: { apiKey (decrypted), orgId } }
   */
  constructor(integration) {
    super(integration);
    const { apiKey, orgId } = integration.credentials;
    if (!apiKey || !orgId) {
      throw new Error(`Cisco Meraki integration "${integration.name}" is missing apiKey or orgId`);
    }
    this.baseUrl = String(integration.baseUrl).replace(/\/+$/, '');
  }

  /** Regional API hosts (see constants/vendors.js). */
  static get regionalClouds() {
    return CLOUD_PROVIDERS.cisco_meraki.regions;
  }

  supports(capability) {
    return ['inventory', 'status', 'test', 'config-backup', 'scope-backup', 'topology', 'address-lookup', 'alarms'].includes(capability);
  }

  get orgId() {
    return String(this.integration.credentials.orgId).trim();
  }

  get orgPath() {
    return `/organizations/${encodeURIComponent(this.orgId)}`;
  }

  // ---------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------

  /** Run `task` after the organization's previous call, at least minIntervalMs after it started. */
  throttled(task) {
    const key = `${this.baseUrl}|${this.orgId}`;
    const previous = queues.get(key) || Promise.resolve();
    const run = previous.then(async () => {
      const started = Date.now();
      try {
        return await task();
      } finally {
        const wait = MerakiProvider.minIntervalMs - (Date.now() - started);
        if (wait > 0) await sleep(wait);
      }
    });
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return run;
  }

  /**
   * Whether `url` may receive the API key: https, on the same site as the
   * configured API host. Meraki answers some calls with a redirect to the
   * organization's shard (n123.meraki.com), and pages with absolute links.
   */
  trusted(url) {
    try {
      const target = new URL(url);
      return target.protocol === 'https:' && siteOf(target.hostname) === siteOf(new URL(this.baseUrl).hostname);
    } catch {
      return false;
    }
  }

  /**
   * One GET, with the reply's headers. Redirects are followed by hand so the
   * key only ever goes to a trusted host; a 429 waits out its Retry-After.
   * @returns {Promise<{ data, headers }>}
   */
  async fetch(url, { params, context }) {
    let target = url;
    let query = params;
    let redirects = 0;
    let rateRetries = 0;
    for (;;) {
      let response;
      try {
        response = await this.throttled(() => axios({
          method: 'GET',
          url: target,
          headers: {
            Authorization: `Bearer ${this.integration.credentials.apiKey}`,
            Accept: 'application/json',
          },
          params: query,
          timeout: 30000,
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400,
        }));
      } catch (error) {
        const retryAfter = Number(error.response?.headers?.['retry-after']);
        if (error.response?.status === 429 && rateRetries < MAX_RATE_RETRIES) {
          rateRetries += 1;
          await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000, MAX_RETRY_AFTER_MS) * MerakiProvider.retryScale);
          continue;
        }
        throw this.enhanceError(error, context);
      }
      if (response.status < 300) return { data: response.data, headers: response.headers || {} };

      const location = response.headers?.location;
      const next = location ? new URL(location, target).toString() : null;
      if (!next || !this.trusted(next) || redirects >= MAX_REDIRECTS) {
        const error = new Error(`Cisco Meraki redirected the request somewhere NetHelper won't send the API key (${next ? new URL(next).hostname : 'no location'})`);
        error.statusCode = response.status;
        error.context = context;
        error.isProviderError = true;
        error.details = { context, method: 'GET', endpoint: target, statusCode: response.status };
        throw error;
      }
      redirects += 1;
      target = next;
      query = undefined; // a redirect's Location carries the query
    }
  }

  /** GET `endpoint` (a path under the API base). The signature scripts/probe-cloud.js uses. */
  async request(method, endpoint, { params = {}, context = 'api_call' } = {}) {
    if (method !== 'GET') throw new Error('The Cisco Meraki provider is read-only');
    return (await this.fetch(`${this.baseUrl}${endpoint}`, { params, context })).data;
  }

  /**
   * Follow Meraki's Link-header pagination to the end. A reply is a bare
   * array, or `{ items, meta }` on the newer endpoints.
   */
  async requestAllPages(endpoint, { params = {}, perPage = PER_PAGE.default, context = 'api_call' } = {}) {
    const items = [];
    let url = `${this.baseUrl}${endpoint}`;
    let query = { ...params, perPage };
    for (let page = 1; ; page++) {
      const { data, headers } = await this.fetch(url, { params: query, context });
      const batch = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      items.push(...batch);
      const next = nextLink(headers.link);
      if (!next || !batch.length) break;
      if (!this.trusted(next) || page >= MAX_PAGES) {
        logger.warn(`Meraki pagination stopped for ${endpoint} after ${items.length} items`);
        break;
      }
      url = next;
      query = undefined; // the link carries perPage and the cursor
    }
    return items;
  }

  // ---------------------------------------------------------------------
  // Connection test
  // ---------------------------------------------------------------------

  async testConnection() {
    try {
      const orgs = await this.requestAllPages('/organizations', { context: 'authentication' });
      const org = orgs.find((o) => String(o.id) === this.orgId);
      if (!org) {
        return {
          success: false,
          message: `The API key works, but it cannot see organization ${this.orgId}. Check the organization ID and the region.`,
          details: {
            endpoint: this.baseUrl,
            explanation: `The key can see ${orgs.length} organization${orgs.length === 1 ? '' : 's'} on this API host${orgs.length ? `: ${orgs.slice(0, 5).map((o) => `${o.name} (${o.id})`).join(', ')}${orgs.length > 5 ? ', ...' : ''}` : ''}.`,
            actions: [
              'Copy the organization ID from the Meraki dashboard: Organization → Settings, at the bottom of the page',
              'Pick the region the organization lives in (China, Canada, India and US Government have their own API host)',
            ],
          },
        };
      }
      if (org.api && org.api.enabled === false) {
        return {
          success: false,
          message: `Dashboard API access is turned off for organization "${org.name}".`,
          details: {
            endpoint: this.baseUrl,
            actions: ['Turn it on in the Meraki dashboard: Organization → API & Webhooks (or Organization → Settings → Dashboard API access)'],
          },
        };
      }

      // Who the key belongs to: nice to show, never a reason to fail.
      let email = null;
      try {
        email = (await this.request('GET', '/administered/identities/me', { context: 'authentication' }))?.email || null;
      } catch (error) {
        logger.debug(`Meraki identity read failed for ${this.label}: ${error.message}`);
      }
      return {
        success: true,
        message: `Authenticated with Cisco Meraki${email ? ` as ${email}` : ''}: organization "${org.name}"`,
        details: {
          orgId: this.orgId,
          orgName: org.name,
          ...(email && { email }),
          ...(org.cloud?.region?.name && { region: org.cloud.region.name }),
        },
      };
    } catch (error) {
      return this.testFailure(error);
    }
  }

  // ---------------------------------------------------------------------
  // Inventory and status
  // ---------------------------------------------------------------------

  /** The organization's networks: [{ id, name, productTypes, isBoundToConfigTemplate }]. */
  async listNetworks(context = 'network_list') {
    return this.requestAllPages(`${this.orgPath}/networks`, { context });
  }

  /** Availability rows by serial. */
  async availabilityBySerial(context) {
    const rows = await this.requestAllPages(`${this.orgPath}/devices/availabilities`, { context });
    return new Map(rows.filter((row) => row?.serial).map((row) => [row.serial, row]));
  }

  /**
   * Every device the organization has claimed, enriched with what the
   * assigned-devices list (LAN IP, firmware), the availability list (status)
   * and the network list (site name) know. The inventory read (what exists)
   * and the availability read (the only source of status) are fatal: a sync
   * without status would have to guess it. The other two only enrich.
   */
  async listInventory() {
    const inventory = await this.requestAllPages(`${this.orgPath}/inventory/devices`, { context: 'device_list' });

    const soft = async (what, read, fallback) => {
      try {
        return await read();
      } catch (error) {
        logger.warn(`Meraki ${what} unavailable for ${this.label}, syncing without it: ${error.message}`);
        return fallback;
      }
    };
    const assigned = await soft('device list', () => this.requestAllPages(`${this.orgPath}/devices`, { context: 'device_list' }), []);
    const availability = await this.availabilityBySerial('device_status');
    const networks = await soft('network list', () => this.listNetworks(), []);

    const assignedBySerial = new Map(assigned.filter((d) => d?.serial).map((d) => [d.serial, d]));
    const networkNames = new Map(networks.map((n) => [n.id, n.name]));
    const devices = inventory
      .filter((item) => item?.serial)
      .map((item) => this.normalizeDevice(
        item,
        assignedBySerial.get(item.serial) || null,
        availability.get(item.serial) || null,
        networkNames.get(item.networkId) || null
      ));
    logger.info(`Inventory fetched from ${this.label}: ${devices.length} device(s)`);
    return devices;
  }

  /**
   * Status for the cloud status refresh: the availability list, plus the
   * assigned-devices list for LAN IP and firmware (non-fatal). A device not
   * assigned to a network is in neither; the hourly sync covers it.
   */
  async listStatuses() {
    const availability = await this.availabilityBySerial('device_status');
    let assigned = [];
    try {
      assigned = await this.requestAllPages(`${this.orgPath}/devices`, { context: 'device_status' });
    } catch (error) {
      logger.warn(`Meraki device list unavailable for ${this.label}; status refresh without IP/firmware: ${error.message}`);
    }
    const assignedBySerial = new Map(assigned.filter((d) => d?.serial).map((d) => [d.serial, d]));
    const statuses = new Map();
    for (const [serial, row] of availability) {
      const online = this.isOnline(row.status);
      const device = assignedBySerial.get(serial);
      statuses.set(serial, {
        status: online ? 'online' : 'offline',
        // Meraki's availability carries no last-seen time: online means seen now.
        lastSeen: online ? new Date() : null,
        ipAddress: device?.lanIp || null,
        firmwareVersion: device?.firmware || null,
        cloudConnectionStatus: online ? 'connected' : 'not_reachable',
        configInSync: null,
        configStatus: null,
      });
    }
    return statuses;
  }

  async getDeviceStatus(serial) {
    const rows = await this.requestAllPages(`${this.orgPath}/devices/availabilities`, {
      params: { serials: [serial] },
      context: 'device_status',
    });
    const row = rows.find((r) => r.serial === serial);
    if (!row) throw new Error(`Device ${serial} has no status in ${this.label} (it may not be assigned to a network)`);
    const online = this.isOnline(row.status);
    return { status: online ? 'online' : 'offline', lastSeen: online ? new Date() : null, raw: row };
  }

  /** Meraki availability: online | alerting (up, with a health alert) | offline | dormant (not seen for a week). */
  isOnline(status) {
    return status === 'online' || status === 'alerting';
  }

  mapDeviceType(productType) {
    return PRODUCT_TYPES[productType] || 'other';
  }

  /**
   * Map an inventory record (+ its assigned-device and availability rows) onto
   * the NormalizedCloudDevice contract. A device with no availability row
   * (not assigned to a network) is offline.
   */
  normalizeDevice(item, assigned = null, availability = null, networkName = null) {
    const productType = item.productType || assigned?.productType || null;
    const online = this.isOnline(availability?.status);
    return {
      serial: item.serial,
      name: assigned?.name || item.name || item.serial,
      model: item.model || assigned?.model || '',
      macAddress: item.mac || assigned?.mac || null,
      ipAddress: assigned?.lanIp || null,
      type: this.mapDeviceType(productType),
      vendor: 'cisco',
      platform: 'meraki',
      status: online ? 'online' : 'offline',
      firmwareVersion: assigned?.firmware || null,
      site: networkName || item.networkId || null,
      lastSeen: online ? new Date() : null,
      // A Meraki device in a network takes all of its configuration from the cloud.
      ...(item.networkId && { cloudManaged: true, cloudManagedSource: 'cloud-inventory' }),
      cloudConnectionStatus: online ? 'connected' : 'not_reachable',
      metadata: {
        networkId: item.networkId || null,
        networkName,
        productType,
        sku: item.sku,
        tags: assigned?.tags || item.tags,
        availability: availability?.status,
        claimedAt: item.claimedAt,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Settings snapshots (config backups)
  // ---------------------------------------------------------------------

  /**
   * Read each section; a section this device, network or licence doesn't have
   * (400/404) is null, anything else fails the snapshot. Sequential, to stay
   * gentle on the organization's shared rate limit.
   * @param {Object<string, () => Promise>} sections
   */
  async readSections(sections) {
    const out = {};
    let readable = 0;
    for (const [key, read] of Object.entries(sections)) {
      try {
        out[key] = this.sortById(await read());
        readable += 1;
      } catch (error) {
        if (error.statusCode !== 400 && error.statusCode !== 404) throw error;
        out[key] = null;
      }
    }
    return { out, readable };
  }

  /**
   * A list whose items all carry an `id` is a set of objects, returned in no
   * promised order: sort it so diffs stay quiet. Lists without ids (firewall
   * rules, ACLs) are ordered on purpose and left alone.
   */
  sortById(value) {
    if (!Array.isArray(value) || !value.length) return value;
    const hasId = (item) => item && typeof item === 'object' && (typeof item.id === 'string' || typeof item.id === 'number');
    if (!value.every(hasId)) return value;
    return [...value].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  }

  /**
   * Snapshot the settings Meraki holds for one device: its record, its
   * management interface, and the per-product settings (switch ports and
   * layer-3 interfaces, AP radio settings, appliance uplinks). The rest of a
   * Meraki device's configuration is its network's: see the scope backups.
   */
  async getDeviceConfiguration(serial) {
    const path = `/devices/${encodeURIComponent(serial)}`;
    let device;
    try {
      device = await this.request('GET', path, { context: 'device_config' });
    } catch (error) {
      if (error.statusCode !== 404) throw error;
      this.unsupported(
        'config-backup',
        `Meraki has no settings for ${serial}: it is not assigned to a network (or is no longer in this organization)`
      );
    }

    const productType = device.productType || null;
    if (!DEVICE_SECTIONS[productType]) {
      this.unsupported(
        'config-backup',
        `${serial} is a ${productType || 'device'} NetHelper keeps no settings snapshot for (switches, access points and appliances only)`
      );
    }

    const record = { ...device };
    for (const field of DEVICE_STATE_FIELDS) delete record[field];

    const paths = { ...DEVICE_SECTIONS.all, ...DEVICE_SECTIONS[productType] };
    const { out } = await this.readSections(Object.fromEntries(
      Object.entries(paths).map(([key, sub]) => [key, () => this.request('GET', `${path}/${sub}`, { context: 'device_config' })])
    ));

    return {
      text: this.canonicalJson(redactConfigSecrets({ device: record, ...out })),
      format: 'meraki-settings-json',
      source: this.label,
    };
  }

  /** The organization, its configuration templates, then every network, by name. */
  async listConfigScopes() {
    const org = await this.request('GET', this.orgPath, { context: 'scope_list' });
    const networks = await this.listNetworks('scope_list');
    let templates = [];
    try {
      templates = await this.request('GET', `${this.orgPath}/configTemplates`, { context: 'scope_list' });
    } catch (error) {
      logger.warn(`Meraki configuration templates unavailable for ${this.label}: ${error.message}`);
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    return [
      { scopeType: 'org', scopeId: this.orgId, name: org?.name || this.orgId },
      ...(Array.isArray(templates) ? templates : [])
        .map((t) => ({ scopeType: 'config-template', scopeId: t.id, name: t.name || t.id }))
        .sort(byName),
      ...networks
        .map((n) => ({ scopeType: 'network', scopeId: n.id, name: n.name || n.id }))
        .sort(byName),
    ];
  }

  /**
   * Snapshot an organization's, a network's or a configuration template's
   * settings as one canonical-JSON bundle. This is where Meraki keeps what
   * devices inherit: SSIDs, RF profiles, switch settings and ACLs, appliance
   * VLANs, firewall and VPN rules.
   */
  async getScopeConfiguration(scope) {
    const bundle = { scope: { type: scope.scopeType, id: scope.scopeId, name: scope.name } };
    const get = (path) => () => this.request('GET', path, { context: 'scope_config' });

    if (scope.scopeType === 'org') {
      bundle.organization = await this.request('GET', this.orgPath, { context: 'scope_config' });
      const { out } = await this.readSections(Object.fromEntries(
        Object.entries(ORG_SECTIONS).map(([key, { path, paged }]) => [
          key,
          paged ? () => this.requestAllPages(`${this.orgPath}/${path}`, { context: 'scope_config' }) : get(`${this.orgPath}/${path}`),
        ])
      ));
      Object.assign(bundle, out);
    } else if (scope.scopeType === 'network' || scope.scopeType === 'config-template') {
      const base = `/networks/${encodeURIComponent(scope.scopeId)}`;
      let productTypes;
      if (scope.scopeType === 'network') {
        bundle.network = await this.request('GET', base, { context: 'scope_config' });
        productTypes = bundle.network?.productTypes || [];
      } else {
        const templates = await this.request('GET', `${this.orgPath}/configTemplates`, { context: 'scope_config' });
        bundle.template = (Array.isArray(templates) ? templates : []).find((t) => t.id === scope.scopeId) || null;
        if (!bundle.template) throw new Error(`Configuration template ${scope.name} is no longer in ${this.label}`);
        productTypes = bundle.template.productTypes || [];
      }

      const paths = { ...NETWORK_SECTIONS.all };
      for (const type of productTypes) Object.assign(paths, NETWORK_SECTIONS[type] || {});
      const { out, readable } = await this.readSections(Object.fromEntries(
        Object.entries(paths).map(([key, sub]) => [key, get(`${base}/${sub}`)])
      ));
      if (!readable) throw new Error(`Meraki returned no settings for ${scope.scopeType} ${scope.name}`);
      Object.assign(bundle, out);

      // Firewall and shaping rules hang off each SSID; read them for the enabled ones.
      const enabled = (Array.isArray(out.wirelessSsids) ? out.wirelessSsids : []).filter((ssid) => ssid?.enabled);
      if (enabled.length) {
        bundle.wirelessSsidRules = {};
        for (const ssid of enabled) {
          const ssidBase = `${base}/wireless/ssids/${encodeURIComponent(ssid.number)}`;
          bundle.wirelessSsidRules[ssid.number] = (await this.readSections(Object.fromEntries(
            Object.entries(SSID_SECTIONS).map(([key, sub]) => [key, get(`${ssidBase}/${sub}`)])
          ))).out;
        }
      }
    } else {
      this.unsupported('scope-backup', `Meraki has no "${scope.scopeType}" scope`);
    }

    return {
      text: this.canonicalJson(redactConfigSecrets(bundle)),
      format: 'meraki-scope-json',
      source: this.label,
    };
  }

  // ---------------------------------------------------------------------
  // Topology
  // ---------------------------------------------------------------------

  /**
   * LLDP/CDP neighbors for every device in the organization. Switches come
   * from two org-wide reads (discovery per port, and the port configuration
   * for their VLANs); APs and appliances from their network's link-layer
   * topology, one call per network that has any. A failed network read costs
   * that network's AP/appliance links, not the run.
   */
  async listNeighbors() {
    const availability = await this.availabilityBySerial('neighbors');
    const discovery = await this.requestAllPages(`${this.orgPath}/switch/ports/topology/discovery/byDevice`, {
      perPage: PER_PAGE.discovery,
      context: 'neighbors',
    });

    let switchPorts = [];
    try {
      switchPorts = await this.requestAllPages(`${this.orgPath}/switch/ports/bySwitch`, {
        perPage: PER_PAGE.switchPorts,
        context: 'neighbors',
      });
    } catch (error) {
      logger.warn(`Meraki switch ports unavailable for ${this.label}; neighbors without VLANs: ${error.message}`);
    }

    const networks = new Set();
    for (const row of availability.values()) {
      if (row.productType !== 'switch' && this.isOnline(row.status) && row.network?.id) networks.add(row.network.id);
    }
    const linkLayers = [];
    for (const networkId of networks) {
      try {
        linkLayers.push(await this.request('GET', `/networks/${encodeURIComponent(networkId)}/topology/linkLayer`, { context: 'neighbors' }));
      } catch (error) {
        logger.debug(`Meraki link-layer topology unavailable for network ${networkId}: ${error.message}`);
      }
    }

    return parseMerakiNeighbors({ availabilities: [...availability.values()], discovery, switchPorts, linkLayers });
  }

  // ---------------------------------------------------------------------
  // Address lookup
  // ---------------------------------------------------------------------

  /**
   * Who holds `ip`: Meraki's own devices (by LAN IP) and the clients it has
   * seen with it. Clients are listed per network, so networks whose devices
   * share the address's /24 are asked first, and at most
   * ADDRESS_MAX_NETWORKS in all.
   */
  async findByAddress(ip) {
    const devices = await this.requestAllPages(`${this.orgPath}/devices`, { context: 'address_lookup' });
    const holders = devices.filter((d) => d.lanIp === ip);

    let availability = new Map();
    if (holders.length) {
      try {
        const rows = await this.requestAllPages(`${this.orgPath}/devices/availabilities`, {
          params: { serials: holders.map((d) => d.serial) },
          context: 'address_lookup',
        });
        availability = new Map(rows.map((row) => [row.serial, row]));
      } catch (error) {
        logger.debug(`Meraki availability unavailable for the address lookup: ${error.message}`);
      }
    }

    const prefix = ip.split('.').slice(0, 3).join('.');
    const near = new Set(devices.filter((d) => d.networkId && String(d.lanIp || '').startsWith(`${prefix}.`)).map((d) => d.networkId));
    const networks = (await this.listNetworks('address_lookup'))
      .sort((a, b) => Number(near.has(b.id)) - Number(near.has(a.id)));
    if (networks.length > ADDRESS_MAX_NETWORKS) {
      logger.info(`Meraki address lookup for ${ip}: asking ${ADDRESS_MAX_NETWORKS} of ${networks.length} networks`);
    }

    const clients = [];
    for (const network of networks.slice(0, ADDRESS_MAX_NETWORKS)) {
      try {
        const rows = await this.request('GET', `/networks/${encodeURIComponent(network.id)}/clients`, {
          params: { ip, timespan: ADDRESS_TIMESPAN, perPage: 20 },
          context: 'address_lookup',
        });
        // `ip` matches partially (10.0.0.1 also finds 10.0.0.10).
        clients.push(...(Array.isArray(rows) ? rows : []).filter((client) => client.ip === ip));
      } catch (error) {
        // A network without client tracking (e.g. cameras only) answers 400/404.
        if (error.statusCode !== 400 && error.statusCode !== 404) throw error;
      }
    }

    return [
      ...holders.map((d) => this.deviceHolder(d, availability.get(d.serial))),
      ...clients.map((c) => this.clientHolder(c)),
    ];
  }

  deviceHolder(device, availability) {
    return {
      kind: 'device', name: device.name || device.serial, mac: normalizeMac(device.mac), serial: device.serial || null,
      model: device.model || null,
      status: availability ? (this.isOnline(availability.status) ? 'online' : 'offline') : null,
      lastSeen: null, manufacturer: 'Cisco Meraki', connectedTo: null,
    };
  }

  clientHolder(client) {
    const status = { online: 'connected', offline: 'disconnected' }[String(client.status || '').toLowerCase()] || null;
    const vlan = client.vlan === '' || client.vlan === null || client.vlan === undefined ? null : client.vlan;
    return {
      kind: 'client', name: client.description || client.user || null, mac: normalizeMac(client.mac), serial: null,
      model: client.deviceTypePrediction || client.os || null, status, lastSeen: toDate(client.lastSeen),
      manufacturer: client.manufacturer || null,
      connectedTo: {
        name: client.recentDeviceName || null,
        serial: client.recentDeviceSerial || null,
        mac: normalizeMac(client.recentDeviceMac),
        port: client.switchport || null,
        vlan,
        ssid: client.ssid || null,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Alarms
  // ---------------------------------------------------------------------

  /**
   * Organization health alerts: the active list (so a stored active alarm
   * missing from it has cleared), plus those resolved since `since`.
   */
  async listAlarms({ since }) {
    const endpoint = `${this.orgPath}/assurance/alerts`;
    const active = await this.requestAllPages(endpoint, {
      params: { active: true },
      perPage: PER_PAGE.alerts,
      context: 'alarms',
    });
    const resolved = await this.requestAllPages(endpoint, {
      params: { active: false, resolved: true, tsStart: new Date(since).toISOString() },
      perPage: PER_PAGE.alerts,
      context: 'alarms',
    });

    const keep = (alert) => alert?.id && !ALARM_SKIP_TYPES.has(alert.type);
    const byId = new Map();
    for (const alert of [...resolved, ...active]) if (keep(alert)) byId.set(String(alert.id), alert);
    return {
      alarms: [...byId.values()].map((alert) => this.normalizeAlarm(alert)),
      activeIds: active.filter(keep).filter((alert) => !alert.resolvedAt && !alert.dismissedAt).map((alert) => String(alert.id)),
    };
  }

  normalizeAlarm(alert) {
    const raisedAt = toDate(alert.startedAt) || new Date();
    const resolvedAt = toDate(alert.resolvedAt);
    const dismissedAt = toDate(alert.dismissedAt);
    const cleared = Boolean(resolvedAt || dismissedAt);
    const devices = Array.isArray(alert.scope?.devices) ? alert.scope.devices : [];
    const ports = devices.map((d) => d?.lldp?.port).filter(Boolean);
    return {
      externalId: String(alert.id),
      type: alert.type || 'alert',
      name: alert.title || humanizeType(alert.type),
      category: alert.categoryType || null,
      severity: ALARM_SEVERITY[String(alert.severity).toLowerCase()] || 'info',
      stateful: true,
      status: cleared ? 'cleared' : 'active',
      raisedAt,
      lastSeenAt: resolvedAt || dismissedAt || raisedAt,
      clearedAt: cleared ? resolvedAt || dismissedAt : null,
      clearedReason: cleared && !resolvedAt ? 'dismissed' : null,
      summary: alert.description || null,
      siteName: alert.network?.name || null,
      count: 1,
      serials: devices.map((d) => d?.serial).filter(Boolean),
      macs: devices.map((d) => normalizeMac(d?.mac)).filter(Boolean),
      hostnames: devices.map((d) => d?.name).filter(Boolean),
      data: {
        ...(alert.network?.id && { networkId: alert.network.id }),
        ...(alert.deviceType && { deviceType: alert.deviceType }),
        ...(ports.length && { ports }),
      },
    };
  }

  // ---------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------

  enhanceError(error, context) {
    if (error.name === 'CapabilityError' || error.isProviderError) return error;

    const status = error.response?.status;
    const body = error.response?.data;
    const detail = Array.isArray(body?.errors) ? body.errors.join('; ') : (typeof body === 'string' ? body.slice(0, 200) : null);
    let message;
    let actions;

    if (status === 401) {
      message = `Cisco Meraki rejected the API key (401). Check the key and the region (${this.baseUrl}).`;
      actions = [
        'Check the key was copied whole and has not been revoked (dashboard: your profile → API access)',
        'Pick the region the organization lives in: a key only works on its own region\'s API host',
      ];
    } else if (status === 403) {
      message = `Cisco Meraki denied access (403)${detail ? `: ${detail}` : ''}. The key's administrator may lack access to organization ${this.orgId}, or its API access is turned off.`;
      actions = [
        'Use a key of an administrator with at least read-only access to the whole organization',
        'Check Dashboard API access is enabled: Organization → API & Webhooks',
      ];
    } else if (status === 404 && (context === 'authentication' || context === 'device_list')) {
      message = `Cisco Meraki has no organization ${this.orgId} this key can see (404). Check the organization ID and the region.`;
      actions = ['Copy the organization ID from Organization → Settings in the Meraki dashboard'];
    } else if (status === 429) {
      message = 'Cisco Meraki rate limit exceeded (10 requests/second per organization). Try again shortly.';
      actions = ['Other tools using the same organization share the limit'];
    } else if (status) {
      message = `Cisco Meraki API error (${status})${detail ? `: ${detail}` : ''}`;
    } else {
      message = `Could not reach Cisco Meraki at ${this.baseUrl}: ${error.message}`;
    }

    const wrapped = new Error(message);
    wrapped.statusCode = status;
    wrapped.context = context;
    wrapped.originalError = error;
    wrapped.isProviderError = true;
    if (actions) wrapped.actions = actions;
    wrapped.details = {
      ...(actions && { actions }),
      context,
      ...(error.config?.method && { method: error.config.method.toUpperCase() }),
      ...(error.config?.url && { endpoint: error.config.url }),
      ...(status && { statusCode: status }),
      ...(detail && { providerMessage: String(detail) }),
      ...(!status && error.code && { providerError: error.code }),
    };
    return wrapped;
  }
}

// Spacing between two calls to one organization (5/s: half of Meraki's limit,
// leaving room for the org's other API clients). Tests set both to 0.
MerakiProvider.minIntervalMs = 200;
MerakiProvider.retryScale = 1;

module.exports = MerakiProvider;
module.exports.nextLink = nextLink;
module.exports.SECTIONS = { DEVICE_SECTIONS, ORG_SECTIONS, NETWORK_SECTIONS, SSID_SECTIONS };
