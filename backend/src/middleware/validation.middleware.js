const { body, param, query, validationResult } = require('express-validator');

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

  create: [
    body('serial').trim().isLength({ min: 1 }).withMessage('Serial number is required'),
    body('name').trim().isLength({ min: 1 }).withMessage('Device name is required'),
    body('type').isIn(['access_point', 'switch', 'gateway']).withMessage('Invalid device type'),
    body('model').optional().trim(),
    body('ipAddress').optional().isIP().withMessage('Invalid IP address'),
    body('macAddress').optional().isMACAddress().withMessage('Invalid MAC address'),
    body('location').optional().trim(),
    handleValidationErrors,
  ],

  update: [
    param('deviceId').isUUID().withMessage('Invalid device ID'),
    body('name').optional().trim().isLength({ min: 1 }),
    body('type').optional().isIn(['access_point', 'switch', 'gateway']),
    body('model').optional().trim(),
    body('ipAddress').optional().isIP(),
    body('macAddress').optional().isMACAddress(),
    body('location').optional().trim(),
    body('status').optional().isIn(['online', 'offline', 'warning', 'maintenance']),
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

// General validation helpers
const validateUUID = (paramName) => [
  param(paramName).isUUID().withMessage(`Invalid ${paramName}`),
  handleValidationErrors,
];

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
  validateQuery,
  validateUUID,
  validateOptionalUUID,
};