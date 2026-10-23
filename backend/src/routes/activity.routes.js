const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activity.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateActivity } = require('../middleware/validation.middleware');

router.use(authenticate);

// Fleet-wide device activity, newest first (status changes, restarts, config
// changes, device alerts; port changes on request). Read-only.
router.get('/', validateActivity.list, activityController.list);

module.exports = router;
