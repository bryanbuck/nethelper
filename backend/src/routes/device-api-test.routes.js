const express = require('express');
const router = express.Router();
const deviceApiTestController = require('../controllers/device-api-test.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { body, param, validationResult } = require('express-validator');

// Validation middleware
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

// All routes require authentication
router.use(authenticate);

/**
 * Get list of supported device API types
 * GET /api/v1/device-api/supported-types
 */
router.get('/supported-types', deviceApiTestController.getSupportedTypes);

/**
 * Test manual connection (no device/credentials storage required)
 * POST /api/v1/device-api/test-manual
 *
 * Body: {
 *   deviceIp: "192.168.1.1",
 *   username: "admin",
 *   password: "password",
 *   deviceType: "cx_switch" (optional)
 * }
 */
router.post(
  '/test-manual',
  authorize('admin', 'operator'),
  [
    body('deviceIp')
      .trim()
      .notEmpty()
      .withMessage('Device IP address is required')
      .isIP()
      .withMessage('Invalid IP address'),
    body('username')
      .trim()
      .notEmpty()
      .withMessage('Username is required'),
    body('password')
      .notEmpty()
      .withMessage('Password is required'),
    body('deviceType')
      .optional()
      .isIn(['cx_switch', 'aos_switch', 'instant_ap', 'aruba_controller'])
      .withMessage('Invalid device type'),
    handleValidationErrors,
  ],
  deviceApiTestController.testManualConnection
);

/**
 * Test connection to a device using stored credentials
 * POST /api/v1/device-api/test/:deviceId
 */
router.post(
  '/test/:deviceId',
  authorize('admin', 'operator'),
  [
    param('deviceId').isUUID().withMessage('Invalid device ID'),
    handleValidationErrors,
  ],
  deviceApiTestController.testDeviceConnection
);

/**
 * Get device information via device API
 * GET /api/v1/device-api/:deviceId/info
 */
router.get(
  '/:deviceId/info',
  [
    param('deviceId').isUUID().withMessage('Invalid device ID'),
    handleValidationErrors,
  ],
  deviceApiTestController.getDeviceInfo
);

/**
 * Get firmware information via device API
 * GET /api/v1/device-api/:deviceId/firmware
 */
router.get(
  '/:deviceId/firmware',
  [
    param('deviceId').isUUID().withMessage('Invalid device ID'),
    handleValidationErrors,
  ],
  deviceApiTestController.getFirmwareInfo
);

module.exports = router;
