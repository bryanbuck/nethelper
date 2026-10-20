const deviceService = require('../services/device.service');
const { debugLog, Services } = require('../utils/debug-logger');

// Create service-specific logger
const logger = debugLog.createLogger(Services.JOBS);

// The sync runs here, after POST /devices/sync has returned; this is how the
// UI learns the outcome (counts, and possible duplicates to review).
function emit(event, payload) {
  try {
    const { getIO } = require('../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch {
    // Socket.io not initialised (tests).
  }
}

// Device sync job processor
async function processDeviceSync(job) {
  try {
    const integrationId = job.data?.integrationId || null;
    logger.progress('Starting device sync job', { jobId: job.id, integrationId });

    const result = await deviceService.syncDevicesFromCloud(integrationId);
    
    logger.success('Device sync job completed', { 
      jobId: job.id, 
      ...result 
    });

    emit('device:sync:completed', { integrationId, ...result });
    return result;
  } catch (error) {
    // A cloud provider's error carries suggested actions for the user.
    if (error.isProviderError && error.actions) {
      logger.error('Device sync failed - cloud provider error', {
        jobId: job.id,
        errorType: error.type,
        userMessage: error.message,
        actions: error.actions,
        statusCode: error.statusCode
      });
    } else {
      logger.error('Device sync job failed', { 
        jobId: job.id, 
        error: error.message,
        stack: error.stack 
      });
    }
    // Bull retries a failed sync; only report the last attempt.
    if (job.attemptsMade + 1 >= (job.opts?.attempts || 1)) {
      emit('device:sync:failed', { integrationId: job.data?.integrationId || null, error: error.message });
    }
    throw error;
  }
}

// Export function that initializes the queue processor
module.exports = (queue) => {
  queue.process('syncDevices', processDeviceSync);
  logger.success('Device sync job processor initialized');
};