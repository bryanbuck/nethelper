import api from './api'
import { handleApiError } from '@/utils/apiError'

class ActivityService {
  /**
   * One page of the fleet Activity feed, newest first.
   * @param {Object} params - { categories?: string[], deviceId?: string, vendor?: string, before?: string, limit?: number }
   * @returns {Promise<Object>} { success, data, nextBefore, categories }
   */
  async list(params = {}) {
    try {
      const query = { ...params }
      if (Array.isArray(query.categories)) query.categories = query.categories.join(',') || undefined
      Object.keys(query).forEach((k) => (query[k] === null || query[k] === '') && delete query[k])
      const response = await api.get('/activity', { params: query })
      return response.data
    } catch (error) {
      console.error('Error fetching activity:', error)
      throw handleApiError(error, 'loading activity')
    }
  }
}

export default new ActivityService()
