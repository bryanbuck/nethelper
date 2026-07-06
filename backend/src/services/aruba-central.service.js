const axios = require('axios');
const { debugLog, Services } = require('../utils/debug-logger');
const ArubaErrorHandler = require('../utils/aruba-error-handler');
const { getRedis } = require('../config/redis');
const { getPrisma } = require('../config/database');
const { decrypt } = require('../utils/encryption');

// Create service-specific logger
const logger = debugLog.createLogger(Services.ARUBA_CENTRAL);

class ArubaCentralService {
  constructor() {
    this.redis = null;
    this.configCache = null;
    this.configCacheExpiry = null;
  }

  getRedis() {
    if (!this.redis) {
      this.redis = getRedis();
    }
    return this.redis;
  }

  /**
   * Get active Aruba Central configuration from database
   * Uses in-memory cache with 5-minute expiry
   */
  async getConfig() {
    try {
      // Check cache first (5 minute TTL)
      const now = Date.now();
      if (this.configCache && this.configCacheExpiry && now < this.configCacheExpiry) {
        logger.debug('Using cached Aruba Central config');
        return this.configCache;
      }

      const prisma = getPrisma();

      // Try to get active config from database
      const dbConfig = await prisma.arubaCentralConfig.findFirst({
        where: { isActive: true },
        orderBy: { updatedAt: 'desc' },
      });

      let config;

      if (dbConfig) {
        logger.debug('Loaded Aruba Central config from database');

        // Decrypt client secret
        const decryptedSecret = decrypt(dbConfig.clientSecret);

        config = {
          baseURL: dbConfig.baseUrl,
          clientId: dbConfig.clientId,
          clientSecret: decryptedSecret,
          customerId: dbConfig.customerId,
          source: 'database',
          configId: dbConfig.id,
        };
      } else {
        // Fallback to environment variables if no DB config
        logger.warn('No active Aruba Central config in database, falling back to environment variables');

        if (!process.env.ARUBA_CENTRAL_BASE_URL || !process.env.ARUBA_CENTRAL_CLIENT_ID) {
          throw new Error('Aruba Central configuration not found. Please configure in Settings or environment variables.');
        }

        config = {
          baseURL: process.env.ARUBA_CENTRAL_BASE_URL,
          clientId: process.env.ARUBA_CENTRAL_CLIENT_ID,
          clientSecret: process.env.ARUBA_CENTRAL_CLIENT_SECRET,
          customerId: process.env.ARUBA_CENTRAL_CUSTOMER_ID,
          source: 'environment',
        };
      }

      // Cache for 5 minutes
      this.configCache = config;
      this.configCacheExpiry = now + (5 * 60 * 1000);

      return config;
    } catch (error) {
      logger.error('Error loading Aruba Central config', { error: error.message });
      throw error;
    }
  }

  /**
   * Clear the configuration cache (call when config is updated)
   */
  clearConfigCache() {
    this.configCache = null;
    this.configCacheExpiry = null;
    logger.debug('Aruba Central config cache cleared');
  }

