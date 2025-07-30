/**
 * Execution Model
 * Represents an automation execution in the NetHelper Automation Platform
 */

// Execution status enumeration
export const ExecutionStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
}

// Execution status display information
export const ExecutionStatusInfo = {
  [ExecutionStatus.PENDING]: {
    label: 'Pending',
    color: 'info',
    icon: 'mdi-clock-outline',
    description: 'Execution is waiting to start'
  },
  [ExecutionStatus.RUNNING]: {
    label: 'Running',
    color: 'primary',
    icon: 'mdi-play-circle',
    description: 'Execution is currently running'
  },
  [ExecutionStatus.SUCCESS]: {
    label: 'Success',
    color: 'success',
    icon: 'mdi-check-circle',
    description: 'Execution completed successfully'
  },
  [ExecutionStatus.FAILED]: {
    label: 'Failed',
    color: 'error',
    icon: 'mdi-close-circle',
    description: 'Execution failed with errors'
  },
  [ExecutionStatus.CANCELLED]: {
    label: 'Cancelled',
    color: 'warning',
    icon: 'mdi-cancel',
    description: 'Execution was cancelled'
  }
}

// Execution trigger types
export const ExecutionTrigger = {
  MANUAL: 'manual',
  SCHEDULED: 'scheduled',
  EVENT: 'event',
  API: 'api'
}

export class Execution {
  constructor(data = {}) {
    this.id = data.id || null
    this.automationId = data.automationId || null
    this.deviceId = data.deviceId || null
    this.status = data.status || ExecutionStatus.PENDING
    this.startedAt = data.startedAt ? new Date(data.startedAt) : null
    this.completedAt = data.completedAt ? new Date(data.completedAt) : null
    this.duration = data.duration || null // Duration in milliseconds
    this.output = data.output || null
    this.error = data.error || null
    this.triggeredBy = data.triggeredBy || null
    this.userId = data.userId || null
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date()
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date()
    
    // Related data
    this.automation = data.automation || null
    this.device = data.device || null
    this.user = data.user || null
  }

  /**
   * Create Execution instance from API response
   * @param {Object} apiData - Raw data from API
   * @returns {Execution} Execution instance
   */
  static fromApiResponse(apiData) {
    return new Execution(apiData)
  }

  /**
   * Convert Execution instance to API payload
   * @returns {Object} API payload
   */
  toApiPayload() {
    return {
      automationId: this.automationId,
      deviceId: this.deviceId,
      status: this.status,
      startedAt: this.startedAt?.toISOString(),
      completedAt: this.completedAt?.toISOString(),
      duration: this.duration,
      output: this.output,
      error: this.error,
      triggeredBy: this.triggeredBy,
      userId: this.userId
    }
  }

  /**
   * Get execution status information
   * @returns {Object} Status information with label, color, icon, and description
   */
  getStatusInfo() {
    return ExecutionStatusInfo[this.status] || ExecutionStatusInfo[ExecutionStatus.PENDING]
  }

  /**
   * Check if execution is pending
   * @returns {boolean} Whether execution is pending
   */
  isPending() {
    return this.status === ExecutionStatus.PENDING
  }

  /**
   * Check if execution is running
   * @returns {boolean} Whether execution is running
   */
  isRunning() {
    return this.status === ExecutionStatus.RUNNING
  }

  /**
   * Check if execution is completed (success, failed, or cancelled)
   * @returns {boolean} Whether execution is completed
   */
  isCompleted() {
    return [ExecutionStatus.SUCCESS, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED].includes(this.status)
  }

  /**
   * Check if execution was successful
   * @returns {boolean} Whether execution was successful
   */
  isSuccessful() {
    return this.status === ExecutionStatus.SUCCESS
  }

  /**
   * Check if execution failed
   * @returns {boolean} Whether execution failed
   */
  isFailed() {
    return this.status === ExecutionStatus.FAILED
  }

  /**
   * Check if execution was cancelled
   * @returns {boolean} Whether execution was cancelled
   */
  isCancelled() {
    return this.status === ExecutionStatus.CANCELLED
  }

  /**
   * Get execution duration in human readable format
   * @returns {string} Human readable duration
   */
  getDurationDisplay() {
    if (!this.duration) {
      if (this.isRunning() && this.startedAt) {
        // Calculate current running time
        const runningTime = new Date() - this.startedAt
        return this.formatDuration(runningTime) + ' (running)'
      }
      return 'Unknown'
    }
    
    return this.formatDuration(this.duration)
  }

