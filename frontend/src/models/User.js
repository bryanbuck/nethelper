/**
 * User Model
 * Represents a user in the NetHelper Automation Platform
 */

// User role enumeration
export const UserRole = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer'
}

// User role display names and permissions
export const UserRoleInfo = {
  [UserRole.ADMIN]: {
    label: 'Administrator',
    description: 'Full system access with user management',
    permissions: ['read', 'write', 'delete', 'manage_users', 'manage_system']
  },
  [UserRole.OPERATOR]: {
    label: 'Operator',
    description: 'Can create and execute automations',
    permissions: ['read', 'write', 'execute_automations']
  },
  [UserRole.VIEWER]: {
    label: 'Viewer',
    description: 'Read-only access to system data',
    permissions: ['read']
  }
}

export class User {
  constructor(data = {}) {
    this.id = data.id || null
    this.email = data.email || ''
    this.password = data.password || '' // Only used during creation/update
    this.name = data.name || ''
    this.role = data.role || UserRole.VIEWER
    this.refreshToken = data.refreshToken || null
    this.lastLogin = data.lastLogin ? new Date(data.lastLogin) : null
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date()
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date()
    
    // Related data
    this.automations = data.automations || []
    this.executions = data.executions || []
  }

  /**
   * Create User instance from API response
   * @param {Object} apiData - Raw data from API
   * @returns {User} User instance
   */
  static fromApiResponse(apiData) {
    return new User(apiData)
  }

  /**
   * Convert User instance to API payload
   * @param {boolean} includePassword - Whether to include password in payload
   * @returns {Object} API payload
   */
  toApiPayload(includePassword = false) {
    const payload = {
      email: this.email,
      name: this.name,
      role: this.role
    }

    if (includePassword && this.password) {
      payload.password = this.password
    }

    return payload
  }

  /**
   * Get user's display name
   * @returns {string} Display name
   */
  getDisplayName() {
    return this.name || this.email
  }

  /**
   * Get user's role information
   * @returns {Object} Role information with label, description, and permissions
   */
  getRoleInfo() {
    return UserRoleInfo[this.role] || UserRoleInfo[UserRole.VIEWER]
  }

  /**
   * Check if user has specific permission
   * @param {string} permission - Permission to check
   * @returns {boolean} Whether user has permission
   */
  hasPermission(permission) {
    const roleInfo = this.getRoleInfo()
    return roleInfo.permissions.includes(permission)
  }

  /**
   * Check if user is admin
   * @returns {boolean} Whether user is admin
   */
  isAdmin() {
    return this.role === UserRole.ADMIN
  }

  /**
   * Check if user is operator or higher
   * @returns {boolean} Whether user can operate
   */
  canOperate() {
    return this.role === UserRole.ADMIN || this.role === UserRole.OPERATOR
  }

  /**
   * Check if user can manage other users
   * @returns {boolean} Whether user can manage users
   */
  canManageUsers() {
    return this.hasPermission('manage_users')
  }

  /**
   * Get time since last login
   * @returns {string} Human readable time since last login
   */
  getLastLoginDisplay() {
    if (!this.lastLogin) return 'Never'
    
    const now = new Date()
    const diff = now - this.lastLogin
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'Just now'
  }

  /**
   * Validate user data
   * @returns {Object} Validation result with isValid boolean and errors array
   */
  validate() {
    const errors = []

    // Email validation
    if (!this.email) {
      errors.push('Email is required')
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      errors.push('Email format is invalid')
    }

    // Name validation
    if (!this.name || this.name.trim().length < 2) {
      errors.push('Name must be at least 2 characters long')
    }

    // Role validation
    if (!Object.values(UserRole).includes(this.role)) {
      errors.push('Invalid user role')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Clone user instance
   * @returns {User} Cloned user instance
   */
  clone() {
    return new User({
      id: this.id,
      email: this.email,
      name: this.name,
      role: this.role,
      refreshToken: this.refreshToken,
      lastLogin: this.lastLogin,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      automations: [...this.automations],
      executions: [...this.executions]
    })
  }

  /**
   * Update user data
   * @param {Object} updates - Updates to apply
   * @returns {User} Updated user instance
   */
  update(updates) {
    const updatedUser = this.clone()
    Object.assign(updatedUser, updates)
    updatedUser.updatedAt = new Date()
    return updatedUser
  }

  /**
   * Get user initials for avatar display
   * @returns {string} User initials
   */
  getInitials() {
    const name = this.name || this.email
    return name
      .split(' ')
      .map(part => part.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('')
  }

  /**
   * Check if user account is active (has logged in recently)
   * @param {number} daysThreshold - Days threshold for activity (default: 30)
   * @returns {boolean} Whether user is active
   */
  isActive(daysThreshold = 30) {
    if (!this.lastLogin) return false
    
    const now = new Date()
    const daysSinceLogin = (now - this.lastLogin) / (1000 * 60 * 60 * 24)
    return daysSinceLogin <= daysThreshold
  }

  /**
   * Convert to JSON representation
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      email: this.email,
      name: this.name,
      role: this.role,
      lastLogin: this.lastLogin?.toISOString(),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      automations: this.automations,
      executions: this.executions
    }
  }
}

export default User