const Queue = require('bull');
const logger = require('../utils/logger');

const queues = {};

/**
 * Creates a new Bull queue with standardized configuration for job processing.
 * Sets up Redis connection, default job options including retry logic, cleanup settings,
 * and error handling. Each queue is configured with exponential backoff for failed jobs.
 * 
 * @param {string} name - The name of the queue to create
 * @returns {Queue} Configured Bull queue instance
 */
function createQueue(name) {
  const queue = new Queue(name, {
    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
    },
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
  });

  queue.on('error', (error) => {
    logger.error(`Queue ${name} error:`, error);
  });

  queue.on('failed', (job, err) => {
    logger.error(`Job ${job.id} in queue ${name} failed:`, err);
  });

  return queue;
}

/**
 * Initializes all application job queues and their processors.
 * Creates queues for automation execution, device synchronization, notifications,
 * and cleanup tasks. Also imports and initializes the corresponding job processors
 * to handle queue processing.
 * 
 * @returns {Promise<void>} Promise that resolves when all queues are initialized
 */
async function initializeQueues() {
  // Create queues
  queues.automation = createQueue('automation');
  queues.deviceSync = createQueue('device-sync');
  queues.notification = createQueue('notification');
  queues.cleanup = createQueue('cleanup');
  queues.pingMonitor = createQueue('ping-monitor');
  queues.discovery = createQueue('discovery');
  queues.configBackup = createQueue('config-backup');

  // Import and initialize job processors
  require('../jobs/automation.job')(queues.automation);
  require('../jobs/device-sync.job')(queues.deviceSync);
  require('../jobs/ping-monitor.job')(queues.pingMonitor);
  require('../jobs/discovery.job')(queues.discovery);
  require('../jobs/config-backup.job')(queues.configBackup);

  logger.info('All job queues initialized');
}

/**
 * Retrieves a previously initialized queue by name.
 * Provides access to specific queues for adding jobs or monitoring status.
 * Throws an error if the requested queue hasn't been initialized.
 * 
 * @param {string} name - The name of the queue to retrieve
 * @returns {Queue} The requested Bull queue instance
 * @throws {Error} If the queue doesn't exist
 */
function getQueue(name) {
  if (!queues[name]) {
    throw new Error(`Queue ${name} not found`);
  }
  return queues[name];
}

module.exports = {
  initializeQueues,
  getQueue,
};