  async getAccessToken() {
    try {
      // Check for cached token
      logger.debug('Checking for cached access token');
      const cachedToken = await this.getRedis().get('aruba:access_token');
      if (cachedToken) {
        logger.success('Using cached access token');
        return cachedToken;
      }

      // Get configuration from database or environment
      const config = await this.getConfig();

      logger.info('No cached token found, requesting new access token');
      logger.debug('OAuth URL', { url: `${config.baseURL}/oauth2/token`, source: config.source });

      // Get new token using form data format
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', config.clientId);
      params.append('client_secret', config.clientSecret);

      logger.progress('Attempting OAuth2 connection', {
        url: `${config.baseURL}/oauth2/token`,
        clientId: config.clientId,
        grantType: 'client_credentials',
        configSource: config.source
      });

      const startTime = Date.now();
      const response = await axios.post(`${config.baseURL}/oauth2/token`, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      const responseTime = Date.now() - startTime;

      logger.success('OAuth2 response received', {
        statusCode: response.status,
        responseTime: `${responseTime}ms`,
        hasAccessToken: !!response.data?.access_token,
        expiresIn: response.data?.expires_in
      });

      const { access_token, expires_in } = response.data;

      // Cache token with expiration
      await this.getRedis().setex('aruba:access_token', expires_in - 60, access_token);
      logger.success('Access token cached', {
        cacheExpiry: `${expires_in - 60}s`,
        tokenLength: access_token?.length
      });

      return access_token;
    } catch (error) {
      // Parse and enhance the error
      const enhancedError = ArubaErrorHandler.parseError(error, 'authentication');
      ArubaErrorHandler.logError(enhancedError);

      // Create a more user-friendly error
      const userError = new Error(enhancedError.userMessage);
      userError.type = enhancedError.type;
      userError.category = enhancedError.category;
      userError.actions = enhancedError.actions;
      userError.isArubaError = enhancedError.isArubaError;
      userError.originalError = error;

      throw userError;
    }
  }

  async makeRequest(method, endpoint, data = null) {
    const requestId = Math.random().toString(36).substr(2, 9);
    try {
      logger.progress('Starting API request', {
        method,
        endpoint,
        url: `${this.baseURL}${endpoint}`,
        hasData: !!data,
        customerId: this.customerId
      }, requestId);

      const accessToken = await this.getAccessToken();
      
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          customer_id: this.customerId,
        },
      };

      if (data) {
        config.data = data;
        logger.debug('Request payload', data, requestId);
      }

      logger.debug('Making HTTP request', {
        method: config.method,
        url: config.url,
        headers: {
          ...config.headers,
          'Authorization': 'Bearer [REDACTED]'
        },
        params: config.params
      }, requestId);

      const startTime = Date.now();
      const response = await axios(config);
      const responseTime = Date.now() - startTime;

      logger.debug('API response received', {
        statusCode: response.status,
        statusText: response.statusText,
        responseTime: `${responseTime}ms`,
        dataSize: JSON.stringify(response.data).length,
        hasData: !!response.data
      }, requestId);

      if (response.data && Array.isArray(response.data)) {
        logger.debug('Response contains array', { itemCount: response.data.length }, requestId);
      } else if (response.data && typeof response.data === 'object') {
        logger.debug('Response object keys', { keys: Object.keys(response.data) }, requestId);
      }

      logger.success('API request completed', {
        method,
        endpoint,
        statusCode: response.status,
        responseTime: `${responseTime}ms`
      }, requestId);

      return response.data;
    } catch (error) {
      // Parse and enhance the error
      const enhancedError = ArubaErrorHandler.parseError(error, `api_${endpoint.split('/')[1] || 'call'}`);
      ArubaErrorHandler.logError(enhancedError, requestId);
      
      // Create a more user-friendly error
      const userError = new Error(enhancedError.userMessage);
      userError.type = enhancedError.type;
      userError.category = enhancedError.category;
      userError.actions = enhancedError.actions;
      userError.isArubaError = enhancedError.isArubaError;
      userError.statusCode = enhancedError.details.statusCode;
      userError.endpoint = endpoint;
      userError.originalError = error;
      
      throw userError;
    }
  }

  /**
   * Get all devices using unified Aruba Central API
   * @param {Object} options - Query options
   * @param {string} options.filter - OData filter string (e.g., "deviceType eq 'SWITCH'")
   * @param {string} options.sort - Sort expression (e.g., "deviceName asc")
   * @param {number} options.limit - Maximum number of devices to return (max 100)
   * @param {number} options.offset - Pagination offset
   * @returns {Promise<Object>} Response with items, count, total, and next cursor
   */
  async getAllDevices(options = {}) {
    logger.info('Fetching all devices from unified endpoint', options);

    try {
      const endpoint = '/network-monitoring/v1alpha1/devices';
      const centralConfig = await this.getConfig();

      // Build query parameters
      const params = {
        customer_id: centralConfig.customerId,
      };

      // Add OData filter if provided
      if (options.filter) {
        params.filter = options.filter;
      }

      // Add sort if provided
      if (options.sort) {
        params.sort = options.sort;
      }

      // Add limit (default 100, max 100)
      if (options.limit) {
        params.limit = Math.min(options.limit, 100);
      }

      // Add pagination cursor if provided
      if (options.next) {
        params.next = options.next;
      }

      const accessToken = await this.getAccessToken();

      const config = {
        method: 'GET',
        url: `${centralConfig.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params,
      };

      logger.debug('Making unified device list request', {
        url: config.url,
        params: { ...params, customer_id: '[REDACTED]' }
      });

      const startTime = Date.now();
      const response = await axios(config);
      const responseTime = Date.now() - startTime;

      const data = response.data;
      const deviceCount = data.items?.length || 0;

      logger.success('Unified device list fetched successfully', {
        count: deviceCount,
        total: data.total,
        hasMore: !!data.next,
        responseTime: `${responseTime}ms`
      });

      return data;
    } catch (error) {
      const enhancedError = ArubaErrorHandler.parseError(error, 'device_list');
      ArubaErrorHandler.logError(enhancedError);

      const userError = new Error(enhancedError.userMessage);
      userError.type = enhancedError.type;
      userError.category = enhancedError.category;
      userError.actions = enhancedError.actions;
      userError.isArubaError = enhancedError.isArubaError;
      userError.statusCode = enhancedError.details.statusCode;
      userError.originalError = error;

      throw userError;
    }
  }

  /**
   * Get detailed information for a specific switch
   * @param {string} serial - Switch serial number
   * @returns {Promise<Object>} Switch details
   */
  async getSwitchDetails(serial) {
    logger.info('Fetching switch details', { serial });

    try {
      const endpoint = `/network-monitoring/v1alpha1/switch/${serial}`;
      const centralConfig = await this.getConfig();
      const accessToken = await this.getAccessToken();

      const config = {
        method: 'GET',
        url: `${centralConfig.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          customer_id: centralConfig.customerId,
        },
      };

      const startTime = Date.now();
      const response = await axios(config);
      const responseTime = Date.now() - startTime;

      logger.success('Switch details fetched successfully', {
        serial,
        model: response.data.model,
        status: response.data.status,
        responseTime: `${responseTime}ms`
      });

      return response.data;
    } catch (error) {
      const enhancedError = ArubaErrorHandler.parseError(error, 'switch_details');
      ArubaErrorHandler.logError(enhancedError);

      const userError = new Error(enhancedError.userMessage);
      userError.type = enhancedError.type;
      userError.category = enhancedError.category;
      userError.actions = enhancedError.actions;
      userError.isArubaError = enhancedError.isArubaError;
      userError.statusCode = enhancedError.details.statusCode;
      userError.originalError = error;

      throw userError;
    }
  }

  /**
   * Get detailed information for a specific access point
   * @param {string} serial - Access point serial number
   * @returns {Promise<Object>} Access point details
   */
  async getAccessPointDetails(serial) {
    logger.info('Fetching access point details', { serial });

    try {
      const endpoint = `/network-monitoring/v1alpha1/aps/${serial}`;
      const centralConfig = await this.getConfig();
      const accessToken = await this.getAccessToken();

      const config = {
        method: 'GET',
        url: `${centralConfig.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          customer_id: centralConfig.customerId,
        },
      };

      const startTime = Date.now();
      const response = await axios(config);
      const responseTime = Date.now() - startTime;

      logger.success('Access point details fetched successfully', {
        serial,
        model: response.data.model,
        status: response.data.status,
        responseTime: `${responseTime}ms`
      });

      return response.data;
    } catch (error) {
      const enhancedError = ArubaErrorHandler.parseError(error, 'ap_details');
      ArubaErrorHandler.logError(enhancedError);

      const userError = new Error(enhancedError.userMessage);
      userError.type = enhancedError.type;
      userError.category = enhancedError.category;
      userError.actions = enhancedError.actions;
      userError.isArubaError = enhancedError.isArubaError;
      userError.statusCode = enhancedError.details.statusCode;
      userError.originalError = error;

      throw userError;
    }
  }

  // Configuration Methods
  async getDeviceConfiguration(deviceSerial) {
    const endpoint = `/configuration/v2/devices/${deviceSerial}/configuration`;
    return this.makeRequest('GET', endpoint);
  }

  async updateDeviceConfiguration(deviceSerial, configuration) {
    const endpoint = `/configuration/v2/devices/${deviceSerial}/configuration`;
    return this.makeRequest('PUT', endpoint, configuration);
  }

  async backupConfiguration(deviceSerial) {
    const endpoint = `/configuration/v2/devices/${deviceSerial}/config_backup`;
    return this.makeRequest('POST', endpoint);
  }

  // Command Execution
  async executeCommand(deviceSerial, command) {
    const endpoint = '/troubleshooting/v1/commands';
    return this.makeRequest('POST', endpoint, {
      device_serial: deviceSerial,
      command: command,
    });
  }

  // Monitoring Methods
  async getDeviceStats(deviceSerial, metric, duration = '3h') {
    const endpoint = `/monitoring/v2/stats/devices/${deviceSerial}/${metric}`;
    return this.makeRequest('GET', endpoint, null, { duration });
  }

  async getNetworkHealth() {
    const endpoint = '/monitoring/v2/networks/health';
    return this.makeRequest('GET', endpoint);
  }

  // Firmware Management
  async getFirmwareVersions(deviceType) {
    const endpoint = `/firmware/v1/versions/${deviceType}`;
    return this.makeRequest('GET', endpoint);
  }

  async upgradeFirmware(deviceSerial, version) {
    const endpoint = '/firmware/v1/upgrade';
    return this.makeRequest('POST', endpoint, {
      device_serial: deviceSerial,
      firmware_version: version,
    });
  }
}

module.exports = new ArubaCentralService();
