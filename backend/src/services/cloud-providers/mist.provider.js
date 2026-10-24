const axios = require('axios');
const BaseCloudProvider = require('./base-cloud-provider');
const { redactConfigSecrets } = require('../../utils/config-redact');
const { CLOUD_PROVIDERS } = require('../../constants/vendors');
const { parseMistNeighbors } = require('../topology/parsers/mist');
const { MistStream } = require('../cloud/mist-stream');
const { normalizeMac } = require('../../utils/device-key');
const logger = require('../../utils/logger');

/**
 * Juniper Mist cloud provider.
 *
 * Auth is a simple org API token (`Authorization: Token <key>`) — no OAuth
 * dance, so unlike the Central provider there is nothing to cache in Redis.
 *
 * Endpoints used (verified against the official OpenAPI spec,
 * github.com/mistsys/mist_openapi):
 *   GET /api/v1/self                          - credential check
 *   GET /api/v1/orgs/:org_id/inventory        - inventory (paginated)
 *   GET /api/v1/orgs/:org_id/stats/devices    - live stats (ip, version, uptime)
 *   GET /api/v1/sites/:site_id/devices/:id    - a device's Mist config object
 *   GET /api/v1/orgs/:org_id/stats/ports/search - switch/gateway LLDP neighbors per port
 *   GET /api/v1/orgs/:org_id/{devices,wired_clients,clients}/search?ip= - who holds an IP
 *   WSS api-ws.<region>/api-ws/v1/stream   - /sites/:site_id/stats/devices (cloud/mist-stream.js)
 *   Scope backups (org and site config, where AP config lives):
 *   GET /api/v1/orgs/:org_id, /orgs/:org_id/sites
 *   GET /api/v1/orgs/:org_id/{setting,wlans,templates,rftemplates,
 *       deviceprofiles,networktemplates,sitetemplates,gatewaytemplates}
 *   GET /api/v1/sites/:site_id, /sites/:site_id/{setting,wlans}
 *
 * Config-backup semantics: Mist is intent-based, so a "config" is the device's
 * Mist configuration object, not a running-config. (The `config_cmd` endpoint
 * only returns the CLI Mist *would* generate when adopting a brownfield switch,
 * which is not the device's actual state.) We snapshot the config object as
 * canonical JSON so it checksums and diffs meaningfully. For a true Junos
 * running-config, reach the device directly over SSH — see the junos platform.
 *
 * Rate limit: 5,000 requests/hour per org.
 */

const PAGE_LIMIT = 1000; // Mist caps `limit` at 1000 (default 100)

// Device stats fields sync reads. Without `fields` the reply leaves out
// config_status; `fields=*` adds everything (interface tables, clients) and
// grows to kilobytes per device. A list returns exactly the fields named.
const STATS_FIELDS = ['mac', 'ip', 'version', 'last_seen', 'status', 'uptime', 'config_status'];
// The only config_status value seen live (2026-10-19) is NO_CHANGE: in sync.
// Others are not documented well enough to call out of sync.
const mistConfigInSync = (value) => (value === 'NO_CHANGE' ? true : null);

// What the neighbor read needs: an AP's LLDP view of its uplink.
const NEIGHBOR_FIELDS = ['mac', 'serial', 'status', 'name', 'hostname', 'lldp_stat', 'lldp_stats'];

// How far back findByAddress searches. Wired client search defaults to a day,
// wireless to two weeks; one window keeps the answers comparable.
const ADDRESS_WINDOW = '7d';

// Alarm groups the mirror reads: device and site infrastructure, and Marvis
// (VNA licence; the only group with open/resolved status).
const ALARM_GROUPS = ['infrastructure', 'marvis'];
// Infrastructure alarms NetHelper already records itself: device offline and
// back (cloud status refresh) and restarts (event stream).
const ALARM_SKIP_TYPES = new Set([
  'device_down', 'device_reconnected', 'device_restarted',
  'switch_down', 'switch_reconnected', 'switch_restarted',
  'gateway_down', 'gateway_reconnected',
]);
const ALARM_SEVERITY = { critical: 'critical', major: 'critical', warn: 'warning', warning: 'warning', minor: 'warning' };
// GET /api/v1/const/alarm_defs per API host: display names, read once per process.
const alarmDefsCache = new Map();
const humanizeType = (type) => type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const fromEpoch = (seconds) => (seconds ? new Date(seconds * 1000) : null);
const first = (value) => (Array.isArray(value) ? value[0] : value) || null;

