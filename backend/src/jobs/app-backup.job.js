const appBackupService = require('../services/app-backup.service');
const logger = require('../utils/logger');

module.exports = (queue) => {
  // Run now (Settings -> App Backup)
  queue.process('run', async (job) => {
    logger.info('Application backup started (manual)');
    const result = await appBackupService.run({ trigger: 'manual', triggeredBy: job.data?.triggeredBy || null });
    return { fileName: result.archive.name, sizeBytes: result.archive.sizeBytes };
  });

  // The settings' cron schedule (one repeatable job, appBackupService.syncSchedule)
  queue.process('scheduled', async () => {
    logger.info('Application backup started (scheduled)');
    const result = await appBackupService.run({ trigger: 'scheduled' });
    return { fileName: result.archive.name, sizeBytes: result.archive.sizeBytes };
  });
};
