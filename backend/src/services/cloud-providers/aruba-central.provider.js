const axios = require('axios');
const BaseCloudProvider = require('./base-cloud-provider');
const { redactConfigSecrets } = require('../../utils/config-redact');
const ArubaErrorHandler = require('../../utils/aruba-error-handler');
const { getRedis } = require('../../config/redis');
const { detectPlatform } = require('../../utils/device-platform');
const { parseCentralTopology } = require('../topology/parsers/central');
const { normalizeMac } = require('../../utils/device-key');
const { debugLog, Services } = require('../../utils/debug-logger');

const logger = debugLog.createLogger(Services.ARUBA_CENTRAL);

// Endpoints verified working against a New Central / GreenLake tenant use the
// network-monitoring v1alpha1 API. The classic-Central endpoint families
// (/configuration/v2, /troubleshooting/v1, /monitoring/v2, /firmware/v1) are
// QUARANTINED below: they were never proven to work (the code paths that
// called them carried an unset-baseURL bug since inception) and 404 on New
// Central tenants. Prove them against a live tenant before resurrecting.

// Token endpoints (developer.arubanetworks.com "Generating and managing access
// tokens"). A Central-scoped API client gets its token from HPE SSO; a
// GreenLake-platform-scoped client from its workspace's token URL. Both are
// client_credentials grants and both tokens work against New Central only.
const CENTRAL_TOKEN_URL = 'https://sso.common.cloud.hpe.com/as/token.oauth2';
const glpTokenUrl = (workspaceId) =>
  `https://global.api.greenlake.hpe.com/authorization/v2/oauth2/${encodeURIComponent(workspaceId)}/token`;

/**
 * Aruba switch firmware strings carry the OS major version after a two-letter
 * family code: AOS-CX is 10 (ML.10.16.1010), AOS-S is 15/16 (WC.16.11.0012).
 */
function platformFromFirmware(version) {
  if (/^[A-Z]{2}\.10\./i.test(version || '')) return 'aos-cx';
  if (/^[A-Z]{2}\.1[56]\./i.test(version || '')) return 'aos-s';
  return null;
}

// New Central configuration API. Profiles live in a library; config
// assignments bind them to a scope (global, site collection, site, device
// group, device) for a device function, and scope maps index every object in
// effect at each scope. Shapes verified against a live tenant on 2026-10-16.
const CONFIG_API = '/network-config/v1alpha1';

// Scopes backed up, in hierarchy order. Device scopes are left out: a device's
// own config is what its device backup captures.
const SCOPE_LISTS = [
  { scopeType: 'site-collection', endpoint: 'site-collections' },
  { scopeType: 'site', endpoint: 'sites' },
  { scopeType: 'device-group', endpoint: 'device-groups' },
];

// Central sends scope ids as JSON numbers above 2^53 (e.g. 68797217769316352),
// which JSON.parse rounds. Quote them before parsing so they stay exact.
function parseKeepingScopeIds(text) {
  if (typeof text !== 'string' || !text) return text;
  try {
    return JSON.parse(text.replace(/("scope-id"\s*:\s*)(-?\d+)/g, '$1"$2"'));
  } catch {
    return text; // not JSON (an error page): let the HTTP status speak
  }
}

/** A profile's identity within its list, so lists sort the same every run. */
function profileKey(item) {
  if (!item || typeof item !== 'object') return String(item);
  return String(item.name ?? item.ssid ?? item.vlan ?? item.id ?? JSON.stringify(item));
}

/** Central's configStatus (live: "Synchronized", "Out of sync", or null) as in-sync true/false/null. */
function centralConfigInSync(value) {
  const key = String(value || '').toLowerCase().replace(/[\s_-]/g, '');
  if (key === 'synchronized' || key === 'insync') return true;
  if (key === 'outofsync') return false;
  return null;
}

/**
 * A v1alpha1 client (live shape 2026-10-22): status Connected|Disconnected,
 * lastSeenAt "0" while connected, connectedTo = the switch/AP name.
 */
