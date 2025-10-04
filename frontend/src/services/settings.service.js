import api from './api'

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
    const response = await api.get('/settings/api-credentials')
    return response.data
  },

  /**
   * Get a specific API credential by ID
   * @param {string} id - Credential ID
   * @returns {Promise} API credential details
   */
  async getApiCredential(id) {
    const response = await api.get(`/settings/api-credentials/${id}`)
    return response.data
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
    const response = await api.post('/settings/api-credentials', credentialData)
    return response.data
  },

  /**
   * Update an existing API credential
   * @param {string} id - Credential ID
   * @param {Object} updates - Updated credential data
   * @returns {Promise} Updated credential
   */
  async updateApiCredential(id, updates) {
    const response = await api.put(`/settings/api-credentials/${id}`, updates)
    return response.data
  },

  /**
   * Delete an API credential
   * @param {string} id - Credential ID
   * @returns {Promise} Deletion result
   */
  async deleteApiCredential(id) {
    const response = await api.delete(`/settings/api-credentials/${id}`)
    return response.data
  },

  /**
   * Test an API credential
   * @param {string} id - Credential ID
   * @returns {Promise} Test result
   */
  async testApiCredential(id) {
    const response = await api.post(`/settings/api-credentials/${id}/test`)
    return response.data
  },

  /**
   * Get credentials by device ID
   * @param {string} deviceId - Device ID
   * @returns {Promise} Credentials for the device
   */
  async getCredentialsByDevice(deviceId) {
    const response = await api.get(`/settings/api-credentials/device/${deviceId}`)
    return response.data
  },

  // ============================================
  // General Settings (for future expansion)
  // ============================================

  /**
   * Get all application settings
   * @returns {Promise} Application settings
   */
  async getSettings() {
    const response = await api.get('/settings')
    return response.data
  },

  /**
   * Update application settings
   * @param {Object} settings - Settings to update
   * @returns {Promise} Updated settings
   */
  async updateSettings(settings) {
    const response = await api.put('/settings', settings)
    return response.data
  },

  /**
   * Get a specific setting by key
   * @param {string} key - Setting key
   * @returns {Promise} Setting value
   */
  async getSetting(key) {
    const response = await api.get(`/settings/${key}`)
    return response.data
  },

  /**
   * Update a specific setting
   * @param {string} key - Setting key
   * @param {*} value - Setting value
   * @returns {Promise} Updated setting
   */
  async updateSetting(key, value) {
    const response = await api.put(`/settings/${key}`, { value })
    return response.data
  },
}

export default settingsService
