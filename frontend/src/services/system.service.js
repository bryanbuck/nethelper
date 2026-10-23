import api from './api'
import { handleApiError } from '@/utils/apiError'

class SystemService {
  /**
   * System Status snapshot (admins): identity, the latest fast and slow
   * samples, and the last hour of history.
   */
  async getStatus() {
    try {
      const response = await api.get('/system')
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'loading the system status')
    }
  }
}

export default new SystemService()
