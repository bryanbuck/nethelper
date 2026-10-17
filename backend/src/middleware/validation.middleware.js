const { body, param, query, validationResult } = require('express-validator');
const { VENDORS, PLATFORMS } = require('../constants/vendors');
const { ALERT_RULES, SEVERITIES, MAX_SETTLE_SECONDS } = require('../constants/alert-rules');

const DEVICE_TYPES = ['access_point', 'switch', 'gateway', 'controller', 'other'];
const VENDOR_IDS = Object.keys(VENDORS);
const PLATFORM_IDS = Object.keys(PLATFORMS);

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
  next();
};

// Device validation rules
const validateDevice = {
  updateConfiguration: [
    param('deviceId').isUUID().withMessage('Invalid device ID'),
    body('configuration').isObject().withMessage('Configuration must be an object'),
    handleValidationErrors,
  ],

  executeCommand: [
    param('deviceId').isUUID().withMessage('Invalid device ID'),
    body('command').trim().isLength({ min: 1 }).withMessage('Command is required'),
    handleValidationErrors,
  ],

  merge: [
    body('targetId').isUUID().withMessage('Invalid device ID to keep'),
    body('sourceIds').isArray({ min: 1, max: 20 }).withMessage('sourceIds must list the devices to merge'),
    body('sourceIds.*').isUUID().withMessage('Invalid device ID to merge'),
    body('identityFrom').optional({ values: 'null' }).isUUID().withMessage('Invalid identityFrom device ID'),
    handleValidationErrors,
  ],

  assignCredential: [
    body('deviceIds').isArray({ min: 1, max: 500 }).withMessage('deviceIds must list 1 to 500 devices'),
    body('deviceIds.*').isUUID().withMessage('Invalid device ID'),
    body('apiCredentialId').optional({ values: 'null' }).isUUID().withMessage('Invalid credential ID'),
    handleValidationErrors,
  ],

  create: [
    body('name').trim().isLength({ min: 1 }).withMessage('Device name is required'),
    body('type').isIn(DEVICE_TYPES).withMessage('Invalid device type'),
    body('vendor').optional().isIn(VENDOR_IDS).withMessage('Invalid vendor'),
    body('platform').optional({ nullable: true }).isIn(PLATFORM_IDS).withMessage('Invalid platform'),
    body('ipAddress').trim().isIP().withMessage('IP address is required and must be valid'),
    body('serial').optional({ values: 'null' }).trim(),
    body('model').optional().trim(),
    body('macAddress').optional().isMACAddress().withMessage('Invalid MAC address'),
    body('location').optional().trim(),
    body('managementMode').optional().isIn(['cloud', 'direct']).withMessage('Invalid management mode'),
    body('cloudIntegrationId').optional({ nullable: true }).isUUID().withMessage('Invalid cloud integration ID'),
    body('apiCredentialId').optional({ nullable: true }).isUUID().withMessage('Invalid credential ID'),
    handleValidationErrors,
  ],

  update: [
    param('deviceId').isUUID().withMessage('Invalid device ID'),
    body('name').optional().trim().isLength({ min: 1 }),
    body('type').optional().isIn(DEVICE_TYPES),
    body('vendor').optional().isIn(VENDOR_IDS).withMessage('Invalid vendor'),
    body('platform').optional({ nullable: true }).isIn(PLATFORM_IDS).withMessage('Invalid platform'),
    body('model').optional().trim(),
    body('ipAddress').optional().isIP(),
    body('macAddress').optional().isMACAddress(),
    body('location').optional().trim(),
    body('status').optional().isIn(['online', 'offline', 'warning', 'maintenance']),
    body('managementMode').optional().isIn(['cloud', 'direct']).withMessage('Invalid management mode'),
    body('cloudIntegrationId').optional({ nullable: true }).isUUID().withMessage('Invalid cloud integration ID'),
    body('apiCredentialId').optional({ nullable: true }).isUUID().withMessage('Invalid credential ID'),
    handleValidationErrors,
  ],
};

