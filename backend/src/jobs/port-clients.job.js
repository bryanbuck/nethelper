const portClientService = require('../services/ports/port-client.service');
const logger = require('../utils/logger');

module.exports = (queue) => {
  // Port Identity: scheduled and on-demand wired-client collection (one job at a time).
  queue.process('collect', async (job) => {
    const { deviceIds, triggeredBy } = job.data || {};
    const trigger = job.opts?.repeat ? 'scheduled' : 'manual';
    if (trigger === 'manual') {
      logger.info(`Port client collection triggered by user ${triggeredBy} for ${deviceIds?.length || 'all'} switch(es)`);
    }
    const { results, ...summary } = await portClientService.collectAll({ deviceIds, trigger });
    return { ...summary, failedDevices: results.filter((r) => r.status === 'failed').map((r) => r.name) };
  });

  const enabled = process.env.PORT_CLIENTS_ENABLED !== 'false';
  const interval = portClientService.intervalMs;
  if (enabled) portClientService.start();

  (async () => {
    // A changed interval would otherwise leave the old repeatable job running too.
    for (const job of await queue.getRepeatableJobs()) {
      if (job.name === 'collect' && (!enabled || Number(job.every) !== interval)) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
    if (enabled) {
      await queue.add('collect', {}, {
        repeat: { every: interval },
        jobId: 'port-clients-recurring',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 20,
      });
      logger.info(`Port client collection scheduled every ${interval}ms`);
    } else {
      logger.info('Port client collection disabled via PORT_CLIENTS_ENABLED');
    }
  })().catch((error) => logger.error(`Could not schedule port client collection: ${error.message}`));
};
