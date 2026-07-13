const axios = require('axios');
const https = require('https');
const BaseDeviceAPI = require('./base-device-api');
const logger = require('../../utils/logger');

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
 */
class CXSwitchAPI extends BaseDeviceAPI {
  constructor(device, credentials) {
    super('cx_switch', device, credentials);

    // API version to use (can be overridden)
    this.apiVersion = '10.10';

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

      // Build query parameters
      const params = new URLSearchParams({
        username: this.credentials.username,
        password: this.credentials.password,
      });

      // Make login request
      const response = await axios.post(
        `${loginUrl}?${params.toString()}`,
        '',
        {
          headers: {
            'accept': '*/*',
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
        this.sessionCookie = setCookieHeader[0].split(';')[0];
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
      const logoutUrl = `${baseUrl}/rest/v10.04/logout`;

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
  async makeAuthenticatedRequest(method, endpoint, data = null) {
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

      if (response.status >= 400) {
        throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
      }

      return response.data;
    } catch (error) {
      logger.error('CX API request failed', {
        method,
        endpoint,
        error: error.message,
      });

      // If authentication failed, clear session and try once more
      if (error.response && error.response.status === 401) {
        logger.warn('Session expired, attempting to re-authenticate');
        this.clearSession();
        // Don't retry automatically to avoid infinite loops
      }

      throw error;
    }
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
