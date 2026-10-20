import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import backupService from '@/services/backup.service'

export const useBackupsStore = defineStore('backups', () => {
  // Backup history
  const backups = ref([])
  const total = ref(0)
  const backupsLoading = ref(false)

  // List filters and pagination
  const filters = ref({
    deviceId: null,
    scheduleId: null,
    status: null
  })
  const pagination = ref({
    page: 1,
    itemsPerPage: 25
  })

  // Cloud-scope backups (Mist org/sites, Central scopes)
  const scopeBackups = ref([])
  const scopeTotal = ref(0)
  const scopeLoading = ref(false)

  // Schedules
  const schedules = ref([])
  const schedulesLoading = ref(false)

  const running = ref(false)
  const error = ref(null)

  const activeSchedules = computed(() =>
    schedules.value.filter(schedule => schedule.active)
  )

  const failedBackups = computed(() =>
    backups.value.filter(backup => backup.status === 'failed')
  )

  async function fetchBackups(options = {}) {
    backupsLoading.value = true
    error.value = null
    try {
      if (options.filters) {
        filters.value = { ...filters.value, ...options.filters }
      }
      if (options.page) pagination.value.page = options.page
      if (options.itemsPerPage) pagination.value.itemsPerPage = options.itemsPerPage

      const params = {
        limit: pagination.value.itemsPerPage,
        offset: (pagination.value.page - 1) * pagination.value.itemsPerPage
      }
      if (filters.value.deviceId) params.deviceId = filters.value.deviceId
      if (filters.value.scheduleId) params.scheduleId = filters.value.scheduleId
      if (filters.value.status) params.status = filters.value.status

      const response = await backupService.getBackups(params)
      backups.value = response.data || []
      total.value = response.total || 0

      return response
    } catch (err) {
      console.error('Failed to fetch backups:', err)
      error.value = err
      throw err
    } finally {
      backupsLoading.value = false
    }
  }

  async function runBackup(deviceIds) {
    running.value = true
    error.value = null
    try {
      const response = await backupService.runBackup(deviceIds)
      return response
    } catch (err) {
      console.error('Failed to queue backup run:', err)
      error.value = err
      throw err
    } finally {
      running.value = false
    }
  }

  async function fetchBackupContent(backupId, kind) {
    error.value = null
    try {
      const response = await backupService.getBackupContent(backupId, kind)
      return response.data
    } catch (err) {
      console.error('Failed to fetch backup content:', err)
      error.value = err
      throw err
    }
  }

  // Trigger a browser download of a blob
  function saveBlob({ blob, filename }) {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    return filename
  }

  async function downloadBackup(backupId, kind) {
    error.value = null
    try {
      return saveBlob(await backupService.downloadBackup(backupId, kind))
    } catch (err) {
      console.error('Failed to download backup:', err)
      error.value = err
      throw err
    }
  }

  async function diffBackups(fromId, toId, kind) {
    error.value = null
    try {
      const response = await backupService.diffBackups(fromId, toId, kind)
      return response.data
    } catch (err) {
      console.error('Failed to diff backups:', err)
      error.value = err
      throw err
    }
  }

  async function deleteBackup(backupId) {
    error.value = null
    try {
      await backupService.deleteBackup(backupId)
      const index = backups.value.findIndex(backup => backup.id === backupId)
      if (index > -1) {
        backups.value.splice(index, 1)
        total.value = Math.max(0, total.value - 1)
      }
    } catch (err) {
      console.error('Failed to delete backup:', err)
      error.value = err
      throw err
    }
  }

  // Cloud-scope actions

  async function fetchScopeBackups(params = {}) {
    scopeLoading.value = true
    error.value = null
    try {
      const response = await backupService.getScopeBackups(params)
      scopeBackups.value = response.data || []
      scopeTotal.value = response.total || 0
      return response
    } catch (err) {
      console.error('Failed to fetch cloud scope backups:', err)
      error.value = err
      throw err
    } finally {
      scopeLoading.value = false
    }
  }

  async function runScopeBackup(integrationId = null) {
    running.value = true
    error.value = null
    try {
      return await backupService.runScopeBackup(integrationId)
    } catch (err) {
      console.error('Failed to queue cloud scope backup:', err)
      error.value = err
      throw err
    } finally {
      running.value = false
    }
  }

  async function fetchScopeBackupContent(scopeBackupId) {
    error.value = null
    try {
      const response = await backupService.getScopeBackupContent(scopeBackupId)
      return response.data
    } catch (err) {
      console.error('Failed to fetch cloud scope backup content:', err)
      error.value = err
      throw err
    }
  }

  async function downloadScopeBackup(scopeBackupId) {
    error.value = null
    try {
      return saveBlob(await backupService.downloadScopeBackup(scopeBackupId))
    } catch (err) {
      console.error('Failed to download cloud scope backup:', err)
      error.value = err
      throw err
    }
  }

  async function diffScopeBackups(fromId, toId) {
    error.value = null
    try {
      const response = await backupService.diffScopeBackups(fromId, toId)
      return response.data
    } catch (err) {
      console.error('Failed to diff cloud scope backups:', err)
      error.value = err
      throw err
    }
  }

  async function deleteScopeBackup(scopeBackupId) {
    error.value = null
    try {
      await backupService.deleteScopeBackup(scopeBackupId)
      const index = scopeBackups.value.findIndex(backup => backup.id === scopeBackupId)
      if (index > -1) {
        scopeBackups.value.splice(index, 1)
        scopeTotal.value = Math.max(0, scopeTotal.value - 1)
      }
    } catch (err) {
      console.error('Failed to delete cloud scope backup:', err)
      error.value = err
      throw err
    }
  }

  // Schedule actions

  async function fetchSchedules() {
    schedulesLoading.value = true
    error.value = null
    try {
      const response = await backupService.getSchedules()
      schedules.value = response.data || []
      return schedules.value
    } catch (err) {
      console.error('Failed to fetch backup schedules:', err)
      error.value = err
      throw err
    } finally {
      schedulesLoading.value = false
    }
  }

  async function createSchedule(data) {
    error.value = null
    try {
      const response = await backupService.createSchedule(data)
      schedules.value.unshift({ ...response.data, _count: { backups: 0 } })
      return response.data
    } catch (err) {
      console.error('Failed to create backup schedule:', err)
      error.value = err
      throw err
    }
  }

  async function updateSchedule(scheduleId, data) {
    error.value = null
    try {
      const response = await backupService.updateSchedule(scheduleId, data)
      const index = schedules.value.findIndex(schedule => schedule.id === scheduleId)
      if (index > -1) {
        schedules.value[index] = { ...schedules.value[index], ...response.data }
      }
      return response.data
    } catch (err) {
      console.error('Failed to update backup schedule:', err)
      error.value = err
      throw err
    }
  }

  async function deleteSchedule(scheduleId) {
    error.value = null
    try {
      await backupService.deleteSchedule(scheduleId)
      const index = schedules.value.findIndex(schedule => schedule.id === scheduleId)
      if (index > -1) {
        schedules.value.splice(index, 1)
      }
    } catch (err) {
      console.error('Failed to delete backup schedule:', err)
      error.value = err
      throw err
    }
  }

  async function runScheduleNow(scheduleId) {
    error.value = null
    try {
      const response = await backupService.runScheduleNow(scheduleId)
      return response
    } catch (err) {
      console.error('Failed to run backup schedule:', err)
      error.value = err
      throw err
    }
  }

  function clearError() {
    error.value = null
  }

  // WebSocket event handlers

  /**
   * Update a loaded backup record in place (from 'backup:completed' / 'backup:failed')
   * @param {Object} data - { backupId, deviceId, deviceName, hasChanges?, error? },
   *   or for a cloud scope { scope: true, scopeBackupId, scopeName, hasChanges?, error? }
   */
  function applyBackupEvent(data) {
    const backup = data.scope
      ? scopeBackups.value.find(b => b.id === data.scopeBackupId)
      : backups.value.find(b => b.id === data.backupId)
    if (backup) {
      backup.status = data.error ? 'failed' : 'success'
      if (data.hasChanges !== undefined) backup.hasChanges = data.hasChanges
      if (data.error) backup.error = data.error
    }
  }

  /**
   * Refresh state after a full backup run finishes (from 'backup:run:completed')
   */
  async function handleRunCompleted(data = {}) {
    try {
      const refreshScopes = data.scope || data.scopes || scopeBackups.value.length > 0
      await Promise.all([
        fetchBackups(),
        fetchSchedules(),
        ...(refreshScopes ? [fetchScopeBackups()] : [])
      ])
    } catch (err) {
      console.error('Failed to refresh backups after run completed:', err)
    }
  }

  return {
    backups,
    total,
    backupsLoading,
    filters,
    pagination,
    schedules,
    schedulesLoading,
    running,
    error,
    activeSchedules,
    failedBackups,
    scopeBackups,
    scopeTotal,
    scopeLoading,
    fetchScopeBackups,
    runScopeBackup,
    fetchScopeBackupContent,
    downloadScopeBackup,
    diffScopeBackups,
    deleteScopeBackup,
    fetchBackups,
    runBackup,
    fetchBackupContent,
    downloadBackup,
    diffBackups,
    deleteBackup,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    runScheduleNow,
    clearError,
    applyBackupEvent,
    handleRunCompleted
  }
})
