/**
 * Schedule Model
 * Represents a schedule for automation execution in the Aruba Central Automation Platform
 */

import { parse } from 'cron-parser'

// Common cron expressions
export const CommonCronExpressions = {
  EVERY_MINUTE: '* * * * *',
  EVERY_5_MINUTES: '*/5 * * * *',
  EVERY_15_MINUTES: '*/15 * * * *',
  EVERY_30_MINUTES: '*/30 * * * *',
  HOURLY: '0 * * * *',
  EVERY_2_HOURS: '0 */2 * * *',
  EVERY_6_HOURS: '0 */6 * * *',
  EVERY_12_HOURS: '0 */12 * * *',
  DAILY: '0 0 * * *',
  DAILY_AT_NOON: '0 12 * * *',
  WEEKLY: '0 0 * * 0',
  MONTHLY: '0 0 1 * *',
  YEARLY: '0 0 1 1 *'
}

// Cron expression display names
export const CronExpressionLabels = {
  [CommonCronExpressions.EVERY_MINUTE]: 'Every minute',
  [CommonCronExpressions.EVERY_5_MINUTES]: 'Every 5 minutes',
  [CommonCronExpressions.EVERY_15_MINUTES]: 'Every 15 minutes',
  [CommonCronExpressions.EVERY_30_MINUTES]: 'Every 30 minutes',
  [CommonCronExpressions.HOURLY]: 'Every hour',
  [CommonCronExpressions.EVERY_2_HOURS]: 'Every 2 hours',
  [CommonCronExpressions.EVERY_6_HOURS]: 'Every 6 hours',
  [CommonCronExpressions.EVERY_12_HOURS]: 'Every 12 hours',
  [CommonCronExpressions.DAILY]: 'Daily at midnight',
  [CommonCronExpressions.DAILY_AT_NOON]: 'Daily at noon',
  [CommonCronExpressions.WEEKLY]: 'Weekly on Sunday',
  [CommonCronExpressions.MONTHLY]: 'Monthly on 1st',
  [CommonCronExpressions.YEARLY]: 'Yearly on Jan 1st'
}

// Common timezones
export const CommonTimezones = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney'
]

export class Schedule {
  constructor(data = {}) {
    this.id = data.id || null
    this.automationId = data.automationId || null
    this.cronExpression = data.cronExpression || CommonCronExpressions.DAILY
    this.timezone = data.timezone || 'UTC'
    this.active = data.active !== undefined ? data.active : true
    this.nextRun = data.nextRun ? new Date(data.nextRun) : null
    this.lastRun = data.lastRun ? new Date(data.lastRun) : null
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date()
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date()
    
    // Related data
    this.automation = data.automation || null
  }

  /**
   * Create Schedule instance from API response
   * @param {Object} apiData - Raw data from API
   * @returns {Schedule} Schedule instance
   */
  static fromApiResponse(apiData) {
    return new Schedule(apiData)
  }

  /**
   * Convert Schedule instance to API payload
   * @returns {Object} API payload
   */
  toApiPayload() {
    return {
      automationId: this.automationId,
      cronExpression: this.cronExpression,
      timezone: this.timezone,
      active: this.active
    }
  }

  /**
   * Check if schedule is active
   * @returns {boolean} Whether schedule is active
   */
  isActive() {
    return this.active
  }

