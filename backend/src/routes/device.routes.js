const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/device.controller');
const topologyController = require('../controllers/topology.controller');
const portController = require('../controllers/port.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const savedFilterController = require('../controllers/saved-filter.controller');
const {
  validateDevice, validateDeviceGroup, validateSavedFilter, validateQuery, validateUUID, validatePorts,
} = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// Port Identity: where is this MAC / IP / host / note text, fleet-wide
router.get('/ports/search', validatePorts.search, portController.search);

// Get all devices
router.get('/', validateQuery.deviceList, deviceController.getDevices);

// Create new device
router.post('/', authorize('admin', 'operator'), validateDevice.create, deviceController.createDevice);

// Likely duplicate devices, and merging them into one
router.get('/duplicates', deviceController.getDuplicates);
// Asks the cloud and/or device for the real serial and MAC; changes nothing.
router.post('/merge/preview', authorize('admin', 'operator'), validateDevice.merge, deviceController.previewMerge);
router.post('/merge', authorize('admin', 'operator'), validateDevice.merge, deviceController.mergeDevices);

// Link one device credential to many devices (null unlinks). The preview
// changes nothing.
router.post('/credential/preview', authorize('admin', 'operator'), validateDevice.assignCredential, deviceController.previewCredentialAssignment);
router.post('/credential', authorize('admin', 'operator'), validateDevice.assignCredential, deviceController.assignCredential);

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

// The signed-in user's saved Devices-page filters. Personal, so every role
// (viewers too) manages its own: no authorize(); the role-gates test lists
// these as SELF_SERVICE. Declared before /:deviceId.
router.get('/saved-filters', savedFilterController.list);
router.post('/saved-filters', validateSavedFilter.create, savedFilterController.create);
router.put('/saved-filters/:filterId', validateSavedFilter.update, savedFilterController.update);
router.delete('/saved-filters/:filterId', validateSavedFilter.remove, savedFilterController.remove);

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

router.post(
  '/groups/:groupId/members',
  authorize('admin', 'operator'),
  validateDeviceGroup.members,
  deviceController.updateGroupMembers
);

router.delete(
  '/groups/:groupId',
  authorize('admin'),
  validateDeviceGroup.remove,
  deviceController.deleteDeviceGroup
);

// Get specific device
router.get('/:deviceId', deviceController.getDevice);

// Update device
router.put('/:deviceId', authorize('admin', 'operator'), validateDevice.update, deviceController.updateDevice);

// Delete device
router.delete('/:deviceId', authorize('admin'), deviceController.deleteDevice);

// Live state: recent port/PoE events, and the always-on monitoring toggle
router.get('/:deviceId/events', deviceController.getDeviceEvents);

// History tab: ping/cloud status lanes and backup/restart markers over a window
router.get('/:deviceId/history', validateUUID('deviceId'), deviceController.getDeviceHistory);

// What else holds this device's IP address (other devices, clouds, neighbor table, LLDP, discovery).
// Operator+: it spends cloud API quota and returns cloud client records.
router.get('/:deviceId/address-lookup', authorize('admin', 'operator'), validateUUID('deviceId'), deviceController.lookupAddress);

// Network Map: this device's LLDP/CDP neighbors
router.get('/:deviceId/neighbors', validateUUID('deviceId'), topologyController.getDeviceNeighbors);

// Port Identity: the switch's ports (clients, notes, neighbors, VLANs), one
// port with its note history, port notes, and a client read on demand.
router.get('/:deviceId/ports', validatePorts.device, portController.getPorts);
router.post('/:deviceId/ports/read', authorize('admin', 'operator'), validatePorts.device, portController.readNow);
router.get('/:deviceId/ports/:port', validatePorts.port, portController.getPort);
router.put('/:deviceId/ports/:port/note', authorize('admin', 'operator'), validatePorts.note, portController.setNote);
router.delete('/:deviceId/ports/:port/note', authorize('admin', 'operator'), validatePorts.port, portController.clearNote);

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
