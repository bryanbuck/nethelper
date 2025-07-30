/**
 * AuditLog Model
 * Represents an audit log entry in the NetHelper Automation Platform
 */

// Common audit actions
export const AuditAction = {
  // User actions
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  
  // Device actions
  DEVICE_CREATED: 'device_created',
  DEVICE_UPDATED: 'device_updated',
  DEVICE_DELETED: 'device_deleted',
  DEVICE_SYNC: 'device_sync',
  DEVICE_COMMAND: 'device_command',
  
  // Automation actions
  AUTOMATION_CREATED: 'automation_created',
  AUTOMATION_UPDATED: 'automation_updated',
  AUTOMATION_DELETED: 'automation_deleted',
  AUTOMATION_EXECUTED: 'automation_executed',
  AUTOMATION_ACTIVATED: 'automation_activated',
  AUTOMATION_DEACTIVATED: 'automation_deactivated',
  
  // Schedule actions
  SCHEDULE_CREATED: 'schedule_created',
  SCHEDULE_UPDATED: 'schedule_updated',
  SCHEDULE_DELETED: 'schedule_deleted',
  
  // System actions
  CONFIGURATION_CHANGED: 'configuration_changed',
  BACKUP_CREATED: 'backup_created',
  FIRMWARE_UPDATED: 'firmware_updated',
  SECURITY_EVENT: 'security_event'
}

// Entity types for audit logs
export const AuditEntity = {
  USER: 'User',
  DEVICE: 'Device',
  DEVICE_GROUP: 'DeviceGroup',
  AUTOMATION: 'Automation',
  SCHEDULE: 'Schedule',
  EXECUTION: 'Execution',
  SYSTEM: 'System'
}

// Action severity levels
export const AuditSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
}

// Action categories
export const AuditCategory = {
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  DATA_CHANGE: 'data_change',
  SYSTEM_ACCESS: 'system_access',
  CONFIGURATION: 'configuration',
  SECURITY: 'security',
  OPERATION: 'operation'
}

// Action display information
export const AuditActionInfo = {
  [AuditAction.USER_LOGIN]: {
    label: 'User Login',
    icon: 'mdi-login',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.LOW,
    description: 'User logged into the system'
  },
  [AuditAction.USER_LOGOUT]: {
    label: 'User Logout',
    icon: 'mdi-logout',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.LOW,
    description: 'User logged out of the system'
  },
  [AuditAction.USER_CREATED]: {
    label: 'User Created',
    icon: 'mdi-account-plus',
    category: AuditCategory.DATA_CHANGE,
    severity: AuditSeverity.MEDIUM,
    description: 'New user account created'
  },
  [AuditAction.DEVICE_SYNC]: {
    label: 'Device Sync',
    icon: 'mdi-sync',
    category: AuditCategory.OPERATION,
    severity: AuditSeverity.LOW,
    description: 'Device data synchronized'
  },
  [AuditAction.AUTOMATION_EXECUTED]: {
    label: 'Automation Executed',
    icon: 'mdi-play',
    category: AuditCategory.OPERATION,
    severity: AuditSeverity.MEDIUM,
    description: 'Automation workflow executed'
  },
  [AuditAction.SECURITY_EVENT]: {
    label: 'Security Event',
    icon: 'mdi-shield-alert',
    category: AuditCategory.SECURITY,
    severity: AuditSeverity.HIGH,
    description: 'Security-related event occurred'
  }
}

export class AuditLog {
  constructor(data = {}) {
    this.id = data.id || null
    this.action = data.action || ''
    this.entity = data.entity || ''
    this.entityId = data.entityId || ''
    this.userId = data.userId || ''
    this.changes = data.changes || null
    this.ipAddress = data.ipAddress || null
    this.userAgent = data.userAgent || null
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date()
    
    // Additional computed properties
    this._user = data.user || null
    this._entityData = data.entityData || null
  }

  /**
   * Create AuditLog instance from API response
   * @param {Object} apiData - Raw data from API
   * @returns {AuditLog} AuditLog instance
   */
  static fromApiResponse(apiData) {
    return new AuditLog(apiData)
  }

