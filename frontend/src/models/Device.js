/**
 * Device Model
 * Represents a network device in the NetHelper Automation Platform
 */

// Device type enumeration
export const DeviceType = {
  ACCESS_POINT: 'access_point',
  SWITCH: 'switch',
  GATEWAY: 'gateway'
}

// Device status enumeration
export const DeviceStatus = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  WARNING: 'warning',
  MAINTENANCE: 'maintenance'
}

// Device type display information
export const DeviceTypeInfo = {
  [DeviceType.ACCESS_POINT]: {
    label: 'Access Point',
    icon: 'mdi-wifi',
    description: 'Wireless access point device',
    color: 'blue'
  },
  [DeviceType.SWITCH]: {
    label: 'Switch',
    icon: 'mdi-switch',
    description: 'Network switch device',
    color: 'green'
  },
  [DeviceType.GATEWAY]: {
    label: 'Gateway',
    icon: 'mdi-router-wireless',
    description: 'Network gateway device',
    color: 'purple'
  }
}

// Device status display information
export const DeviceStatusInfo = {
  [DeviceStatus.ONLINE]: {
    label: 'Online',
    color: 'success',
    icon: 'mdi-check-circle',
    description: 'Device is online and operational'
  },
  [DeviceStatus.OFFLINE]: {
    label: 'Offline',
    color: 'error',
    icon: 'mdi-close-circle',
    description: 'Device is offline or unreachable'
  },
  [DeviceStatus.WARNING]: {
    label: 'Warning',
    color: 'warning',
    icon: 'mdi-alert-circle',
    description: 'Device has warnings or performance issues'
  },
  [DeviceStatus.MAINTENANCE]: {
    label: 'Maintenance',
    color: 'info',
    icon: 'mdi-wrench',
    description: 'Device is under maintenance'
  }
}

/**
 * A device's displayed status: ping first, then its cloud's view. When the
 * two disagree about a cloud-managed device it is warning: cloud online but
 * no ping (up, but unreachable from NetHelper), or cloud offline but its
 * address answers ping (maybe another device now has that IP). Mirrors
 * backend/src/utils/device-status.js.
 */
export function effectiveStatus(device) {
  const { pingStatus, cloudStatus, managementMode } = device || {}
  if (managementMode === 'cloud') {
    if (pingStatus === 'offline' && cloudStatus === 'online') return DeviceStatus.WARNING
    if (pingStatus === 'online' && cloudStatus === 'offline') return DeviceStatus.WARNING
  }
  return pingStatus || cloudStatus || DeviceStatus.OFFLINE
}

/** True when the cloud reports a device offline but its address answers ping. */
export function answersPingButCloudOffline(device) {
  return device?.pingStatus === 'online' && effectiveStatus(device) === DeviceStatus.WARNING
}

/** True when the cloud reports a device online that NetHelper can't ping. */
export function unreachableFromHere(device) {
  return device?.pingStatus === 'offline' && effectiveStatus(device) === DeviceStatus.WARNING
}

export class Device {
  constructor(data = {}) {
    this.id = data.id || null
    this.serial = data.serial || ''
    this.name = data.name || ''
    this.type = data.type || DeviceType.ACCESS_POINT
    this.model = data.model || ''
    this.ipAddress = data.ipAddress || null
    this.macAddress = data.macAddress || null
    this.location = data.location || null
    this.status = data.status || DeviceStatus.OFFLINE
    this.firmwareVersion = data.firmwareVersion || null
    this.lastSeen = data.lastSeen ? new Date(data.lastSeen) : null
    this.metadata = data.metadata || null
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date()
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date()
    
    // Related data
    this.executions = data.executions || []
    this.deviceGroups = data.deviceGroups || []
  }

  /**
   * Create Device instance from API response
   * @param {Object} apiData - Raw data from API
   * @returns {Device} Device instance
   */
  static fromApiResponse(apiData) {
    return new Device(apiData)
  }

  /**
   * Convert Device instance to API payload
   * @returns {Object} API payload
   */
  toApiPayload() {
    return {
      serial: this.serial,
      name: this.name,
      type: this.type,
      model: this.model,
      ipAddress: this.ipAddress,
      macAddress: this.macAddress,
      location: this.location,
      status: this.status,
      firmwareVersion: this.firmwareVersion,
      metadata: this.metadata
    }
  }

  /**
   * Get device type information
   * @returns {Object} Type information with label, icon, description, and color
   */
  getTypeInfo() {
    return DeviceTypeInfo[this.type] || DeviceTypeInfo[DeviceType.ACCESS_POINT]
  }

  /**
   * Get device status information
   * @returns {Object} Status information with label, color, icon, and description
   */
  getStatusInfo() {
    return DeviceStatusInfo[this.status] || DeviceStatusInfo[DeviceStatus.OFFLINE]
  }

  /**
   * Check if device is online
   * @returns {boolean} Whether device is online
   */
  isOnline() {
    return this.status === DeviceStatus.ONLINE
  }

  /**
   * Check if device is offline
   * @returns {boolean} Whether device is offline
   */
  isOffline() {
    return this.status === DeviceStatus.OFFLINE
  }

  /**
   * Check if device has warnings
   * @returns {boolean} Whether device has warnings
   */
  hasWarnings() {
    return this.status === DeviceStatus.WARNING
  }

  /**
   * Check if device is under maintenance
   * @returns {boolean} Whether device is under maintenance
   */
  isUnderMaintenance() {
    return this.status === DeviceStatus.MAINTENANCE
  }

  /**
   * Get display name for device
   * @returns {string} Display name
   */
  getDisplayName() {
    return this.name || this.serial || 'Unknown Device'
  }

