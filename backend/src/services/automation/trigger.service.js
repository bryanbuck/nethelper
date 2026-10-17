/**
 * Starts automations whose trigger is an alert. Listens to the alert
 * service's in-process 'opened'/'resolved' events and queues an automation
 * 'run' job for every active, enabled automation whose Alert trigger
 * matches. Alerts already carry their rule's settle time and dedup, so a
 * bouncing condition doesn't start a run per bounce.
 *
 * The automations are cached; the automation routes call invalidate() on
 * every write. Single-instance assumption, like the alert service.
 */

const { getPrisma } = require('../../config/database');
const alertService = require('../alert.service');
const logger = require('../../utils/logger');
const { parseGraph, subtypeOf, isEnabled } = require('./graph');
const { alertTriggerMatches, deviceInGroup } = require('./nodes');
const { RUN_JOB_OPTIONS } = require('./runs');

class AutomationTriggerService {
  constructor() {
    this.cache = null;
    this.onOpened = (alert) => this.handle('opened', alert);
    this.onResolved = (alert) => this.handle('resolved', alert);
  }

  start() {
    alertService.on('opened', this.onOpened);
    alertService.on('resolved', this.onResolved);
  }

  stop() {
    alertService.off('opened', this.onOpened);
    alertService.off('resolved', this.onResolved);
  }

  invalidate() {
    this.cache = null;
  }

  /** Active, enabled automations with an enabled Alert trigger: [{ id, config }]. */
  async alertAutomations() {
    if (!this.cache) {
      const rows = await getPrisma().automation.findMany({
        where: { active: true, enabled: true },
        select: { id: true, elements: true },
      });
      this.cache = rows.flatMap((row) => {
        const { trigger } = parseGraph(row.elements);
        if (!trigger || !isEnabled(trigger) || subtypeOf(trigger) !== 'alert') return [];
        return [{ id: row.id, config: trigger.data.config || {} }];
      });
    }
    return this.cache;
  }

  async handle(event, alert) {
    try {
      for (const { id, config } of await this.alertAutomations()) {
        if (!alertTriggerMatches(config, event, alert)) continue;
        if (config.deviceGroupId && !(await deviceInGroup(alert.deviceId, config.deviceGroupId))) continue;
        const { getQueue } = require('../../config/bull');
        await getQueue('automation').add('run', {
          automationId: id,
          deviceId: alert.deviceId || null,
          alertId: alert.id,
          trigger: `alert:${event}`,
        }, {
          ...RUN_JOB_OPTIONS,
          jobId: `alert:${id}:${alert.id}:${event}`, // a repeated event doesn't start a second run
        });
        logger.info('Automation queued by alert', { automationId: id, alertId: alert.id, event });
      }
    } catch (error) {
      logger.warn(`Alert trigger for ${alert.id} failed: ${error.message}`);
    }
  }
}

module.exports = new AutomationTriggerService();
module.exports.AutomationTriggerService = AutomationTriggerService;
