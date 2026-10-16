const topologyService = require('../services/topology/topology.service');
const logger = require('../utils/logger');

module.exports = (queue) => {
  // Scheduled and on-demand neighbor collection (one job runs at a time).
  queue.process('collect', async (job) => {
    const { deviceIds, triggeredBy } = job.data || {};
    const trigger = job.opts?.repeat ? 'scheduled' : 'manual';
    if (trigger === 'manual') {
      logger.info(`Topology collection triggered by user ${triggeredBy} for ${deviceIds?.length || 'all'} device(s)`);
    }
    const { results, ...summary } = await topologyService.collectAll({ deviceIds, trigger });
    return { ...summary, failedDevices: results.filter((r) => r.status === 'failed').map((r) => r.name) };
  });

  const interval = parseInt(process.env.TOPOLOGY_INTERVAL, 10) || 21600000;
  const enabled = process.env.TOPOLOGY_ENABLED !== 'false';

  (async () => {
    // A changed interval would otherwise leave the old repeatable job running too.
    const repeatables = await queue.getRepeatableJobs();
    for (const job of repeatables) {
      if (job.name === 'collect' && (!enabled || Number(job.every) !== interval)) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
    if (enabled) {
      await queue.add('collect', {}, {
        repeat: { every: interval },
        jobId: 'topology-recurring',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 20,
      });
      logger.info(`Topology collection scheduled every ${interval}ms`);
    } else {
      logger.info('Topology collection disabled via TOPOLOGY_ENABLED');
    }
  })().catch((error) => logger.error(`Could not schedule topology collection: ${error.message}`));
};
