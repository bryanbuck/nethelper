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

class ArubaCentralProvider extends BaseCloudProvider {
  /**
   * @param {Object} integration - { id, provider, name, baseUrl,
   *   credentials: { clientId, clientSecret (decrypted), customerId } }
   */
  constructor(integration) {
    super(integration);
    const { clientId, clientSecret, customerId } = integration.credentials;
    if (!clientId || !clientSecret || !customerId) {
      throw new Error(`Aruba Central integration "${integration.name}" is missing clientId, clientSecret, or customerId`);
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

      const { baseUrl } = this.integration;
      const { clientId, clientSecret } = this.integration.credentials;

      logger.progress('Requesting new access token', {
        integration: this.integration.name,
        url: `${baseUrl}/oauth2/token`,
        clientId,
        grantType: 'client_credentials',
      });

      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);

      const response = await axios.post(`${baseUrl}/oauth2/token`, params, {
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
        params: {
          customer_id: this.integration.credentials.customerId,
          ...params,
        },
        ...(data ? { data } : {}),
      });
      return response.data;
    } catch (error) {
      throw this.enhanceError(error, context);
    }
  }

  async testConnection() {
    try {
      await this.clearTokenCache(); // force a real credential check
      const startTime = Date.now();
      await this.getAccessToken();
      return {
        success: true,
        message: 'Successfully authenticated with Aruba Central',
        details: { responseTime: `${Date.now() - startTime}ms` },
      };
    } catch (error) {
      return { success: false, message: error.message };
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
      params: { filter: `serial eq '${serial}'`, limit: 1 },
      context: 'device_status',
    });
    const item = (page.items || [])[0];
    if (!item) throw new Error(`Device ${serial} not found in ${this.label}`);
    const normalized = this.normalizeDevice(item);
    return { status: normalized.status, lastSeen: normalized.lastSeen, raw: item };
  }

  /** Map a unified-endpoint item to the NormalizedCloudDevice contract. */
  normalizeDevice(item) {
    const type = this.mapDeviceType(item.deviceType);
    const normalized = {
      serial: item.serial,
      name: item.deviceName || item.serial,
      model: item.model || '',
      macAddress: item.macAddress || null,
      ipAddress: item.ipv4 || item.ipv6 || null,
      type,
      vendor: 'aruba',
      platform: null,
      status: this.mapDeviceStatus(item.status),
      firmwareVersion: item.firmwareVersion || null,
      site: item.siteId || null,
      lastSeen: item.lastSeen ? new Date(item.lastSeen * 1000) : null,
      metadata: {
        siteId: item.siteId,
        deployment: item.deployment,
        health: item.health,
        uptime: item.upTime,
        stackId: item.stackId,
        switchRole: item.switchRole,
        firmwareBackupVersion: item.firmwareBackupVersion,
        firmwareStatus: item.firmwareStatus,
        firmwareRecommendedVersion: item.firmwareRecommendedVersion,
      },
    };
    // Classify switches into aos-cx / aos-s from the model string (write-once;
    // the platform column is authoritative after sync persists it).
    if (type === 'switch') {
      const platform = detectPlatform({ type, model: normalized.model, vendor: 'aruba' });
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
      Up: 'online',
      Down: 'offline',
      Warning: 'warning',
      Maintenance: 'maintenance',
      UP: 'online',
      DOWN: 'offline',
    };
    return statusMap[centralStatus] || 'offline';
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
    return userError;
  }
}

module.exports = ArubaCentralProvider;
