const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alert.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validateAlerts } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// Alerts, newest activity first (default: unresolved)
router.get('/', validateAlerts.list, alertController.list);

// Unresolved counts by status and severity (app-bar badge, dashboard)
router.get('/summary', alertController.summary);

// Built-in rules with their current settings
router.get('/rules', alertController.getRules);
router.patch('/rules/:key', authorize('admin'), validateAlerts.updateRule, alertController.updateRule);

// Bulk actions; single-row actions send one id
router.post('/acknowledge', authorize('admin', 'operator'), validateAlerts.ids, alertController.acknowledge);
router.post('/resolve', authorize('admin', 'operator'), validateAlerts.ids, alertController.resolve);

module.exports = router;
