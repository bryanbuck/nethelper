import api from './api'

class DeviceService {
  async getDevices(params = {}) {
    try {
      const response = await api.get('/devices', { params })
      return response.data
    } catch (error) {
      console.error('Error fetching devices:', error)
      throw this.handleApiError(error, 'fetching devices')
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
      throw this.handleApiError(error, 'fetching devices')
    }
  }

  async getDevice(id) {
    try {
      const response = await api.get(`/devices/${id}`)
      return response.data
    } catch (error) {
      console.error('Error fetching device:', error)
      throw this.handleApiError(error, 'fetching device details')
    }
  }

  async createDevice(deviceData) {
    try {
      const response = await api.post('/devices', deviceData)
      return response.data
    } catch (error) {
      console.error('Error creating device:', error)
      throw this.handleApiError(error, 'creating device')
    }
  }

  async updateDevice(id, deviceData) {
    try {
      const response = await api.put(`/devices/${id}`, deviceData)
      return response.data
    } catch (error) {
      console.error('Error updating device:', error)
      throw this.handleApiError(error, 'updating device')
    }
  }

  async syncDevices() {
    try {
      const response = await api.post('/devices/sync')
      return response.data
    } catch (error) {
      console.error('Error syncing devices:', error)
      throw this.handleApiError(error, 'syncing devices')
    }
  }

  async getDeviceStats(id) {
    try {
      const response = await api.get(`/devices/${id}/stats`)
      return response.data
    } catch (error) {
      console.error('Error fetching device stats:', error)
      throw this.handleApiError(error, 'fetching device statistics')
    }
  }

  getMockDevices() {
    return {
      data: [
        {
          id: '1',
          name: 'AP-Office-01',
          type: 'Access Point',
          ipAddress: '192.168.1.101',
          location: 'Main Office',
          status: 'online',
          lastSeen: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          uptime: '5d 12h 30m',
          clients: 24,
          bandwidth: '45.2 Mbps'
        },
        {
          id: '2',
          name: 'SW-Core-01',
          type: 'Switch',
          ipAddress: '192.168.1.201',
          location: 'Server Room',
          status: 'online',
          lastSeen: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          uptime: '12d 8h 15m',
          ports: 48,
          utilization: '67%'
        },
        {
          id: '3',
          name: 'GW-Main-01',
          type: 'Gateway',
          ipAddress: '192.168.1.1',
          location: 'Network Closet',
          status: 'warning',
          lastSeen: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
          uptime: '2d 4h 22m',
          throughput: '156.8 Mbps',
          temperature: '82�C'
        },
        {
          id: '4',
          name: 'AP-Conference-01',
          type: 'Access Point',
          ipAddress: '192.168.1.102',
          location: 'Conference Room A',
          status: 'offline',
          lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          uptime: '0m',
          clients: 0,
          bandwidth: '0 Mbps'
        },
        {
          id: '5',
          name: 'SW-Floor2-01',
          type: 'Switch',
          ipAddress: '192.168.1.202',
          location: 'Floor 2 IDF',
          status: 'online',
          lastSeen: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
          uptime: '8d 16h 45m',
          ports: 24,
          utilization: '34%'
        },
        {
          id: '6',
          name: 'AP-Lobby-01',
          type: 'Access Point',
          ipAddress: '192.168.1.103',
          location: 'Main Lobby',
          status: 'online',
          lastSeen: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
          uptime: '7d 2h 18m',
          clients: 12,
          bandwidth: '28.4 Mbps'
        }
      ]
    }
  }