/** A devices/search result (no serial or status there; `timestamp` is its last report). */
function mistDeviceHolder(item) {
  return {
    kind: 'device', name: item.last_hostname || first(item.hostname), mac: normalizeMac(item.mac), serial: null,
    model: item.model || null, status: null, lastSeen: fromEpoch(item.timestamp), manufacturer: null, connectedTo: null,
  };
}

/** A wired_clients/search result: the port it holds `ip` on, else its latest port. */
function mistWiredHolder(item, ip) {
  const ports = item.device_mac_port || [];
  const port = ports.filter((p) => p.ip === ip).sort((a, b) => String(b.when).localeCompare(String(a.when)))[0] || null;
  const seen = port?.when ? new Date(port.when) : fromEpoch(item.timestamp);
  return {
    kind: 'client', name: item.last_hostname || first(item.hostname), mac: normalizeMac(item.mac), serial: null,
    model: null, status: null, lastSeen: Number.isNaN(seen?.getTime()) ? null : seen, manufacturer: item.manufacture || null,
    connectedTo: {
      name: null, serial: null,
      mac: normalizeMac(port?.device_mac || item.last_device_mac),
      port: port?.port_id || item.last_port_id || null,
      vlan: port?.vlan ?? item.last_vlan ?? null,
      ssid: null,
    },
  };
}

/** A clients/search (wireless) result. Field names from Mist's spec; no live sample yet. */
function mistWirelessHolder(item) {
  return {
    kind: 'client', name: item.last_hostname || first(item.hostname), mac: normalizeMac(item.mac), serial: null,
    model: item.last_model || null, status: null, lastSeen: fromEpoch(item.timestamp), manufacturer: item.manufacture || null,
    connectedTo: {
      name: null, serial: null, mac: normalizeMac(item.last_ap || first(item.ap)), port: null,
      vlan: item.last_vlan ?? null, ssid: item.last_ssid || first(item.ssid),
    },
  };
}

class MistProvider extends BaseCloudProvider {
  /**
   * @param {Object} integration - { id, provider, name, baseUrl,
   *   credentials: { apiToken (decrypted), orgId } }
   */
  constructor(integration) {
    super(integration);
    const { apiToken, orgId } = integration.credentials;
    if (!apiToken || !orgId) {
      throw new Error(`Juniper Mist integration "${integration.name}" is missing apiToken or orgId`);
    }
  }

  /** Regional clouds a Mist org can live in (see constants/vendors.js). */
  static get regionalClouds() {
    return CLOUD_PROVIDERS.juniper_mist.regions;
  }

  supports(capability) {
    return ['inventory', 'status', 'test', 'config-backup', 'scope-backup', 'topology', 'events', 'address-lookup', 'alarms'].includes(capability);
  }

  get orgId() {
    return this.integration.credentials.orgId;
  }

  /**
   * The org's WebSocket stream: every regional cloud serves it on its API
   * host with `api-ws.` for `api.` (api.ac2.mist.com → api-ws.ac2.mist.com).
   * Null for a base URL that isn't a Mist API host.
   */
  get streamUrl() {
    let url;
    try {
      url = new URL(this.integration.baseUrl);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !/^api\.([a-z0-9-]+\.)?mist\.com$/.test(url.hostname)) return null;
    return `wss://${url.hostname.replace(/^api\./, 'api-ws.')}/api-ws/v1/stream`;
  }

  /** Headers for the stream's upgrade request (the same token as REST). */
  streamHeaders() {
    return { Authorization: `Token ${this.integration.credentials.apiToken}` };
  }

  /** The org's sites: [{ id, name }]. */
  async listSites() {
    const sites = await this.requestAllPages(`/api/v1/orgs/${this.orgId}/sites`, { context: 'site_list' });
    return sites.map((site) => ({ id: site.id, name: site.name }));
  }

