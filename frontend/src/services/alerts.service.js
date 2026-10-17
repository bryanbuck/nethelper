import api from './api'
import { handleApiError } from '@/utils/apiError'

class AlertsService {
  /**
   * Alerts, newest activity first.
   * @param {Object} params - { status?: 'active'|'open'|'acknowledged'|'resolved'|'all',
   *   severity?: string[], rule?: string, deviceId?: string, q?: string, page?: number, limit?: number }
   * @returns {Promise<Object>} { success, data, total, page, limit }
   */
  async list(params = {}) {
    try {
      const query = { ...params }
      if (Array.isArray(query.severity)) query.severity = query.severity.join(',') || undefined
      Object.keys(query).forEach((k) => (query[k] === null || query[k] === '') && delete query[k])
      const response = await api.get('/alerts', { params: query })
      return response.data
    } catch (error) {
      console.error('Error fetching alerts:', error)
      throw handleApiError(error, 'loading alerts')
    }
  }

  /** Unresolved counts: { open, acknowledged, bySeverity, openBySeverity } */
  async summary() {
    try {
      const response = await api.get('/alerts/summary')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'loading the alert summary')
    }
  }

  async acknowledge(ids) {
    try {
      const response = await api.post('/alerts/acknowledge', { ids })
      return response.data
    } catch (error) {
      throw handleApiError(error, 'acknowledging alerts')
    }
  }

  async resolve(ids) {
    try {
      const response = await api.post('/alerts/resolve', { ids })
      return response.data
    } catch (error) {
      throw handleApiError(error, 'resolving alerts')
    }
  }

  async getRules() {
    try {
      const response = await api.get('/alerts/rules')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'loading alert rules')
    }
  }

  /**
   * Admin only.
   * @param {string} key
   * @param {Object} patch - { enabled?, severity?, settleSeconds? }
   */
  async updateRule(key, patch) {
    try {
      const response = await api.patch(`/alerts/rules/${encodeURIComponent(key)}`, patch)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'saving the alert rule')
    }
  }
}

export default new AlertsService()
