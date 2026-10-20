const pingMonitorService = require('../services/ping-monitor.service');
const logger = require('../utils/logger');

module.exports = (queue) => {
  // Process ping monitoring jobs
  queue.process('checkDevices', async (job) => {
    try {
      const { manual, triggeredBy } = job.data || {};

      if (manual) {
        logger.info(`Manual device ping check triggered by user ${triggeredBy}`);
      } else {
        logger.debug('Scheduled device ping check started');
      }

      await pingMonitorService.checkAllDevices();

      const stats = pingMonitorService.getStats();
      logger.debug('Device ping check completed', {
        successful: stats.lastCheck.successful,
        failed: stats.lastCheck.failed,
        total: stats.lastCheck.total,
      });

      return {
        success: true,
        stats: stats.lastCheck,
      };
    } catch (error) {
      logger.error('Ping check job failed:', error);
      throw error;
    }
  });

  // The only ping scheduler (every 60 seconds by default).
  const interval = parseInt(process.env.PING_MONITOR_INTERVAL) || 60000;
  const enabled = process.env.PING_MONITOR_ENABLED !== 'false';

  (async () => {
    // Bull keys a repeatable by its interval: a changed interval, or monitoring
    // turned off, would otherwise leave the old job sweeping too.
    for (const job of await queue.getRepeatableJobs()) {
      if (job.name === 'checkDevices' && (!enabled || Number(job.every) !== interval)) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
    if (!enabled) {
      logger.info('Ping monitor job disabled via PING_MONITOR_ENABLED environment variable');
      return;
    }
    await queue.add('checkDevices', {}, {
      repeat: {
        every: interval,
      },
      jobId: 'ping-monitor-recurring',
      removeOnComplete: true, // Keep queue clean
      removeOnFail: 20,
    });
    logger.info(`Ping monitor job initialized with ${interval}ms interval`);
  })().catch((error) => logger.error(`Could not schedule ping monitoring: ${error.message}`));
};
