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
   * Test an automation without executing it
   * @param {string} automationId - Automation ID
   * @param {Object} testData - Test parameters
   * @returns {Promise} API response with test results
   */
  async testAutomation(automationId, testData = {}) {
    const response = await api.post(`/automations/${automationId}/test`, testData)
    return response.data
  }

  /**
   * Get automation execution history
   * @param {string} automationId - Automation ID
   * @param {Object} params - Query parameters (page, limit, status, dateRange)
   * @returns {Promise} API response with execution history
   */
  async getAutomationHistory(automationId, params = {}) {
    const response = await api.get(`/automations/${automationId}/history`, { params })
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

  /**
   * Clone an existing automation
   * @param {string} automationId - Automation ID to clone
   * @param {Object} overrides - Properties to override in the cloned automation
   * @returns {Promise} API response with cloned automation
   */
  async cloneAutomation(automationId, overrides = {}) {
    const response = await api.post(`/automations/${automationId}/clone`, overrides)
    return response.data
  }

  /**
   * Get automation templates
   * @param {Object} params - Query parameters (category, type)
   * @returns {Promise} API response with automation templates
   */
  async getAutomationTemplates(params = {}) {
    const response = await api.get('/automations/templates', { params })
    return response.data
  }

  /**
   * Create automation from template
   * @param {string} templateId - Template ID
   * @param {Object} customizations - Template customizations
   * @returns {Promise} API response with created automation
   */
  async createFromTemplate(templateId, customizations = {}) {
    const response = await api.post('/automations/from-template', {
      templateId,
      ...customizations
    })
    return response.data
  }

  /**
   * Validate automation configuration
   * @param {Object} automationData - Automation configuration to validate
   * @returns {Promise} API response with validation results
   */
  async validateAutomation(automationData) {
    const response = await api.post('/automations/validate', automationData)
    return response.data
  }

  /**
   * Get automation statistics
   * @param {Object} params - Query parameters (dateRange, groupBy)
   * @returns {Promise} API response with automation statistics
   */
  async getAutomationStats(params = {}) {
    const response = await api.get('/automations/stats', { params })
    return response.data
  }

  /**
   * Export automations
   * @param {Object} params - Export parameters (format, automationIds, includeHistory)
   * @returns {Promise} API response with export data
   */
  async exportAutomations(params = {}) {
    const response = await api.get('/automations/export', { 
      params,
      responseType: 'blob' // For file downloads
    })
    return response.data
  }

  /**
   * Import automations
   * @param {FormData} formData - Form data containing automation import file
   * @returns {Promise} API response with import results
   */
  async importAutomations(formData) {
    const response = await api.post('/automations/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
    return response.data
  }
}

// Create and export a singleton instance
const automationService = new AutomationService()
export default automationService