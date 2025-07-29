const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/device.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validateDevice } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// Get all devices
router.get('/', deviceController.getDevices);

// Sync devices from Aruba Central
router.post('/sync', authorize('admin', 'operator'), deviceController.syncDevices);

// Get specific device
router.get('/:deviceId', deviceController.getDevice);

// Get device statistics
router.get('/:deviceId/stats', deviceController.getDeviceStats);

// Update device configuration
router.put(
  '/:deviceId/configuration',
  authorize('admin', 'operator'),
  validateDevice.updateConfiguration,
  deviceController.updateDeviceConfiguration
);

// Backup device configuration
router.post(
  '/:deviceId/backup',
  authorize('admin', 'operator'),
  deviceController.backupDeviceConfiguration
);

// Execute command on device
router.post(
  '/:deviceId/command',
  authorize('admin'),
  validateDevice.executeCommand,
  deviceController.executeCommand
);

module.exports = router;