// Automation validation rules
const validateAutomation = {
  create: [
    body('name').trim().isLength({ min: 1 }).withMessage('Automation name is required'),
    body('type').isIn(['configuration_backup', 'firmware_update', 'compliance_check', 'custom_script', 'monitoring_alert']).withMessage('Invalid automation type'),
    body('workflow').isObject().withMessage('Workflow must be an object'),
    body('description').optional().trim(),
    body('deviceGroupIds').optional().isArray().withMessage('Device group IDs must be an array'),
    handleValidationErrors,
  ],

  update: [
    param('automationId').isUUID().withMessage('Invalid automation ID'),
    body('name').optional().trim().isLength({ min: 1 }),
    body('type').optional().isIn(['configuration_backup', 'firmware_update', 'compliance_check', 'custom_script', 'monitoring_alert']),
    body('workflow').optional().isObject(),
    body('description').optional().trim(),
    body('active').optional().isBoolean(),
    body('deviceGroupIds').optional().isArray(),
    handleValidationErrors,
  ],

  execute: [
    param('automationId').isUUID().withMessage('Invalid automation ID'),
    body('deviceIds').optional().isArray().withMessage('Device IDs must be an array'),
    handleValidationErrors,
  ],
};

// Schedule validation rules
const validateSchedule = {
  create: [
    body('automationId').isUUID().withMessage('Valid automation ID is required'),
    body('cronExpression').trim().isLength({ min: 1 }).withMessage('Cron expression is required'),
    body('timezone').optional().trim().isLength({ min: 1 }),
    handleValidationErrors,
  ],

  update: [
    param('scheduleId').isUUID().withMessage('Invalid schedule ID'),
    body('cronExpression').optional().trim().isLength({ min: 1 }),
    body('timezone').optional().trim().isLength({ min: 1 }),
    body('active').optional().isBoolean(),
    handleValidationErrors,
  ],
};

// Device Group validation rules
const validateDeviceGroup = {
  create: [
    body('name').trim().isLength({ min: 1 }).withMessage('Group name is required'),
    body('description').optional().trim(),
    body('deviceIds').optional().isArray().withMessage('Device IDs must be an array'),
    handleValidationErrors,
  ],

  update: [
    param('groupId').isUUID().withMessage('Invalid group ID'),
    body('name').optional().trim().isLength({ min: 1 }),
    body('description').optional().trim(),
    body('deviceIds').optional().isArray(),
    handleValidationErrors,
  ],
};

// Query validation rules
const validateQuery = {
  pagination: [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    handleValidationErrors,
  ],

  deviceFilters: [
    query('type').optional().isIn(['access_point', 'switch', 'gateway']),
    query('status').optional().isIn(['online', 'offline', 'warning', 'maintenance']),
    query('location').optional().trim(),
    query('search').optional().trim(),
    handleValidationErrors,
  ],

  executionFilters: [
    query('status').optional().isIn(['pending', 'running', 'success', 'failed', 'cancelled']),
    query('automationId').optional().isUUID(),
    query('deviceId').optional().isUUID(),
    handleValidationErrors,
  ],
};

// API Credential validation rules
const validateApiCredential = {
  create: [
    body('name').trim().isLength({ min: 1, max: 255 }).withMessage('Credential name is required (max 255 characters)'),
    body('type').isIn(['switch', 'ap', 'gateway', 'controller', 'other']).withMessage('Invalid credential type'),
    body('deviceId').optional().isUUID().withMessage('Invalid device ID'),
    body('username').optional().trim(),
    body('password').optional().trim(),
    body('apiKey').optional().trim(),
    body('apiSecret').optional().trim(),
    body('notes').optional().trim(),
    body('metadata').optional().isObject().withMessage('Metadata must be an object'),
    handleValidationErrors,
  ],

  update: [
    param('id').isUUID().withMessage('Invalid credential ID'),
    body('name').optional().trim().isLength({ min: 1, max: 255 }),
    body('type').optional().isIn(['switch', 'ap', 'gateway', 'controller', 'other']),
    body('deviceId').optional().isUUID(),
    body('username').optional().trim(),
    body('password').optional().trim(),
    body('apiKey').optional().trim(),
    body('apiSecret').optional().trim(),
    body('notes').optional().trim(),
    body('metadata').optional().isObject(),
    handleValidationErrors,
  ],
};

