/**
 * Debug Logging Utility for Backend Services
 * Provides configurable debug logging with service-specific controls
 * Based on frontend debug.js but adapted for Node.js backend
 */

const winston = require('winston');
const path = require('path');

// Debug log levels
const LogLevel = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};

// Backend service categories for filtering
const ServiceCategory = {
  AUTH: 'AUTH',
  ARUBA_CENTRAL: 'ARUBA_CENTRAL',
  DEVICE: 'DEVICE',
  AUTOMATION: 'AUTOMATION',
  NOTIFICATION: 'NOTIFICATION',
  DATABASE: 'DATABASE',
  WEBSOCKET: 'WEBSOCKET',
  API: 'API',
  MIDDLEWARE: 'MIDDLEWARE',
  JOBS: 'JOBS',
  REDIS: 'REDIS'
};

/**
 * Service-aware debug logger class
 */
class ServiceDebugLogger {
  constructor() {
    this.globalLogLevel = process.env.LOG_LEVEL || 'info';
    this.serviceLogLevels = this.parseServiceLogLevels();
    this.enabledServices = this.parseEnabledServices();
    this.winston = this.createWinstonLogger();
  }

  createWinstonLogger() {
    const logDir = 'logs';
    
    const logger = winston.createLogger({
      level: this.globalLogLevel,
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss.SSS',
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.printf(({ timestamp, level, message, service, requestId, ...meta }) => {
          const servicePrefix = service ? `[${service}]` : '';
          const requestPrefix = requestId ? `[${requestId}]` : '';
          const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level.toUpperCase()} ${servicePrefix}${requestPrefix} ${message}${metaStr}`;
        })
      ),
      defaultMeta: { service: 'nethelper-backend' },
      transports: [
        // Write all logs with level 'error' and below to error.log
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
        }),
        // Write all logs to combined.log
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
        }),
      ],
    });

    // Add console transport in non-production
    if (process.env.NODE_ENV !== 'production') {
      logger.add(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, service, requestId, ...meta }) => {
              const time = timestamp.split(' ')[1]; // Just the time part
              const servicePrefix = service ? `[${service}]` : '';
              const requestPrefix = requestId ? `[${requestId}]` : '';
              const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta, null, 2)}` : '';
              return `${time} ${level} ${servicePrefix}${requestPrefix} ${message}${metaStr}`;
            })
          ),
        })
      );
    }
    
    return logger;
  }

  parseServiceLogLevels() {
    const serviceLevels = {};
    const serviceLevelsEnv = process.env.SERVICE_LOG_LEVELS;
    
    if (serviceLevelsEnv) {
      // Format: "ARUBA_CENTRAL:debug,AUTH:warn,DEVICE:info"
      serviceLevelsEnv.split(',').forEach(serviceLevel => {
        const [service, level] = serviceLevel.split(':').map(s => s.trim());
        if (service && level) {
          serviceLevels[service.toUpperCase()] = level.toLowerCase();
        }
      });
    }
    
    return serviceLevels;
  }

  parseEnabledServices() {
    const servicesEnv = process.env.DEBUG_SERVICES;
    if (!servicesEnv) return Object.values(ServiceCategory); // All services by default
    
    return servicesEnv.split(',').map(service => service.trim().toUpperCase());
  }

  shouldLog(service, level) {
    // Check if service is enabled
    if (service && !this.enabledServices.includes(service)) {
      return false;
    }

    // Get effective log level for this service
    const effectiveLevel = service && this.serviceLogLevels[service] 
      ? this.serviceLogLevels[service] 
      : this.globalLogLevel;

    // Check if level meets threshold
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    return levels[level] <= levels[effectiveLevel];
  }

  formatMessage(service, message, data, requestId) {
    const meta = { 
      ...(service && { service }),
      ...(requestId && { requestId }),
      ...(data && typeof data === 'object' && { ...data })
    };
    
    return { message, meta };
  }

  log(level, service, message, data, requestId) {
    if (!this.shouldLog(service, level)) return;

    const { message: formattedMessage, meta } = this.formatMessage(service, message, data, requestId);
    this.winston.log(level, formattedMessage, meta);
  }

  // Convenience methods with emoji prefixes for easy identification
  progress(service, message, data, requestId) {
    this.log('info', service, `🔄 ${message}`, data, requestId);
  }

  success(service, message, data, requestId) {
    this.log('info', service, `✅ ${message}`, data, requestId);
  }

  error(service, message, data, requestId) {
    this.log('error', service, `❌ ${message}`, data, requestId);
  }

  warn(service, message, data, requestId) {
    this.log('warn', service, `⚠️ ${message}`, data, requestId);
  }

  info(service, message, data, requestId) {
    this.log('info', service, `ℹ️ ${message}`, data, requestId);
  }

  debug(service, message, data, requestId) {
    this.log('debug', service, `🔍 ${message}`, data, requestId);
  }

  // Create service-specific logger
  createServiceLogger(serviceName) {
    const upperServiceName = serviceName.toUpperCase();
    return {
      progress: (message, data, requestId) => this.progress(upperServiceName, message, data, requestId),
      success: (message, data, requestId) => this.success(upperServiceName, message, data, requestId),
      error: (message, data, requestId) => this.error(upperServiceName, message, data, requestId),
      warn: (message, data, requestId) => this.warn(upperServiceName, message, data, requestId),
      info: (message, data, requestId) => this.info(upperServiceName, message, data, requestId),
      debug: (message, data, requestId) => this.debug(upperServiceName, message, data, requestId),
      
      // Direct winston access for special cases
      raw: (level, message, data) => this.winston.log(level, message, { service: upperServiceName, ...data })
    };
  }

  // Runtime configuration methods
  setServiceLogLevel(service, level) {
    this.serviceLogLevels[service.toUpperCase()] = level.toLowerCase();
    console.log(`Service ${service} log level set to ${level}`);
  }

  enableService(service) {
    const upperService = service.toUpperCase();
    if (!this.enabledServices.includes(upperService)) {
      this.enabledServices.push(upperService);
      console.log(`Service ${service} logging enabled`);
    }
  }

  disableService(service) {
    const upperService = service.toUpperCase();
    const index = this.enabledServices.indexOf(upperService);
    if (index > -1) {
      this.enabledServices.splice(index, 1);
      console.log(`Service ${service} logging disabled`);
    }
  }

  // Get current configuration status
  getStatus() {
    return {
      globalLogLevel: this.globalLogLevel,
      serviceLogLevels: this.serviceLogLevels,
      enabledServices: this.enabledServices,
      availableServices: Object.values(ServiceCategory),
      environment: {
        LOG_LEVEL: process.env.LOG_LEVEL,
        SERVICE_LOG_LEVELS: process.env.SERVICE_LOG_LEVELS,
        DEBUG_SERVICES: process.env.DEBUG_SERVICES,
        NODE_ENV: process.env.NODE_ENV
      }
    };
  }
}

