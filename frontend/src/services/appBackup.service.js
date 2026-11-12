import api from './api'
import { handleApiError } from '@/utils/apiError'

/**
 * Application self-backup (Settings -> App Backup, admin only).
 * The backend's app-backup.service.js; restore is a CLI, not an API.
 */
const appBackupService = {
  /** { config, schedule, remote, tools, path, running, archives, runs, keyFingerprint } */
  async overview() {
    try {
      const response = await api.get('/app-backups')
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'loading application backups')
    }
  },

  async saveConfig(payload) {
    try {
      const response = await api.put('/app-backups/config', payload)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'saving application backup settings')
    }
  },

  async runNow() {
    try {
      const response = await api.post('/app-backups/run')
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'starting an application backup')
    }
  },

  /** Connect to the saved SFTP destination: { ok, hostKey, newlyPinned, archives } or { ok: false, error, hostKey, hostKeyMismatch } */
  async testRemote() {
    try {
      const response = await api.post('/app-backups/remote/test')
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'testing the backup destination')
    }
  },

  /** @returns {Promise<{ blob: Blob, filename: string }>} */
  async download(name) {
    try {
      const response = await api.get(`/app-backups/${encodeURIComponent(name)}/download`, { responseType: 'blob' })
      return { blob: response.data, filename: name }
    } catch (error) {
      throw handleApiError(error, 'downloading the backup')
    }
  },

  async remove(name) {
    try {
      await api.delete(`/app-backups/${encodeURIComponent(name)}`)
    } catch (error) {
      throw handleApiError(error, 'deleting the backup')
    }
  }
}

export default appBackupService