  /** Stream channels: device stats for every site (Mist has no org-wide one). */
  async listEventChannels() {
    const sites = await this.listSites();
    return sites.map((site) => `/sites/${site.id}/stats/devices`);
  }

  /** An unopened stream over `channels`; see cloud/mist-stream.js. */
  openEventStream(channels) {
    if (!this.streamUrl) this.unsupported('events', `no stream host for ${this.integration.baseUrl}`);
    return new MistStream({ url: this.streamUrl, headers: this.streamHeaders(), channels });
  }

  async request(method, endpoint, { params = {}, context = 'api_call' } = {}) {
    try {
      const response = await axios({
        method,
        url: `${this.integration.baseUrl}${endpoint}`,
        headers: {
          Authorization: `Token ${this.integration.credentials.apiToken}`,
          Accept: 'application/json',
        },
        params,
        timeout: 30000,
      });
      return response.data;
    } catch (error) {
      throw this.enhanceError(error, context);
    }
  }

  /**
   * Follow Mist's page/limit pagination to completion. The inventory endpoint
   * became paginated in early 2026 (default 100), so a single unpaginated call
   * would silently truncate large orgs.
   */
  async requestAllPages(endpoint, { params = {}, context = 'api_call' } = {}) {
    const items = [];
    let page = 1;
    for (;;) {
      const data = await this.request('GET', endpoint, {
        params: { ...params, limit: PAGE_LIMIT, page },
        context,
      });
      // Mist returns either a bare array or { results: [], total, limit, page }.
      const batch = Array.isArray(data) ? data : (data.results || []);
      items.push(...batch);
      if (batch.length < PAGE_LIMIT) break;
      page += 1;
      if (page > 100) {
        logger.warn(`Mist pagination stopped at page 100 for ${endpoint} (${items.length} items)`);
        break;
      }
    }
    return items;
  }

  /**
   * Follow a search endpoint's `next` link (search_after paging; the search
   * endpoints ignore `page`). `next` is a path on the same host; anything
   * else is refused so the token never goes elsewhere.
   */
  async searchAll(endpoint, { params = {}, context = 'api_call' } = {}) {
    const items = [];
    let data = await this.request('GET', endpoint, { params: { ...params, limit: PAGE_LIMIT }, context });
    for (let pages = 1; ; pages++) {
      items.push(...(data?.results || []));
      if (!data?.next) break;
      if (!/^\/api\/v1\//.test(data.next) || pages >= 100) {
        logger.warn(`Mist search paging stopped for ${endpoint} after ${items.length} results`);
        break;
      }
      data = await this.request('GET', data.next, { context });
    }
    return items;
  }

  async testConnection() {
    try {
      const self = await this.request('GET', '/api/v1/self', { context: 'authentication' });
      // A valid token that cannot see the configured org is a real
      // misconfiguration, so check org scope rather than just auth.
      const privileges = self.privileges || [];
      const scoped = privileges.some((p) => p.org_id === this.orgId);
      if (privileges.length > 0 && !scoped) {
        const orgs = new Set(privileges.map((p) => p.org_id).filter(Boolean));
        return {
          success: false,
          message: `Token authenticated as ${self.email || self.name || 'API token'}, but it has no privileges on org ${this.orgId}. Check the org ID and the regional cloud.`,
          details: {
            endpoint: this.integration.baseUrl,
            explanation: `The token can see ${orgs.size} other org${orgs.size === 1 ? '' : 's'} in this regional cloud, not the configured one.`,
            actions: [
              'Copy the org ID from Mist: Organization → Settings',
              'Pick the regional cloud the org lives in (the host you sign in to, e.g. manage.ac2.mist.com → api.ac2.mist.com)',
            ],
          },
        };
      }
      // An org token is named, not tied to a user; a user token has an email.
      const role = privileges.find((p) => p.org_id === this.orgId)?.role;
      return {
        success: true,
        message: `Authenticated with Juniper Mist as ${self.email || self.name || 'API token'}${role ? ` (${role} access)` : ''}`,
        details: { orgId: this.orgId, ...(self.email && { email: self.email }), ...(role && { role }) },
      };
    } catch (error) {
      return this.testFailure(error);
    }
  }

