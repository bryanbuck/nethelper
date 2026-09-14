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

// Cloud Integration routes (Aruba Central, Juniper Mist, Cisco Meraki).
// Several integrations can be active at once, including multiple tenants of
// the same provider — see docs/MULTI_VENDOR_ROADMAP.md.

// List configured cloud integrations (+ the catalog of supported providers)
router.get('/cloud-integrations', settingsController.getCloudIntegrations);

// Create a cloud integration
router.post(
  '/cloud-integrations',
  authorize('admin'),
  settingsController.createCloudIntegration
);

// Update a cloud integration
router.put(
  '/cloud-integrations/:id',
  authorize('admin'),
  validateUUID('id'),
  settingsController.updateCloudIntegration
);

// Test a cloud integration's credentials
router.post(
  '/cloud-integrations/:id/test',
  authorize('admin'),
  validateUUID('id'),
  settingsController.testCloudIntegration
);

// Delete a cloud integration
router.delete(
  '/cloud-integrations/:id',
  authorize('admin'),
  validateUUID('id'),
  settingsController.deleteCloudIntegration
);

// DEPRECATED Aruba Central Configuration routes — kept for one release while
// clients migrate to /cloud-integrations. They operate on the aruba_central
// rows of the CloudIntegration table.

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

// --- Git backup mirror (admin only) ---
// Storage configuration for the config-backup Git mirror. Secrets are masked
// on read; a blank secret on write keeps the stored value.
router.get('/git-backup', authorize('admin'), settingsController.getGitBackupConfig);
router.put('/git-backup', authorize('admin'), settingsController.saveGitBackupConfig);
router.post('/git-backup/test', authorize('admin'), settingsController.testGitBackupConfig);
router.delete('/git-backup', authorize('admin'), settingsController.deleteGitBackupConfig);

module.exports = router;
