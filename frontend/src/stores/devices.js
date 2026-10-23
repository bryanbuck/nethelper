import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import deviceService from '@/services/device.service'

export const useDevicesStore = defineStore('devices', () => {
  const devices = ref([])
  const selectedDevices = ref([])
  const filters = ref({})
  const loading = ref(false)
  const error = ref(null)
  const lastSync = ref(null)
  // Outcome of the last cloud sync job (device:sync:completed), and the
  // likely-duplicate groups to offer for merging.
  const lastSyncResult = ref(null)
  const duplicateGroups = ref([])
  const stats = ref({
    total: 0,
    online: 0,
    offline: 0,
    warning: 0
  })
  
  // Pagination state
  const pagination = ref({
    page: 1,
    itemsPerPage: 10,
    total: 0,
    totalPages: 0
  })
  
  // Table state
  const tableOptions = ref({
    page: 1,
    itemsPerPage: 10,
    sortBy: [],
    search: '',
    filters: {}
  })
  
  const tableLoading = ref(false)

  // True while `devices` holds the whole inventory (fetchDevices), false
  // while it holds one table page (fetchDevicesWithPagination). On a page,
  // `stats` are the server's fleet-wide summary rather than counted here.
  const devicesComplete = ref(false)

  // Firmware polling state
  const firmwareData = ref([])
  const firmwareLoading = ref(false)
  const firmwareError = ref(null)
  const availablePollers = ref([])

  // System polling state
  const systemData = ref(null)
  const systemLoading = ref(false)
  const systemError = ref(null)

  const onlineDevices = computed(() =>
    devices.value.filter(device => device.status === 'online')
  )

  const offlineDevices = computed(() => 
    devices.value.filter(device => device.status === 'offline')
  )

  const warningDevices = computed(() => 
    devices.value.filter(device => device.status === 'warning')
  )

  const devicesByType = computed(() => {
    const types = {}
    devices.value.forEach(device => {
      if (!types[device.type]) {
        types[device.type] = []
      }
      types[device.type].push(device)
    })
    return types
  })

  async function fetchDevices() {
    loading.value = true
    error.value = null
    try {
      const response = await deviceService.getDevices()
      devices.value = response.data
      devicesComplete.value = true
      updateStats()
      lastSync.value = new Date()
    } catch (err) {
      console.error('Failed to fetch devices:', err)
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  /** For views that need every device (pickers, lookups): fetch unless held. */
  async function ensureAllDevices() {
    if (!devicesComplete.value) await fetchDevices()
    return devices.value
  }

  async function fetchDevicesWithPagination(options = {}) {
    tableLoading.value = true
    error.value = null
    try {
      const mergedOptions = {
        ...tableOptions.value,
        ...options
      }

      const response = await deviceService.getDevicesWithPagination(mergedOptions)

      devices.value = response.data
      pagination.value = response.pagination
      // "All" (no limit) returns every matching row, but still possibly filtered
      devicesComplete.value = false

      // Update table options
      tableOptions.value = {
        ...tableOptions.value,
        ...mergedOptions
      }

      if (response.summary) stats.value = { ...response.summary }
      else updateStats(true)
      lastSync.value = new Date()

      return response
    } catch (err) {
      console.error('Failed to fetch devices with pagination:', err)
      error.value = err

      // Ensure devices.value is always an array (initialize if undefined)
      if (!devices.value) {
        devices.value = []
      }

      // Don't throw - let the component handle the error gracefully
      return {
        data: [],
        pagination: {
          page: options.page || 1,
          itemsPerPage: options.itemsPerPage || 10,
          total: 0,
          totalPages: 0
        }
      }
    } finally {
      tableLoading.value = false
    }
  }

  function updateTableOptions(options) {
    tableOptions.value = {
      ...tableOptions.value,
      ...options
    }
  }

  function setSearch(searchTerm) {
    tableOptions.value.search = searchTerm
    tableOptions.value.page = 1 // Reset to first page on search
  }

  function setFilters(newFilters) {
    tableOptions.value.filters = { ...newFilters }
    tableOptions.value.page = 1 // Reset to first page on filter
  }

  function setSorting(sortBy) {
    tableOptions.value.sortBy = sortBy
  }

  function setPage(page) {
    tableOptions.value.page = page
  }

  function setItemsPerPage(itemsPerPage) {
    tableOptions.value.itemsPerPage = itemsPerPage
    tableOptions.value.page = 1 // Reset to first page on page size change
  }

  // Pass an integrationId to sync one cloud integration; omit to sync all
  // active ones.
  async function syncDevices(integrationId = null) {
    loading.value = true
    error.value = null
    try {
      // Only queues the job; the result arrives as device:sync:completed.
      return await deviceService.syncDevices(integrationId)
    } catch (err) {
      console.error('Failed to sync devices:', err)
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * device:sync:completed. Views watch lastSyncResult and reload what they
   * show (the device table pages through `devices`, so a full fetch here
   * would clobber its page).
   */
  async function applySyncResult(result) {
    lastSyncResult.value = { ...result, at: new Date() }
    await fetchDuplicates().catch(() => {})
  }

  async function fetchDuplicates() {
    const response = await deviceService.getDuplicates()
    duplicateGroups.value = response.data || []
    return duplicateGroups.value
  }

  async function mergeDevices(targetId, sourceIds, identityFrom = null) {
    const response = await deviceService.mergeDevices(targetId, sourceIds, identityFrom)
    devices.value = devices.value.filter((d) => !sourceIds.includes(d.id))
    updateDeviceLocally(targetId, response.data)
    await fetchDuplicates().catch(() => {})
    return response.data
  }

  function clearError() {
    error.value = null
  }

  function updateDeviceStatus(deviceId, status) {
    const device = devices.value.find(d => d.id === deviceId)
    if (device) {
      device.status = status
      device.lastSeen = new Date().toISOString()
      updateStats()
    }
  }

  /**
   * Update device locally without making API call
   * Used for WebSocket real-time updates
   * @param {string} deviceId - Device ID
   * @param {Object} updates - Fields to update
   */
  function updateDeviceLocally(deviceId, updates) {
    const device = devices.value.find(d => d.id === deviceId)
    if (device) {
      Object.assign(device, updates)
      updateStats()
    }
  }

  // Counts the held rows; skipped while they are one table page (the stats
  // are then the server's fleet-wide summary), unless forced.
  function updateStats(force = false) {
    if (!devicesComplete.value && !force) return
    stats.value = {
      total: devices.value.length,
      online: onlineDevices.value.length,
      offline: offlineDevices.value.length,
      warning: warningDevices.value.length
    }
  }

  async function createDevice(deviceData) {
    loading.value = true
    error.value = null
    try {
      const response = await deviceService.createDevice(deviceData)
      const newDevice = response.data

      // Ensure devices.value is initialized as an array
      if (!devices.value) {
        devices.value = []
      }

      // Add to local state
      devices.value.push(newDevice)
      updateStats()

      return newDevice
    } catch (err) {
      console.error('Failed to create device:', err)
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  function addDevice(device) {
    // Ensure devices.value is initialized as an array
    if (!devices.value) {
      devices.value = []
    }
    devices.value.push(device)
    updateStats()
  }

  function removeDevice(deviceId) {
    const index = devices.value.findIndex(d => d.id === deviceId)
    if (index > -1) {
      devices.value.splice(index, 1)
      updateStats()
    }
  }

  async function updateDevice(deviceId, updates) {
    loading.value = true
    error.value = null
    try {
      const response = await deviceService.updateDevice(deviceId, updates)
      const updatedDevice = response.data

      // Update local state
      const device = devices.value.find(d => d.id === deviceId)
      if (device) {
        Object.assign(device, updatedDevice)
        updateStats()
      }

      return updatedDevice
    } catch (err) {
      console.error('Failed to update device:', err)
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  async function deleteDevice(deviceId) {
    await deviceService.deleteDevice(deviceId)
    removeDevice(deviceId)
  }

  function clearSelection() {
    selectedDevices.value = []
  }

  function selectDevice(deviceId) {
    if (!selectedDevices.value.includes(deviceId)) {
      selectedDevices.value.push(deviceId)
    }
  }

  function deselectDevice(deviceId) {
    const index = selectedDevices.value.indexOf(deviceId)
    if (index > -1) {
      selectedDevices.value.splice(index, 1)
    }
  }

  async function fetchAvailablePollers() {
    try {
      const response = await deviceService.getAvailablePollers()
      availablePollers.value = response.pollers || []
      return response
    } catch (error) {
      console.error('Failed to fetch available pollers:', error)
      throw error
    }
  }

  async function pollDeviceFirmware(deviceIds) {
    firmwareLoading.value = true
    firmwareError.value = null
    try {
      const response = await deviceService.pollDeviceFirmware(deviceIds)

      // Merge firmware data with device info
      firmwareData.value = response.results.map(result => {
        const device = devices.value.find(d => d.id === result.deviceId)
        return {
          deviceId: result.deviceId,
          deviceName: device?.name || result.deviceId,
          deviceType: device?.type || 'Unknown',
          deviceIp: device?.ipAddress || 'N/A',
          deviceLocation: device?.location || 'N/A',
          success: result.success,
          error: result.error || null,
          timestamp: result.timestamp,
          booted: result.data?.booted_image || null,
          current: result.data?.current_image || null,
          default: result.data?.default_image || null,
          primary: result.data?.primary_version || null,
          secondary: result.data?.secondary_version || null
        }
      })

      return response
    } catch (error) {
      firmwareError.value = error.message || 'Failed to poll device firmware'
      console.error('Failed to poll device firmware:', error)
      throw error
    } finally {
      firmwareLoading.value = false
    }
  }

  async function pollAllSwitchesFirmware() {
    // Get all switch devices (type is the backend DeviceType enum)
    const switches = devices.value.filter(d => d.type === 'switch')

    if (switches.length === 0) {
      firmwareError.value = 'No switches found to poll'
      return
    }

    const switchIds = switches.map(s => s.id)
    return await pollDeviceFirmware(switchIds)
  }

  function clearFirmwareData() {
    firmwareData.value = []
    firmwareError.value = null
  }

  async function pollDeviceSystem(deviceId) {
    systemLoading.value = true
    systemError.value = null
    try {
      const response = await deviceService.pollDeviceSystem([deviceId])

      if (response.results && response.results.length > 0) {
        const result = response.results[0]
        if (result.success) {
          systemData.value = {
            deviceId: result.deviceId,
            timestamp: result.timestamp,
            ...result.data
          }
        } else {
          systemError.value = result.error || 'Failed to poll system information'
        }
      }

      return response
    } catch (error) {
      systemError.value = error.message || 'Failed to poll device system information'
      console.error('Failed to poll device system:', error)
      throw error
    } finally {
      systemLoading.value = false
    }
  }

  function clearSystemData() {
    systemData.value = null
    systemError.value = null
  }

  return {
    devices,
    selectedDevices,
    filters,
    loading,
    error,
    lastSync,
    lastSyncResult,
    duplicateGroups,
    stats,
    pagination,
    tableOptions,
    tableLoading,
    devicesComplete,
    firmwareData,
    firmwareLoading,
    firmwareError,
    availablePollers,
    onlineDevices,
    offlineDevices,
    warningDevices,
    devicesByType,
    fetchDevices,
    fetchDevicesWithPagination,
    ensureAllDevices,
    syncDevices,
    applySyncResult,
    fetchDuplicates,
    mergeDevices,
    clearError,
    createDevice,
    updateDeviceStatus,
    updateDeviceLocally,
    addDevice,
    removeDevice,
    updateDevice,
    deleteDevice,
    clearSelection,
    selectDevice,
    deselectDevice,
    updateTableOptions,
    setSearch,
    setFilters,
    setSorting,
    setPage,
    setItemsPerPage,
    fetchAvailablePollers,
    pollDeviceFirmware,
    pollAllSwitchesFirmware,
    clearFirmwareData,
    systemData,
    systemLoading,
    systemError,
    pollDeviceSystem,
    clearSystemData
  }
})