  /**
   * Org inventory, enriched with live stats (IP, firmware version) where the
   * device is currently connected. Stats failures are non-fatal: inventory is
   * the source of truth for what exists.
   */
  async listInventory() {
    const inventory = await this.requestAllPages(`/api/v1/orgs/${this.orgId}/inventory`, {
      context: 'device_list',
    });

    // Inventory names a device's site only by id; resolve names once.
    const siteNames = new Map();
    try {
      for (const site of await this.listSites()) siteNames.set(site.id, site.name);
    } catch (error) {
      logger.warn(`Mist site list unavailable for ${this.label}, syncing without site names: ${error.message}`);
    }

    const statsByMac = new Map();
    try {
      // `type` defaults to `ap` on this endpoint — without type=all we would
      // silently sync only access points.
      const stats = await this.requestAllPages(`/api/v1/orgs/${this.orgId}/stats/devices`, {
        params: { type: 'all', fields: STATS_FIELDS.join(',') },
        context: 'device_stats',
      });
      for (const stat of stats) {
        if (stat.mac) statsByMac.set(stat.mac.toLowerCase(), stat);
      }
    } catch (error) {
      logger.warn(`Mist device stats unavailable for ${this.label}, syncing inventory without live enrichment: ${error.message}`);
    }

    const devices = inventory.map((item) => this.normalizeDevice(
      item,
      statsByMac.get((item.mac || '').toLowerCase()),
      siteNames.get(item.site_id)
    ));
    logger.info(`Inventory fetched from ${this.label}: ${devices.length} device(s)`);
    return devices;
  }

  async getDeviceStatus(serial) {
    const item = await this.findInventoryItem(serial, 'device_status');

    // Inventory says only whether the device is connected; its stats say when
    // Mist last heard from it. A device without a site has no stats.
    let stats = null;
    if (item.site_id && item.id) {
      try {
        stats = await this.request('GET', `/api/v1/sites/${item.site_id}/stats/devices/${item.id}`, {
          params: { fields: STATS_FIELDS.join(',') },
          context: 'device_status',
        });
      } catch (error) {
        logger.warn(`Mist stats unavailable for ${serial}: ${error.message}`);
      }
    }

    return {
      status: item.connected ? 'online' : 'offline',
      lastSeen: stats?.last_seen ? new Date(stats.last_seen * 1000) : null,
      raw: { inventory: item, stats },
    };
  }

  /**
   * LLDP neighbors for every device in the org, from two reads: device stats
   * (APs report their uplink) and port stats (switches report each port's
   * neighbor). `neighbor_mac=*` keeps the port search to ports that have a
   * neighbor; the parser filters again in case Mist ever ignores it.
   */
  async listNeighbors() {
    const stats = await this.requestAllPages(`/api/v1/orgs/${this.orgId}/stats/devices`, {
      params: { type: 'all', fields: NEIGHBOR_FIELDS.join(',') },
      context: 'neighbors',
    });
    const ports = await this.searchAll(`/api/v1/orgs/${this.orgId}/stats/ports/search`, {
      params: { neighbor_mac: '*' },
      context: 'neighbors',
    });
    return parseMistNeighbors({ stats, ports });
  }

  /**
   * Status for the cloud status refresh in one paged read (org device stats)
   * instead of inventory + sites + stats. A device with no site has no stats
   * and is left out; the hourly sync covers it.
   */
  async listStatuses() {
    const stats = await this.requestAllPages(`/api/v1/orgs/${this.orgId}/stats/devices`, {
      params: { type: 'all', fields: [...STATS_FIELDS, 'serial'].join(',') },
      context: 'device_status',
    });
    const statuses = new Map();
    for (const stat of stats) {
      if (!stat.serial) continue;
      const connected = stat.status === 'connected';
      statuses.set(stat.serial, {
        status: connected ? 'online' : 'offline',
        lastSeen: stat.last_seen ? new Date(stat.last_seen * 1000) : null,
        ipAddress: stat.ip || null,
        firmwareVersion: stat.version || null,
        cloudConnectionStatus: connected ? 'connected' : 'not_reachable',
        configInSync: mistConfigInSync(stat.config_status),
        configStatus: stat.config_status ?? null,
      });
    }
    return statuses;
  }

