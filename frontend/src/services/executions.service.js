import api from './api'
import { handleApiError } from '@/utils/apiError'

/**
 * Automation run history (/api/v1/executions). Runs are written by the
 * backend engine (Run Now, schedules, alert triggers).
 */
class ExecutionsService {
  async list(params = {}) {
    try {
      const response = await api.get('/executions', { params })
      return response.data.data // { executions, pagination }
    } catch (error) {
      throw handleApiError(error, 'loading run history')
    }
  }

  async get(id) {
    try {
      const response = await api.get(`/executions/${id}`)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'loading the run')
    }
  }

  async cancel(id) {
    try {
      const response = await api.patch(`/executions/${id}/cancel`)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'cancelling the run')
    }
  }
}

export default new ExecutionsService()
