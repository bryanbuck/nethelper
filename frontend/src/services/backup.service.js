import api from './api'
import { handleApiError } from '@/utils/apiError'

/** Filename from a Content-Disposition header, or the fallback. */
function filenameFrom(response, fallback) {
  const disposition = response.headers['content-disposition']
  const match = disposition && /filename="?([^";]+)"?/.exec(disposition)
  return match ? match[1] : fallback
}

class BackupService {
  /**
   * List configuration backups
   * @param {Object} params - { deviceId?, scheduleId?, status?, limit?, offset? }
   * @returns {Promise<Object>} { success, data: backups, total }
   */
  async getBackups(params = {}) {
    try {
      const response = await api.get('/backups', { params })
      return response.data
    } catch (error) {
      console.error('Error fetching backups:', error)
      throw handleApiError(error, 'fetching backups')
    }
  }

  /**
   * Queue a manual backup run for specific devices
   * @param {string[]} deviceIds - Device IDs to back up
   * @returns {Promise<Object>} { success, message, jobId }
   */
  async runBackup(deviceIds) {
    try {
      const response = await api.post('/backups/run', { deviceIds })
      return response.data
    } catch (error) {
      console.error('Error queuing backup run:', error)
      throw handleApiError(error, 'queuing backup run')
    }
  }

  /**
   * Get a single backup record
   * @param {string} backupId - Backup ID
   */
  async getBackup(backupId) {
    try {
      const response = await api.get(`/backups/${backupId}`)
      return response.data
    } catch (error) {
      console.error('Error fetching backup:', error)
      throw handleApiError(error, 'fetching backup')
    }
  }

  /**
   * Get a backup record with one artifact's configuration content
   * @param {string} backupId - Backup ID
   * @param {string} [kind] - 'cli' | 'structured'; omitted, the primary (CLI when present)
   * @returns {Promise<Object>} { success, data: { ...backup, content, artifact: { kind, format } } }
   */
  async getBackupContent(backupId, kind) {
    try {
      const response = await api.get(`/backups/${backupId}/content`, { params: kind ? { kind } : {} })
      return response.data
    } catch (error) {
      console.error('Error fetching backup content:', error)
      throw handleApiError(error, 'fetching backup content')
    }
  }

  /**
   * Download one artifact of a backup as a file blob
   * @param {string} backupId - Backup ID
   * @param {string} [kind] - 'cli' | 'structured'; omitted, the primary
   * @returns {Promise<Object>} { blob, filename }
   */
  async downloadBackup(backupId, kind) {
    try {
      const response = await api.get(`/backups/${backupId}/download`, {
        params: kind ? { kind } : {},
        responseType: 'blob'
      })
      return { blob: response.data, filename: filenameFrom(response, `backup-${backupId}.cfg`) }
    } catch (error) {
      console.error('Error downloading backup:', error)
      throw handleApiError(error, 'downloading backup')
    }
  }

  /**
   * Get a unified diff between two backups
   * @param {string} backupId - "From" backup ID
   * @param {string} otherId - "To" backup ID
   * @param {string} [kind] - 'cli' | 'structured'; omitted, CLI when both have it
   * @returns {Promise<Object>} { success, data: { from, to, kind, kinds, identical, additions, deletions, patch } }
   */
  async diffBackups(backupId, otherId, kind) {
    try {
      const response = await api.get(`/backups/${backupId}/diff/${otherId}`, { params: kind ? { kind } : {} })
      return response.data
    } catch (error) {
      console.error('Error diffing backups:', error)
      throw handleApiError(error, 'comparing backups')
    }
  }

  /**
   * Delete a backup (admin only)
   * @param {string} backupId - Backup ID
   */
  async deleteBackup(backupId) {
    try {
      const response = await api.delete(`/backups/${backupId}`)
      return response.data
    } catch (error) {
      console.error('Error deleting backup:', error)
      throw handleApiError(error, 'deleting backup')
    }
  }

  // Cloud-scope backups (Mist org/site config, where AP config lives)