  /**
   * Convert AuditLog instance to API payload
   * @returns {Object} API payload
   */
  toApiPayload() {
    return {
      action: this.action,
      entity: this.entity,
      entityId: this.entityId,
      userId: this.userId,
      changes: this.changes,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent
    }
  }

  /**
   * Get action information
   * @returns {Object} Action information with label, icon, category, severity, and description
   */
  getActionInfo() {
    return AuditActionInfo[this.action] || {
      label: this.action,
      icon: 'mdi-information',
      category: AuditCategory.OPERATION,
      severity: AuditSeverity.LOW,
      description: 'Unknown action'
    }
  }

  /**
   * Get action display label
   * @returns {string} Human readable action label
   */
  getActionLabel() {
    return this.getActionInfo().label
  }

  /**
   * Get action category
   * @returns {string} Action category
   */
  getCategory() {
    return this.getActionInfo().category
  }

  /**
   * Get action severity
   * @returns {string} Action severity level
   */
  getSeverity() {
    return this.getActionInfo().severity
  }

  /**
   * Get action icon
   * @returns {string} Material Design icon name
   */
  getIcon() {
    return this.getActionInfo().icon
  }

  /**
   * Get severity color for UI display
   * @returns {string} Color name for severity
   */
  getSeverityColor() {
    const colors = {
      [AuditSeverity.LOW]: 'success',
      [AuditSeverity.MEDIUM]: 'info',
      [AuditSeverity.HIGH]: 'warning',
      [AuditSeverity.CRITICAL]: 'error'
    }
    return colors[this.getSeverity()] || 'grey'
  }

  /**
   * Get user name (if user data is available)
   * @returns {string} User name or ID
   */
  getUserName() {
    return this._user?.name || this.userId || 'System'
  }

  /**
   * Get entity display name
   * @returns {string} Entity display name
   */
  getEntityDisplayName() {
    if (this._entityData?.name) return this._entityData.name
    if (this._entityData?.email) return this._entityData.email
    return this.entityId || 'Unknown'
  }

  /**
   * Get formatted timestamp
   * @returns {string} Formatted timestamp
   */
  getFormattedTimestamp() {
    return this.createdAt.toLocaleString()
  }

  /**
   * Get relative time (time ago)
   * @returns {string} Relative time string
   */
  getRelativeTime() {
    const now = new Date()
    const diff = now - this.createdAt
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'Just now'
  }

  /**
   * Get browser information from user agent
   * @returns {Object} Browser information
   */
  getBrowserInfo() {
    if (!this.userAgent) return { browser: 'Unknown', os: 'Unknown' }

    // Simple user agent parsing (in production, use a proper library)
    const ua = this.userAgent.toLowerCase()
    let browser = 'Unknown'
    let os = 'Unknown'

    // Browser detection
    if (ua.includes('chrome')) browser = 'Chrome'
    else if (ua.includes('firefox')) browser = 'Firefox'
    else if (ua.includes('safari')) browser = 'Safari'
    else if (ua.includes('edge')) browser = 'Edge'

    // OS detection
    if (ua.includes('windows')) os = 'Windows'
    else if (ua.includes('mac')) os = 'macOS'
    else if (ua.includes('linux')) os = 'Linux'
    else if (ua.includes('android')) os = 'Android'
    else if (ua.includes('ios')) os = 'iOS'

    return { browser, os }
  }

  /**
   * Get changes summary
   * @returns {Object} Changes summary
   */
  getChangesSummary() {
    if (!this.changes || typeof this.changes !== 'object') {
      return {
        hasChanges: false,
        fieldCount: 0,
        fields: []
      }
    }

    const fields = Object.keys(this.changes)
    return {
      hasChanges: true,
      fieldCount: fields.length,
      fields: fields.map(field => ({
        field,
        oldValue: this.changes[field]?.from,
        newValue: this.changes[field]?.to
      }))
    }
  }

  /**
   * Check if this is a security-related event
   * @returns {boolean} Whether this is a security event
   */
  isSecurityEvent() {
    return this.getCategory() === AuditCategory.SECURITY ||
           this.getSeverity() === AuditSeverity.CRITICAL
  }

  /**
   * Check if this is an authentication event
   * @returns {boolean} Whether this is an authentication event
   */
  isAuthenticationEvent() {
    return this.getCategory() === AuditCategory.AUTHENTICATION
  }

