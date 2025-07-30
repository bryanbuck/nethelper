/**
 * Models Index
 * Central export point for all data models in the NetHelper Automation Platform
 */

// Import all models
import User, { UserRole, UserRoleInfo } from './User.js'
import Device, { DeviceType, DeviceStatus, DeviceTypeInfo, DeviceStatusInfo } from './Device.js'
import Automation, { 
  AutomationType, 
  AutomationTypeInfo, 
  WorkflowNodeType, 
  DefaultWorkflow 
} from './Automation.js'
import Schedule, { 
  CommonCronExpressions, 
  CronExpressionLabels, 
  CommonTimezones 
} from './Schedule.js'
import Execution, { 
  ExecutionStatus, 
  ExecutionStatusInfo, 
  ExecutionTrigger 
} from './Execution.js'
import DeviceGroup from './DeviceGroup.js'
import AuditLog, { 
  AuditAction, 
  AuditEntity, 
  AuditSeverity, 
  AuditCategory, 
  AuditActionInfo 
} from './AuditLog.js'

// Export all models as named exports
export {
  // Core models
  User,
  Device,
  Automation,
  Schedule,
  Execution,
  DeviceGroup,
  AuditLog,
  
  // User-related enums and constants
  UserRole,
  UserRoleInfo,
  
  // Device-related enums and constants
  DeviceType,
  DeviceStatus,
  DeviceTypeInfo,
  DeviceStatusInfo,
  
  // Automation-related enums and constants
  AutomationType,
  AutomationTypeInfo,
  WorkflowNodeType,
  DefaultWorkflow,
  
  // Schedule-related enums and constants
  CommonCronExpressions,
  CronExpressionLabels,
  CommonTimezones,
  
  // Execution-related enums and constants
  ExecutionStatus,
  ExecutionStatusInfo,
  ExecutionTrigger,
  
  // Audit-related enums and constants
  AuditAction,
  AuditEntity,
  AuditSeverity,
  AuditCategory,
  AuditActionInfo
}

// Export models as default object for convenience
export default {
  User,
  Device,
  Automation,
  Schedule,
  Execution,
  DeviceGroup,
  AuditLog,
  
  // Grouped constants
  constants: {
    user: {
      roles: UserRole,
      roleInfo: UserRoleInfo
    },
    device: {
      types: DeviceType,
      statuses: DeviceStatus,
      typeInfo: DeviceTypeInfo,
      statusInfo: DeviceStatusInfo
    },
    automation: {
      types: AutomationType,
      typeInfo: AutomationTypeInfo,
      nodeTypes: WorkflowNodeType,
      defaultWorkflow: DefaultWorkflow
    },
    schedule: {
      commonCrons: CommonCronExpressions,
      cronLabels: CronExpressionLabels,
      timezones: CommonTimezones
    },
    execution: {
      statuses: ExecutionStatus,
      statusInfo: ExecutionStatusInfo,
      triggers: ExecutionTrigger
    },
    audit: {
      actions: AuditAction,
      entities: AuditEntity,
      severity: AuditSeverity,
      categories: AuditCategory,
      actionInfo: AuditActionInfo
    }
  },
  
  // Utility functions for model creation
  utils: {
    /**
     * Create model instance from API response
     * @param {string} modelType - Type of model to create
     * @param {Object} apiData - Raw API data
     * @returns {Object} Model instance
     */
    fromApiResponse(modelType, apiData) {
      const models = {
        User,
        Device,
        Automation,
        Schedule,
        Execution,
        DeviceGroup,
        AuditLog
      }
      
      const ModelClass = models[modelType]
      if (!ModelClass) {
        throw new Error(`Unknown model type: ${modelType}`)
      }
      
      return ModelClass.fromApiResponse(apiData)
    },
    
    /**
     * Create multiple model instances from API response array
     * @param {string} modelType - Type of model to create
     * @param {Array} apiDataArray - Array of raw API data
     * @returns {Array} Array of model instances
     */
    fromApiResponseArray(modelType, apiDataArray) {
      if (!Array.isArray(apiDataArray)) {
        throw new Error('API data must be an array')
      }
      
      return apiDataArray.map(apiData => this.fromApiResponse(modelType, apiData))
    },
    
    /**
     * Validate model data
     * @param {Object} modelInstance - Model instance to validate
     * @returns {Object} Validation result
     */
    validate(modelInstance) {
      if (!modelInstance || typeof modelInstance.validate !== 'function') {
        return {
          isValid: false,
          errors: ['Invalid model instance or missing validate method']
        }
      }
      
      return modelInstance.validate()
    },
    
    /**
     * Convert model instance to API payload
     * @param {Object} modelInstance - Model instance to convert
     * @returns {Object} API payload
     */
    toApiPayload(modelInstance) {
      if (!modelInstance || typeof modelInstance.toApiPayload !== 'function') {
        throw new Error('Invalid model instance or missing toApiPayload method')
      }
      
      return modelInstance.toApiPayload()
    }
  }
}