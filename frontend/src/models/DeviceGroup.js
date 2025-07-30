/**
 * DeviceGroup Model
 * Represents a group of devices in the NetHelper Automation Platform
 */

export class DeviceGroup {
  constructor(data = {}) {
    this.id = data.id || null
    this.name = data.name || ''
    this.description = data.description || null
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date()
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date()
    
    // Related data
    this.devices = data.devices || []
    this.automations = data.automations || []
  }

  /**
   * Create DeviceGroup instance from API response
   * @param {Object} apiData - Raw data from API
   * @returns {DeviceGroup} DeviceGroup instance
   */
  static fromApiResponse(apiData) {
    return new DeviceGroup(apiData)
  }

  /**
   * Convert DeviceGroup instance to API payload
   * @returns {Object} API payload
   */
  toApiPayload() {
    return {
      name: this.name,
      description: this.description
    }
  }

  /**
   * Get display name for device group
   * @returns {string} Display name
   */
  getDisplayName() {
    return this.name || 'Unnamed Group'
  }

  /**
   * Get device count
   * @returns {number} Number of devices in the group
   */
  getDeviceCount() {
    return this.devices.length
  }

  /**
   * Get automation count
   * @returns {number} Number of automations using this group
   */
  getAutomationCount() {
    return this.automations.length
  }

  /**
   * Get devices by type
   * @param {string} deviceType - Device type to filter by
   * @returns {Array} Devices of specified type
   */
  getDevicesByType(deviceType) {
    return this.devices.filter(device => device.type === deviceType)
  }

  /**
   * Get devices by status
   * @param {string} status - Device status to filter by
   * @returns {Array} Devices with specified status
   */
  getDevicesByStatus(status) {
    return this.devices.filter(device => device.status === status)
  }

  /**
   * Get online devices count
   * @returns {number} Number of online devices
   */
  getOnlineDevicesCount() {
    return this.getDevicesByStatus('online').length
  }

  /**
   * Get offline devices count
   * @returns {number} Number of offline devices
   */
  getOfflineDevicesCount() {
    return this.getDevicesByStatus('offline').length
  }

  /**
   * Get group health percentage
   * @returns {number} Health percentage (0-100)
   */
  getHealthPercentage() {
    const totalDevices = this.getDeviceCount()
    if (totalDevices === 0) return 100
    
    const onlineDevices = this.getOnlineDevicesCount()
    return Math.round((onlineDevices / totalDevices) * 100)
  }

  /**
   * Check if group is empty
   * @returns {boolean} Whether group has no devices
   */
  isEmpty() {
    return this.getDeviceCount() === 0
  }

  /**
   * Check if group has devices
   * @returns {boolean} Whether group has devices
   */
  hasDevices() {
    return this.getDeviceCount() > 0
  }

  /**
   * Check if group is used by automations
   * @returns {boolean} Whether group is used by automations
   */
  isUsedByAutomations() {
    return this.getAutomationCount() > 0
  }

  /**
   * Get device type distribution
   * @returns {Object} Distribution of device types
   */
  getDeviceTypeDistribution() {
    const distribution = {}
    
    this.devices.forEach(device => {
      const type = device.type || 'unknown'
      distribution[type] = (distribution[type] || 0) + 1
    })
    
    return distribution
  }

  /**
   * Get device status distribution
   * @returns {Object} Distribution of device statuses
   */
  getDeviceStatusDistribution() {
    const distribution = {
      online: 0,
      offline: 0,
      warning: 0,
      maintenance: 0
    }
    
    this.devices.forEach(device => {
      const status = device.status || 'offline'
      if (distribution.hasOwnProperty(status)) {
        distribution[status]++
      }
    })
    
    return distribution
  }

  /**
   * Get group statistics
   * @returns {Object} Group statistics
   */
  getStatistics() {
    const deviceTypeDistribution = this.getDeviceTypeDistribution()
    const statusDistribution = this.getDeviceStatusDistribution()
    
    return {
      totalDevices: this.getDeviceCount(),
      onlineDevices: statusDistribution.online,
      offlineDevices: statusDistribution.offline,
      warningDevices: statusDistribution.warning,
      maintenanceDevices: statusDistribution.maintenance,
      healthPercentage: this.getHealthPercentage(),
      deviceTypes: deviceTypeDistribution,
      statusDistribution,
      automationCount: this.getAutomationCount()
    }
  }

  /**
   * Check if device exists in group
   * @param {string} deviceId - Device ID to check
   * @returns {boolean} Whether device exists in group
   */
  hasDevice(deviceId) {
    return this.devices.some(device => device.id === deviceId)
  }

