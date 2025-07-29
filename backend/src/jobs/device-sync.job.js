const deviceService = require('../services/device.service');
const logger = require('../utils/logger');

// Device sync job processor
async function processDeviceSync(job) {
  try {
    logger.info('Starting device sync job', { jobId: job.id });
    
    const result = await deviceService.syncDevicesFromAruba();
    
    logger.info('Device sync job completed', { 
      jobId: job.id, 
      ...result 
    });
    
    return result;
  } catch (error) {
    logger.error('Device sync job failed', { 
      jobId: job.id, 
      error: error.message 
    });
    throw error;
  }
}

// Export function that initializes the queue processor
module.exports = (queue) => {
  queue.process('syncDevices', processDeviceSync);
  logger.info('Device sync job processor initialized');
};