  /**
   * Who holds `ip`, from three org searches that filter by exact IP on
   * Mist's side (verified live 2026-10-22): Mist's own devices, wired clients
   * (with the switch port they were seen on; Mist APs show up here too) and
   * wireless clients, over the last ADDRESS_WINDOW.
   */
  async findByAddress(ip) {
    const search = (what) => this.request('GET', `/api/v1/orgs/${this.orgId}/${what}/search`, {
      params: { ip, duration: ADDRESS_WINDOW, limit: 20 },
      context: 'address_lookup',
    }).then((data) => data?.results || []);
    const [devices, wired, wireless] = await Promise.all([search('devices'), search('wired_clients'), search('clients')]);
    return [
      ...devices.map(mistDeviceHolder),
      ...wired.map((client) => mistWiredHolder(client, ip)),
      ...wireless.map(mistWirelessHolder),
    ];
  }

  /** alarm type -> display name; a failed read falls back to the type. */
  async alarmDisplayNames() {
    const host = this.integration.baseUrl;
    if (!alarmDefsCache.has(host)) {
      try {
        const defs = await this.request('GET', '/api/v1/const/alarm_defs', { context: 'alarms' });
        alarmDefsCache.set(host, new Map((Array.isArray(defs) ? defs : []).map((d) => [d.key, d.display])));
      } catch (error) {
        logger.warn(`Mist alarm definitions unavailable (${error.message}); using alarm types as names`);
        return new Map();
      }
    }
    return alarmDefsCache.get(host);
  }

  /**
   * Org alarms since `since` (search_after paging). Infrastructure alarms
   * are point events without a status; marvis ones carry open/resolved.
   * Mist has no "active" list, so activeIds is null.
   */
  async listAlarms({ since }) {
    const [names, rows] = await Promise.all([
      this.alarmDisplayNames(),
      this.searchAll(`/api/v1/orgs/${this.orgId}/alarms/search`, {
        params: { start: Math.floor(new Date(since).getTime() / 1000), end: Math.ceil(Date.now() / 1000) },
        context: 'alarms',
      }),
    ]);
    const alarms = rows
      .filter((a) => ALARM_GROUPS.includes(a.group) && !ALARM_SKIP_TYPES.has(a.type))
      .map((a) => this.normalizeAlarm(a, names));
    return { alarms, activeIds: null };
  }

  normalizeAlarm(a, names = new Map()) {
    const stateful = a.status === 'open' || a.status === 'resolved';
    const reasons = Array.isArray(a.reasons) ? a.reasons.filter(Boolean) : [];
    const resolved = a.status === 'resolved';
    return {
      externalId: a.id,
      type: a.type,
      name: names.get(a.type) || humanizeType(a.type),
      category: a.group || null,
      severity: ALARM_SEVERITY[String(a.severity).toLowerCase()] || 'info',
      stateful,
      status: stateful ? (resolved ? 'cleared' : 'active') : 'event',
      raisedAt: fromEpoch(a.timestamp) || new Date(),
      lastSeenAt: fromEpoch(a.last_seen) || fromEpoch(a.timestamp) || new Date(),
      clearedAt: resolved ? fromEpoch(a.resolved_time) || new Date() : null,
      clearedReason: null,
      summary: reasons.join('; ') || null,
      siteName: null,
      count: Number(a.count) || 1,
      serials: [],
      macs: [...(a.switches || []), ...(a.aps || []), ...(a.gateways || [])].map(normalizeMac).filter(Boolean),
      hostnames: (a.hostnames || []).filter(Boolean),
      data: {
        ...(a.site_id && { siteId: a.site_id }),
        ...(a.port_ids?.length && { ports: a.port_ids }),
      },
    };
  }

  /** The org inventory record of one device, by serial. */
  async findInventoryItem(serial, context) {
    const matches = await this.request('GET', `/api/v1/orgs/${this.orgId}/inventory`, {
      params: { serial },
      context,
    });
    const item = (Array.isArray(matches) ? matches : matches.results || [])[0];
    if (!item) throw new Error(`Device ${serial} not found in ${this.label}`);
    return item;
  }

