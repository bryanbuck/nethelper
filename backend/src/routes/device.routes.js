const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/device.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validateDevice, validateDeviceGroup } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// Get all devices
router.get('/', deviceController.getDevices);

// Create new device
router.post('/', authorize('admin', 'operator'), validateDevice.create, deviceController.createDevice);

// Sync devices from Aruba Central
router.post('/sync', authorize('admin', 'operator'), deviceController.syncDevices);

// Ping monitoring routes
// Get ping monitoring statistics
router.get('/ping/stats', deviceController.getPingStats);

// Trigger ping check for all devices
router.post('/ping/all', authorize('admin', 'operator'), deviceController.pingAllDevices);

// Device polling routes
// Get available pollers
router.get('/poll/pollers', deviceController.getAvailablePollers);

// Poll devices for specific information (bulk operation)
router.post('/poll', authorize('admin', 'operator'), deviceController.pollDevices);

// Get specific device
router.get('/:deviceId', deviceController.getDevice);

// Update device
router.put('/:deviceId', authorize('admin', 'operator'), validateDevice.update, deviceController.updateDevice);

// Delete device
router.delete('/:deviceId', authorize('admin'), deviceController.deleteDevice);

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

// Manually trigger ping check for specific device
router.post(
  '/:deviceId/ping',
  authorize('admin', 'operator'),
  deviceController.pingDevice
);

// Device group routes
router.get('/groups', deviceController.getDeviceGroups);

router.post(
  '/groups',
  authorize('admin', 'operator'),
  validateDeviceGroup.create,
  deviceController.createDeviceGroup
);

router.put(
  '/groups/:groupId',
  authorize('admin', 'operator'),
  validateDeviceGroup.update,
  deviceController.updateDeviceGroup
);

router.delete(
  '/groups/:groupId',
  authorize('admin'),
  deviceController.deleteDeviceGroup
);

module.exports = router;
