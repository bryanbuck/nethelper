import api from './api'
import { handleApiError } from '@/utils/apiError'

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
   * Get a backup record with its stored configuration content
   * @param {string} backupId - Backup ID
   * @returns {Promise<Object>} { success, data: { ...backup, content } }
   */
  async getBackupContent(backupId) {
    try {
      const response = await api.get(`/backups/${backupId}/content`)
      return response.data
    } catch (error) {
      console.error('Error fetching backup content:', error)
      throw handleApiError(error, 'fetching backup content')
    }
  }

  /**
   * Download a backup's configuration as a file blob
   * @param {string} backupId - Backup ID
   * @returns {Promise<Object>} { blob, filename }
   */
  async downloadBackup(backupId) {
    try {
      const response = await api.get(`/backups/${backupId}/download`, {
        responseType: 'blob'
      })

      // Extract filename from Content-Disposition header
      let filename = `backup-${backupId}.cfg`
      const disposition = response.headers['content-disposition']
      if (disposition) {
        const match = /filename="?([^";]+)"?/.exec(disposition)
        if (match) filename = match[1]
      }

      return { blob: response.data, filename }
    } catch (error) {
      console.error('Error downloading backup:', error)
      throw handleApiError(error, 'downloading backup')
    }
  }

  /**
   * Get a unified diff between two backups
   * @param {string} backupId - "From" backup ID
   * @param {string} otherId - "To" backup ID
   * @returns {Promise<Object>} { success, data: { from, to, identical, additions, deletions, patch } }
   */
  async diffBackups(backupId, otherId) {
    try {
      const response = await api.get(`/backups/${backupId}/diff/${otherId}`)
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