  /**
   * Snapshot a device's Mist configuration object.
   *
   * Mist is intent-based: this is the desired-state config Mist holds for the
   * device, not a CLI running-config. Keys are sorted so the JSON is stable and
   * diffs reflect real changes rather than key reordering.
   */
  async getDeviceConfiguration(serial) {
    const item = await this.findInventoryItem(serial, 'device_config');

    if (!item.site_id) {
      this.unsupported(
        'config-backup',
        `device ${serial} is in inventory but not assigned to a site, so Mist holds no configuration for it`
      );
    }

    // APs are configured by site/WLAN templates rather than per-device objects,
    // so there is no meaningful per-AP config to snapshot. Say so plainly
    // instead of storing a near-empty object that would look like a backup.
    if (this.mapDeviceType(item.type) === 'access_point') {
      this.unsupported(
        'config-backup',
        `${serial} is an access point; Mist configures APs through site and WLAN templates, not per-device config`
      );
    }

    const config = await this.request(
      'GET',
      `/api/v1/sites/${item.site_id}/devices/${item.id}`,
      { context: 'device_config' }
    );

    return {
      text: this.canonicalJson(config),
      format: 'mist-config-json',
      source: this.label,
      // Whether Mist owns this device's config (false: monitored only, e.g. a
      // brownfield switch adopted without config management).
      ...(typeof config?.mist_configured === 'boolean' && { cloudManaged: config.mist_configured }),
    };
  }

