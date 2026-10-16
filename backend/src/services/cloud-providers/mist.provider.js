const axios = require('axios');
const BaseCloudProvider = require('./base-cloud-provider');
const { redactConfigSecrets } = require('../../utils/config-redact');
const { CLOUD_PROVIDERS } = require('../../constants/vendors');
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
    return ['inventory', 'status', 'test', 'config-backup', 'scope-backup'].includes(capability);
  }

  get orgId() {
    return this.integration.credentials.orgId;
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

  async testConnection() {
    try {
      const self = await this.request('GET', '/api/v1/self', { context: 'authentication' });
      // A valid token that cannot see the configured org is a real
      // misconfiguration, so check org scope rather than just auth.
      const privileges = self.privileges || [];
      const scoped = privileges.some((p) => p.org_id === this.orgId);
      if (privileges.length > 0 && !scoped) {
        return {
          success: false,
          message: `Token authenticated as ${self.email || 'unknown user'}, but it has no privileges on org ${this.orgId}. Check the org ID and the regional cloud.`,
        };
      }
      return {
        success: true,
        message: `Authenticated with Juniper Mist as ${self.email || self.name || 'API token'}`,
        details: { email: self.email, orgId: this.orgId },
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

    const statsByMac = new Map();
    try {
      // `type` defaults to `ap` on this endpoint — without type=all we would
      // silently sync only access points.
      const stats = await this.requestAllPages(`/api/v1/orgs/${this.orgId}/stats/devices`, {
        params: { type: 'all' },
        context: 'device_stats',
      });
      for (const stat of stats) {
        if (stat.mac) statsByMac.set(stat.mac.toLowerCase(), stat);
      }
    } catch (error) {
      logger.warn(`Mist device stats unavailable for ${this.label}, syncing inventory without live enrichment: ${error.message}`);
    }

    const devices = inventory.map((item) => this.normalizeDevice(item, statsByMac.get((item.mac || '').toLowerCase())));
    logger.info(`Inventory fetched from ${this.label}: ${devices.length} device(s)`);
    return devices;
  }

  async getDeviceStatus(serial) {
    const matches = await this.request('GET', `/api/v1/orgs/${this.orgId}/inventory`, {
      params: { serial },
      context: 'device_status',
    });
    const item = (Array.isArray(matches) ? matches : matches.results || [])[0];
    if (!item) throw new Error(`Device ${serial} not found in ${this.label}`);

    return {
      status: item.connected ? 'online' : 'offline',
      lastSeen: item.last_disconnected ? new Date(item.last_disconnected * 1000) : null,
      raw: item,
    };
  }

  /**
   * Snapshot a device's Mist configuration object.
   *
   * Mist is intent-based: this is the desired-state config Mist holds for the
   * device, not a CLI running-config. Keys are sorted so the JSON is stable and
   * diffs reflect real changes rather than key reordering.
   */
  async getDeviceConfiguration(serial) {
    const matches = await this.request('GET', `/api/v1/orgs/${this.orgId}/inventory`, {
      params: { serial },
      context: 'device_config',
    });
    const item = (Array.isArray(matches) ? matches : matches.results || [])[0];
    if (!item) throw new Error(`Device ${serial} not found in ${this.label}`);

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
  normalizeDevice(item, stats = null) {
    const type = this.mapDeviceType(item.type);
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
      status: item.connected ? 'online' : 'offline',
      firmwareVersion: stats?.version || null,
      site: item.site_id || null,
      lastSeen: stats?.last_seen
        ? new Date(stats.last_seen * 1000)
        : (item.last_disconnected ? new Date(item.last_disconnected * 1000) : null),
      metadata: {
        mistId: item.id,
        siteId: item.site_id,
        hostname: item.hostname,
        sku: item.sku,
        hwRev: item.hw_rev,
        adopted: item.adopted,
        vcMac: item.vc_mac,
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

    if (status === 401) {
      message = `Juniper Mist rejected the API token (401). Check the token and that it belongs to this regional cloud (${this.integration.baseUrl}).`;
    } else if (status === 403) {
      message = `Juniper Mist denied access to org ${this.orgId} (403). The token may lack privileges on this org.`;
    } else if (status === 429) {
      message = 'Juniper Mist rate limit exceeded (5,000 requests/hour per org). Try again later.';
    } else if (status) {
      message = `Juniper Mist API error (${status})${detail ? `: ${detail}` : ''}`;
    } else {
      message = `Could not reach Juniper Mist at ${this.integration.baseUrl}: ${error.message}`;
    }

    const wrapped = new Error(message);
    wrapped.statusCode = status;
    wrapped.context = context;
    wrapped.originalError = error;
    wrapped.details = {
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
