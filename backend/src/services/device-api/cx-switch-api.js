const axios = require('axios');
const https = require('https');
const WebSocket = require('ws');
const BaseDeviceAPI = require('./base-device-api');
const cxLive = require('./cx-live');
const logger = require('../../utils/logger');

// One REST version for every call (login, requests, logout, notifications).
// 10.10 is served by AOS-CX 10.10 and later; checked against ML.10.16.
const CX_REST_VERSION = '10.10';

/**
 * Aruba CX Switch API Implementation
 *
 * Implements the BaseDeviceAPI interface for Aruba CX switches running AOS-CX.
 * Handles cookie-based authentication with CSRF token support.
 *
 * API Documentation: https://developer.arubanetworks.com/aoscx/docs/introduction
 *
 * Authentication:
 * - Uses session cookies for state management
 * - Requires CSRF token for firmware v10.09+
 * - Login endpoint: /rest/v{version}/login
 * - Logout endpoint: /rest/v{version}/logout
 *
 * Sessions are a scarce resource on AOS-CX (a handful per user), so
 * long-lived callers (services/live/) keep one instance per device and reuse
 * its session rather than logging in per request.
 */
class CXSwitchAPI extends BaseDeviceAPI {
  constructor(device, credentials) {
    super('cx_switch', device, credentials);

    // API version to use (can be overridden)
    this.apiVersion = CX_REST_VERSION;

    // HTTP agent that ignores self-signed certificates (typical in network devices)
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    // Session storage
    this.sessionCookie = null;
    this.csrfToken = null;
  }

  /**
   * Login to CX switch
   * @returns {Promise<Object>} Login result with session info
   */
  async login() {
    try {
      this.validateCredentials();

      const baseUrl = this.getBaseUrl();
      const loginUrl = `${baseUrl}/rest/v${this.apiVersion}/login`;

      logger.info('Attempting CX switch login', {
        device: this.device.name,
        ipAddress: this.device.ipAddress,
        username: this.credentials.username,
        apiVersion: this.apiVersion,
      });

      // Form body, not query string: a password in the URL ends up in the
      // switch's (and any proxy's) access logs.
      const params = new URLSearchParams({
        username: this.credentials.username,
        password: this.credentials.password,
      });

      // Make login request
      const response = await axios.post(
        loginUrl,
        params.toString(),
        {
          headers: {
            'accept': '*/*',
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-use-csrf-token': 'true', // Request CSRF token for v10.09+
          },
          httpsAgent: this.httpsAgent,
          validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        }
      );

      // Check if login was successful
      if (response.status !== 200) {
        throw new Error(`Login failed with status ${response.status}: ${response.statusText}`);
      }

      // Extract session cookie from Set-Cookie header
      const setCookieHeader = response.headers['set-cookie'];
      if (setCookieHeader && setCookieHeader.length > 0) {
        this.sessionCookie = setCookieHeader.map((c) => c.split(';')[0]).join('; ');
        logger.debug('Session cookie extracted', {
          cookieLength: this.sessionCookie.length,
        });
      }

      // Extract CSRF token if present in response headers
      if (response.headers['x-csrf-token']) {
        this.csrfToken = response.headers['x-csrf-token'];
        logger.debug('CSRF token extracted', {
          tokenLength: this.csrfToken.length,
        });
      }

      // Store session info
      this.session = {
        cookie: this.sessionCookie,
        csrfToken: this.csrfToken,
        loginTime: new Date(),
      };

      logger.info('CX switch login successful', {
        device: this.device.name,
        hasCookie: !!this.sessionCookie,
        hasCsrfToken: !!this.csrfToken,
      });

      return {
        success: true,
        message: 'Login successful',
        sessionCookie: !!this.sessionCookie,
        csrfToken: !!this.csrfToken,
      };
    } catch (error) {
      logger.error('CX switch login failed', {
        device: this.device.name,
        error: error.message,
      });

      // Clear any partial session data
      this.clearSession();

      throw new Error(`CX login failed: ${error.message}`);
    }
  }

