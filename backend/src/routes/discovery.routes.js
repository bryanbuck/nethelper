const express = require('express');
const router = express.Router();
const discoveryController = require('../controllers/discovery.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validateDiscovery } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// Suggested subnets derived from the backend host's interfaces
router.get('/subnets', discoveryController.getSubnets);

// Start a new discovery scan
router.post('/scan', authorize('admin', 'operator'), validateDiscovery.scan, discoveryController.startScan);

// List recent scans
router.get('/scans', discoveryController.getScans);

// Get a scan with its discovered devices
router.get('/scans/:scanId', validateDiscovery.scanId, discoveryController.getScan);

// Delete a scan and its results
router.delete('/scans/:scanId', authorize('admin'), validateDiscovery.scanId, discoveryController.deleteScan);

// Import a discovered device into the inventory (or merge into a conflicting device)
router.post(
  '/devices/:discoveredId/import',
  authorize('admin', 'operator'),
  validateDiscovery.importDevice,
  discoveryController.importDevice
);

// Ignore a discovered device
router.post(
  '/devices/:discoveredId/ignore',
  authorize('admin', 'operator'),
  validateDiscovery.discoveredId,
  discoveryController.ignoreDevice
);

module.exports = router;
