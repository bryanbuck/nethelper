const express = require('express');
const router = express.Router();
const systemController = require('../controllers/system.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.use(authenticate);

// System Status page: process, queues, database, Redis, usage (admin only).
// Live updates come over the socket (subscribe:system-status).
router.get('/', authorize('admin'), systemController.status);

module.exports = router;