  /**
   * Get human-readable description of cron expression
   * @returns {string} Cron expression description
   */
  getCronDescription() {
    // Check if it's a common expression
    if (CronExpressionLabels[this.cronExpression]) {
      return CronExpressionLabels[this.cronExpression]
    }

    // Parse the cron expression to generate description
    try {
      const parts = this.cronExpression.split(' ')
      if (parts.length !== 5) {
        return 'Custom schedule'
      }

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

      let description = 'Runs '

      // Handle frequency
      if (minute === '*' && hour === '*') {
        description += 'every minute'
      } else if (hour === '*') {
        if (minute.includes('/')) {
          const interval = minute.split('/')[1]
          description += `every ${interval} minutes`
        } else if (minute === '0') {
          description += 'every hour'
        } else {
          description += `at ${minute} minutes past every hour`
        }
      } else if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        description += `daily at ${hour}:${minute.padStart(2, '0')}`
      } else if (dayOfWeek !== '*') {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        if (dayOfWeek.includes(',')) {
          const dayNames = dayOfWeek.split(',').map(d => days[parseInt(d)]).join(', ')
          description += `weekly on ${dayNames} at ${hour}:${minute.padStart(2, '0')}`
        } else {
          description += `weekly on ${days[parseInt(dayOfWeek)]} at ${hour}:${minute.padStart(2, '0')}`
        }
      } else if (dayOfMonth !== '*') {
        description += `monthly on day ${dayOfMonth} at ${hour}:${minute.padStart(2, '0')}`
      } else {
        description += 'custom schedule'
      }

      return description
    } catch (error) {
      return 'Invalid schedule'
    }
  }

  /**
   * Calculate next run time based on cron expression
   * @returns {Date|null} Next run time or null if invalid
   */
  calculateNextRun() {
    try {
      const options = {
        tz: this.timezone
      }
      const interval = parse(this.cronExpression, options)
      return interval.next().toDate()
    } catch (error) {
      console.error('Error calculating next run:', error)
      return null
    }
  }

  /**
   * Calculate next few run times
   * @param {number} count - Number of next runs to calculate (default: 5)
   * @returns {Date[]} Array of next run times
   */
  calculateNextRuns(count = 5) {
    try {
      const options = {
        tz: this.timezone
      }
      const interval = parse(this.cronExpression, options)
      const nextRuns = []
      
      for (let i = 0; i < count; i++) {
        nextRuns.push(interval.next().toDate())
      }
      
      return nextRuns
    } catch (error) {
      console.error('Error calculating next runs:', error)
      return []
    }
  }

  /**
   * Check if cron expression is valid
   * @returns {boolean} Whether cron expression is valid
   */
  isValidCronExpression() {
    try {
      parse(this.cronExpression)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Get time until next run
   * @returns {string} Human readable time until next run
   */
  getTimeUntilNextRun() {
    if (!this.nextRun) return 'Unknown'
    
    const now = new Date()
    const diff = this.nextRun - now
    
    if (diff <= 0) return 'Overdue'
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  /**
   * Get time since last run
   * @returns {string} Human readable time since last run
   */
  getTimeSinceLastRun() {
    if (!this.lastRun) return 'Never'
    
    const now = new Date()
    const diff = now - this.lastRun
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'Just now'
  }

  /**
   * Get schedule frequency category
   * @returns {string} Frequency category (minute, hourly, daily, weekly, monthly, yearly, custom)
   */
  getFrequencyCategory() {
    const parts = this.cronExpression.split(' ')
    if (parts.length !== 5) return 'custom'
    
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
    
    if (minute.includes('*') && hour.includes('*')) return 'minute'
    if (hour.includes('*')) return 'hourly'
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return 'daily'
    if (dayOfWeek !== '*') return 'weekly'
    if (dayOfMonth !== '*') return 'monthly'
    if (month !== '*') return 'yearly'
    
    return 'custom'
  }

  /**
   * Check if schedule should run soon (within next hour)
   * @returns {boolean} Whether schedule runs within next hour
   */
  runsSoon() {
    if (!this.nextRun) return false
    
    const now = new Date()
    const oneHour = 60 * 60 * 1000
    return (this.nextRun - now) <= oneHour
  }

  /**
   * Validate schedule data
   * @returns {Object} Validation result with isValid boolean and errors array
   */
  validate() {
    const errors = []

    // Automation ID validation
    if (!this.automationId) {
      errors.push('Automation ID is required')
    }

    // Cron expression validation
    if (!this.cronExpression) {
      errors.push('Cron expression is required')
    } else if (!this.isValidCronExpression()) {
      errors.push('Invalid cron expression format')
    }

    // Timezone validation
    if (!this.timezone) {
      errors.push('Timezone is required')
    } else {
      try {
        // Test if timezone is valid by creating a date with it
        new Date().toLocaleString('en-US', { timeZone: this.timezone })
      } catch (error) {
        errors.push('Invalid timezone')
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Clone schedule instance
   * @returns {Schedule} Cloned schedule instance
   */
  clone() {
    return new Schedule({
      id: this.id,
      automationId: this.automationId,
      cronExpression: this.cronExpression,
      timezone: this.timezone,
      active: this.active,
      nextRun: this.nextRun,
      lastRun: this.lastRun,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      automation: this.automation
    })
  }

  /**
   * Update schedule data
   * @param {Object} updates - Updates to apply
   * @returns {Schedule} Updated schedule instance
   */
  update(updates) {
    const updatedSchedule = this.clone()
    Object.assign(updatedSchedule, updates)
    updatedSchedule.updatedAt = new Date()
    
    // Recalculate next run if cron expression or timezone changed
    if (updates.cronExpression || updates.timezone) {
      updatedSchedule.nextRun = updatedSchedule.calculateNextRun()
    }
    
    return updatedSchedule
  }

  /**
   * Toggle schedule active status
   * @returns {Schedule} Updated schedule instance
   */
  toggleActive() {
    return this.update({ active: !this.active })
  }

  /**
   * Update last run time
   * @param {Date} lastRun - Last run time (default: now)
   * @returns {Schedule} Updated schedule instance
   */
  updateLastRun(lastRun = new Date()) {
    const nextRun = this.calculateNextRun()
    return this.update({ lastRun, nextRun })
  }

  /**
   * Get schedule status based on active state and next run
   * @returns {Object} Status with label and color
   */
  getStatus() {
    if (!this.active) {
      return { label: 'Inactive', color: 'grey' }
    }
    
    if (!this.nextRun) {
      return { label: 'Error', color: 'error' }
    }
    
    const now = new Date()
    if (this.nextRun < now) {
      return { label: 'Overdue', color: 'warning' }
    }
    
    if (this.runsSoon()) {
      return { label: 'Runs Soon', color: 'info' }
    }
    
    return { label: 'Scheduled', color: 'success' }
  }

  /**
   * Get schedule summary for quick display
   * @returns {Object} Schedule summary
   */
  getSummary() {
    return {
      id: this.id,
      cronDescription: this.getCronDescription(),
      timezone: this.timezone,
      active: this.active,
      nextRun: this.nextRun?.toISOString(),
      lastRun: this.lastRun?.toISOString(),
      timeUntilNextRun: this.getTimeUntilNextRun(),
      timeSinceLastRun: this.getTimeSinceLastRun(),
      frequencyCategory: this.getFrequencyCategory(),
      status: this.getStatus()
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
      cronExpression: this.cronExpression,
      timezone: this.timezone,
      active: this.active,
      nextRun: this.nextRun?.toISOString(),
      lastRun: this.lastRun?.toISOString(),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      automation: this.automation
    }
  }
}

export default Schedule