  /**
   * Add device to group
   * @param {Object} device - Device to add
   * @returns {DeviceGroup} Updated device group instance
   */
  addDevice(device) {
    if (this.hasDevice(device.id)) {
      return this // Device already exists
    }
    
    const updatedDevices = [...this.devices, device]
    return this.update({ devices: updatedDevices })
  }

  /**
   * Remove device from group
   * @param {string} deviceId - Device ID to remove
   * @returns {DeviceGroup} Updated device group instance
   */
  removeDevice(deviceId) {
    const updatedDevices = this.devices.filter(device => device.id !== deviceId)
    return this.update({ devices: updatedDevices })
  }

  /**
   * Get devices that match criteria
   * @param {Object} criteria - Filtering criteria
   * @returns {Array} Filtered devices
   */
  filterDevices(criteria = {}) {
    let filteredDevices = [...this.devices]
    
    if (criteria.type) {
      filteredDevices = filteredDevices.filter(device => device.type === criteria.type)
    }
    
    if (criteria.status) {
      filteredDevices = filteredDevices.filter(device => device.status === criteria.status)
    }
    
    if (criteria.location) {
      filteredDevices = filteredDevices.filter(device => 
        device.location && device.location.toLowerCase().includes(criteria.location.toLowerCase())
      )
    }
    
    if (criteria.name) {
      filteredDevices = filteredDevices.filter(device => 
        device.name && device.name.toLowerCase().includes(criteria.name.toLowerCase())
      )
    }
    
    return filteredDevices
  }

  /**
   * Get group's average uptime
   * @returns {number} Average uptime percentage
   */
  getAverageUptime() {
    if (this.devices.length === 0) return 0
    
    const totalUptime = this.devices.reduce((sum, device) => {
      // Assuming device has getUptimePercentage method
      return sum + (device.getUptimePercentage ? device.getUptimePercentage() : 0)
    }, 0)
    
    return Math.round(totalUptime / this.devices.length)
  }

  /**
   * Validate device group data
   * @returns {Object} Validation result with isValid boolean and errors array
   */
  validate() {
    const errors = []

    // Name validation
    if (!this.name || this.name.trim().length < 2) {
      errors.push('Group name must be at least 2 characters long')
    }

    // Name uniqueness would be validated at the API level
    // Description validation (optional)
    if (this.description && this.description.length > 500) {
      errors.push('Description cannot exceed 500 characters')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Clone device group instance
   * @returns {DeviceGroup} Cloned device group instance
   */
  clone() {
    return new DeviceGroup({
      id: this.id,
      name: this.name,
      description: this.description,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      devices: [...this.devices],
      automations: [...this.automations]
    })
  }

  /**
   * Update device group data
   * @param {Object} updates - Updates to apply
   * @returns {DeviceGroup} Updated device group instance
   */
  update(updates) {
    const updatedGroup = this.clone()
    Object.assign(updatedGroup, updates)
    updatedGroup.updatedAt = new Date()
    return updatedGroup
  }

  /**
   * Get group summary for quick display
   * @returns {Object} Group summary
   */
  getSummary() {
    const stats = this.getStatistics()
    
    return {
      id: this.id,
      name: this.getDisplayName(),
      description: this.description,
      deviceCount: stats.totalDevices,
      onlineCount: stats.onlineDevices,
      healthPercentage: stats.healthPercentage,
      automationCount: stats.automationCount,
      isEmpty: this.isEmpty(),
      isUsedByAutomations: this.isUsedByAutomations()
    }
  }

  /**
   * Get devices for table display
   * @returns {Array} Devices formatted for table display
   */
  getDevicesForTable() {
    return this.devices.map(device => ({
      id: device.id,
      name: device.name || device.serial,
      type: device.type,
      status: device.status,
      location: device.location,
      lastSeen: device.lastSeen,
      ipAddress: device.ipAddress
    }))
  }

  /**
   * Export group data for external use
   * @returns {Object} Exportable group data
   */
  exportData() {
    return {
      groupInfo: {
        id: this.id,
        name: this.name,
        description: this.description,
        createdAt: this.createdAt.toISOString(),
        updatedAt: this.updatedAt.toISOString()
      },
      statistics: this.getStatistics(),
      devices: this.getDevicesForTable(),
      automations: this.automations.map(automation => ({
        id: automation.id,
        name: automation.name,
        type: automation.type,
        active: automation.active
      }))
    }
  }

  /**
   * Convert to JSON representation
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      devices: this.devices,
      automations: this.automations
    }
  }
}

export default DeviceGroup