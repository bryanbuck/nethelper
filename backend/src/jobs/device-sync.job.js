const deviceService = require('../services/device.service');
const cloudStatusService = require('../services/cloud-status.service');
const cloudAlarmService = require('../services/cloud-alarm.service');
const CloudProviderFactory = require('../services/cloud-providers/cloud-provider-factory');
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
  // Repeatable runs are the hourly sync; the UI shows only their failures.
  const trigger = job.opts?.repeat ? 'scheduled' : 'manual';
  try {
    const integrationId = job.data?.integrationId || null;
    // Nothing configured: skip quietly. Integrations that exist but can't be
    // loaded still run the sync, which raises sync.failed for each.
    if (trigger === 'scheduled') {
      const { providers, skipped } = await CloudProviderFactory.activeIntegrations();
      if (!providers.length && !skipped.length) return { skipped: 'no active cloud integrations' };
    }
    logger.progress('Starting device sync job', { jobId: job.id, integrationId, trigger });

    const result = await deviceService.syncDevicesFromCloud(integrationId);
    
    logger.success('Device sync job completed', { 
      jobId: job.id, 
      ...result 
    });

    emit('device:sync:completed', { integrationId, trigger, ...result });
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
      emit('device:sync:failed', { integrationId: job.data?.integrationId || null, trigger, error: error.message });
    }
    throw error;
  }
}

// Cloud status refresh: what each cloud reports now, between full syncs.
async function processStatusRefresh() {
  const results = await cloudStatusService.refreshAll();
  const changes = results.reduce((sum, r) => sum + (r.statusChanges || 0), 0);
  if (changes) logger.info('Cloud status refresh', { statusChanges: changes });
  return { results };
}

// Cloud alarm mirror: new and cleared alarms from every cloud that has them.
async function processAlarmPoll() {
  const results = await cloudAlarmService.pollAll();
  const raised = results.reduce((sum, r) => sum + (r.raised || 0), 0);
  if (raised) logger.info('Cloud alarm poll', { raised });
  return { results };
}

const SCHEDULES = [
  {
    name: 'syncDevices',
    jobId: 'cloud-sync-recurring',
    enabled: () => process.env.CLOUD_SYNC_ENABLED !== 'false',
    interval: () => parseInt(process.env.CLOUD_SYNC_INTERVAL, 10) || 3600000,
  },
  {
    name: 'refreshStatuses',
    jobId: 'cloud-status-recurring',
    enabled: () => process.env.CLOUD_STATUS_ENABLED !== 'false',
    interval: () => parseInt(process.env.CLOUD_STATUS_INTERVAL, 10) || 300000,
  },
  {
    name: 'pollCloudAlarms',
    jobId: 'cloud-alarms-recurring',
    enabled: () => process.env.CLOUD_ALARMS_ENABLED !== 'false',
    interval: () => parseInt(process.env.CLOUD_ALARM_INTERVAL, 10) || 300000,
  },
];

async function schedule(queue) {
  const repeatables = await queue.getRepeatableJobs();
  for (const { name, jobId, enabled, interval } of SCHEDULES) {
    // A changed interval would otherwise leave the old repeatable job running too.
    for (const job of repeatables) {
      if (job.name === name && (!enabled() || Number(job.every) !== interval())) {
        await queue.removeRepeatableByKey(job.key);
      }
    }
    if (!enabled()) {
      logger.info(`Scheduled ${name} disabled`);
      continue;
    }
    // One attempt: the next run is the retry.
    await queue.add(name, {}, {
      repeat: { every: interval() },
      jobId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: 20,
    });
    logger.info(`Scheduled ${name} every ${interval()}ms`);
  }
}

// Export function that initializes the queue processor
module.exports = (queue) => {
  queue.process('syncDevices', processDeviceSync);
  queue.process('refreshStatuses', processStatusRefresh);
  queue.process('pollCloudAlarms', processAlarmPoll);
  schedule(queue).catch((error) => logger.error('Could not schedule cloud sync jobs', { error: error.message }));
  logger.success('Device sync job processor initialized');
};