  /**
   * Format duration in milliseconds to human readable string
   * @param {number} milliseconds - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(milliseconds) {
    if (!milliseconds || milliseconds < 0) return '0s'
    
    const seconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  /**
   * Get time since execution started
   * @returns {string} Human readable time since start
   */
  getTimeSinceStart() {
    if (!this.startedAt) return 'Not started'
    
    const now = new Date()
    const diff = now - this.startedAt
    return this.formatDuration(diff) + ' ago'
  }

  /**
   * Get time since execution completed
   * @returns {string} Human readable time since completion
   */
  getTimeSinceCompletion() {
    if (!this.completedAt) return 'Not completed'
    
    const now = new Date()
    const diff = now - this.completedAt
    return this.formatDuration(diff) + ' ago'
  }

  /**
   * Get automation name (if automation data is available)
   * @returns {string} Automation name or ID
   */
  getAutomationName() {
    return this.automation?.name || this.automationId || 'Unknown Automation'
  }

  /**
   * Get device name (if device data is available)
   * @returns {string} Device name or ID
   */
  getDeviceName() {
    return this.device?.name || this.deviceId || 'No specific device'
  }

  /**
   * Get user name who triggered the execution
   * @returns {string} User name or ID
   */
  getTriggeredByName() {
    return this.user?.name || this.userId || 'System'
  }

  /**
   * Get execution progress percentage (if output contains progress info)
   * @returns {number} Progress percentage (0-100)
   */
  getProgress() {
    if (this.isCompleted()) return 100
    if (this.isPending()) return 0
    
    // Try to extract progress from output
    if (this.output && typeof this.output === 'object' && this.output.progress) {
      return Math.min(100, Math.max(0, this.output.progress))
    }
    
    // If running but no progress info, return indeterminate
    return this.isRunning() ? -1 : 0
  }

  /**
   * Get execution logs from output
   * @returns {Array} Array of log entries
   */
  getLogs() {
    if (!this.output) return []
    
    if (Array.isArray(this.output)) return this.output
    if (typeof this.output === 'object' && this.output.logs) return this.output.logs
    if (typeof this.output === 'string') return [{ message: this.output, timestamp: this.startedAt }]
    
    return []
  }

  /**
   * Get execution result summary
   * @returns {Object} Result summary
   */
  getResultSummary() {
    const summary = {
      status: this.getStatusInfo().label,
      duration: this.getDurationDisplay(),
      startTime: this.startedAt?.toLocaleString() || 'Not started',
      endTime: this.completedAt?.toLocaleString() || 'Not completed'
    }

    if (this.error) {
      summary.error = this.error
    }

    if (this.output && typeof this.output === 'object') {
      summary.outputSummary = {
        hasLogs: this.getLogs().length > 0,
        logCount: this.getLogs().length,
        hasProgress: 'progress' in this.output,
        keys: Object.keys(this.output)
      }
    }

    return summary
  }

  /**
   * Check if execution can be cancelled
   * @returns {boolean} Whether execution can be cancelled
   */
  canBeCancelled() {
    return [ExecutionStatus.PENDING, ExecutionStatus.RUNNING].includes(this.status)
  }

  /**
   * Check if execution can be retried
   * @returns {boolean} Whether execution can be retried
   */
  canBeRetried() {
    return [ExecutionStatus.FAILED, ExecutionStatus.CANCELLED].includes(this.status)
  }

  /**
   * Get execution performance rating based on duration and success
   * @returns {string} Performance rating (excellent, good, average, poor)
   */
  getPerformanceRating() {
    if (!this.isSuccessful() || !this.duration) return 'unknown'
    
    // These thresholds would be configurable in a real application
    if (this.duration < 30000) return 'excellent' // < 30 seconds
    if (this.duration < 120000) return 'good' // < 2 minutes
    if (this.duration < 300000) return 'average' // < 5 minutes
    return 'poor' // > 5 minutes
  }

  /**
   * Calculate execution efficiency score
   * @returns {number} Efficiency score (0-100)
   */
  getEfficiencyScore() {
    if (!this.isSuccessful()) return 0
    if (!this.duration) return 50 // Default if no duration available
    
    // Simple efficiency calculation based on duration
    // In a real application, this would consider more factors
    const maxDuration = 600000 // 10 minutes
    const efficiency = Math.max(0, (maxDuration - this.duration) / maxDuration * 100)
    return Math.round(efficiency)
  }