  /** The org, then every site in it. */
  async listConfigScopes() {
    const org = await this.request('GET', `/api/v1/orgs/${this.orgId}`, { context: 'scope_list' });
    const sites = await this.requestAllPages(`/api/v1/orgs/${this.orgId}/sites`, { context: 'scope_list' });
    return [
      { scopeType: 'org', scopeId: this.orgId, name: org?.name || this.orgId },
      ...sites
        .map((site) => ({ scopeType: 'site', scopeId: site.id, name: site.name || site.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }

  /**
   * Snapshot an org's or a site's configuration as one canonical-JSON bundle.
   *
   * Org: org settings plus the org-level objects sites and devices inherit:
   * WLANs, WLAN templates, RF templates, device profiles (AP profiles among
   * them), switch/site/gateway templates. Site: the site record (which names
   * the templates it uses), its settings, and its own WLANs. Together they are
   * what Mist pushes to the APs, which have no per-device config of their own.
   *
   * A section the org has no access to (404, e.g. an unlicensed feature) is
   * recorded as null rather than failing the scope; anything else fails it.
   */
  async getScopeConfiguration(scope) {
    let sections;
    if (scope.scopeType === 'org') {
      const base = `/api/v1/orgs/${this.orgId}`;
      sections = {
        setting: () => this.request('GET', `${base}/setting`, { context: 'scope_config' }),
        wlans: () => this.requestAllPages(`${base}/wlans`, { context: 'scope_config' }),
        wlanTemplates: () => this.requestAllPages(`${base}/templates`, { context: 'scope_config' }),
        rfTemplates: () => this.requestAllPages(`${base}/rftemplates`, { context: 'scope_config' }),
        deviceProfiles: () => this.requestAllPages(`${base}/deviceprofiles`, { context: 'scope_config' }),
        networkTemplates: () => this.requestAllPages(`${base}/networktemplates`, { context: 'scope_config' }),
        siteTemplates: () => this.requestAllPages(`${base}/sitetemplates`, { context: 'scope_config' }),
        gatewayTemplates: () => this.requestAllPages(`${base}/gatewaytemplates`, { context: 'scope_config' }),
      };
    } else if (scope.scopeType === 'site') {
      const base = `/api/v1/sites/${scope.scopeId}`;
      sections = {
        site: () => this.request('GET', base, { context: 'scope_config' }),
        setting: () => this.request('GET', `${base}/setting`, { context: 'scope_config' }),
        wlans: () => this.requestAllPages(`${base}/wlans`, { context: 'scope_config' }),
      };
    } else {
      this.unsupported('scope-backup', `Mist has no "${scope.scopeType}" scope`);
    }

    // Sequential, to stay gentle on the 5,000 requests/hour org budget.
    const bundle = { scope: { type: scope.scopeType, id: scope.scopeId, name: scope.name } };
    for (const [key, fetch] of Object.entries(sections)) {
      try {
        bundle[key] = this.sortById(await fetch());
      } catch (error) {
        if (error.statusCode !== 404) throw error;
        bundle[key] = null;
      }
    }

    return {
      text: this.canonicalJson(redactConfigSecrets(bundle)),
      format: 'mist-scope-json',
      source: this.label,
    };
  }

  /** Lists come back in no promised order; sort by id so diffs stay quiet. */
  sortById(value) {
    if (!Array.isArray(value)) return value;
    return [...value].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')));
  }

  /**
   * Map a Mist inventory record (+ optional live stats) onto the
   * NormalizedCloudDevice contract.
   */
  /**
   * Field names follow a live org (2026-10-19): inventory carries `connected`,
   * `site_id` and `version` but no last-seen time; stats carry `last_seen`
   * (epoch seconds), `status` connected|disconnected, `ip` and `uptime`, and
   * keep the last known values while a device is offline.
   */
  normalizeDevice(item, stats = null, siteName = null) {
    const type = this.mapDeviceType(item.type);
    const connected = Boolean(item.connected);
    return {
      serial: item.serial,
      name: item.name || item.hostname || item.serial,
      model: item.model || '',
      macAddress: item.mac || null,
      ipAddress: stats?.ip || null,
      type,
      vendor: 'juniper',
      // Mist-managed Juniper switches/gateways run Junos; APs are appliances
      // with no CLI platform we would ever reach directly.
      platform: type === 'access_point' ? null : 'junos',
      status: connected ? 'online' : 'offline',
      firmwareVersion: stats?.version || item.version || null,
      site: siteName || item.site_id || null,
      lastSeen: stats?.last_seen ? new Date(stats.last_seen * 1000) : null,
      // An AP assigned to a site takes its config from Mist. Whether Mist
      // configures a switch or gateway is on its device object
      // (`mist_configured`), which a config backup reads.
      ...(type === 'access_point' && item.site_id && { cloudManaged: true, cloudManagedSource: 'cloud-inventory' }),
      cloudConnectionStatus: connected ? 'connected' : 'not_reachable',
      configInSync: mistConfigInSync(stats?.config_status),
      metadata: {
        mistId: item.id,
        siteId: item.site_id,
        siteName,
        hostname: item.hostname,
        sku: item.sku,
        hwRev: item.hw_rev,
        uptime: stats?.uptime,
        configStatus: stats?.config_status,
      },
    };
  }

  /** Mist device types are `ap` | `switch` | `gateway`. */
  mapDeviceType(mistType) {
    const typeMap = {
      ap: 'access_point',
      switch: 'switch',
      gateway: 'gateway',
    };
    const type = typeMap[String(mistType).toLowerCase()];
    if (!type) {
      logger.warn(`Unknown Mist device type "${mistType}", classifying as other`);
      return 'other';
    }
    return type;
  }

  enhanceError(error, context) {
    if (error.name === 'CapabilityError') return error;

    const status = error.response?.status;
    const detail = error.response?.data?.detail || error.response?.data?.error;
    let message;

    let actions;
    if (status === 401) {
      message = `Juniper Mist rejected the API token (401). Check the token and that it belongs to this regional cloud (${this.integration.baseUrl}).`;
      actions = [
        'Check the token was copied whole and has not been revoked (Organization → Settings → API Token)',
        'Pick the regional cloud the org lives in: a token only works on its own cloud',
      ];
    } else if (status === 403) {
      message = `Juniper Mist denied access to org ${this.orgId} (403). The token may lack privileges on this org.`;
      actions = ['Use an org token, or a user token with at least read access to this org'];
    } else if (status === 429) {
      message = 'Juniper Mist rate limit exceeded (5,000 requests/hour per org). Try again later.';
      actions = ['Wait for the hourly budget to reset; other tools using the same org share it'];
    } else if (status) {
      message = `Juniper Mist API error (${status})${detail ? `: ${detail}` : ''}`;
    } else {
      message = `Could not reach Juniper Mist at ${this.integration.baseUrl}: ${error.message}`;
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

module.exports = MistProvider;
