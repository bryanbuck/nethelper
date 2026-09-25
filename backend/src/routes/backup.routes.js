const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backup.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validateBackup } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// List backups (filter by deviceId, scheduleId, status; paginated)
router.get('/', validateBackup.list, backupController.getBackups);

// Queue a manual backup run for specific devices
router.post('/run', authorize('admin', 'operator'), validateBackup.run, backupController.runBackup);

// Schedule management (must precede /:backupId routes)
router.get('/schedules', backupController.getSchedules);
router.post('/schedules', authorize('admin', 'operator'), validateBackup.scheduleCreate, backupController.createSchedule);
router.put('/schedules/:scheduleId', authorize('admin', 'operator'), validateBackup.scheduleUpdate, backupController.updateSchedule);
router.delete('/schedules/:scheduleId', authorize('admin'), validateBackup.scheduleId, backupController.deleteSchedule);
router.post('/schedules/:scheduleId/run', authorize('admin', 'operator'), validateBackup.scheduleId, backupController.runScheduleNow);

// Single backup record / content / download / diff
router.get('/:backupId', validateBackup.backupId, backupController.getBackup);
// Config bodies carry device secrets (SNMP communities, RADIUS keys, local
// user hashes), so viewers see backup metadata but not contents.
router.get('/:backupId/content', authorize('admin', 'operator'), validateBackup.backupId, backupController.getBackupContent);
router.get('/:backupId/download', authorize('admin', 'operator'), validateBackup.backupId, backupController.downloadBackup);
router.get('/:backupId/diff/:otherId', authorize('admin', 'operator'), validateBackup.diff, backupController.diffBackups);
// Git commit history for this backup's device (empty when the mirror is off)
router.get('/:backupId/history', validateBackup.backupId, backupController.getBackupHistory);
router.delete('/:backupId', authorize('admin'), validateBackup.backupId, backupController.deleteBackup);

module.exports = router;
