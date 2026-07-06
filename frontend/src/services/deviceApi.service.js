import api from './api'
import { handleApiError } from '@/utils/apiError'

/**
 * Device API Testing Service
 * Handles testing device API connectivity and retrieving device information
 */
class DeviceApiService {
  /**
   * Test manual connection with provided credentials
   * @param {Object} params - Manual test parameters
   * @param {string} params.deviceIp - Device IP address
   * @param {string} params.username - Username for authentication
   * @param {string} params.password - Password for authentication
   * @param {string} params.deviceType - Device type (cx_switch, aos_switch, instant_ap, aruba_controller)
   * @returns {Promise<Object>} Test result
   */
  async testManualConnection(params) {
    try {
      const response = await api.post('/device-api/test-manual', {
        deviceIp: params.deviceIp,
        username: params.username,
        password: params.password,
        deviceType: params.deviceType || 'cx_switch'
      })
      return response.data
    } catch (error) {
      console.error('Error testing manual connection:', error)
      throw handleApiError(error, 'testing device connection')
    }
  }

  /**
   * Test device connection using stored credentials
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>} Test result
   */
  async testDeviceConnection(deviceId) {
    try {
      const response = await api.post(`/device-api/test/${deviceId}`)
      return response.data
    } catch (error) {
      console.error('Error testing device connection:', error)
      throw handleApiError(error, 'testing device connection')
    }
  }

  /**
   * Get device information via API
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>} Device information
   */
  async getDeviceInfo(deviceId) {
    try {
      const response = await api.get(`/device-api/${deviceId}/info`)
      return response.data
    } catch (error) {
      console.error('Error getting device info:', error)
      throw handleApiError(error, 'retrieving device information')
    }
  }

  /**
   * Get firmware information via API
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>} Firmware information
   */
  async getFirmwareInfo(deviceId) {
    try {
      const response = await api.get(`/device-api/${deviceId}/firmware`)
      return response.data
    } catch (error) {
      console.error('Error getting firmware info:', error)
      throw handleApiError(error, 'retrieving firmware information')
    }
  }

  /**
   * Get supported device types
   * @returns {Promise<Array>} List of supported device types
   */
  async getSupportedTypes() {
    try {
      const response = await api.get('/device-api/supported-types')
      return response.data
    } catch (error) {
      console.error('Error getting supported types:', error)
      throw handleApiError(error, 'retrieving supported device types')
    }
  }

  /**
   * Test credential by ID
   * @param {string} credentialId - Credential ID
   * @returns {Promise<Object>} Test result
   */
  async testCredential(credentialId) {
    try {
      const response = await api.post(`/settings/api-credentials/${credentialId}/test`)
      return response.data
    } catch (error) {
      console.error('Error testing credential:', error)
      throw handleApiError(error, 'testing credential')
    }
  }

  /**
   * Format error messages for device API issues
   * @param {Object} error - Error object
   * @returns {Object} Formatted error with troubleshooting steps
   */
  formatConnectionError(error) {
    const errorMessages = {
      'ECONNREFUSED': {
        title: 'Connection Refused',
        message: 'Could not connect to device. Check IP address and network connectivity.',
        actions: [
          'Verify device IP address is correct',
          'Check device is powered on and reachable',
          'Verify backend server can reach device network'
        ]
      },
      'ETIMEDOUT': {
        title: 'Connection Timeout',
        message: 'Device did not respond in time.',
        actions: [
          'Check network connectivity',
          'Verify device is not overloaded',
          'Try again in a few moments'
        ]
      },
      'Authentication failed': {
        title: 'Authentication Failed',
        message: 'Invalid username or password.',
        actions: [
          'Verify username and password are correct',
          'Check user is in administrators group',
          'Ensure password is set on device'
        ]
      },
      'No credentials configured': {
        title: 'No Credentials Found',
        message: 'This device does not have API credentials configured.',
        actions: [
          'Go to Settings > API Credentials',
          'Click "Add Credential"',
          'Link credential to this device'
        ]
      },
      'REST API not enabled': {
        title: 'REST API Not Enabled',
        message: 'The device REST API is not enabled or accessible.',
        actions: [
          'Enable HTTPS REST API on the device',
          'Verify REST API is configured correctly',
          'Check firewall rules allow HTTPS access'
        ]
      },
      'Invalid response': {
        title: 'Invalid Response',
        message: 'The device returned an unexpected response.',
        actions: [
          'Verify device type is correct',
          'Check device firmware version compatibility',
          'Review backend logs for details'
        ]
      }
    }

    const message = error.userMessage || error.message || 'Unknown error'
    const errorCode = error.code || error.type || ''

    // Try to match error message
    for (const [key, config] of Object.entries(errorMessages)) {
      if (message.includes(key) || errorCode.includes(key)) {
        return config
      }
    }

    // Default error format
    return {
      title: 'Connection Failed',
      message: message,
      actions: [
        'Check device configuration',
        'Verify network connectivity',
        'Review logs for details'
      ]
    }
  }

}

export default new DeviceApiService()
