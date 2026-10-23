/**
 * Runs one automation for one device (or none) through the graph engine
 * (services/automation/engine.js).
 *
 * Job 'run': { automationId, executionId?, deviceId?, alertId?, configChange?, trigger }.
 * Run Now and schedules create the Execution row up front (executionId);
 * alert-triggered runs create it here. A run cancelled while pending never
 * starts; one cancelled while running stops before its next step.
 *
 * Job 'scheduled': { scheduleId }, a cron tick of an automation's Schedule
 * trigger (services/automation/schedule.service.js), which queues the runs.
 */

const { getPrisma } = require('../config/database');
const engine = require('../services/automation/engine');
const scheduleService = require('../services/automation/schedule.service');
const logger = require('../utils/logger');

function emit(event, payload) {
  try {
    const { getIO } = require('../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch {
    // Socket.io not initialised (tests).
  }
}

async function runAutomation({ automationId, executionId, deviceId, alertId, configChange, trigger }) {
  const prisma = getPrisma();
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    select: { id: true, name: true, elements: true, enabled: true },
  });
  if (!automation) throw new Error(`Automation ${automationId} not found`);

  const [device, alert] = await Promise.all([
    deviceId ? prisma.device.findUnique({ where: { id: deviceId } }) : null,
    alertId ? prisma.alert.findUnique({ where: { id: alertId } }) : null,
  ]);

  if (executionId) {
    const pending = await prisma.execution.findUnique({ where: { id: executionId }, select: { status: true } });
    if (!pending || pending.status === 'cancelled') return { executionId, status: 'cancelled' };
  }

  const startedAt = new Date();
  const execution = executionId
    ? await prisma.execution.update({ where: { id: executionId }, data: { status: 'running', startedAt } })
    : await prisma.execution.create({
      data: { automationId, deviceId: device?.id || null, status: 'running', startedAt, trigger },
    });
  const shouldStop = async () => {
    const row = await prisma.execution.findUnique({ where: { id: execution.id }, select: { status: true } });
    return row?.status === 'cancelled';
  };
  const summary = { id: automation.id, name: automation.name };
  emit('automation:started', { executionId: execution.id, automationId, automation: summary, deviceId: device?.id || null, trigger });

  let status = 'failed';
  let output = null;
  let error = null;
  try {
    if (!automation.enabled) throw new Error('The automation is disabled');
    if (alertId && !alert) throw new Error('The alert that triggered this run no longer exists');
    const result = await engine.run(automation, { device, alert, configChange, executionId: execution.id, shouldStop });
    status = result.status;
    output = { trigger, results: result.results };
    if (status === 'failed') error = result.results.filter((r) => r.status === 'failed').map((r) => `${r.label}: ${r.error}`).join('; ');
  } catch (err) {
    error = err.message;
    output = { trigger, results: [] };
  }

  const completedAt = new Date();
  const duration = completedAt - startedAt;
  await prisma.execution.update({
    where: { id: execution.id },
    data: { status, completedAt, duration, output, error },
  });
  await prisma.automation.update({ where: { id: automationId }, data: { lastRun: completedAt } });
  emit('automation:completed', { executionId: execution.id, automationId, automation: summary, status, output, error, duration, trigger });
  logger.info('Automation run finished', { automationId, executionId: execution.id, status, trigger });
  return { executionId: execution.id, status };
}

module.exports = (queue) => {
  queue.process('run', 2, (job) => runAutomation(job.data));
  queue.process('scheduled', (job) => scheduleService.fire(job.data.scheduleId));
};
module.exports.runAutomation = runAutomation;
