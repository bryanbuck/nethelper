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

// Get API credentials by device ID
router.get('/api-credentials/device/:deviceId', validateUUID('deviceId'), settingsController.getApiCredentialsByDevice);

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

module.exports = router;
