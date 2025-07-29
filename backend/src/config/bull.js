const Queue = require('bull');
const logger = require('../utils/logger');

const queues = {};

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

async function initializeQueues() {
  // Create queues
  queues.automation = createQueue('automation');
  queues.deviceSync = createQueue('device-sync');
  queues.notification = createQueue('notification');
  queues.cleanup = createQueue('cleanup');

  // Import and initialize job processors
  require('../jobs/automation.job')(queues.automation);
  require('../jobs/device-sync.job')(queues.deviceSync);
  
  logger.info('All job queues initialized');
}

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
