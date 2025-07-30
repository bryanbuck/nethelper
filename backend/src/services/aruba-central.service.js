const axios = require('axios');
const logger = require('../utils/logger');
const { getRedis } = require('../config/redis');

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
      const cachedToken = await this.getRedis().get('aruba:access_token');
      if (cachedToken) {
        return cachedToken;
      }

      // Get new token using form data format
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);

      const response = await axios.post(`${this.baseURL}/oauth2/token`, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token, expires_in } = response.data;

      // Cache token with expiration
      await this.getRedis().setex('aruba:access_token', expires_in - 60, access_token);

      return access_token;
    } catch (error) {
      logger.error('Failed to get Aruba Central access token:', error);
      throw error;
    }
  }

  async makeRequest(method, endpoint, data = null) {
    try {
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
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      logger.error(`Aruba Central API error - ${method} ${endpoint}:`, error.response?.data || error.message);
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
