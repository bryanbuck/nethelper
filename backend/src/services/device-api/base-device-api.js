
/**
 * Base Device API Interface
 *
 * This abstract class defines the standard interface for device-specific API implementations.
 * All device API services (CX, AOS, etc.) should extend this class and implement the required methods.
 *
 * This ensures a consistent interface across different device types while allowing device-specific
 * implementations.
 */
class BaseDeviceAPI {
  constructor(deviceType, device, credentials) {
    if (this.constructor === BaseDeviceAPI) {
      throw new Error('BaseDeviceAPI is an abstract class and cannot be instantiated directly');
    }

    this.deviceType = deviceType;
    this.device = device;
    this.credentials = credentials;
    this.session = null; // For storing session cookies, tokens, etc.
  }

  /**
   * Login to the device
   * Must be implemented by subclasses
   * @returns {Promise<Object>} Login result with session info
   */
  async login() {
    throw new Error('login() must be implemented by subclass');
  }

  /**
   * Logout from the device
   * Must be implemented by subclasses
   * @returns {Promise<void>}
   */
  async logout() {
    throw new Error('logout() must be implemented by subclass');
  }

  /**
   * Test connection to the device
   * Must be implemented by subclasses
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by subclass');
  }

  /**
   * Get device information
   * Must be implemented by subclasses
   * @returns {Promise<Object>} Device information
   */
  async getDeviceInfo() {
    throw new Error('getDeviceInfo() must be implemented by subclass');
  }

  /**
   * Get device configuration
   * Optional - may not be supported by all device types
   * @returns {Promise<Object>} Device configuration
   */
  async getConfiguration() {
    throw new Error('getConfiguration() is not implemented for this device type');
  }

  /**
   * Get device status
   * Optional - may not be supported by all device types
   * @returns {Promise<Object>} Device status
   */
  async getStatus() {
    throw new Error('getStatus() is not implemented for this device type');
  }

  /**
   * Get firmware information
   * Optional - may not be supported by all device types
   * @returns {Promise<Object>} Firmware information
   */
  async getFirmwareInfo() {
    throw new Error('getFirmwareInfo() is not implemented for this device type');
  }

  /**
   * Execute a command on the device
   * Optional - may not be supported by all device types
   * @param {string} command - Command to execute
   * @returns {Promise<Object>} Command result
   */
  /**
   * Normalized port/PoE state for the live monitor (services/live/).
   * @returns {Promise<Array>} see services/live/port-state.js for the shape
   */
  async getPortState() {
    const { CapabilityError } = require('../cloud-providers/errors');
    throw new CapabilityError(`Live port state is not available for ${this.deviceType} devices yet`, { capability: 'live' });
  }

  async executeCommand(_command) {
    throw new Error('executeCommand() is not implemented for this device type');
  }

  /**
   * Validate credentials format
   * @returns {boolean} True if credentials are valid format
   */
  validateCredentials() {
    if (!this.credentials) {
      throw new Error('No credentials provided');
    }

    if (!this.credentials.username && !this.credentials.apiKey) {
      throw new Error('Username or API key required');
    }

    if (this.credentials.username && !this.credentials.password) {
      throw new Error('Password required when using username authentication');
    }

    return true;
  }

  /**
   * Get base URL for API calls
   * @returns {string} Base URL
   */
  getBaseUrl() {
    if (!this.device || !this.device.ipAddress) {
      throw new Error('Device IP address not configured');
    }

    // Default to HTTPS
    return `https://${this.device.ipAddress}`;
  }

  /**
   * Check if session is valid
   * @returns {boolean} True if session exists and is valid
   */
  hasValidSession() {
    return !!this.session;
  }

  /**
   * Clear session data
   */
  clearSession() {
    this.session = null;
  }
}

module.exports = BaseDeviceAPI;
