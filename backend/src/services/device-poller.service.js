const axios = require('axios');
const https = require('https');
const settingsService = require('./settings.service');
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
   * Polls firmware information from AOS-CX switches
   * @param {Object} device - Device object from database
   * @param {Object} credentials - Decrypted credentials
   * @returns {Promise<Object>} Firmware information
   */
  async firmwarePoller(device, credentials) {
    try {
      logger.progress(`Polling firmware info from ${device.name} (${device.ipAddress})`);

      // Determine base URL based on device type
      let baseUrl, apiPath;

      switch (device.type) {
        case 'switch':
          // AOS-CX switch - use REST API v10.15
          baseUrl = `https://${device.ipAddress}/rest/v10.15`;
          apiPath = '/firmware';
          break;

        // Additional device types can be added here
        case 'ap':
        case 'gateway':
          throw new Error(`Firmware polling not yet implemented for device type: ${device.type}`);

        default:
          throw new Error(`Unsupported device type: ${device.type}`);
      }

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
   * Get list of available pollers
   * @returns {Array<string>} Array of poller names
   */
  getAvailablePollers() {
    return Array.from(this.pollers.keys());
  }
}

module.exports = new DevicePollerService();