function centralClientHolder(item, lastSeen) {
  const connected = String(item.status).toLowerCase() === 'connected';
  return {
    kind: 'client',
    // `name` is the MAC when the client has no hostname.
    name: item.hostName || (normalizeMac(item.name) ? null : item.name) || null,
    mac: normalizeMac(item.mac),
    serial: null,
    model: null,
    status: connected ? 'connected' : 'disconnected',
    lastSeen: connected ? new Date() : lastSeen,
    manufacturer: item.manufacturer || null,
    connectedTo: {
      name: item.connectedTo || null,
      serial: item.connectedDeviceSerial || null,
      mac: null,
      port: item.port || null,
      vlan: item.vlanId ?? null,
      ssid: String(item.type).toLowerCase() === 'wireless' ? item.network || null : null,
    },
  };
}

/** Classic Central's API gateway (apigw-*): a different API, unreachable with GreenLake tokens. */
function isClassicGateway(baseUrl) {
  try {
    return new URL(baseUrl).hostname.toLowerCase().startsWith('apigw-');
  } catch {
    return false;
  }
}

class ArubaCentralProvider extends BaseCloudProvider {
  /**
   * @param {Object} integration - { id, provider, name, baseUrl,
   *   credentials: { clientId, clientSecret (decrypted), workspaceId? } }
   *   A legacy customerId may still be stored; New Central ignores it.
   */
  constructor(integration) {
    super(integration);
    const { clientId, clientSecret } = integration.credentials;
    if (!clientId || !clientSecret) {
      throw new Error(`Aruba Central integration "${integration.name}" is missing clientId or clientSecret`);
    }
  }

  supports(capability) {
    return ['inventory', 'status', 'test', 'scope-backup', 'topology', 'address-lookup'].includes(capability);
    // NOT 'config-backup': the classic /configuration/v2 endpoint is
    // quarantined (see getDeviceConfiguration). CX configs are still backed
    // up over device REST; AOS-S over SSH.
  }

  tokenCacheKey() {
    return `cloud:${this.integration.id}:access_token`;
  }

  tokenUrl() {
    const { workspaceId } = this.integration.credentials;
    return workspaceId ? glpTokenUrl(workspaceId) : CENTRAL_TOKEN_URL;
  }

  /** Drop the cached OAuth token (call after credential changes). */
  async clearTokenCache() {
    await getRedis().del(this.tokenCacheKey()).catch(() => {});
  }

