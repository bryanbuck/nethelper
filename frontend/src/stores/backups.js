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

  async function fetchBackupContent(backupId) {
    error.value = null
    try {
      const response = await backupService.getBackupContent(backupId)
      return response.data
    } catch (err) {
      console.error('Failed to fetch backup content:', err)
      error.value = err
      throw err
    }
  }

  async function downloadBackup(backupId) {
    error.value = null
    try {
      const { blob, filename } = await backupService.downloadBackup(backupId)

      // Trigger a browser download
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      return filename
    } catch (err) {
      console.error('Failed to download backup:', err)
      error.value = err
      throw err
    }
  }

  async function diffBackups(fromId, toId) {
    error.value = null
    try {
      const response = await backupService.diffBackups(fromId, toId)
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
   * @param {Object} data - { backupId, deviceId, deviceName, hasChanges?, error? }
   */
  function applyBackupEvent(data) {
    const backup = backups.value.find(b => b.id === data.backupId)
    if (backup) {
      backup.status = data.error ? 'failed' : 'success'
      if (data.hasChanges !== undefined) backup.hasChanges = data.hasChanges
      if (data.error) backup.error = data.error
    }
  }

  /**
   * Refresh state after a full backup run finishes (from 'backup:run:completed')
   */
  async function handleRunCompleted() {
    try {
      await Promise.all([fetchBackups(), fetchSchedules()])
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
