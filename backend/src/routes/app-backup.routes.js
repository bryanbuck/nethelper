const express = require('express');
const router = express.Router();
const appBackupController = require('../controllers/app-backup.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.use(authenticate);

// Application self-backup (Settings -> App Backup). Admin only throughout: an
// archive holds the whole database and every device config.
router.get('/', authorize('admin'), appBackupController.overview);
router.put('/config', authorize('admin'), appBackupController.saveConfig);
router.post('/run', authorize('admin'), appBackupController.run);
router.get('/:name/download', authorize('admin'), appBackupController.download);
router.delete('/:name', authorize('admin'), appBackupController.remove);

module.exports = router;
