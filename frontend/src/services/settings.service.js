import api from './api'
import { handleApiError } from '@/utils/apiError'

/**
 * Settings Service
 * Handles all API calls related to application settings
 */

const settingsService = {
  // ============================================
  // API Credentials
  // ============================================

  /**
   * Get all API credentials
   * @returns {Promise} API credentials list
   */
  async getApiCredentials() {
    try {
      const response = await api.get('/settings/api-credentials')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching API credentials')
    }
  },

  /**
   * Get a specific API credential by ID
   * @param {string} id - Credential ID
   * @returns {Promise} API credential details
   */
  async getApiCredential(id) {
    try {
      const response = await api.get(`/settings/api-credentials/${id}`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching API credential')
    }
  },

  /**
   * Create a new API credential
   * @param {Object} credentialData - Credential data
   * @param {string} credentialData.name - Credential name
   * @param {string} credentialData.type - Credential type (e.g., 'switch', 'ap', 'gateway')
   * @param {string} credentialData.deviceId - Associated device ID (optional)
   * @param {string} credentialData.username - API username
   * @param {string} credentialData.password - API password
   * @param {string} credentialData.apiKey - API key (optional)
   * @param {string} credentialData.apiSecret - API secret (optional)
   * @param {Object} credentialData.metadata - Additional metadata (optional)
   * @returns {Promise} Created credential
   */
  async createApiCredential(credentialData) {
    try {
      const response = await api.post('/settings/api-credentials', credentialData)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'creating API credential')
    }
  },

  /**
   * Update an existing API credential
   * @param {string} id - Credential ID
   * @param {Object} updates - Updated credential data
   * @returns {Promise} Updated credential
   */
  async updateApiCredential(id, updates) {
    try {
      const response = await api.put(`/settings/api-credentials/${id}`, updates)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'updating API credential')
    }
  },

  /**
   * Delete an API credential
   * @param {string} id - Credential ID
   * @returns {Promise} Deletion result
   */
  async deleteApiCredential(id) {
    try {
      const response = await api.delete(`/settings/api-credentials/${id}`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'deleting API credential')
    }
  },

  /**
   * Test an API credential
   * @param {string} id - Credential ID
   * @returns {Promise} Test result
   */
  async testApiCredential(id) {
    try {
      const response = await api.post(`/settings/api-credentials/${id}/test`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'testing API credential')
    }
  },

  /**
   * Get credentials by device ID
   * @param {string} deviceId - Device ID
   * @returns {Promise} Credentials for the device
   */
  async getCredentialsByDevice(deviceId) {
    try {
      const response = await api.get(`/settings/api-credentials/device/${deviceId}`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching credentials for device')
    }
  },

  // ============================================
  // Aruba Central API Configuration
  // ============================================

  /**
   * Get current Aruba Central API configuration
   * @returns {Promise} Aruba Central configuration
   */
  async getArubaCentralConfig() {
    try {
      const response = await api.get('/settings/aruba-central')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching Aruba Central configuration')
    }
  },

  /**
   * Save Aruba Central API configuration
   * @param {Object} configData - Configuration data
   * @param {string} configData.baseUrl - API base URL
   * @param {string} configData.clientId - Client ID
   * @param {string} configData.clientSecret - Client secret
   * @param {string} configData.customerId - Customer ID
   * @param {string} configData.notes - Optional notes
   * @returns {Promise} Saved configuration
   */
  async saveArubaCentralConfig(configData) {
    try {
      const response = await api.post('/settings/aruba-central', configData)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'saving Aruba Central configuration')
    }
  },

  /**
   * Test Aruba Central API connection
   * @param {string} configId - Optional config ID (uses active config if not provided)
   * @returns {Promise} Test result
   */
  async testArubaCentralConnection(configId = null) {
    try {
      const payload = configId ? { configId } : {}
      const response = await api.post('/settings/aruba-central/test', payload)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'testing Aruba Central connection')
    }
  },

  /**
   * Delete Aruba Central API configuration
   * @param {string} id - Configuration ID
   * @returns {Promise} Deletion result
   */
  async deleteArubaCentralConfig(id) {
    try {
      const response = await api.delete(`/settings/aruba-central/${id}`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'deleting Aruba Central configuration')
    }
  },

  // ============================================
  // General Settings (for future expansion)
  // ============================================

  /**
   * Get all application settings
   * @returns {Promise} Application settings
   */
  async getSettings() {
    try {
      const response = await api.get('/settings')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching settings')
    }
  },

  /**
   * Update application settings
   * @param {Object} settings - Settings to update
   * @returns {Promise} Updated settings
   */
  async updateSettings(settings) {
    try {
      const response = await api.put('/settings', settings)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'updating settings')
    }
  },

  /**
   * Get a specific setting by key
   * @param {string} key - Setting key
   * @returns {Promise} Setting value
   */
  async getSetting(key) {
    try {
      const response = await api.get(`/settings/${key}`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching setting')
    }
  },

  /**
   * Update a specific setting
   * @param {string} key - Setting key
   * @param {*} value - Setting value
   * @returns {Promise} Updated setting
   */
  async updateSetting(key, value) {
    try {
      const response = await api.put(`/settings/${key}`, { value })
      return response.data
    } catch (error) {
      throw handleApiError(error, 'updating setting')
    }
  },
}

export default settingsService
