/**
 * Queue engine runs: one Execution row and one 'run' job per target device,
 * or a single deviceless run when there are no targets.
 */

const { getPrisma } = require('../../config/database');

// A run executes at most once: a retry could repeat steps that already ran
// (raise an alert, take a backup). The queue's default is 3 attempts.
const RUN_JOB_OPTIONS = { attempts: 1, removeOnComplete: 100, removeOnFail: 100 };

async function queueRuns({ automationId, devices, trigger, userId = null }) {
  const prisma = getPrisma();
  const targets = devices.length ? devices : [null];
  const executions = await Promise.all(targets.map((device) => prisma.execution.create({
    data: { automationId, deviceId: device?.id || null, userId, status: 'pending', trigger },
    include: { device: { select: { id: true, name: true, serial: true } } },
  })));

  const { getQueue } = require('../../config/bull');
  const queue = getQueue('automation');
  await Promise.all(executions.map((execution) => queue.add('run', {
    automationId,
    executionId: execution.id,
    deviceId: execution.deviceId,
    trigger,
  }, RUN_JOB_OPTIONS)));
  return executions;
}

module.exports = { queueRuns, RUN_JOB_OPTIONS };
