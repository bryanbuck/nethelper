const notificationChannels = require('../services/notification-channel.service');

// One alert notification through one channel. Retried with backoff
// (notification-channel.service JOB_OPTIONS); the channel records the
// outcome, a failure only once the last attempt fails.
module.exports = (queue) => {
  queue.process('deliver', async (job) => {
    const attempts = job.opts.attempts || 1;
    return notificationChannels.deliver(job.data, { finalAttempt: job.attemptsMade + 1 >= attempts });
  });
};
