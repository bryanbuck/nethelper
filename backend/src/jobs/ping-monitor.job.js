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

  // Schedule recurring job (every 60 seconds by default)
  const interval = parseInt(process.env.PING_MONITOR_INTERVAL) || 60000;
  const enabled = process.env.PING_MONITOR_ENABLED !== 'false';

  if (enabled) {
    queue.add('checkDevices', {}, {
      repeat: {
        every: interval,
      },
      jobId: 'ping-monitor-recurring',
      removeOnComplete: true, // Keep queue clean
      removeOnFail: false, // Keep failed jobs for debugging
    });

    logger.info(`Ping monitor job initialized with ${interval}ms interval`);
  } else {
    logger.info('Ping monitor job disabled via PING_MONITOR_ENABLED environment variable');
  }
};
