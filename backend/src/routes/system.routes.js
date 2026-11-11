const express = require('express');
const router = express.Router();
const systemController = require('../controllers/system.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.use(authenticate);

// System Status page: process, queues, database, Redis, usage (admin only).
// Live updates come over the socket (subscribe:system-status).
router.get('/', authorize('admin'), systemController.status);

// Update check: is a newer release out? (admin only; the upgrade itself is a
// command on the host, never something the app does)
router.get('/update', authorize('admin'), systemController.update);
router.post('/update/check', authorize('admin'), systemController.checkUpdate);

module.exports = router;
