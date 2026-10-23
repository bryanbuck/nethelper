/**
 * Starts automations from events. Queues an automation 'run' job for every
 * active, enabled automation whose trigger matches:
 *   - Alert: the alert service's in-process 'opened'/'resolved' events.
 *     Alerts already carry their rule's settle time and dedup, so a bouncing
 *     condition doesn't start a run per bounce.
 *   - Configuration Change: the config backup service's 'changed' event (a
 *     device backup that differs from its previous successful one). Changes
 *     are seen when a backup runs, so detection follows the backup schedule.
 *
 * The automations are cached; the automation routes call invalidate() on
 * every write. Single-instance assumption, like the alert service.
 */

const { getPrisma } = require('../../config/database');
const alertService = require('../alert.service');
const logger = require('../../utils/logger');
const { parseGraph, subtypeOf, isEnabled } = require('./graph');
const { alertTriggerMatches, configChangeTriggerMatches, deviceInGroup } = require('./nodes');
const { RUN_JOB_OPTIONS } = require('./runs');

const EVENT_TRIGGERS = ['alert', 'config-change'];

// Lazy: the config backup service pulls in every transport.
const configBackupEvents = () => require('../config-backup.service').events;

class AutomationTriggerService {
  constructor() {
    this.cache = null;
    this.onOpened = (alert) => this.handle('opened', alert);
    this.onResolved = (alert) => this.handle('resolved', alert);
    this.onConfigChanged = (change) => this.handleConfigChange(change);
  }

  start() {
    alertService.on('opened', this.onOpened);
    alertService.on('resolved', this.onResolved);
    configBackupEvents().on('changed', this.onConfigChanged);
  }

  stop() {
    alertService.off('opened', this.onOpened);
    alertService.off('resolved', this.onResolved);
    configBackupEvents().off('changed', this.onConfigChanged);
  }

  invalidate() {
    this.cache = null;
  }

  /** Active, enabled automations with an enabled event trigger of this type: [{ id, config }]. */
  async automationsFor(type) {
    if (!this.cache) {
      const rows = await getPrisma().automation.findMany({
        where: { active: true, enabled: true },
        select: { id: true, elements: true },
      });
      this.cache = rows.flatMap((row) => {
        const { trigger } = parseGraph(row.elements);
        if (!trigger || !isEnabled(trigger) || !EVENT_TRIGGERS.includes(subtypeOf(trigger))) return [];
        return [{ id: row.id, type: subtypeOf(trigger), config: trigger.data.config || {} }];
      });
    }
    return this.cache.filter((a) => a.type === type);
  }

  async queue(automationId, data, jobId) {
    const { getQueue } = require('../../config/bull');
    await getQueue('automation').add('run', { automationId, ...data }, { ...RUN_JOB_OPTIONS, jobId });
  }

  async handle(event, alert) {
    try {
      for (const { id, config } of await this.automationsFor('alert')) {
        if (!alertTriggerMatches(config, event, alert)) continue;
        if (config.deviceGroupId && !(await deviceInGroup(alert.deviceId, config.deviceGroupId))) continue;
        await this.queue(id, {
          deviceId: alert.deviceId || null,
          alertId: alert.id,
          trigger: `alert:${event}`,
        }, `alert:${id}:${alert.id}:${event}`); // a repeated event doesn't start a second run
        logger.info('Automation queued by alert', { automationId: id, alertId: alert.id, event });
      }
    } catch (error) {
      logger.warn(`Alert trigger for ${alert.id} failed: ${error.message}`);
    }
  }

  async handleConfigChange({ device, backupId, previousBackupId, changedKinds }) {
    try {
      for (const { id, config } of await this.automationsFor('config-change')) {
        if (!configChangeTriggerMatches(config, { changedKinds })) continue;
        if (config.deviceGroupId && !(await deviceInGroup(device.id, config.deviceGroupId))) continue;
        await this.queue(id, {
          deviceId: device.id,
          configChange: { backupId, previousBackupId, changedKinds },
          trigger: 'config-change',
        }, `config:${id}:${backupId}`);
        logger.info('Automation queued by config change', { automationId: id, deviceId: device.id, backupId });
      }
    } catch (error) {
      logger.warn(`Config change trigger for backup ${backupId} failed: ${error.message}`);
    }
  }
}

module.exports = new AutomationTriggerService();
module.exports.AutomationTriggerService = AutomationTriggerService;
