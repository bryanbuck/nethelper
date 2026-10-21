const express = require('express');
const router = express.Router();
const deviceApiTestController = require('../controllers/device-api-test.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { body, param, validationResult } = require('express-validator');
const { manualTestPlatforms } = require('../services/connection-test.service');

const TESTABLE_PLATFORMS = manualTestPlatforms().filter((p) => p.testable).map((p) => p.platform);

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
 * Platforms the manual test can reach (and over which transports)
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
 *   platform: "aos-cx" (optional; aos-cx | aos-s | junos | ios-xe)
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
    body('platform')
      .optional()
      .isIn(TESTABLE_PLATFORMS)
      .withMessage(`Platform must be one of ${TESTABLE_PLATFORMS.join(', ')}`),
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

module.exports = router;
