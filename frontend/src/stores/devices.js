import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import deviceService from '@/services/device.service'

export const useDevicesStore = defineStore('devices', () => {
  const devices = ref([])
  const selectedDevices = ref([])
  const filters = ref({})
  const loading = ref(false)
  const lastSync = ref(null)
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

  // Firmware polling state
  const firmwareData = ref([])
  const firmwareLoading = ref(false)
  const firmwareError = ref(null)
  const availablePollers = ref([])

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

  const recentDevices = computed(() => 
    devices.value
      .filter(device => device.lastSeen)
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
      .slice(0, 10)
  )

  async function fetchDevices() {
    loading.value = true
    try {
      const response = await deviceService.getDevices()
      devices.value = response.data
      updateStats()
      lastSync.value = new Date()
    } catch (error) {
      console.error('Failed to fetch devices:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function fetchDevicesWithPagination(options = {}) {
    tableLoading.value = true
    try {
      const mergedOptions = {
        ...tableOptions.value,
        ...options
      }
      
      const response = await deviceService.getDevicesWithPagination(mergedOptions)
      
      devices.value = response.data
      pagination.value = response.pagination
      
      // Update table options
      tableOptions.value = {
        ...tableOptions.value,
        ...mergedOptions
      }
      
      updateStats()
      lastSync.value = new Date()
      
      return response
    } catch (error) {
      console.error('Failed to fetch devices with pagination:', error)
      throw error
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

  async function syncDevices() {
    loading.value = true
    try {
      const response = await deviceService.syncDevices()
      devices.value = response.data
      updateStats()
      lastSync.value = new Date()
    } catch (error) {
      console.error('Failed to sync devices:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  function updateDeviceStatus(deviceId, status) {
    const device = devices.value.find(d => d.id === deviceId)
    if (device) {
      device.status = status
      device.lastSeen = new Date().toISOString()
      updateStats()
    }
  }

  function updateStats() {
    stats.value = {
      total: devices.value.length,
      online: onlineDevices.value.length,
      offline: offlineDevices.value.length,
      warning: warningDevices.value.length
    }
  }

  function addDevice(device) {
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

  function updateDevice(deviceId, updates) {
    const device = devices.value.find(d => d.id === deviceId)
    if (device) {
      Object.assign(device, updates)
      updateStats()
    }
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
    // Get all switch devices
    const switches = devices.value.filter(d =>
      d.type && (d.type.toLowerCase().includes('switch') || d.type.toLowerCase() === 'cx')
    )

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

  return {
    devices,
    selectedDevices,
    filters,
    loading,
    lastSync,
    stats,
    pagination,
    tableOptions,
    tableLoading,
    firmwareData,
    firmwareLoading,
    firmwareError,
    availablePollers,
    onlineDevices,
    offlineDevices,
    warningDevices,
    devicesByType,
    recentDevices,
    fetchDevices,
    fetchDevicesWithPagination,
    syncDevices,
    updateDeviceStatus,
    addDevice,
    removeDevice,
    updateDevice,
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
    clearFirmwareData
  }
})