  /**
   * Get time since last seen
   * @returns {string} Human readable time since last seen
   */
  getLastSeenDisplay() {
    if (!this.lastSeen) return 'Never'
    
    const now = new Date()
    const diff = now - this.lastSeen
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'Just now'
  }

  /**
   * Get uptime percentage based on last seen and status
   * @param {number} periodDays - Period in days to calculate uptime (default: 30)
   * @returns {number} Uptime percentage (0-100)
   */
  getUptimePercentage(periodDays = 30) {
    if (!this.lastSeen || this.status === DeviceStatus.OFFLINE) return 0
    
    const now = new Date()
    const periodMs = periodDays * 24 * 60 * 60 * 1000
    const timeSinceLastSeen = now - this.lastSeen
    
    if (timeSinceLastSeen > periodMs) return 0
    
    // Simple uptime calculation - in real implementation, this would be more complex
    if (this.status === DeviceStatus.ONLINE) return 100
    if (this.status === DeviceStatus.WARNING) return 85
    if (this.status === DeviceStatus.MAINTENANCE) return 95
    
    return 0
  }

  /**
   * Get device health score based on status and other factors
   * @returns {number} Health score (0-100)
   */
  getHealthScore() {
    const baseScore = {
      [DeviceStatus.ONLINE]: 100,
      [DeviceStatus.WARNING]: 70,
      [DeviceStatus.MAINTENANCE]: 80,
      [DeviceStatus.OFFLINE]: 0
    }[this.status] || 0

    // Adjust based on last seen
    if (this.lastSeen) {
      const hoursSinceLastSeen = (new Date() - this.lastSeen) / (1000 * 60 * 60)
      if (hoursSinceLastSeen > 24) {
        return Math.max(0, baseScore - 20)
      }
    }

    return baseScore
  }

  /**
   * Check if device firmware is outdated
   * @param {string} latestVersion - Latest firmware version available
   * @returns {boolean} Whether firmware is outdated
   */
  isFirmwareOutdated(latestVersion) {
    if (!this.firmwareVersion || !latestVersion) return false
    
    // Simple version comparison - in real implementation, use proper semver
    return this.firmwareVersion !== latestVersion
  }

  /**
   * Get device location display
   * @returns {string} Location display text
   */
  getLocationDisplay() {
    return this.location || 'Unknown Location'
  }

  /**
   * Validate device data
   * @returns {Object} Validation result with isValid boolean and errors array
   */
  validate() {
    const errors = []

    // Serial is optional (directly-managed devices may not have one)

    // Name validation
    if (!this.name || this.name.trim().length < 2) {
      errors.push('Device name must be at least 2 characters long')
    }

    // Type validation
    if (!Object.values(DeviceType).includes(this.type)) {
      errors.push('Invalid device type')
    }

    // Status validation
    if (!Object.values(DeviceStatus).includes(this.status)) {
      errors.push('Invalid device status')
    }

    // Model validation
    if (!this.model || this.model.trim().length === 0) {
      errors.push('Device model is required')
    }

    // IP address validation (if provided)
    if (this.ipAddress) {
      const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
      if (!ipRegex.test(this.ipAddress)) {
        errors.push('Invalid IP address format')
      }
    }

    // MAC address validation (if provided)
    if (this.macAddress) {
      const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/
      if (!macRegex.test(this.macAddress)) {
        errors.push('Invalid MAC address format')
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Clone device instance
   * @returns {Device} Cloned device instance
   */
  clone() {
    return new Device({
      id: this.id,
      serial: this.serial,
      name: this.name,
      type: this.type,
      model: this.model,
      ipAddress: this.ipAddress,
      macAddress: this.macAddress,
      location: this.location,
      status: this.status,
      firmwareVersion: this.firmwareVersion,
      lastSeen: this.lastSeen,
      metadata: this.metadata ? { ...this.metadata } : null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      executions: [...this.executions],
      deviceGroups: [...this.deviceGroups]
    })
  }

  /**
   * Update device data
   * @param {Object} updates - Updates to apply
   * @returns {Device} Updated device instance
   */
  update(updates) {
    const updatedDevice = this.clone()
    Object.assign(updatedDevice, updates)
    updatedDevice.updatedAt = new Date()
    return updatedDevice
  }

  /**
   * Update device status
   * @param {string} status - New status
   * @returns {Device} Updated device instance
   */
  updateStatus(status) {
    if (!Object.values(DeviceStatus).includes(status)) {
      throw new Error(`Invalid device status: ${status}`)
    }
    
    return this.update({ 
      status,
      lastSeen: status === DeviceStatus.ONLINE ? new Date() : this.lastSeen
    })
  }

  /**
   * Get device summary for quick display
   * @returns {Object} Device summary
   */
  getSummary() {
    return {
      id: this.id,
      name: this.getDisplayName(),
      type: this.getTypeInfo().label,
      status: this.getStatusInfo().label,
      location: this.getLocationDisplay(),
      lastSeen: this.getLastSeenDisplay(),
      healthScore: this.getHealthScore()
    }
  }

  /**
   * Convert to JSON representation
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      serial: this.serial,
      name: this.name,
      type: this.type,
      model: this.model,
      ipAddress: this.ipAddress,
      macAddress: this.macAddress,
      location: this.location,
      status: this.status,
      firmwareVersion: this.firmwareVersion,
      lastSeen: this.lastSeen?.toISOString(),
      metadata: this.metadata,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      executions: this.executions,
      deviceGroups: this.deviceGroups
    }
  }
}

export default Device