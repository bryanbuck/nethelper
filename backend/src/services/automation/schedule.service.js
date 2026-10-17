/**
 * Cron runs for automations with a Schedule trigger.
 *
 * The trigger node (cron expression + timezone in Automation.elements) is the
 * source of truth. sync() derives the automation's single Schedule row from
 * it, for nextRun/lastRun, and keeps one Bull repeatable job per schedule.
 * The automation routes call sync() after every create, update and toggle,
 * and remove() before a delete. syncAll() reconciles everything at startup.
 */

const { getPrisma } = require('../../config/database');
const logger = require('../../utils/logger');
const engine = require('./engine');
const { isEnabled } = require('./graph');
const { parseSchedule } = require('./nodes');
const { resolveTargets } = require('./targets');
const { queueRuns } = require('./runs');

const JOB_NAME = 'scheduled';
const JOB_PREFIX = 'automation-schedule-';

function getQueue() {
  return require('../../config/bull').getQueue('automation');
}

class AutomationScheduleService {
  constructor() {
    this.pruneTimer = null;
  }

  /** Daily prune of old execution history (scheduled runs add up). */
  start() {
    this.pruneTimer = setInterval(() => this.pruneExecutions().catch(() => {}), 24 * 3600 * 1000);
    this.pruneTimer.unref?.();
    this.pruneExecutions().catch((error) => logger.warn(`Execution prune failed: ${error.message}`));
  }

  stop() {
    clearInterval(this.pruneTimer);
  }

  async pruneExecutions() {
    const days = Number(process.env.EXECUTION_RETENTION_DAYS) > 0 ? Number(process.env.EXECUTION_RETENTION_DAYS) : 90;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const { count } = await getPrisma().execution.deleteMany({
      where: { status: { in: ['success', 'failed', 'cancelled'] }, createdAt: { lt: cutoff } },
    });
    if (count) logger.info(`Pruned ${count} automation execution(s) older than ${days} days`);
  }

  jobId(scheduleId) {
    return `${JOB_PREFIX}${scheduleId}`;
  }

  /** The schedule an automation should have now ({ cronExpression, timezone, config }), or null. */
  desired(automation) {
    if (!automation.active || !automation.enabled) return null;
    const { graph, errors, triggerType } = engine.validate(automation.elements);
    if (errors.length || triggerType !== 'schedule' || !isEnabled(graph.trigger)) return null;
    const config = graph.trigger.data.config || {};
    return { cronExpression: String(config.schedule).trim(), timezone: config.timezone || 'UTC', config };
  }

  async sync(automationId) {
    const prisma = getPrisma();
    const automation = await prisma.automation.findUnique({
      where: { id: automationId },
      select: { id: true, name: true, active: true, enabled: true, elements: true },
    });
    const existing = await prisma.schedule.findMany({ where: { automationId } });
    for (const schedule of existing) await this.unregister(schedule);

    const want = automation && this.desired(automation);
    if (!want) {
      if (existing.length) await prisma.schedule.deleteMany({ where: { automationId } });
      return null;
    }
    const data = {
      cronExpression: want.cronExpression,
      timezone: want.timezone,
      active: true,
      nextRun: parseSchedule(want.config).next().toDate(),
    };
    const [keep, ...extra] = existing;
    if (extra.length) await prisma.schedule.deleteMany({ where: { id: { in: extra.map((s) => s.id) } } });
    const schedule = keep
      ? await prisma.schedule.update({ where: { id: keep.id }, data })
      : await prisma.schedule.create({ data: { automationId, ...data } });
    await this.register(schedule);
    logger.info(`Automation "${automation.name}" scheduled (${schedule.cronExpression} ${schedule.timezone})`);
    return schedule;
  }

  /** Before an automation is deleted (its Schedule rows cascade; the Bull jobs don't). */
  async remove(automationId) {
    const schedules = await getPrisma().schedule.findMany({ where: { automationId } });
    for (const schedule of schedules) await this.unregister(schedule);
  }

  async register(schedule) {
    await getQueue().add(JOB_NAME, { scheduleId: schedule.id }, {
      repeat: { cron: schedule.cronExpression, tz: schedule.timezone },
      jobId: this.jobId(schedule.id),
      attempts: 1, // a tick that failed is not re-fired; the next tick comes anyway
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  async unregister(schedule) {
    await getQueue().removeRepeatable(JOB_NAME, {
      cron: schedule.cronExpression,
      tz: schedule.timezone,
      jobId: this.jobId(schedule.id),
    }).catch(() => {});
  }

  /** Startup: drop every automation repeatable, then re-derive each automation's schedule. */
  async syncAll() {
    const queue = getQueue();
    for (const job of await queue.getRepeatableJobs()) {
      if (job.id?.startsWith(JOB_PREFIX)) await queue.removeRepeatableByKey(job.key).catch(() => {});
    }
    const automations = await getPrisma().automation.findMany({ select: { id: true } });
    let scheduled = 0;
    for (const { id } of automations) {
      try {
        if (await this.sync(id)) scheduled += 1;
      } catch (error) {
        logger.warn(`Automation ${id} schedule sync failed: ${error.message}`);
      }
    }
    logger.info(`Automation schedule sync complete: ${scheduled} scheduled automation(s)`);
  }

  /** A cron tick: queue one run per target device (or one deviceless run). */
  async fire(scheduleId) {
    const prisma = getPrisma();
    const schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: { automation: { select: { id: true, name: true, active: true, enabled: true, elements: true } } },
    });
    if (!schedule?.active) return { skipped: 'schedule not found or inactive' };
    const want = this.desired(schedule.automation);
    if (!want) return { skipped: 'automation is inactive or no longer scheduled' };

    const now = new Date();
    await prisma.schedule.update({
      where: { id: scheduleId },
      data: { lastRun: now, nextRun: parseSchedule(want.config).next().toDate() },
    });

    const devices = await resolveTargets(schedule.automation, want.config);
    const { needsDevice } = engine.validate(schedule.automation.elements);
    if (!devices.length && needsDevice) {
      // Leave a trace in the history rather than skipping silently.
      await prisma.execution.create({
        data: {
          automationId: schedule.automationId, status: 'failed', trigger: 'schedule',
          startedAt: now, completedAt: now, duration: 0,
          error: 'No target devices: pick devices or groups on the Schedule trigger',
        },
      });
      return { queued: 0 };
    }
    const executions = await queueRuns({ automationId: schedule.automationId, devices, trigger: 'schedule' });
    return { queued: executions.length };
  }
}

module.exports = new AutomationScheduleService();
module.exports.AutomationScheduleService = AutomationScheduleService;