// Discovery validation rules
const validateDiscovery = {
  scan: [
    body('subnets').optional().isArray().withMessage('Subnets must be an array'),
    body('subnets.*').optional().trim().matches(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/).withMessage('Subnets must be CIDR strings'),
    handleValidationErrors,
  ],

  scanId: [
    param('scanId').isUUID().withMessage('Invalid scan ID'),
    handleValidationErrors,
  ],

  discoveredId: [
    param('discoveredId').isUUID().withMessage('Invalid discovered device ID'),
    handleValidationErrors,
  ],

  importDevice: [
    param('discoveredId').isUUID().withMessage('Invalid discovered device ID'),
    body('name').optional().trim().isLength({ min: 1 }),
    body('type').optional().isIn(['access_point', 'switch', 'gateway']),
    body('serial').optional().trim().isLength({ min: 1 }),
    body('model').optional().trim(),
    body('location').optional().trim(),
    body('apiCredentialId').optional({ nullable: true }).isUUID().withMessage('Invalid credential ID'),
    body('updateExisting').optional().isBoolean(),
    handleValidationErrors,
  ],
};

// Config backup validation rules
const validateBackup = {
  list: [
    query('deviceId').optional().isUUID(),
    query('scheduleId').optional().isUUID(),
    query('status').optional().isIn(['pending', 'running', 'success', 'failed']),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    handleValidationErrors,
  ],

  run: [
    body('deviceIds').isArray({ min: 1 }).withMessage('At least one device ID is required'),
    body('deviceIds.*').isUUID().withMessage('Device IDs must be UUIDs'),
    handleValidationErrors,
  ],

  backupId: [
    param('backupId').isUUID().withMessage('Invalid backup ID'),
    handleValidationErrors,
  ],

  // content / download: optional artifact kind (default: the primary)
  content: [
    param('backupId').isUUID().withMessage('Invalid backup ID'),
    query('kind').optional().isIn(['cli', 'structured']).withMessage('kind must be cli or structured'),
    handleValidationErrors,
  ],

  diff: [
    param('backupId').isUUID().withMessage('Invalid backup ID'),
    param('otherId').isUUID().withMessage('Invalid backup ID'),
    query('kind').optional().isIn(['cli', 'structured']).withMessage('kind must be cli or structured'),
    handleValidationErrors,
  ],

  scheduleId: [
    param('scheduleId').isUUID().withMessage('Invalid schedule ID'),
    handleValidationErrors,
  ],

  // Cloud-scope backups. integrationId is not always a UUID (the env-backed
  // Central integration is "env:aruba_central").
  scopeList: [
    query('integrationId').optional().isString().isLength({ min: 1, max: 100 }),
    query('scopeType').optional().isIn(['org', 'site', 'group']),
    query('scopeId').optional().isString().isLength({ min: 1, max: 200 }),
    query('status').optional().isIn(['pending', 'running', 'success', 'failed']),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    handleValidationErrors,
  ],

  scopeRun: [
    body('integrationId').optional({ values: 'null' }).isString().isLength({ min: 1, max: 100 }),
    handleValidationErrors,
  ],

  scopeBackupId: [
    param('scopeBackupId').isUUID().withMessage('Invalid scope backup ID'),
    handleValidationErrors,
  ],

  scopeDiff: [
    param('scopeBackupId').isUUID().withMessage('Invalid scope backup ID'),
    param('otherId').isUUID().withMessage('Invalid scope backup ID'),
    handleValidationErrors,
  ],

  scheduleCreate: [
    body('name').trim().isLength({ min: 1 }).withMessage('Schedule name is required'),
    body('cronExpression').trim().isLength({ min: 1 }).withMessage('Cron expression is required'),
    body('timezone').optional().trim().isLength({ min: 1 }),
    body('active').optional().isBoolean(),
    body('deviceSelection').optional().isObject().withMessage('Device selection must be an object'),
    body('deviceSelection.mode').optional().isIn(['all', 'types', 'devices']),
    body('retentionDays').optional().isInt({ min: 0, max: 3650 }).toInt(),
    body('retentionMaxCount').optional().isInt({ min: 0, max: 1000 }).toInt(),
    body('includeScopes').optional().isBoolean().toBoolean(),
    handleValidationErrors,
  ],

  scheduleUpdate: [
    param('scheduleId').isUUID().withMessage('Invalid schedule ID'),
    body('name').optional().trim().isLength({ min: 1 }),
    body('cronExpression').optional().trim().isLength({ min: 1 }),
    body('timezone').optional().trim().isLength({ min: 1 }),
    body('active').optional().isBoolean(),
    body('deviceSelection').optional().isObject(),
    body('deviceSelection.mode').optional().isIn(['all', 'types', 'devices']),
    body('retentionDays').optional().isInt({ min: 0, max: 3650 }).toInt(),
    body('retentionMaxCount').optional().isInt({ min: 0, max: 1000 }).toInt(),
    body('includeScopes').optional().isBoolean().toBoolean(),
    handleValidationErrors,
  ],
};

