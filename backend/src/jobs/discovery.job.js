const discoveryService = require('../services/discovery.service');
const logger = require('../utils/logger');

module.exports = (queue) => {
  queue.process('runScan', async (job) => {
    const { scanId, triggeredBy } = job.data;
    logger.info(`Discovery scan ${scanId} started (triggered by ${triggeredBy || 'unknown'})`);

    const scan = await discoveryService.runScan(scanId);
    return {
      success: true,
      totalHosts: scan.totalHosts,
      arubaHosts: scan.arubaHosts,
    };
  });
};