  getMockDevicesWithPagination(options = {}) {
    const {
      page = 1,
      itemsPerPage = 10,
      sortBy = [],
      search = '',
      filters = {}
    } = options

    // Generate a larger dataset for pagination testing
    const allDevices = this.generateMockDevices(50)
    
    // Apply search filter
    let filteredDevices = allDevices
    if (search) {
      const searchLower = search.toLowerCase()
      filteredDevices = allDevices.filter(device => 
        device.name.toLowerCase().includes(searchLower) ||
        device.type.toLowerCase().includes(searchLower) ||
        device.ipAddress.includes(searchLower) ||
        device.location.toLowerCase().includes(searchLower) ||
        device.status.toLowerCase().includes(searchLower)
      )
    }

    // Apply additional filters
    if (filters.status) {
      filteredDevices = filteredDevices.filter(device => device.status === filters.status)
    }
    if (filters.type) {
      filteredDevices = filteredDevices.filter(device => device.type === filters.type)
    }
    if (filters.location) {
      filteredDevices = filteredDevices.filter(device => device.location === filters.location)
    }

    // Apply sorting
    if (sortBy.length > 0) {
      const { key, order } = sortBy[0]
      filteredDevices.sort((a, b) => {
        let aVal = a[key]
        let bVal = b[key]
        
        if (typeof aVal === 'string') {
          aVal = aVal.toLowerCase()
          bVal = bVal.toLowerCase()
        }
        
        if (order === 'desc') {
          return bVal > aVal ? 1 : bVal < aVal ? -1 : 0
        } else {
          return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
        }
      })
    }

    // Calculate pagination
    const total = filteredDevices.length
    const startIndex = (page - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const paginatedDevices = filteredDevices.slice(startIndex, endIndex)

    return {
      data: paginatedDevices,
      pagination: {
        page,
        itemsPerPage,
        total,
        totalPages: Math.ceil(total / itemsPerPage)
      }
    }
  }

  generateMockDevices(count = 50) {
    const devices = []
    const deviceTypes = ['Access Point', 'Switch', 'Gateway', 'Controller']
    const statuses = ['online', 'offline', 'warning', 'maintenance']
    const locations = [
      'Main Office', 'Server Room', 'Conference Room A', 'Conference Room B',
      'Floor 1 IDF', 'Floor 2 IDF', 'Floor 3 IDF', 'Network Closet',
      'Main Lobby', 'Reception Area', 'IT Department', 'Executive Floor',
      'Cafeteria', 'Storage Room', 'Parking Garage', 'Security Office'
    ]

    for (let i = 1; i <= count; i++) {
      const type = deviceTypes[Math.floor(Math.random() * deviceTypes.length)]
      const status = statuses[Math.floor(Math.random() * statuses.length)]
      const location = locations[Math.floor(Math.random() * locations.length)]
      
      let prefix = 'DEV'
      if (type === 'Access Point') prefix = 'AP'
      else if (type === 'Switch') prefix = 'SW'
      else if (type === 'Gateway') prefix = 'GW'
      else if (type === 'Controller') prefix = 'CTL'
      
      const device = {
        id: i.toString(),
        name: `${prefix}-${location.replace(/\s+/g, '')}-${i.toString().padStart(2, '0')}`,
        type,
        ipAddress: `192.168.${Math.floor(i / 254) + 1}.${(i % 254) + 1}`,
        location,
        status,
        lastSeen: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000).toISOString(),
        uptime: this.generateRandomUptime(),
        macAddress: this.generateRandomMac(),
        serialNumber: `SN${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        firmware: `${Math.floor(Math.random() * 5) + 8}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 100)}`,
        model: `${type.replace(' ', '-')}-${Math.floor(Math.random() * 9000) + 1000}`
      }

      // Add type-specific properties
      if (type === 'Access Point') {
        device.clients = Math.floor(Math.random() * 50)
        device.bandwidth = `${(Math.random() * 100).toFixed(1)} Mbps`
        device.channel = Math.floor(Math.random() * 11) + 1
      } else if (type === 'Switch') {
        device.ports = [24, 48][Math.floor(Math.random() * 2)]
        device.utilization = `${Math.floor(Math.random() * 100)}%`
        device.vlanCount = Math.floor(Math.random() * 20) + 1
      } else if (type === 'Gateway') {
        device.throughput = `${(Math.random() * 200).toFixed(1)} Mbps`
        device.temperature = `${Math.floor(Math.random() * 40) + 50}°C`
        device.wanStatus = Math.random() > 0.8 ? 'down' : 'up'
      }

      devices.push(device)
    }

    return devices
  }

  generateRandomUptime() {
    const days = Math.floor(Math.random() * 30)
    const hours = Math.floor(Math.random() * 24)
    const minutes = Math.floor(Math.random() * 60)
    return `${days}d ${hours}h ${minutes}m`
  }

  generateRandomMac() {
    const hex = '0123456789ABCDEF'
    let mac = ''
    for (let i = 0; i < 6; i++) {
      if (i > 0) mac += ':'
      mac += hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)]
    }
    return mac
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

  /**
   * Handle API errors with user-friendly messages
   * @param {Error} error - The error object from axios
   * @param {string} action - Description of what was being attempted
   * @returns {Error} Enhanced error with user-friendly message
   */
  handleApiError(error, action = 'completing the request') {
    const enhancedError = new Error()

    // Check if it's a network error (no response from server)
    if (!error.response) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        enhancedError.message = `Request timeout while ${action}. The server took too long to respond.`
        enhancedError.userMessage = 'The request timed out. Please try again.'
        enhancedError.type = 'TIMEOUT'
      } else if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
        enhancedError.message = `Network error while ${action}. Unable to connect to the server.`
        enhancedError.userMessage = 'Unable to connect to the server. Please check your internet connection and ensure the backend server is running.'
        enhancedError.type = 'NETWORK'
      } else {
        enhancedError.message = `Connection failed while ${action}. ${error.message}`
        enhancedError.userMessage = 'Connection failed. Please verify the backend server is running and accessible.'
        enhancedError.type = 'CONNECTION'
      }
      enhancedError.statusCode = 0
      enhancedError.isRecoverable = true
      return enhancedError
    }

    // Handle HTTP error responses
    const status = error.response.status
    const responseData = error.response.data

    enhancedError.statusCode = status
    enhancedError.response = error.response

    switch (status) {
      case 400:
        enhancedError.message = `Bad request while ${action}: ${responseData.error || responseData.message || 'Invalid data provided'}`
        enhancedError.userMessage = responseData.error || 'The request contains invalid data. Please check your input.'
        enhancedError.type = 'BAD_REQUEST'
        enhancedError.isRecoverable = true
        break

      case 401:
        enhancedError.message = `Unauthorized while ${action}. Please log in again.`
        enhancedError.userMessage = 'Your session has expired. Please log in again.'
        enhancedError.type = 'UNAUTHORIZED'
        enhancedError.isRecoverable = false
        break

      case 403:
        enhancedError.message = `Access forbidden while ${action}. Insufficient permissions.`
        enhancedError.userMessage = 'You do not have permission to perform this action.'
        enhancedError.type = 'FORBIDDEN'
        enhancedError.isRecoverable = false
        break

      case 404:
        enhancedError.message = `Resource not found while ${action}.`
        enhancedError.userMessage = 'The requested resource was not found.'
        enhancedError.type = 'NOT_FOUND'
        enhancedError.isRecoverable = true
        break

      case 409:
        enhancedError.message = `Conflict while ${action}: ${responseData.error || 'Resource already exists'}`
        enhancedError.userMessage = responseData.error || 'A conflict occurred. This resource may already exist.'
        enhancedError.type = 'CONFLICT'
        enhancedError.isRecoverable = true
        break

      case 422:
        enhancedError.message = `Validation error while ${action}: ${responseData.error || 'Invalid data'}`
        enhancedError.userMessage = responseData.error || 'The data provided failed validation.'
        enhancedError.type = 'VALIDATION_ERROR'
        enhancedError.isRecoverable = true
        enhancedError.validationErrors = responseData.errors
        break

      case 429:
        enhancedError.message = `Rate limit exceeded while ${action}.`
        enhancedError.userMessage = 'Too many requests. Please wait a moment and try again.'
        enhancedError.type = 'RATE_LIMIT'
        enhancedError.isRecoverable = true
        break

      case 500:
      case 502:
      case 503:
      case 504:
        enhancedError.message = `Server error while ${action}: ${responseData.error || 'Internal server error'}`
        enhancedError.userMessage = 'A server error occurred. Please try again later or contact support if the issue persists.'
        enhancedError.type = 'SERVER_ERROR'
        enhancedError.isRecoverable = true
        break

      default:
        enhancedError.message = `Error while ${action}: ${responseData.error || responseData.message || 'Unknown error'}`
        enhancedError.userMessage = responseData.error || responseData.message || 'An unexpected error occurred.'
        enhancedError.type = 'UNKNOWN'
        enhancedError.isRecoverable = true
    }

    // Preserve original error details
    enhancedError.originalError = error
    enhancedError.action = action

    return enhancedError
  }
}

export default new DeviceService()