const axios = require('axios');
const https = require('https');
const settingsService = require('./settings.service');
const sshDeviceService = require('./ssh-device.service');
const { isCxRestCapable } = require('../utils/device-platform');
const { getPrisma } = require('../config/database');
const { debugLog, Services } = require('../utils/debug-logger');

// Create service-specific logger
const logger = debugLog.createLogger(Services.DEVICE);

/**
 * Device Poller Service
 *
 * A modular service for polling device-specific information directly from devices.
 * This is separate from Aruba Central APIs and uses device-specific credentials.
 *
 * Architecture:
 * - Base service handles common operations (authentication, HTTP requests, error handling)
 * - Poller modules implement specific data collection (firmware, config, stats, etc.)
 * - Supports bulk device polling with parallel execution
 */
class DevicePollerService {
  constructor() {
    // Registry of available pollers
    this.pollers = new Map();

    // Register built-in pollers
    this.registerPoller('firmware', this.firmwarePoller.bind(this));
    this.registerPoller('system', this.systemPoller.bind(this));
    this.registerPoller('backup', this.backupPoller.bind(this));
    this.registerPoller('login-sessions', this.loginSessionsPoller.bind(this));
  }

  /**
   * Register a new poller module
   * @param {string} name - Poller name
   * @param {Function} pollerFunction - Async function that polls device
   */
  registerPoller(name, pollerFunction) {
    this.pollers.set(name, pollerFunction);
    logger.info(`Registered poller: ${name}`);
  }