  /**
   * List cloud-scope backups
   * @param {Object} params - { integrationId?, scopeType?, scopeId?, status?, limit?, offset? }
   * @returns {Promise<Object>} { success, data: scopeBackups, total }
   */
  async getScopeBackups(params = {}) {
    try {
      const response = await api.get('/backups/scopes', { params })
      return response.data
    } catch (error) {
      console.error('Error fetching cloud scope backups:', error)
      throw handleApiError(error, 'fetching cloud scope backups')
    }
  }

  /**
   * Queue a backup of every cloud scope (or one integration's)
   * @param {string} [integrationId]
   */
  async runScopeBackup(integrationId = null) {
    try {
      const response = await api.post('/backups/scopes/run', integrationId ? { integrationId } : {})
      return response.data
    } catch (error) {
      console.error('Error queuing cloud scope backup:', error)
      throw handleApiError(error, 'queuing cloud scope backup')
    }
  }

  async getScopeBackupContent(scopeBackupId) {
    try {
      const response = await api.get(`/backups/scopes/${scopeBackupId}/content`)
      return response.data
    } catch (error) {
      console.error('Error fetching cloud scope backup content:', error)
      throw handleApiError(error, 'fetching cloud scope backup content')
    }
  }

  async downloadScopeBackup(scopeBackupId) {
    try {
      const response = await api.get(`/backups/scopes/${scopeBackupId}/download`, { responseType: 'blob' })
      return { blob: response.data, filename: filenameFrom(response, `scope-${scopeBackupId}.json`) }
    } catch (error) {
      console.error('Error downloading cloud scope backup:', error)
      throw handleApiError(error, 'downloading cloud scope backup')
    }
  }

  async diffScopeBackups(scopeBackupId, otherId) {
    try {
      const response = await api.get(`/backups/scopes/${scopeBackupId}/diff/${otherId}`)
      return response.data
    } catch (error) {
      console.error('Error diffing cloud scope backups:', error)
      throw handleApiError(error, 'comparing cloud scope backups')
    }
  }

  async deleteScopeBackup(scopeBackupId) {
    try {
      const response = await api.delete(`/backups/scopes/${scopeBackupId}`)
      return response.data
    } catch (error) {
      console.error('Error deleting cloud scope backup:', error)
      throw handleApiError(error, 'deleting cloud scope backup')
    }
  }

  // Backup schedule management

  /**
   * List backup schedules
   * @returns {Promise<Object>} { success, data: schedules, count }
   */
  async getSchedules() {
    try {
      const response = await api.get('/backups/schedules')
      return response.data
    } catch (error) {
      console.error('Error fetching backup schedules:', error)
      throw handleApiError(error, 'fetching backup schedules')
    }
  }

  /**
   * Create a backup schedule
   * @param {Object} data - { name, cronExpression, timezone?, active?, deviceSelection?, retentionDays?, retentionMaxCount? }
   */
  async createSchedule(data) {
    try {
      const response = await api.post('/backups/schedules', data)
      return response.data
    } catch (error) {
      console.error('Error creating backup schedule:', error)
      throw handleApiError(error, 'creating backup schedule')
    }
  }

  /**
   * Update a backup schedule
   * @param {string} scheduleId - Schedule ID
   * @param {Object} data - Fields to update
   */
  async updateSchedule(scheduleId, data) {
    try {
      const response = await api.put(`/backups/schedules/${scheduleId}`, data)
      return response.data
    } catch (error) {
      console.error('Error updating backup schedule:', error)
      throw handleApiError(error, 'updating backup schedule')
    }
  }

  /**
   * Delete a backup schedule (admin only)
   * @param {string} scheduleId - Schedule ID
   */
  async deleteSchedule(scheduleId) {
    try {
      const response = await api.delete(`/backups/schedules/${scheduleId}`)
      return response.data
    } catch (error) {
      console.error('Error deleting backup schedule:', error)
      throw handleApiError(error, 'deleting backup schedule')
    }
  }

  /**
   * Queue an immediate run of a schedule
   * @param {string} scheduleId - Schedule ID
   */
  async runScheduleNow(scheduleId) {
    try {
      const response = await api.post(`/backups/schedules/${scheduleId}/run`)
      return response.data
    } catch (error) {
      console.error('Error running backup schedule:', error)
      throw handleApiError(error, 'running backup schedule')
    }
  }
}

export default new BackupService()
