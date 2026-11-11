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

  /**
   * The server's last update check (admins): { enabled, current, latest:
   * { version, url, publishedAt } | null, updateAvailable, checkedAt, error }.
   */
  async getUpdateStatus() {
    try {
      const response = await api.get('/system/update')
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'loading the update status')
    }
  }

  /** Ask the server to check for a newer release now; same shape. */
  async checkForUpdate() {
    try {
      const response = await api.post('/system/update/check')
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'checking for updates')
    }
  }
}

export default new SystemService()
