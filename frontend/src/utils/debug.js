/**
 * Debug Logging Utility
 * Provides configurable debug logging for development and troubleshooting
 */

// Check if debug mode is enabled
const isDebugEnabled = () => {
  return import.meta.env.VITE_DEBUG_LOGGING === 'true' || 
         import.meta.env.VITE_LOG_LEVEL === 'debug' ||
         import.meta.env.DEV
}

// Debug log levels
export const LogLevel = {
  ERROR: 'error',
  WARN: 'warn', 
  INFO: 'info',
  DEBUG: 'debug'
}

// Debug categories for filtering
export const DebugCategory = {
  AUTH: 'AUTH',
  API: 'API',
  ROUTER: 'ROUTER',
  WEBSOCKET: 'WEBSOCKET',
  STORE: 'STORE',
  COMPONENT: 'COMPONENT',
  SETTINGS: 'SETTINGS'
}

/**
 * Debug logger class
 */
class DebugLogger {
  constructor() {
    this.enabled = isDebugEnabled()
    this.enabledCategories = this.parseEnabledCategories()
  }

  parseEnabledCategories() {
    const categoriesEnv = import.meta.env.VITE_DEBUG_CATEGORIES
    if (!categoriesEnv) return Object.values(DebugCategory) // All categories by default
    
    return categoriesEnv.split(',').map(cat => cat.trim().toUpperCase())
  }

  shouldLog(category) {
    return this.enabled && (!category || this.enabledCategories.includes(category))
  }

  formatMessage(category, message, data) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
    const prefix = category ? `[${category}]` : ''
    return {
      prefix: `${timestamp} ${prefix}`,
      message,
      data
    }
  }

  log(level, category, message, data) {
    if (!this.shouldLog(category)) return

    const formatted = this.formatMessage(category, message, data)
    const logMethod = console[level] || console.log

    if (data !== undefined) {
      logMethod(`${formatted.prefix} ${formatted.message}`, data)
    } else {
      logMethod(`${formatted.prefix} ${formatted.message}`)
    }
  }

  // Convenience methods with emoji prefixes for easy identification
  progress(category, message, data) {
    if (!this.shouldLog(category)) return
    this.log('log', category, `🔄 ${message}`, data)
  }

  success(category, message, data) {
    if (!this.shouldLog(category)) return
    this.log('log', category, `✅ ${message}`, data)
  }

  error(category, message, data) {
    if (!this.shouldLog(category)) return
    this.log('error', category, `❌ ${message}`, data)
  }

  warn(category, message, data) {
    if (!this.shouldLog(category)) return
    this.log('warn', category, `⚠️ ${message}`, data)
  }

  info(category, message, data) {
    if (!this.shouldLog(category)) return
    this.log('info', category, `ℹ️ ${message}`, data)
  }

  // Toggle debug mode at runtime
  toggleDebug() {
    this.enabled = !this.enabled
    console.log(`Debug logging ${this.enabled ? 'enabled' : 'disabled'}`)
    return this.enabled
  }

  // Enable/disable specific categories
  toggleCategory(category) {
    const upperCategory = category.toUpperCase()
    const index = this.enabledCategories.indexOf(upperCategory)
    
    if (index > -1) {
      this.enabledCategories.splice(index, 1)
      console.log(`Debug category ${category} disabled`)
    } else {
      this.enabledCategories.push(upperCategory)
      console.log(`Debug category ${category} enabled`)
    }
    
    return this.enabledCategories.includes(upperCategory)
  }

  // Get current debug status
  getStatus() {
    return {
      enabled: this.enabled,
      categories: this.enabledCategories,
      environment: {
        VITE_DEBUG_LOGGING: import.meta.env.VITE_DEBUG_LOGGING,
        VITE_LOG_LEVEL: import.meta.env.VITE_LOG_LEVEL,
        VITE_DEBUG_CATEGORIES: import.meta.env.VITE_DEBUG_CATEGORIES,
        DEV: import.meta.env.DEV
      }
    }
  }
}

// Create singleton instance
const debugLogger = new DebugLogger()

// Export convenience functions
export const debugLog = {
  progress: (category, message, data) => debugLogger.progress(category, message, data),
  success: (category, message, data) => debugLogger.success(category, message, data),
  error: (category, message, data) => debugLogger.error(category, message, data),
  warn: (category, message, data) => debugLogger.warn(category, message, data),
  info: (category, message, data) => debugLogger.info(category, message, data),
  
  // Direct logging without category
  log: (message, data) => debugLogger.log('log', null, message, data),
  
  // Admin functions
  toggle: () => debugLogger.toggleDebug(),
  toggleCategory: (category) => debugLogger.toggleCategory(category),
  status: () => debugLogger.getStatus(),
  
  // Make logger instance available for advanced usage
  logger: debugLogger
}

// Make debug functions available globally in development
if (import.meta.env.DEV) {
  window.debugLog = debugLog
  console.log('🔧 Debug logging utilities available at window.debugLog')
  console.log('🔧 Try: debugLog.status(), debugLog.toggle(), debugLog.toggleCategory("AUTH")')
}

export default debugLog