import api from './api'

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
      throw this.handleApiError(error, 'testing device connection')
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
      throw this.handleApiError(error, 'testing device connection')
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
      throw this.handleApiError(error, 'retrieving device information')
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
      throw this.handleApiError(error, 'retrieving firmware information')
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
      throw this.handleApiError(error, 'retrieving supported device types')
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
      throw this.handleApiError(error, 'testing credential')
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

  /**
   * Handle API errors with user-friendly messages
   * @param {Error} error - The error object from axios
   * @param {string} action - Description of what was being attempted
   * @returns {Error} Enhanced error with user-friendly message
   */
  handleApiError(error, action = 'completing the request') {
    const enhancedError = new Error()

    // Check if it's a network error (no response from server)
    if (!error.response) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        enhancedError.message = `Request timeout while ${action}. The server took too long to respond.`
        enhancedError.userMessage = 'The request timed out. Please try again.'
        enhancedError.type = 'TIMEOUT'
      } else if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
        enhancedError.message = `Network error while ${action}. Unable to connect to the server.`
        enhancedError.userMessage = 'Unable to connect to the server. Please check your internet connection and ensure the backend server is running.'
        enhancedError.type = 'NETWORK'
      } else {
        enhancedError.message = `Connection failed while ${action}. ${error.message}`
        enhancedError.userMessage = 'Connection failed. Please verify the backend server is running and accessible.'
        enhancedError.type = 'CONNECTION'
      }
      enhancedError.statusCode = 0
      enhancedError.isRecoverable = true
      return enhancedError
    }

    // Handle HTTP error responses
    const status = error.response.status
    const responseData = error.response.data

    enhancedError.statusCode = status
    enhancedError.response = error.response

    switch (status) {
      case 400:
        enhancedError.message = `Bad request while ${action}: ${responseData.error || responseData.message || 'Invalid data provided'}`
        enhancedError.userMessage = responseData.error || 'The request contains invalid data. Please check your input.'
        enhancedError.type = 'BAD_REQUEST'
        enhancedError.isRecoverable = true
        break

      case 401:
        enhancedError.message = `Unauthorized while ${action}. Please log in again.`
        enhancedError.userMessage = 'Your session has expired. Please log in again.'
        enhancedError.type = 'UNAUTHORIZED'
        enhancedError.isRecoverable = false
        break

      case 403:
        enhancedError.message = `Access forbidden while ${action}. Insufficient permissions.`
        enhancedError.userMessage = 'You do not have permission to perform this action.'
        enhancedError.type = 'FORBIDDEN'
        enhancedError.isRecoverable = false
        break

      case 404:
        enhancedError.message = `Resource not found while ${action}.`
        enhancedError.userMessage = responseData.error || 'The requested resource was not found.'
        enhancedError.type = 'NOT_FOUND'
        enhancedError.isRecoverable = true
        break

      case 500:
      case 502:
      case 503:
      case 504:
        enhancedError.message = `Server error while ${action}: ${responseData.error || 'Internal server error'}`
        enhancedError.userMessage = responseData.error || 'A server error occurred. Please try again later or contact support if the issue persists.'
        enhancedError.type = 'SERVER_ERROR'
        enhancedError.isRecoverable = true
        break

      default:
        enhancedError.message = `Error while ${action}: ${responseData.error || responseData.message || 'Unknown error'}`
        enhancedError.userMessage = responseData.error || responseData.message || 'An unexpected error occurred.'
        enhancedError.type = 'UNKNOWN'
        enhancedError.isRecoverable = true
    }

    // Preserve original error details
    enhancedError.originalError = error
    enhancedError.action = action

    return enhancedError
  }
}

export default new DeviceApiService()
