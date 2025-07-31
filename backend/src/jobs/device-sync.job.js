const deviceService = require('../services/device.service');
const { debugLog, Services } = require('../utils/debug-logger');

// Create service-specific logger
const logger = debugLog.createLogger(Services.JOBS);

// Device sync job processor
async function processDeviceSync(job) {
  try {
    logger.progress('Starting device sync job', { jobId: job.id });
    
    const result = await deviceService.syncDevicesFromAruba();
    
    logger.success('Device sync job completed', { 
      jobId: job.id, 
      ...result 
    });
    
    return result;
  } catch (error) {
    logger.error('Device sync job failed', { 
      jobId: job.id, 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

// Export function that initializes the queue processor
module.exports = (queue) => {
  queue.process('syncDevices', processDeviceSync);
  logger.success('Device sync job processor initialized');
};