  /**
   * Validate execution data
   * @returns {Object} Validation result with isValid boolean and errors array
   */
  validate() {
    const errors = []

    // Automation ID validation
    if (!this.automationId) {
      errors.push('Automation ID is required')
    }

    // Status validation
    if (!Object.values(ExecutionStatus).includes(this.status)) {
      errors.push('Invalid execution status')
    }

    // Date validation
    if (this.startedAt && this.completedAt && this.startedAt > this.completedAt) {
      errors.push('Start time cannot be after completion time')
    }

    // Duration validation
    if (this.duration !== null && this.duration < 0) {
      errors.push('Duration cannot be negative')
    }

    // Status consistency validation
    if (this.isCompleted() && !this.completedAt) {
      errors.push('Completed executions must have a completion time')
    }

    if (this.isRunning() && !this.startedAt) {
      errors.push('Running executions must have a start time')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Clone execution instance
   * @returns {Execution} Cloned execution instance
   */
  clone() {
    return new Execution({
      id: this.id,
      automationId: this.automationId,
      deviceId: this.deviceId,
      status: this.status,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration: this.duration,
      output: this.output ? JSON.parse(JSON.stringify(this.output)) : null,
      error: this.error,
      triggeredBy: this.triggeredBy,
      userId: this.userId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      automation: this.automation,
      device: this.device,
      user: this.user
    })
  }

  /**
   * Update execution data
   * @param {Object} updates - Updates to apply
   * @returns {Execution} Updated execution instance
   */
  update(updates) {
    const updatedExecution = this.clone()
    Object.assign(updatedExecution, updates)
    updatedExecution.updatedAt = new Date()
    
    // Calculate duration if both start and completion times are available
    if (updatedExecution.startedAt && updatedExecution.completedAt && !updatedExecution.duration) {
      updatedExecution.duration = updatedExecution.completedAt - updatedExecution.startedAt
    }
    
    return updatedExecution
  }

  /**
   * Mark execution as started
   * @param {Date} startTime - Start time (default: now)
   * @returns {Execution} Updated execution instance
   */
  markAsStarted(startTime = new Date()) {
    return this.update({
      status: ExecutionStatus.RUNNING,
      startedAt: startTime
    })
  }

  /**
   * Mark execution as completed with success
   * @param {Object} output - Execution output
   * @param {Date} completionTime - Completion time (default: now)
   * @returns {Execution} Updated execution instance
   */
  markAsSuccessful(output = null, completionTime = new Date()) {
    return this.update({
      status: ExecutionStatus.SUCCESS,
      completedAt: completionTime,
      output,
      error: null
    })
  }

  /**
   * Mark execution as failed
   * @param {string} error - Error message
   * @param {Date} completionTime - Completion time (default: now)
   * @returns {Execution} Updated execution instance
   */
  markAsFailed(error, completionTime = new Date()) {
    return this.update({
      status: ExecutionStatus.FAILED,
      completedAt: completionTime,
      error
    })
  }

  /**
   * Mark execution as cancelled
   * @param {Date} completionTime - Completion time (default: now)
   * @returns {Execution} Updated execution instance
   */
  markAsCancelled(completionTime = new Date()) {
    return this.update({
      status: ExecutionStatus.CANCELLED,
      completedAt: completionTime
    })
  }

  /**
   * Get execution summary for quick display
   * @returns {Object} Execution summary
   */
  getSummary() {
    return {
      id: this.id,
      automationName: this.getAutomationName(),
      deviceName: this.getDeviceName(),
      status: this.getStatusInfo().label,
      duration: this.getDurationDisplay(),
      startedAt: this.startedAt?.toISOString(),
      completedAt: this.completedAt?.toISOString(),
      triggeredBy: this.getTriggeredByName(),
      progress: this.getProgress(),
      canBeCancelled: this.canBeCancelled(),
      canBeRetried: this.canBeRetried(),
      performanceRating: this.getPerformanceRating(),
      efficiencyScore: this.getEfficiencyScore()
    }
  }

  /**
   * Convert to JSON representation
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      automationId: this.automationId,
      deviceId: this.deviceId,
      status: this.status,
      startedAt: this.startedAt?.toISOString(),
      completedAt: this.completedAt?.toISOString(),
      duration: this.duration,
      output: this.output,
      error: this.error,
      triggeredBy: this.triggeredBy,
      userId: this.userId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      automation: this.automation,
      device: this.device,
      user: this.user
    }
  }
}

export default Execution