  /**
   * OAuth2 client_credentials grant, token cached in Redis per integration
   * (so two Central accounts never share a token).
   */
  async getAccessToken() {
    try {
      const cached = await getRedis().get(this.tokenCacheKey());
      if (cached) {
        logger.debug(`Using cached access token for ${this.label}`);
        return cached;
      }

      const { clientId, clientSecret, workspaceId } = this.integration.credentials;
      const url = this.tokenUrl();

      logger.progress('Requesting new access token', {
        integration: this.integration.name,
        url,
        clientId,
        scope: workspaceId ? 'greenlake-workspace' : 'central',
        grantType: 'client_credentials',
      });

      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);

      const response = await axios.post(url, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token: accessToken, expires_in: expiresIn } = response.data;
      await getRedis().setEx(this.tokenCacheKey(), Math.max(expiresIn - 60, 30), accessToken);
      logger.success('Access token cached', { integration: this.integration.name, cacheExpiry: `${expiresIn - 60}s` });

      return accessToken;
    } catch (error) {
      throw this.enhanceError(error, 'authentication');
    }
  }

  async makeRequest(method, endpoint, { params = {}, data = null, context = 'api_call', exactScopeIds = false } = {}) {
    try {
      const accessToken = await this.getAccessToken();
      const response = await axios({
        method,
        url: `${this.integration.baseUrl}${endpoint}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params,
        ...(data ? { data } : {}),
        ...(exactScopeIds ? { transformResponse: [parseKeepingScopeIds] } : {}),
      });
      return response.data;
    } catch (error) {
      throw this.enhanceError(error, context);
    }
  }

  /**
   * Authenticate, then make one real API call against the configured base
   * URL: a token alone proves the client, not the cluster.
   */
  async testConnection() {
    const { baseUrl } = this.integration;
    if (isClassicGateway(baseUrl)) {
      return {
        success: false,
        message: 'The base URL points at a Classic Central API gateway',
        details: {
          endpoint: baseUrl,
          explanation: 'apigw-* hosts serve Classic Central, which does not accept GreenLake API client tokens. NetHelper uses the New Central API.',
          actions: ['Edit the integration and pick your cluster (e.g. US-West-4 → us4.api.central.arubanetworks.com)'],
        },
      };
    }
    try {
      await this.clearTokenCache(); // force a real credential check
      const startTime = Date.now();
      await this.getAccessToken();
      await this.makeRequest('GET', '/network-monitoring/v1alpha1/devices', {
        params: { limit: 1 },
        context: 'device_list',
      });
      return {
        success: true,
        message: 'Successfully authenticated with Aruba Central',
        details: { responseTime: `${Date.now() - startTime}ms` },
      };
    } catch (error) {
      return this.testFailure(error);
    }
  }

  /**
   * Full inventory via the unified network-monitoring endpoint, followed
   * through pagination, normalized to NormalizedCloudDevice.
   */
  async listInventory() {
    const devices = [];
    let next;
    do {
      const params = { limit: 100 };
      if (next) params.next = next;
      const page = await this.makeRequest('GET', '/network-monitoring/v1alpha1/devices', {
        params,
        context: 'device_list',
      });
      for (const item of page.items || []) {
        devices.push(this.normalizeDevice(item));
      }
      next = page.next;
    } while (next);

    logger.success(`Inventory fetched from ${this.label}`, { count: devices.length });
    return devices;
  }

  async getDeviceStatus(serial) {
    // The unified endpoint supports OData filters; one-device lookup.
    const page = await this.makeRequest('GET', '/network-monitoring/v1alpha1/devices', {
      params: { filter: `serialNumber eq '${serial}'`, limit: 1 },
      context: 'device_status',
    });
    const item = (page.items || [])[0];
    if (!item) throw new Error(`Device ${serial} not found in ${this.label}`);
    const normalized = this.normalizeDevice(item);
    return { status: normalized.status, lastSeen: normalized.lastSeen, raw: item };
  }

  /**
   * Neighbors for every device, from each site's topology (one call per site,
   * sequential for Central's per-second limit). Only the GA v1 path serves
   * topology; v1alpha1 returns 404 (live tenant, 2026-10-19). A device with
   * no site is in no topology, so it is absent from the result.
   */
  async listNeighbors() {
    const siteIds = [...new Set((await this.listInventory()).map((d) => d.metadata.siteId).filter(Boolean))];
    const replies = [];
    for (const siteId of siteIds) {
      replies.push(await this.makeRequest('GET', `/network-monitoring/v1/topology/${encodeURIComponent(siteId)}`, {
        context: 'topology',
      }));
    }
    return parseCentralTopology(replies);
  }

  /**
   * Who holds `ip`. Neither list filters by IP (live tenant, 2026-10-22: the
   * clients `filter` rejects ipv4 and macAddress, and has no `search`), so:
   * the devices list's free-text `search`, matched exactly here, and the
   * whole client list, which comes in pages of up to 1000. v1alpha1 clients
   * (unlike v1) also lists recently disconnected clients, with lastSeenAt.
   */
  async findByAddress(ip) {
    const devices = await this.makeRequest('GET', '/network-monitoring/v1alpha1/devices', {
      params: { search: ip, limit: 100 },
      context: 'address_lookup',
    });
    const holders = (devices.items || [])
      .filter((item) => item.ipv4 === ip)
      .map((item) => {
        const device = this.normalizeDevice(item);
        return {
          kind: 'device', name: device.name, mac: normalizeMac(device.macAddress), serial: device.serial,
          model: device.model || null, status: device.status, lastSeen: device.lastSeen, manufacturer: null, connectedTo: null,
        };
      });

    // The client list can't be filtered by IP, so it is paged through; stop at
    // the first connected client holding the address (one holds it at a
    // time), which on a busy tenant usually saves most of the pages.
    let next;
    let pages = 0;
    let connected = false;
    do {
      const page = await this.makeRequest('GET', '/network-monitoring/v1alpha1/clients', {
        params: { limit: 1000, ...(next && { next }) },
        context: 'address_lookup',
      });
      for (const item of page.items || []) {
        if (item.ipv4 !== ip) continue;
        const holder = centralClientHolder(item, this.parseTimestamp(item.lastSeenAt));
        holders.push(holder);
        if (holder.status === 'connected') connected = true;
      }
      next = page.next;
      pages += 1;
    } while (next && !connected && pages < 20);
    return holders;
  }

  /**
   * Map a unified-endpoint item to the NormalizedCloudDevice contract. Field
   * names follow a live New Central response (2026-10-16), which differs from
   * the spec the provider was first written against: serialNumber, status
   * ONLINE/OFFLINE, lastSeenAt (ISO, null while online), uptimeInMillis.
   */
  normalizeDevice(item) {
    const type = this.mapDeviceType(item.deviceType);
    const serial = item.serialNumber || item.serial || null;
    const status = this.mapDeviceStatus(item.status);
    const normalized = {
      serial,
      name: item.deviceName || serial,
      model: item.model || '',
      macAddress: item.macAddress || null,
      ipAddress: item.ipv4 || item.ipv6 || null,
      type,
      vendor: 'aruba',
      platform: null,
      status,
      firmwareVersion: item.firmwareVersion || item.softwareVersion || null,
      site: item.siteName || item.siteId || null,
      // Central leaves lastSeenAt empty while a device is up: seen now.
      lastSeen: this.parseTimestamp(item.lastSeenAt ?? item.lastSeen) || (status === 'online' ? new Date() : null),
      configInSync: centralConfigInSync(item.configStatus),
      metadata: {
        siteId: item.siteId,
        siteName: item.siteName,
        deployment: item.deployment,
        uptimeMs: item.uptimeInMillis,
        partNumber: item.partNumber,
        configStatus: item.configStatus,
        persona: item.persona,
        role: item.role,
      },
    };
    // Classify switches into aos-cx / aos-s (write-once; the platform column
    // is authoritative after sync persists it). The firmware version names
    // the OS outright; the model regex is the fallback (Central reports some
    // CX switches as a bare "6200").
    if (type === 'switch') {
      const platform = platformFromFirmware(normalized.firmwareVersion)
        || detectPlatform({ type, model: normalized.model, vendor: 'aruba' });
      normalized.platform = platform === 'unknown' ? null : platform;
    }
    return normalized;
  }

  mapDeviceType(centralType) {
    const typeMap = {
      // New API format (v1alpha1)
      ACCESS_POINT: 'access_point',
      SWITCH: 'switch',
      GATEWAY: 'gateway',
      // Legacy API formats (kept for compatibility)
      ap: 'access_point',
      access_point: 'access_point',
      iap: 'access_point',
      instant_ap: 'access_point',
      switch: 'switch',
      cx: 'switch',
      aos_switch: 'switch',
      'aos-s': 'switch',
      'aos-cx': 'switch',
      gateway: 'gateway',
      gw: 'gateway',
      mobility_controller: 'gateway',
      controller: 'gateway',
      mc: 'gateway',
    };
    // Handle both uppercase (new API) and lowercase (legacy)
    const deviceType = typeMap[centralType] || typeMap[centralType?.toLowerCase()];
    if (!deviceType) {
      logger.warn('Unknown device type encountered', { centralType });
      return 'access_point'; // Historical default fallback
    }
    return deviceType;
  }

  mapDeviceStatus(centralStatus) {
    const statusMap = {
      online: 'online',
      up: 'online',
      offline: 'offline',
      down: 'offline',
      warning: 'warning',
      maintenance: 'maintenance',
    };
    return statusMap[String(centralStatus || '').toLowerCase()] || 'offline';
  }

  /** ISO string or epoch seconds → Date; anything else → null. */
  parseTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // -----------------------------------------------------------------------
  // Scope backups (read-only): the config Central holds above the device,
  // which is where access point config lives.
  // -----------------------------------------------------------------------

  /** Every item of a paged scope list (`limit`/`offset`; the reply's own offset is unreliable). */
  async listAllScopeItems(endpoint) {
    const items = [];
    for (;;) {
      const page = await this.makeRequest('GET', `${CONFIG_API}/${endpoint}`, {
        params: { limit: 100, offset: items.length },
        context: 'scope_list',
      });
      const batch = page?.items || [];
      items.push(...batch);
      if (!batch.length || items.length >= (page.total ?? items.length)) return items;
    }
  }

  /** Global first, then site collections, sites and device groups, each by name. */
  async listConfigScopes() {
    const scopes = [{ scopeType: 'org', scopeId: 'global', name: 'Global' }];
    for (const { scopeType, endpoint } of SCOPE_LISTS) {
      const items = await this.listAllScopeItems(endpoint);
      scopes.push(...items
        .map((item) => {
          const scopeId = String(item.scopeId ?? item.id);
          return { scopeType, scopeId, name: item.scopeName || scopeId };
        })
        .sort((a, b) => a.name.localeCompare(b.name)));
    }
    return scopes;
  }

  /**
   * Snapshot one scope as a canonical-JSON bundle:
   *   assignments - the library profiles assigned at this scope, per device function
   *   objects     - every object in effect at this scope (Central's LOCAL view
   *                 of each profile type its scope map lists), local or library
   * The global scope also carries `library`: every profile of every type the
   * tenant assigns or maps anywhere, since lower scopes refer to them by name.
   *
   * A profile type Central won't list here (400/404) is recorded as null
   * rather than failing the scope; anything else fails it.
   */
  async getScopeConfiguration(scope) {
    const assignments = (await this.makeRequest('GET', `${CONFIG_API}/config-assignments`, {
      context: 'scope_config',
      exactScopeIds: true,
    }))?.['config-assignment'] || [];
    const scopeMaps = (await this.makeRequest('GET', `${CONFIG_API}/scope-maps`, {
      context: 'scope_config',
      exactScopeIds: true,
    }))?.['scope-map'] || [];

    // The global scope's id is the tenant's; learn it from its assignments.
    const centralScopeId = scope.scopeType === 'org'
      ? assignments.find((a) => a['scope-type'] === 'GLOBAL')?.['scope-id'] ?? null
      : String(scope.scopeId);

    const typeOf = (resource) => String(resource || '').split('/')[0];
    const atScope = (id) => String(id) === String(centralScopeId);
    const scopedTypes = [...new Set(scopeMaps.filter((m) => atScope(m['scope-id'])).map((m) => typeOf(m.resource)))]
      .filter(Boolean)
      .sort();

    const bundle = {
      scope: { type: scope.scopeType, id: scope.scopeId, name: scope.name, centralScopeId },
      assignments: assignments
        .filter((a) => atScope(a['scope-id']))
        .map((a) => ({
          deviceFunction: a['device-function'],
          profileType: a['profile-type'],
          profileInstance: a['profile-instance'],
        }))
        .sort((a, b) => [a.profileType, a.profileInstance, a.deviceFunction].join('|')
          .localeCompare([b.profileType, b.profileInstance, b.deviceFunction].join('|'))),
      objects: {},
    };

    // Sequential, to stay inside Central's per-second rate limit.
    if (centralScopeId) {
      for (const type of scopedTypes) {
        bundle.objects[type] = await this.readProfiles(type, { 'scope-id': centralScopeId, 'view-type': 'LOCAL' });
      }
    }

    if (scope.scopeType === 'org') {
      const libraryTypes = [...new Set([
        ...assignments.map((a) => a['profile-type']),
        ...scopeMaps.map((m) => typeOf(m.resource)),
      ])].filter(Boolean).sort();
      bundle.library = {};
      for (const type of libraryTypes) {
        bundle.library[type] = await this.readProfiles(type);
      }
    }

    return {
      text: this.canonicalJson(redactConfigSecrets(bundle)),
      format: 'central-scope-json',
      source: this.label,
    };
  }

  /**
   * One profile type's objects. Each type names its list differently
   * (`profile`, `l2-vlan`, `wlan-ssid`, ...), so the reply is kept whole,
   * minus Central's object counters, with each list sorted by identity.
   */
  async readProfiles(type, params = {}) {
    let body;
    try {
      body = await this.makeRequest('GET', `${CONFIG_API}/${encodeURIComponent(type)}`, { params, context: 'scope_config' });
    } catch (error) {
      if (error.statusCode === 400 || error.statusCode === 404) return null;
      throw error;
    }
    if (!body || typeof body !== 'object') return body ?? null;
    const { metadata, ...rest } = body; // eslint-disable-line no-unused-vars
    for (const [key, value] of Object.entries(rest)) {
      if (Array.isArray(value)) {
        rest[key] = [...value].sort((a, b) => profileKey(a).localeCompare(profileKey(b)));
      }
    }
    return rest;
  }

  // -----------------------------------------------------------------------
  // QUARANTINED classic-Central endpoints.
  // These families 404 on New Central tenants and the previous
  // implementations never worked (unset baseURL since inception). They throw
  // CapabilityError so callers report "not supported" instead of a confusing
  // network error. Resurrect only after proving an endpoint against the
  // live tenant, per the triage script.
  // -----------------------------------------------------------------------

  async getDeviceConfiguration(serial) { // eslint-disable-line no-unused-vars
    this.unsupported('config-backup', 'classic /configuration/v2 endpoints are unverified on New Central tenants');
  }

  async updateDeviceConfiguration(serial, configuration) { // eslint-disable-line no-unused-vars
    this.unsupported('config-write', 'classic /configuration/v2 endpoints are unverified on New Central tenants');
  }

  async backupConfiguration(serial) { // eslint-disable-line no-unused-vars
    this.unsupported('config-backup', 'classic /configuration/v2 endpoints are unverified on New Central tenants');
  }

  async executeCommand(serial, command) { // eslint-disable-line no-unused-vars
    this.unsupported('command-execution', 'classic /troubleshooting/v1 endpoints are unverified on New Central tenants');
  }

  async getDeviceStats(serial, metric, duration) { // eslint-disable-line no-unused-vars
    this.unsupported('stats', 'classic /monitoring/v2 endpoints are unverified on New Central tenants');
  }

  /** Wrap axios errors with the Aruba-specific parser (user-friendly message + actions). */
  enhanceError(error, context) {
    if (error.name === 'CapabilityError') return error;
    const enhanced = ArubaErrorHandler.parseError(error, context);
    ArubaErrorHandler.logError(enhanced);
    const userError = new Error(enhanced.userMessage);
    userError.type = enhanced.type;
    userError.category = enhanced.category;
    userError.actions = enhanced.actions;
    userError.isArubaError = enhanced.isArubaError;
    userError.isProviderError = enhanced.isArubaError;
    userError.statusCode = enhanced.details?.statusCode;
    userError.originalError = error;
    userError.details = ArubaErrorHandler.diagnostics(enhanced);
    return userError;
  }
}

module.exports = ArubaCentralProvider;
