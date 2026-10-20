const configBackupService = require('../services/config-backup.service');
const scopeBackupService = require('../services/scope-backup.service');
const logger = require('../utils/logger');

module.exports = (queue) => {
  // Manual backup runs (explicit device list)
  queue.process('runBackup', async (job) => {
    const { deviceIds, triggeredBy } = job.data;
    logger.info(`Manual config backup started for ${deviceIds?.length || 0} device(s)`);
    return configBackupService.runBackupBatch({
      deviceIds,
      trigger: 'manual',
      triggeredBy,
    });
  });

  // Manual cloud-scope runs (Mist org/sites; all integrations or one)
  queue.process('runScopeBackup', async (job) => {
    const { integrationId, triggeredBy } = job.data;
    logger.info(`Manual scope backup started${integrationId ? ` for integration ${integrationId}` : ''}`);
    return scopeBackupService.runScopeBackups({ integrationId, trigger: 'manual', triggeredBy });
  });

  // Cron-scheduled runs (registered as Bull repeatable jobs per schedule)
  queue.process('runScheduled', async (job) => {
    const { scheduleId } = job.data;
    logger.info(`Scheduled config backup started for schedule ${scheduleId}`);
    return configBackupService.runBackupBatch({
      scheduleId,
      trigger: 'scheduled',
    });
  });
};