  /**
   * Logout from CX switch
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      if (!this.hasValidSession()) {
        logger.debug('No active session to logout from');
        return;
      }

      const baseUrl = this.getBaseUrl();
      const logoutUrl = `${baseUrl}/rest/v${this.apiVersion}/logout`;

      logger.info('Attempting CX switch logout', {
        device: this.device.name,
      });

      await axios.post(logoutUrl, '', {
        headers: {
          'Cookie': this.sessionCookie,
          ...(this.csrfToken && { 'X-CSRF-Token': this.csrfToken }),
        },
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
      });

      this.clearSession();

      logger.info('CX switch logout successful', {
        device: this.device.name,
      });
    } catch (error) {
      logger.error('CX switch logout failed', {
        device: this.device.name,
        error: error.message,
      });

      // Clear session anyway
      this.clearSession();
    }
  }

  /**
   * Test connection to CX switch
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    const startTime = Date.now();

    try {
      // Attempt login
      await this.login();

      // Get device info to verify connection
      const deviceInfo = await this.getDeviceInfo();

      // Logout
      await this.logout();

      const responseTime = Date.now() - startTime;

      return {
        success: true,
        message: 'Connection successful',
        testedAt: new Date().toISOString(),
        responseTime,
        deviceInfo: {
          hostname: deviceInfo.hostname || 'Unknown',
          model: deviceInfo.platform_name || this.device.model,
          version: deviceInfo.software_version || 'Unknown',
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        success: false,
        message: `Connection failed: ${error.message}`,
        testedAt: new Date().toISOString(),
        responseTime,
      };
    }
  }

  /**
   * Get device information from CX switch
   * @returns {Promise<Object>} Device information
   */
  async getDeviceInfo() {
    try {
      const response = await this.makeAuthenticatedRequest('GET', '/system');

      return {
        hostname: response.hostname,
        model: response.platform_name,
        version: response.software_version,
        serialNumber: response.serial_number,
        macAddress: response.system_mac,
        uptime: response.boot_time,
        timezone: response.timezone,
        fullData: response,
      };
    } catch (error) {
      logger.error('Failed to get CX device info', {
        device: this.device.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get firmware information
   * @returns {Promise<Object>} Firmware information
   */
  async getFirmwareInfo() {
    try {
      const response = await this.makeAuthenticatedRequest('GET', '/firmware');

      return {
        currentVersion: response.current_version,
        primaryVersion: response.primary_version,
        secondaryVersion: response.secondary_version,
        bootedImage: response.booted_image,
        fullData: response,
      };
    } catch (error) {
      logger.error('Failed to get CX firmware info', {
        device: this.device.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get the switch's own view of its Aruba Central relationship.
   * Real 10.10-era payload: { disable: false, central_source, location,
   * status: { central_connection: 'connected', ... }, ... }
   * AOS-CX 10.15+ renames the resource to hpe_anw_central; fall back to it.
   * @returns {Promise<Object>} Raw aruba_central / hpe_anw_central resource
   */
  async getCentralStatus() {
    try {
      try {
        return await this.makeAuthenticatedRequest('GET', '/system/aruba_central');
      } catch (error) {
        if (!error.message.includes('404')) throw error;
        return await this.makeAuthenticatedRequest('GET', '/system/hpe_anw_central');
      }
    } catch (error) {
      logger.error('Failed to get CX Aruba Central status', {
        device: this.device.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get interface information
   * @returns {Promise<Object>} Interface information
   */
  async getInterfaces() {
    try {
      const response = await this.makeAuthenticatedRequest('GET', '/system/interfaces');
      return response;
    } catch (error) {
      logger.error('Failed to get CX interfaces', {
        device: this.device.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get VLAN information
   * @returns {Promise<Object>} VLAN information
   */
  async getVLANs() {
    try {
      const response = await this.makeAuthenticatedRequest('GET', '/system/vlans');
      return response;
    } catch (error) {
      logger.error('Failed to get CX VLANs', {
        device: this.device.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Make an authenticated request to the CX switch API
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} endpoint - API endpoint (without /rest/vX.XX prefix)
   * @param {Object} data - Request body data (optional)
   * @returns {Promise<Object>} Response data
   */
  async makeAuthenticatedRequest(method, endpoint, data = null, { retried = false } = {}) {
    try {
      // Ensure we have a valid session
      if (!this.hasValidSession()) {
        await this.login();
      }

      const baseUrl = this.getBaseUrl();
      const url = `${baseUrl}/rest/v${this.apiVersion}${endpoint}`;

      const config = {
        method,
        url,
        headers: {
          'Cookie': this.sessionCookie,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
      };

      // Add CSRF token if available
      if (this.csrfToken) {
        config.headers['X-CSRF-Token'] = this.csrfToken;
      }

      // Add request body if provided
      if (data) {
        config.data = data;
      }

      logger.debug('Making CX API request', {
        method,
        endpoint,
        url,
      });

      const response = await axios(config);

      // Expired or revoked session: log in again and retry once.
      if (response.status === 401 && !retried) {
        logger.warn('CX session expired, re-authenticating', { device: this.device.name });
        this.clearSession();
        return this.makeAuthenticatedRequest(method, endpoint, data, { retried: true });
      }

      if (response.status >= 400) {
        const error = new Error(`API request failed with status ${response.status}: ${response.statusText}`);
        error.status = response.status;
        throw error;
      }

      return response.data;
    } catch (error) {
      logger.error('CX API request failed', {
        method,
        endpoint,
        error: error.message,
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------
  // Live state (services/live/). Parsing lives in cx-live.js.
  // ---------------------------------------------------------------------

  /**
   * Normalized state of every physical port, including PoE where the port
   * has it. Two GETs; used as the baseline before subscribing and to resync.
   */
  async getPortState() {
    const interfaces = await this.makeAuthenticatedRequest(
      'GET',
      '/system/interfaces?depth=2&attributes=name,type,description,link_state,link_speed,duplex,user_config'
    );
    let poe = {};
    try {
      poe = await this.makeAuthenticatedRequest(
        'GET',
        '/system/interfaces/*/poe_interface?depth=1&attributes=status,pd_type,power_mgmt,measurements'
      );
    } catch (error) {
      // Non-PoE models have no poe_interface resources.
      if (error.status !== 404) throw error;
    }
    return cxLive.normalizePortState(interfaces, poe);
  }

  /** Current PoE draw per port, { "1/1/4": 4.24, ... }; empty on non-PoE models. */
  async getPoePower() {
    try {
      const poe = await this.makeAuthenticatedRequest(
        'GET',
        '/system/interfaces/*/poe_interface?depth=1&attributes=measurements'
      );
      const out = {};
      for (const [port, entry] of Object.entries(poe || {})) {
        const { powerW } = cxLive.normalizePoe(cxLive.unwrapPoe(entry) || {});
        if (powerW !== undefined) out[port] = powerW;
      }
      return out;
    } catch (error) {
      if (error.status === 404) return {};
      throw error;
    }
  }

  /** Cumulative per-port counters (bytes, packets, errors) for rate math. */
  async getInterfaceCounters() {
    const interfaces = await this.makeAuthenticatedRequest(
      'GET',
      '/system/interfaces?depth=2&attributes=name,type,statistics'
    );
    return cxLive.normalizeCounters(interfaces);
  }

  /** CPU and memory percentages from the management module. */
  async getResourceUtilization() {
    const mm = await this.makeAuthenticatedRequest(
      'GET',
      '/system/subsystems/management_module,1%2F1?attributes=resource_utilization'
    );
    const ru = mm?.resource_utilization || {};
    return {
      cpu: typeof ru.cpu === 'number' ? ru.cpu : null,
      memory: typeof ru.memory === 'number' ? ru.memory : null,
    };
  }

  /**
   * Open the REST notification WebSocket and subscribe to changes for the
   * given ports (link) plus PoE status on all ports. Uses this instance's
   * session, so it does not consume another REST session.
   *
   * @param {string[]} ports - physical port names, e.g. ['1/1/1', ...]
   * @param {Object} handlers
   * @param {Function} handlers.onUpdate - ({ updates, sequences }) for each notification
   * @param {Function} handlers.onClose - (code, reason) when the socket closes
   * @param {Function} [handlers.onError] - (error)
   * @returns {Promise<{ close: Function }>} resolves once the subscription is acknowledged
   */
  async openNotificationStream(ports, { onUpdate, onClose, onError } = {}) {
    if (!this.hasValidSession()) await this.login();

    const prefix = `/rest/v${this.apiVersion}`;
    const topics = [
      ...ports.map((port) => (
        `${prefix}/system/interfaces/${encodeURIComponent(port)}?attributes=link_state,link_speed,duplex,user_config`
      )),
      `${prefix}/system/interfaces/*/poe_interface?attributes=status,pd_type`,
    ];
    const url = `${this.getBaseUrl().replace(/^https:/, 'wss:')}${prefix}/notification`;
    const headers = { Cookie: this.sessionCookie };
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;

    const ws = new WebSocket(url, { headers, rejectUnauthorized: false, handshakeTimeout: 15000 });

    return new Promise((resolve, reject) => {
      let subscribed = false;

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe', topics: topics.map((name) => ({ name })) }));
      });

      ws.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!subscribed) {
          if (message.type === 'success') {
            subscribed = true;
            resolve({ close: () => ws.close() });
            // The ack's sequence numbers are each topic's starting point.
            onUpdate?.({ ...cxLive.parseNotification(message), initial: true });
          } else {
            ws.close();
            reject(new Error(`CX notification subscribe failed: ${JSON.stringify(message).slice(0, 200)}`));
          }
          return;
        }
        if (message.type === 'notification') onUpdate?.(cxLive.parseNotification(message));
      });

      ws.on('unexpected-response', (_req, res) => {
        if (res.statusCode === 401) this.clearSession();
        reject(new Error(`CX notification socket refused (HTTP ${res.statusCode})`));
      });

      ws.on('error', (error) => {
        if (!subscribed) reject(error);
        else onError?.(error);
      });

      ws.on('close', (code, reason) => {
        if (subscribed) onClose?.(code, reason?.toString());
      });
    });
  }

  /**
   * Clear session data
   */
  clearSession() {
    super.clearSession();
    this.sessionCookie = null;
    this.csrfToken = null;
  }
}

module.exports = CXSwitchAPI;
module.exports.CX_REST_VERSION = CX_REST_VERSION;