  /**
   * Check if this is a data change event
   * @returns {boolean} Whether this is a data change event
   */
  isDataChangeEvent() {
    return this.getCategory() === AuditCategory.DATA_CHANGE
  }

  /**
   * Check if event occurred recently (within last hour)
   * @returns {boolean} Whether event is recent
   */
  isRecent() {
    const oneHour = 60 * 60 * 1000
    return (new Date() - this.createdAt) <= oneHour
  }

  /**
   * Get event description with context
   * @returns {string} Detailed event description
   */
  getDescription() {
    const actionInfo = this.getActionInfo()
    const userName = this.getUserName()
    const entityName = this.getEntityDisplayName()
    
    let description = `${userName} ${actionInfo.description.toLowerCase()}`
    
    if (this.entity && this.entityId) {
      description += ` for ${this.entity.toLowerCase()} "${entityName}"`
    }

    return description
  }

  /**
   * Filter method for searching audit logs
   * @param {Object} filters - Search filters
   * @returns {boolean} Whether this log matches the filters
   */
  matchesFilters(filters = {}) {
    if (filters.action && this.action !== filters.action) return false
    if (filters.entity && this.entity !== filters.entity) return false
    if (filters.userId && this.userId !== filters.userId) return false
    if (filters.category && this.getCategory() !== filters.category) return false
    if (filters.severity && this.getSeverity() !== filters.severity) return false
    
    if (filters.dateFrom && this.createdAt < new Date(filters.dateFrom)) return false
    if (filters.dateTo && this.createdAt > new Date(filters.dateTo)) return false
    
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase()
      const searchableText = [
        this.getActionLabel(),
        this.getUserName(),
        this.getEntityDisplayName(),
        this.getDescription(),
        this.ipAddress
      ].join(' ').toLowerCase()
      
      if (!searchableText.includes(searchTerm)) return false
    }

    return true
  }

  /**
   * Clone audit log instance
   * @returns {AuditLog} Cloned audit log instance
   */
  clone() {
    return new AuditLog({
      id: this.id,
      action: this.action,
      entity: this.entity,
      entityId: this.entityId,
      userId: this.userId,
      changes: this.changes ? JSON.parse(JSON.stringify(this.changes)) : null,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      createdAt: this.createdAt,
      user: this._user,
      entityData: this._entityData
    })
  }

  /**
   * Get audit log summary for quick display
   * @returns {Object} Audit log summary
   */
  getSummary() {
    const actionInfo = this.getActionInfo()
    const changesSummary = this.getChangesSummary()
    const browserInfo = this.getBrowserInfo()

    return {
      id: this.id,
      action: this.action,
      actionLabel: actionInfo.label,
      entity: this.entity,
      entityDisplayName: this.getEntityDisplayName(),
      userName: this.getUserName(),
      description: this.getDescription(),
      category: this.getCategory(),
      severity: this.getSeverity(),
      severityColor: this.getSeverityColor(),
      icon: this.getIcon(),
      timestamp: this.getFormattedTimestamp(),
      relativeTime: this.getRelativeTime(),
      isRecent: this.isRecent(),
      isSecurityEvent: this.isSecurityEvent(),
      hasChanges: changesSummary.hasChanges,
      changedFields: changesSummary.fieldCount,
      ipAddress: this.ipAddress,
      browser: browserInfo.browser,
      os: browserInfo.os
    }
  }

  /**
   * Export audit log for compliance reporting
   * @returns {Object} Compliance-friendly export data
   */
  exportForCompliance() {
    return {
      id: this.id,
      timestamp: this.createdAt.toISOString(),
      action: this.action,
      actionDescription: this.getActionInfo().description,
      entity: this.entity,
      entityId: this.entityId,
      userId: this.userId,
      userName: this.getUserName(),
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      changes: this.changes,
      severity: this.getSeverity(),
      category: this.getCategory()
    }
  }

  /**
   * Convert to JSON representation
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      action: this.action,
      entity: this.entity,
      entityId: this.entityId,
      userId: this.userId,
      changes: this.changes,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      createdAt: this.createdAt.toISOString()
    }
  }
}

export default AuditLog