  /**
   * Poll multiple devices using a specific poller
   * @param {string} pollerName - Name of the poller to use
   * @param {Array<string>} deviceIds - Array of device IDs to poll
   * @returns {Promise<Array>} Array of poll results
   */
  async pollDevices(pollerName, deviceIds) {
    try {
      const poller = this.pollers.get(pollerName);

      if (!poller) {
        throw new Error(`Poller '${pollerName}' not found. Available pollers: ${Array.from(this.pollers.keys()).join(', ')}`);
      }

      logger.progress(`Polling ${deviceIds.length} device(s) with ${pollerName} poller`);

      // Poll all devices in parallel
      const results = await Promise.allSettled(
        deviceIds.map(deviceId => this.pollDevice(poller, deviceId))
      );

      // Transform results
      const pollResults = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return {
            deviceId: deviceIds[index],
            success: true,
            data: result.value,
            timestamp: new Date().toISOString(),
          };
        } else {
          return {
            deviceId: deviceIds[index],
            success: false,
            error: result.reason.message || 'Unknown error',
            timestamp: new Date().toISOString(),
          };
        }
      });

      const successCount = pollResults.filter(r => r.success).length;
      const failureCount = pollResults.filter(r => !r.success).length;

      logger.success(`Polling completed: ${successCount} succeeded, ${failureCount} failed`);

      return pollResults;
    } catch (error) {
      logger.error('Poll devices error', { error: error.message, pollerName });
      throw error;
    }
  }

  /**
   * Poll a single device with a specific poller
   * @param {Function} poller - Poller function
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>} Poll result
   */
  async pollDevice(poller, deviceId) {
    try {
      // Get device information
      const prisma = getPrisma();
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
      });

      if (!device) {
        throw new Error(`Device not found: ${deviceId}`);
      }

      if (!device.ipAddress) {
        throw new Error(`Device ${device.name} has no IP address configured`);
      }

      // Get device credentials
      const credentials = await settingsService.getDeviceCredentialsForUse(deviceId);

      if (!credentials) {
        throw new Error(`No credentials found for device ${device.name}`);
      }

      // Execute the poller
      const result = await poller(device, credentials);

      return result;
    } catch (error) {
      logger.error('Poll device error', { deviceId, error: error.message });
      throw error;
    }
  }

  /**
   * Make an authenticated API request to a device
   * @param {string} baseUrl - Device base URL
   * @param {string} path - API path
   * @param {Object} credentials - Device credentials
   * @param {Object} options - Additional axios options
   * @returns {Promise<Object>} API response data
   */
  async makeDeviceRequest(baseUrl, path, credentials, options = {}) {
    try {
      const url = `${baseUrl}${path}`;

      // Create axios config with authentication
      const config = {
        method: options.method || 'GET',
        url,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        timeout: options.timeout || 15000,
        // Accept self-signed certificates (common with network devices)
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
      };

      // Add authentication
      if (credentials.username && credentials.password) {
        config.auth = {
          username: credentials.username,
          password: credentials.password,
        };
      } else if (credentials.apiKey) {
        config.headers['Authorization'] = `Bearer ${credentials.apiKey}`;
      }

      // Add request body if provided
      if (options.data) {
        config.data = options.data;
      }

      const response = await axios(config);

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Device API error (${error.response.status}): ${error.response.data?.message || error.message}`);
      } else if (error.request) {
        throw new Error(`Device unreachable: ${error.message}`);
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }

  /**
   * Firmware Poller Module
   * Polls firmware information from AOS-CX switches (REST) or other direct
   * devices via SSH `show version`.
   * @param {Object} device - Device object from database
   * @param {Object} credentials - Decrypted credentials
   * @returns {Promise<Object>} Firmware information
   */
  async firmwarePoller(device, credentials) {
    try {
      logger.progress(`Polling firmware info from ${device.name} (${device.ipAddress})`);

      if (!isCxRestCapable(device)) {
        // SSH fallback: return the raw `show version` text for CLI-only devices.
        const versionText = await sshDeviceService.getVersion(device, credentials);
        return {
          transport: 'ssh',
          raw_version: versionText,
          primary_version: this.parseVersionFromText(versionText),
        };
      }

      // AOS-CX switch - use REST API v10.15
      const baseUrl = `https://${device.ipAddress}/rest/v10.15`;
      const apiPath = '/firmware';

      // Make API request
      const firmwareData = await this.makeDeviceRequest(baseUrl, apiPath, credentials);

      // Extract relevant fields
      const result = {
        booted_image: firmwareData.booted_image || null,
        current_image: firmwareData.current_image || null,
        default_image: firmwareData.default_image || null,
        primary_version: firmwareData.primary_version || null,
        secondary_version: firmwareData.secondary_version || null,
      };

      logger.success(`Firmware info retrieved from ${device.name}`, {
        primary: result.primary_version,
        secondary: result.secondary_version,
        booted: result.booted_image,
      });

      return result;
    } catch (error) {
      logger.error(`Firmware polling failed for ${device.name}`, { error: error.message });
      throw error;
    }
  }

  /**
   * System Poller Module
   * Polls system information from AOS-CX switches
   * @param {Object} device - Device object from database
   * @param {Object} credentials - Decrypted credentials
   * @returns {Promise<Object>} System information
   */
  async systemPoller(device, credentials) {
    try {
      logger.progress(`Polling system info from ${device.name} (${device.ipAddress})`);

      if (!isCxRestCapable(device)) {
        // SSH fallback for CLI-only devices: return raw `show version` text.
        const versionText = await sshDeviceService.getVersion(device, credentials);
        return {
          transport: 'ssh',
          hostname: null,
          software_version: this.parseVersionFromText(versionText),
          raw_version: versionText,
        };
      }

      // AOS-CX switch - use REST API v10.15
      const baseUrl = `https://${device.ipAddress}/rest/v10.15`;
      const apiPath = '/system';

      // Make API request with depth=1 to get basic system info
      const systemData = await this.makeDeviceRequest(baseUrl, apiPath, credentials, {
        headers: { 'Depth': '1' }
      });

      // Extract relevant fields (common fields returned by /system endpoint)
      const result = {
        hostname: systemData.hostname || null,
        platform_name: systemData.platform_name || null,
        software_version: systemData.software_version || null,
        software_info: systemData.software_info || null,
        mgmt_intf_status: systemData.mgmt_intf_status || null,
        boot_time: systemData.boot_time || null,
        usb_status: systemData.usb_status || null,
        timezone: systemData.timezone || null,
        contact: systemData.contact || null,
        location: systemData.location || null,
        description: systemData.description || null,
      };

      logger.success(`System info retrieved from ${device.name}`, {
        hostname: result.hostname,
        platform: result.platform_name,
        version: result.software_version,
      });

      return result;
    } catch (error) {
      logger.error(`System polling failed for ${device.name}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Backup Poller Module
   * Retrieves configuration backup from AOS-CX switches
   * @param {Object} device - Device object from database
   * @param {Object} credentials - Decrypted credentials
   * @returns {Promise<Object>} Configuration data
   */
  async backupPoller(device, credentials) {
    try {
      logger.progress(`Polling configuration backup from ${device.name} (${device.ipAddress})`);

      // Determine base URL based on device type
      let baseUrl, runningConfigPath, startupConfigPath;

      switch (device.type) {
        case 'switch':
          // AOS-CX switch - use REST API v10.15
          baseUrl = `https://${device.ipAddress}/rest/v10.15`;
          runningConfigPath = '/fullconfigs/running-config';
          startupConfigPath = '/fullconfigs/startup-config';
          break;

        case 'ap':
        case 'gateway':
          throw new Error(`Backup polling not yet implemented for device type: ${device.type}`);

        default:
          throw new Error(`Unsupported device type: ${device.type}`);
      }

      // Get both running and startup configurations
      // Note: These can be large, so we're being careful with parallel requests
      const [runningConfig, startupConfig] = await Promise.all([
        this.makeDeviceRequest(baseUrl, runningConfigPath, credentials, { timeout: 30000 }),
        this.makeDeviceRequest(baseUrl, startupConfigPath, credentials, { timeout: 30000 })
      ]);

      const result = {
        running_config: runningConfig,
        startup_config: startupConfig,
        backed_up_at: new Date().toISOString(),
      };

      logger.success(`Configuration backup retrieved from ${device.name}`, {
        running_config_size: JSON.stringify(runningConfig).length,
        startup_config_size: JSON.stringify(startupConfig).length,
      });

      return result;
    } catch (error) {
      logger.error(`Backup polling failed for ${device.name}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Login Sessions Poller Module
   * Polls active login sessions from AOS-CX switches
   * @param {Object} device - Device object from database
   * @param {Object} credentials - Decrypted credentials
   * @returns {Promise<Object>} Active login sessions
   */
  async loginSessionsPoller(device, credentials) {
    try {
      logger.progress(`Polling login sessions from ${device.name} (${device.ipAddress})`);

      // Determine base URL based on device type
      let baseUrl, apiPath;

      switch (device.type) {
        case 'switch':
          // AOS-CX switch - use REST API v10.15
          baseUrl = `https://${device.ipAddress}/rest/v10.15`;
          // Get system resource which contains session information
          // Note: Direct /login-sessions may not exist, using /system/users or similar
          apiPath = '/system/users';
          break;

        case 'ap':
        case 'gateway':
          throw new Error(`Login sessions polling not yet implemented for device type: ${device.type}`);

        default:
          throw new Error(`Unsupported device type: ${device.type}`);
      }

      try {
        // Try to get login sessions - the exact endpoint may vary by firmware version
        const sessionsData = await this.makeDeviceRequest(baseUrl, apiPath, credentials, {
          headers: { 'Depth': '2' }
        });

        const result = {
          users: sessionsData,
          session_count: Object.keys(sessionsData || {}).length,
          polled_at: new Date().toISOString(),
        };

        logger.success(`Login sessions retrieved from ${device.name}`, {
          session_count: result.session_count,
        });

        return result;
      } catch (apiError) {
        // If the endpoint doesn't exist, provide informative error
        if (apiError.message.includes('404')) {
          throw new Error('Login sessions endpoint not available on this device/firmware version. Try using CLI command "show users" instead.');
        }
        throw apiError;
      }
    } catch (error) {
      logger.error(`Login sessions polling failed for ${device.name}`, { error: error.message });
      throw error;
    }
  }

  /**
   * Best-effort extraction of a version string from `show version` output
   * across AOS-S / AOS-CX / IOS-like formats.
   */
  parseVersionFromText(text) {
    if (!text) return null;
    const patterns = [
      /Version[:\s]+([A-Za-z0-9._-]+)/i,      // AOS-S: "Software revision : WC.16.11.x"
      /revision\s*:\s*([A-Za-z0-9._-]+)/i,
      /\b(\d+\.\d+\.\d+[A-Za-z0-9._-]*)\b/,   // generic semver-ish
    ];
    for (const re of patterns) {
      const match = re.exec(text);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * Get list of available pollers
   * @returns {Array<string>} Array of poller names
   */
  getAvailablePollers() {
    return Array.from(this.pollers.keys());
  }
}

module.exports = new DevicePollerService();