// General validation helpers
const validateUUID = (paramName) => [
  param(paramName).isUUID().withMessage(`Invalid ${paramName}`),
  handleValidationErrors,
];

// Network Map (services/topology/)
const validateTopology = {
  graph: [
    query('site').optional().isString().isLength({ min: 1, max: 200 }),
    query('includeDiscovered').optional().isBoolean().toBoolean(),
    handleValidationErrors,
  ],

  changes: [
    query('since').optional().isISO8601().withMessage('since must be an ISO timestamp'),
    query('deviceId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
    handleValidationErrors,
  ],

  collect: [
    body('deviceIds').optional().isArray({ max: 1000 }).withMessage('deviceIds must be an array'),
    body('deviceIds.*').optional().isUUID().withMessage('deviceIds must be device IDs'),
    handleValidationErrors,
  ],

  layoutScope: [
    param('scope').matches(/^(all|site:.{1,200})$/).withMessage('scope must be "all" or "site:<location>"'),
    handleValidationErrors,
  ],

  saveLayout: [
    param('scope').matches(/^(all|site:.{1,200})$/).withMessage('scope must be "all" or "site:<location>"'),
    body('positions').isObject().withMessage('positions must be an object of { x, y } by node id'),
    handleValidationErrors,
  ],
};

const validateAlerts = {
  list: [
    query('status').optional().isIn(['active', 'open', 'acknowledged', 'resolved', 'all']),
    query('severity').optional().custom((value) => String(value).split(',').every((s) => SEVERITIES.includes(s.trim())))
      .withMessage(`severity must be one or more of ${SEVERITIES.join(', ')}`),
    query('rule').optional().isIn(Object.keys(ALERT_RULES)),
    query('deviceId').optional().isUUID(),
    query('q').optional().isString().isLength({ max: 200 }),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    handleValidationErrors,
  ],

  ids: [
    body('ids').isArray({ min: 1, max: 1000 }).withMessage('ids must be a non-empty array'),
    body('ids.*').isUUID().withMessage('ids must be alert IDs'),
    handleValidationErrors,
  ],

  updateRule: [
    param('key').isIn(Object.keys(ALERT_RULES)).withMessage('Unknown alert rule'),
    body('enabled').optional().isBoolean().toBoolean(),
    body('severity').optional().isIn(SEVERITIES),
    body('settleSeconds').optional().isInt({ min: 0, max: MAX_SETTLE_SECONDS }).toInt(),
    handleValidationErrors,
  ],
};

const validateOptionalUUID = (paramName) => [
  param(paramName).optional().isUUID().withMessage(`Invalid ${paramName}`),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  validateDevice,
  validateAutomation,
  validateSchedule,
  validateDeviceGroup,
  validateApiCredential,
  validateDiscovery,
  validateBackup,
  validateTopology,
  validateAlerts,
  validateQuery,
  validateUUID,
  validateOptionalUUID,
};