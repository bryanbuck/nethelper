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

// Likely duplicate devices, and merging them into one
router.get('/duplicates', deviceController.getDuplicates);
router.post('/merge', authorize('admin', 'operator'), validateDevice.merge, deviceController.mergeDevices);

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

// Device group routes. Declared before /:deviceId, which would otherwise
// capture GET /groups as a device lookup.
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

// Live state: recent port/PoE events, and the always-on monitoring toggle
router.get('/:deviceId/events', deviceController.getDeviceEvents);

router.patch(
  '/:deviceId/live-monitoring',
  authorize('admin', 'operator'),
  deviceController.setLiveMonitoring
);

// Manually trigger ping check for specific device
router.post(
  '/:deviceId/ping',
  authorize('admin', 'operator'),
  deviceController.pingDevice
);

module.exports = router;
