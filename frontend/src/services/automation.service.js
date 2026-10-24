import api from './api'

/**
 * Automation Service
 * Handles all API calls related to network automations
 */
class AutomationService {
  /**
   * Get all automations
   * @param {Object} params - Query parameters (page, limit, type, status)
   * @returns {Promise} API response with automations list
   */
  async getAutomations(params = {}) {
    const response = await api.get('/automations', { params })
    return response.data
  }

  /**
   * Get a specific automation by ID
   * @param {string} automationId - Automation ID
   * @returns {Promise} API response with automation details
   */
  async getAutomationById(automationId) {
    const response = await api.get(`/automations/${automationId}`)
    return response.data
  }

  /**
   * Create a new automation
   * @param {Object} automationData - Automation configuration
   * @returns {Promise} API response with created automation
   */
  async createAutomation(automationData) {
    const response = await api.post('/automations', automationData)
    return response.data
  }

  /**
   * Update an existing automation
   * @param {string} automationId - Automation ID
   * @param {Object} updates - Updated automation data
   * @returns {Promise} API response with updated automation
   */
  async updateAutomation(automationId, updates) {
    const response = await api.put(`/automations/${automationId}`, updates)
    return response.data
  }

  /**
   * Delete an automation
   * @param {string} automationId - Automation ID
   * @returns {Promise} API response
   */
  async deleteAutomation(automationId) {
    const response = await api.delete(`/automations/${automationId}`)
    return response.data
  }

  /**
   * Execute an automation manually
   * @param {string} automationId - Automation ID
   * @param {Object} options - Execution options (deviceId, parameters, etc.)
   * @returns {Promise} API response with execution details
   */
  async executeAutomation(automationId, options = {}) {
    const response = await api.post(`/automations/${automationId}/execute`, options)
    return response.data
  }

  /**
   * Toggle automation active status
   * @param {string} automationId - Automation ID
   * @returns {Promise} API response with updated automation
   */
  async toggleAutomationStatus(automationId) {
    const response = await api.patch(`/automations/${automationId}/toggle`)
    return response.data
  }

}

// Create and export a singleton instance
const automationService = new AutomationService()
export default automationService