const axios = require('axios');
const BaseCloudProvider = require('./base-cloud-provider');
const ArubaErrorHandler = require('../../utils/aruba-error-handler');
const { getRedis } = require('../../config/redis');
const { detectPlatform } = require('../../utils/device-platform');
const { debugLog, Services } = require('../../utils/debug-logger');

const logger = debugLog.createLogger(Services.ARUBA_CENTRAL);

// Endpoints verified working against a New Central / GreenLake tenant use the
// network-monitoring v1alpha1 API. The classic-Central endpoint families
// (/configuration/v2, /troubleshooting/v1, /monitoring/v2, /firmware/v1) are
// QUARANTINED below: they were never proven to work (the code paths that
// called them carried an unset-baseURL bug since inception) and 404 on New
// Central tenants. See docs/CENTRAL_ENDPOINT_TRIAGE.md before resurrecting.

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
    return ['inventory', 'status', 'test'].includes(capability);
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

  async makeRequest(method, endpoint, { params = {}, data = null, context = 'api_call' } = {}) {
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
  // QUARANTINED classic-Central endpoints (docs/CENTRAL_ENDPOINT_TRIAGE.md).
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
    userError.statusCode = enhanced.details?.statusCode;
    userError.originalError = error;
    userError.details = ArubaErrorHandler.diagnostics(enhanced);
    return userError;
  }
}

module.exports = ArubaCentralProvider;
