import api from './api'
import { handleApiError } from '@/utils/apiError'

class DeviceService {
  async getDevices(params = {}) {
    try {
      const response = await api.get('/devices', { params })
      return response.data
    } catch (error) {
      console.error('Error fetching devices:', error)
      throw handleApiError(error, 'fetching devices')
    }
  }

  async getDevicesWithPagination(options = {}) {
    const {
      page = 1,
      itemsPerPage = 10,
      sortBy = [],
      search = '',
      filters = {}
    } = options

    try {
      const params = {
        page,
        limit: itemsPerPage,
        search,
        ...filters
      }

      if (sortBy.length > 0) {
        params.sortBy = sortBy[0].key
        params.sortOrder = sortBy[0].order
      }

      const response = await api.get('/devices', { params })

      // Backend returns { success, data, count }
      // Transform to match expected pagination format
      const devices = response.data.data || []

      return {
        data: devices,
        pagination: {
          page,
          itemsPerPage,
          total: response.data.count || devices.length,
          totalPages: Math.ceil((response.data.count || devices.length) / itemsPerPage)
        }
      }
    } catch (error) {
      console.error('Error fetching devices with pagination:', error)
      throw handleApiError(error, 'fetching devices')
    }
  }

  async getDevice(id) {
    try {
      const response = await api.get(`/devices/${id}`)
      return response.data
    } catch (error) {
      console.error('Error fetching device:', error)
      throw handleApiError(error, 'fetching device details')
    }
  }

  async createDevice(deviceData) {
    try {
      const response = await api.post('/devices', deviceData)
      return response.data
    } catch (error) {
      console.error('Error creating device:', error)
      throw handleApiError(error, 'creating device')
    }
  }

  async updateDevice(id, deviceData) {
    try {
      const response = await api.put(`/devices/${id}`, deviceData)
      return response.data
    } catch (error) {
      console.error('Error updating device:', error)
      throw handleApiError(error, 'updating device')
    }
  }

  /**
   * Sync device inventory from the cloud.
   * @param {string|null} integrationId - sync one integration, or all active ones when null
   */
  async syncDevices(integrationId = null) {
    try {
      const response = await api.post('/devices/sync', integrationId ? { integrationId } : {})
      return response.data
    } catch (error) {
      console.error('Error syncing devices:', error)
      throw handleApiError(error, 'syncing devices')
    }
  }

  async getDeviceStats(id) {
    try {
      const response = await api.get(`/devices/${id}/stats`)
      return response.data
    } catch (error) {
      console.error('Error fetching device stats:', error)
      throw handleApiError(error, 'fetching device statistics')
    }
  }

  // Device Polling API Methods
  async getAvailablePollers() {
    try {
      const response = await api.get('/devices/poll/pollers')
      return response.data
    } catch (error) {
      console.error('Error fetching available pollers:', error)
      throw error
    }
  }

  async pollDevices(poller, deviceIds) {
    try {
      const response = await api.post('/devices/poll', {
        poller,
        deviceIds
      })
      return response.data
    } catch (error) {
      console.error('Error polling devices:', error)
      throw error
    }
  }

  async pollDeviceFirmware(deviceIds) {
    return this.pollDevices('firmware', deviceIds)
  }

  async pollDeviceSystem(deviceIds) {
    return this.pollDevices('system', deviceIds)
  }

  async pollDeviceBackup(deviceIds) {
    return this.pollDevices('backup', deviceIds)
  }

  async pollDeviceLoginSessions(deviceIds) {
    return this.pollDevices('login-sessions', deviceIds)
  }

}

export default new DeviceService()