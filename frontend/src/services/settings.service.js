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
  // Cloud Integrations (Aruba Central, Juniper Mist, Cisco Meraki)
  //
  // Several integrations can be configured at once, including multiple
  // tenants of the same provider. See docs/MULTI_VENDOR_ROADMAP.md.
  // ============================================

  /**
   * List configured cloud integrations plus the catalog of supported providers.
   * @returns {Promise} { integrations: [], providers: [] }
   */
  async getCloudIntegrations() {
    try {
      const response = await api.get('/settings/cloud-integrations')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching cloud integrations')
    }
  },

  /**
   * Create a cloud integration.
   * @param {Object} data - { provider, name, baseUrl, credentials, isActive, notes }
   * @returns {Promise} Created integration (secrets masked)
   */
  async createCloudIntegration(data) {
    try {
      const response = await api.post('/settings/cloud-integrations', data)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'creating cloud integration')
    }
  },

  /**
   * Update a cloud integration. Blank secret fields keep their stored value.
   * @param {string} id - Integration ID
   * @param {Object} data - Fields to update
   * @returns {Promise} Updated integration
   */
  async updateCloudIntegration(id, data) {
    try {
      const response = await api.put(`/settings/cloud-integrations/${id}`, data)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'updating cloud integration')
    }
  },

  /**
   * Test a cloud integration's credentials against its provider.
   * @param {string} id - Integration ID
   * @returns {Promise} Test result
   */
  /**
   * Alert notification channels (admin only). Webhook URLs and header values
   * come back as '***'; sending '***' (or nothing) keeps the stored value.
   * @returns {Promise<{ data: Array, emailConfigured: boolean }>}
   */
  async getNotificationChannels() {
    try {
      const response = await api.get('/settings/notification-channels')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching notification channels')
    }
  },

  async createNotificationChannel(payload) {
    try {
      const response = await api.post('/settings/notification-channels', payload)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'creating the notification channel')
    }
  },

  async updateNotificationChannel(id, payload) {
    try {
      const response = await api.put(`/settings/notification-channels/${id}`, payload)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'updating the notification channel')
    }
  },

  async deleteNotificationChannel(id) {
    try {
      await api.delete(`/settings/notification-channels/${id}`)
    } catch (error) {
      throw handleApiError(error, 'deleting the notification channel')
    }
  },

  /** Cloud alarm names a channel can filter on: [{ provider, name }] (seen here, plus well-known ones). */
  async getCloudAlarmNames() {
    try {
      const response = await api.get('/settings/notification-channels/cloud-alarm-names')
      return response.data.data || []
    } catch (error) {
      throw handleApiError(error, 'loading cloud alarm names')
    }
  },

  /** Send a sample notification now. @returns {Promise<{ success: boolean, error?: string }>} */
  async testNotificationChannel(id) {
    try {
      const response = await api.post(`/settings/notification-channels/${id}/test`)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'testing the notification channel')
    }
  },

  /**
   * Get the Git backup mirror configuration (secrets masked) and its field catalog.
   */
  async getGitBackupConfig() {
    try {
      const response = await api.get('/settings/git-backup')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching Git backup configuration')
    }
  },

  /**
   * Create or update the Git backup mirror configuration.
   * Blank secret fields keep their stored value.
   */
  async saveGitBackupConfig(payload) {
    try {
      const response = await api.put('/settings/git-backup', payload)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'saving Git backup configuration')
    }
  },

  /**
   * Validate the stored Git backup configuration (repo + remote reachability).
   */
  async testGitBackupConfig() {
    try {
      const response = await api.post('/settings/git-backup/test')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'testing Git backup configuration')
    }
  },

  /**
   * Forget the Git backup configuration. The repository is left on disk.
   */
  async deleteGitBackupConfig() {
    try {
      const response = await api.delete('/settings/git-backup')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'deleting Git backup configuration')
    }
  },

  async testCloudIntegration(id) {
    try {
      const response = await api.post(`/settings/cloud-integrations/${id}/test`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'testing cloud integration')
    }
  },

  /**
   * Delete a cloud integration.
   * @param {string} id - Integration ID
   * @returns {Promise} Deletion result
   */
  async deleteCloudIntegration(id) {
    try {
      const response = await api.delete(`/settings/cloud-integrations/${id}`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'deleting cloud integration')
    }
  },

  // ============================================
  // General Settings (for future expansion)
  // ============================================

}

export default settingsService
