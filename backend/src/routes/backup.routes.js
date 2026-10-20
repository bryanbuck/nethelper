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

// Cloud-scope backups: config a cloud plane holds above the device (a Mist org
// or site), which is where AP config lives. Must precede /:backupId routes.
router.get('/scopes', validateBackup.scopeList, backupController.getScopeBackups);
router.post('/scopes/run', authorize('admin', 'operator'), validateBackup.scopeRun, backupController.runScopeBackup);
router.get('/scopes/:scopeBackupId', validateBackup.scopeBackupId, backupController.getScopeBackup);
// Scope configs can carry secrets too (WLAN PSKs, RADIUS secrets).
router.get('/scopes/:scopeBackupId/content', authorize('admin', 'operator'), validateBackup.scopeBackupId, backupController.getScopeBackupContent);
router.get('/scopes/:scopeBackupId/download', authorize('admin', 'operator'), validateBackup.scopeBackupId, backupController.downloadScopeBackup);
router.get('/scopes/:scopeBackupId/diff/:otherId', authorize('admin', 'operator'), validateBackup.scopeDiff, backupController.diffScopeBackups);
router.delete('/scopes/:scopeBackupId', authorize('admin'), validateBackup.scopeBackupId, backupController.deleteScopeBackup);

// Single backup record / content / download / diff
router.get('/:backupId', validateBackup.backupId, backupController.getBackup);
// Config bodies carry device secrets (SNMP communities, RADIUS keys, local
// user hashes), so viewers see backup metadata but not contents.
router.get('/:backupId/content', authorize('admin', 'operator'), validateBackup.content, backupController.getBackupContent);
router.get('/:backupId/download', authorize('admin', 'operator'), validateBackup.content, backupController.downloadBackup);
router.get('/:backupId/diff/:otherId', authorize('admin', 'operator'), validateBackup.diff, backupController.diffBackups);
// Git commit history for this backup's device (empty when the mirror is off)
router.get('/:backupId/history', validateBackup.backupId, backupController.getBackupHistory);
router.delete('/:backupId', authorize('admin'), validateBackup.backupId, backupController.deleteBackup);

module.exports = router;