// Create singleton instance
const serviceDebugLogger = new ServiceDebugLogger();

// Export service categories for use in services
const Services = ServiceCategory;

// Export convenience functions and service logger factory
const debugLog = {
  // Direct logging methods
  progress: (service, message, data, requestId) => serviceDebugLogger.progress(service, message, data, requestId),
  success: (service, message, data, requestId) => serviceDebugLogger.success(service, message, data, requestId),
  error: (service, message, data, requestId) => serviceDebugLogger.error(service, message, data, requestId),
  warn: (service, message, data, requestId) => serviceDebugLogger.warn(service, message, data, requestId),
  info: (service, message, data, requestId) => serviceDebugLogger.info(service, message, data, requestId),
  debug: (service, message, data, requestId) => serviceDebugLogger.debug(service, message, data, requestId),
  
  // Create service-specific logger
  createLogger: (serviceName) => serviceDebugLogger.createServiceLogger(serviceName),
  
  // Admin functions
  setServiceLogLevel: (service, level) => serviceDebugLogger.setServiceLogLevel(service, level),
  enableService: (service) => serviceDebugLogger.enableService(service),
  disableService: (service) => serviceDebugLogger.disableService(service),
  status: () => serviceDebugLogger.getStatus(),
  
  // Access to winston instance for special cases
  winston: serviceDebugLogger.winston,
  
  // Make logger instance available for advanced usage
  logger: serviceDebugLogger
};

module.exports = {
  debugLog,
  Services,
  LogLevel,
  ServiceDebugLogger
};