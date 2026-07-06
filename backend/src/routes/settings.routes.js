const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validateApiCredential, validateUUID } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// API Credentials routes

// Get all API credentials for authenticated user
router.get('/api-credentials', settingsController.getApiCredentials);

// Get API credential by device ID
router.get('/api-credentials/device/:deviceId', validateUUID('deviceId'), settingsController.getApiCredentialByDevice);

// Get specific API credential
router.get('/api-credentials/:id', validateUUID('id'), settingsController.getApiCredential);

// Create new API credential
router.post(
  '/api-credentials',
  authorize('admin', 'operator'),
  validateApiCredential.create,
  settingsController.createApiCredential
);

// Update API credential
router.put(
  '/api-credentials/:id',
  authorize('admin', 'operator'),
  validateApiCredential.update,
  settingsController.updateApiCredential
);

// Delete API credential
router.delete(
  '/api-credentials/:id',
  authorize('admin', 'operator'),
  validateUUID('id'),
  settingsController.deleteApiCredential
);

// Test API credential
router.post(
  '/api-credentials/:id/test',
  authorize('admin', 'operator'),
  validateUUID('id'),
  settingsController.testApiCredential
);

// Aruba Central Configuration routes

// Get Aruba Central configuration
router.get('/aruba-central', settingsController.getArubaCentralConfig);

// Save Aruba Central configuration
router.post(
  '/aruba-central',
  authorize('admin'),  // Only admins can configure Aruba Central
  settingsController.saveArubaCentralConfig
);

// Test Aruba Central configuration
router.post(
  '/aruba-central/test',
  authorize('admin'),
  settingsController.testArubaCentralConfig
);

// Delete Aruba Central configuration
router.delete(
  '/aruba-central/:id',
  authorize('admin'),
  validateUUID('id'),
  settingsController.deleteArubaCentralConfig
);

module.exports = router;
