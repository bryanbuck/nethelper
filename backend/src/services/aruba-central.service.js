const axios = require('axios');
const { debugLog, Services } = require('../utils/debug-logger');
const ArubaErrorHandler = require('../utils/aruba-error-handler');
const { getRedis } = require('../config/redis');

// Create service-specific logger
const logger = debugLog.createLogger(Services.ARUBA_CENTRAL);

class ArubaCentralService {
  constructor() {
    this.baseURL = process.env.ARUBA_CENTRAL_BASE_URL;
    this.clientId = process.env.ARUBA_CENTRAL_CLIENT_ID;
    this.clientSecret = process.env.ARUBA_CENTRAL_CLIENT_SECRET;
    this.customerId = process.env.ARUBA_CENTRAL_CUSTOMER_ID;
    this.redis = null;
  }

  getRedis() {
    if (!this.redis) {
      this.redis = getRedis();
    }
    return this.redis;
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

      logger.info('No cached token found, requesting new access token');
      logger.debug('OAuth URL', { url: `${this.baseURL}/oauth2/token` });
      
      // Get new token using form data format
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);

      logger.progress('Attempting OAuth2 connection', {
        url: `${this.baseURL}/oauth2/token`,
        clientId: this.clientId,
        grantType: 'client_credentials'
      });

      const startTime = Date.now();
      const response = await axios.post(`${this.baseURL}/oauth2/token`, params, {
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

  // Device Management Methods - DEPRECATED: Use getAccessPoints() and getSwitches() separately
  async getDevices(filters = {}) {
    // This method is deprecated - use getAccessPoints() and getSwitches() instead
    logger.warn('getDevices() is deprecated - use getAccessPoints() and getSwitches() separately');
    
    // Get both APs and switches and combine them
    const [accessPoints, switches] = await Promise.all([
      this.getAccessPoints(filters),
      this.getSwitches(filters)
    ]);
    
    // Combine and return both device types
    return [...(accessPoints || []), ...(switches || [])];
  }

  async getDevice(deviceSerial) {
    const endpoint = `/monitoring/v2/devices/${deviceSerial}`;
    return this.makeRequest('GET', endpoint);
  }

  async getAccessPoints(filters = {}) {
    const endpoint = '/monitoring/v2/aps';
    return this.makeRequest('GET', endpoint, null, filters);
  }

  async getSwitches(filters = {}) {
    const endpoint = '/monitoring/v1/switches';
    return this.makeRequest('GET', endpoint, null, filters);
  }

  async getGateways(filters = {}) {
    const endpoint = '/monitoring/v1/gateways';
    return this.makeRequest('GET', endpoint, null, filters);
  }

  // New method that properly fetches all device types using current endpoints
  async getAllDevices(filters = {}) {
    logger.info('Fetching all devices using current API endpoints');
    
    try {
      const [accessPointsResult, switchesResult, gatewaysResult] = await Promise.allSettled([
        this.getAccessPoints(filters),
        this.getSwitches(filters),
        this.getGateways(filters)
      ]);

      const allDevices = [];
      let errors = [];

      if (accessPointsResult.status === 'fulfilled') {
        allDevices.push(...(accessPointsResult.value || []));
        logger.debug('Successfully fetched access points', { count: accessPointsResult.value?.length || 0 });
      } else {
        errors.push({ type: 'access_points', error: accessPointsResult.reason });
        logger.error('Failed to fetch access points', { error: accessPointsResult.reason?.message });
      }

      if (switchesResult.status === 'fulfilled') {
        allDevices.push(...(switchesResult.value || []));
        logger.debug('Successfully fetched switches', { count: switchesResult.value?.length || 0 });
      } else {
        errors.push({ type: 'switches', error: switchesResult.reason });
        logger.error('Failed to fetch switches', { error: switchesResult.reason?.message });
      }

      if (gatewaysResult.status === 'fulfilled') {
        allDevices.push(...(gatewaysResult.value || []));
        logger.debug('Successfully fetched gateways', { count: gatewaysResult.value?.length || 0 });
      } else {
        errors.push({ type: 'gateways', error: gatewaysResult.reason });
        logger.warn('Failed to fetch gateways (may not be supported)', { error: gatewaysResult.reason?.message });
      }

      logger.success('Device fetch completed', { 
        totalDevices: allDevices.length,
        errors: errors.length,
        successfulEndpoints: 3 - errors.length
      });

      // If we have at least some devices, return them even if some endpoints failed
      if (allDevices.length > 0) {
        return allDevices;
      }

      // If all endpoints failed, throw an error
      if (errors.length === 3) {
        const error = new Error('Failed to fetch devices from all endpoints');
        error.details = errors;
        throw error;
      }

      return allDevices;
    } catch (error) {
      logger.error('Unexpected error in getAllDevices', { error: error.message });
      throw error;
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
