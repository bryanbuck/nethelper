const axios = require('axios');
const { debugLog, Services } = require('../utils/debug-logger');
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
      logger.error('Failed to get access token', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        url: `${this.baseURL}/oauth2/token`
      });
      throw error;
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
      const errorDetails = {
        requestId,
        method,
        endpoint,
        url: `${this.baseURL}${endpoint}`,
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        isNetworkError: !error.response,
        isTimeoutError: error.code === 'ECONNABORTED'
      };

      if (error.response) {
        logger.error('API HTTP error', errorDetails, requestId);
      } else if (error.request) {
        logger.error('API network error - no response received', errorDetails, requestId);
      } else {
        logger.error('API request setup error', errorDetails, requestId);
      }

      throw error;
    }
  }

  // Device Management Methods
  async getDevices(filters = {}) {
    const endpoint = '/monitoring/v2/devices';
    return this.makeRequest('GET', endpoint, null, filters);
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
    const endpoint = '/monitoring/v2/switches';
    return this.makeRequest('GET', endpoint, null, filters);
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
