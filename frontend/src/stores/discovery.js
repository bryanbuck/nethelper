import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import discoveryService from '@/services/discovery.service'

export const useDiscoveryStore = defineStore('discovery', () => {
  // Suggested subnets
  const subnets = ref([])
  const subnetsLoading = ref(false)

  // Scan history
  const scans = ref([])
  const scansLoading = ref(false)

  // Currently viewed scan (includes discoveredDevices when loaded)
  const activeScan = ref(null)
  const activeScanLoading = ref(false)

  // Live progress of the running scan (updated via WebSocket)
  const scanProgress = ref(null) // { scanId, progress, phase, message }

  const starting = ref(false)
  const error = ref(null)

  const runningScan = computed(() =>
    scans.value.find(scan => scan.status === 'pending' || scan.status === 'running') || null
  )

  const isScanning = computed(() => !!runningScan.value)

  const discoveredDevices = computed(() => activeScan.value?.discoveredDevices || [])

  const newDevices = computed(() =>
    discoveredDevices.value.filter(device => device.status === 'new')
  )

  const knownVendorDevices = computed(() =>
    discoveredDevices.value.filter(device => device.matchedVendor)
  )

  async function fetchSubnets() {
    subnetsLoading.value = true
    error.value = null
    try {
      const response = await discoveryService.getSubnets()
      subnets.value = response.data || []
      return subnets.value
    } catch (err) {
      console.error('Failed to fetch suggested subnets:', err)
      error.value = err
      throw err
    } finally {
      subnetsLoading.value = false
    }
  }

  async function fetchScans(limit = 20) {
    scansLoading.value = true
    error.value = null
    try {
      const response = await discoveryService.getScans(limit)
      scans.value = response.data || []
      return scans.value
    } catch (err) {
      console.error('Failed to fetch discovery scans:', err)
      error.value = err
      throw err
    } finally {
      scansLoading.value = false
    }
  }

  async function fetchScan(scanId) {
    activeScanLoading.value = true
    error.value = null
    try {
      const response = await discoveryService.getScan(scanId)
      activeScan.value = response.data

      // Keep the scan list entry in sync
      const index = scans.value.findIndex(scan => scan.id === scanId)
      if (index > -1) {
        scans.value[index] = {
          ...scans.value[index],
          ...response.data,
          _count: { discoveredDevices: response.data.discoveredDevices?.length || 0 }
        }
      }

      return activeScan.value
    } catch (err) {
      console.error('Failed to fetch discovery scan:', err)
      error.value = err
      throw err
    } finally {
      activeScanLoading.value = false
    }
  }

  async function startScan(subnetList = null) {
    starting.value = true
    error.value = null
    try {
      const response = await discoveryService.startScan(subnetList)
      const scan = response.data

      // Show the new scan at the top of the history and make it active
      scans.value.unshift({ ...scan, _count: { discoveredDevices: 0 } })
      activeScan.value = { ...scan, discoveredDevices: [] }
      scanProgress.value = { scanId: scan.id, progress: 0, phase: 'pending', message: 'Scan queued' }

      return scan
    } catch (err) {
      console.error('Failed to start discovery scan:', err)
      error.value = err
      throw err
    } finally {
      starting.value = false
    }
  }

  async function deleteScan(scanId) {
    error.value = null
    try {
      await discoveryService.deleteScan(scanId)
      const index = scans.value.findIndex(scan => scan.id === scanId)
      if (index > -1) {
        scans.value.splice(index, 1)
      }
      if (activeScan.value?.id === scanId) {
        activeScan.value = null
      }
    } catch (err) {
      console.error('Failed to delete discovery scan:', err)
      error.value = err
      throw err
    }
  }

  async function importDevice(discoveredId, payload = {}) {
    error.value = null
    try {
      const response = await discoveryService.importDevice(discoveredId, payload)
      markDeviceStatus(discoveredId, 'imported')
      return response
    } catch (err) {
      console.error('Failed to import discovered device:', err)
      error.value = err
      throw err
    }
  }

  async function ignoreDevice(discoveredId) {
    error.value = null
    try {
      const response = await discoveryService.ignoreDevice(discoveredId)
      markDeviceStatus(discoveredId, 'ignored')
      return response
    } catch (err) {
      console.error('Failed to ignore discovered device:', err)
      error.value = err
      throw err
    }
  }

  function markDeviceStatus(discoveredId, status) {
    const device = activeScan.value?.discoveredDevices?.find(d => d.id === discoveredId)
    if (device) {
      device.status = status
    }
  }

  function clearError() {
    error.value = null
  }

  // WebSocket event handlers

  /**
   * Update the active scan's progress (from 'discovery:progress')
   * @param {Object} data - { scanId, progress, phase, message }
   */
  function updateScanProgress(data) {
    const { scanId, progress, phase, message } = data
    scanProgress.value = { scanId, progress, phase, message }

    const scan = scans.value.find(s => s.id === scanId)
    if (scan) {
      scan.status = 'running'
      scan.progress = progress
    }
    if (activeScan.value?.id === scanId) {
      activeScan.value.status = 'running'
      activeScan.value.progress = progress
    }
  }

  /**
   * Handle scan completion (from 'discovery:completed')
   * @param {Object} data - { scanId, totalHosts, vendorHosts }
   */
  async function handleScanCompleted(data) {
    const { scanId, totalHosts, vendorHosts } = data

    if (scanProgress.value?.scanId === scanId) {
      scanProgress.value = null
    }

    const scan = scans.value.find(s => s.id === scanId)
    if (scan) {
      scan.status = 'completed'
      scan.progress = 100
      scan.totalHosts = totalHosts
      scan.vendorHosts = vendorHosts
      scan.completedAt = new Date().toISOString()
    }

    // Load the results if the completed scan is the one being viewed
    if (!activeScan.value || activeScan.value.id === scanId) {
      try {
        await fetchScan(scanId)
      } catch (err) {
        console.error('Failed to refresh completed scan:', err)
      }
    }
  }

  /**
   * Handle scan failure (from 'discovery:failed')
   * @param {Object} data - { scanId, error }
   */
  function handleScanFailed(data) {
    const { scanId, error: errorMessage } = data

    if (scanProgress.value?.scanId === scanId) {
      scanProgress.value = null
    }

    const scan = scans.value.find(s => s.id === scanId)
    if (scan) {
      scan.status = 'failed'
      scan.error = errorMessage
      scan.completedAt = new Date().toISOString()
    }
    if (activeScan.value?.id === scanId) {
      activeScan.value.status = 'failed'
      activeScan.value.error = errorMessage
    }
  }

  return {
    subnets,
    subnetsLoading,
    scans,
    scansLoading,
    activeScan,
    activeScanLoading,
    scanProgress,
    starting,
    error,
    runningScan,
    isScanning,
    discoveredDevices,
    newDevices,
    knownVendorDevices,
    fetchSubnets,
    fetchScans,
    fetchScan,
    startScan,
    deleteScan,
    importDevice,
    ignoreDevice,
    markDeviceStatus,
    clearError,
    updateScanProgress,
    handleScanCompleted,
    handleScanFailed
  }
})
