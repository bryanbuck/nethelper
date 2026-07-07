const configBackupService = require('../services/config-backup.service');
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
