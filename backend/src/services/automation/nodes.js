/**
 * The automation nodes that actually run. Every other node the builder
 * offers is reported as not runnable yet (engine.validate), never faked.
 * Mirrored by RUNNABLE_NODES in frontend/src/models/automation-nodes.js.
 *
 * Each entry: { needsDevice?, needsAlert?, validate(config) -> string[],
 * run(ctx, config) -> result }. Conditions return true or false (the branch
 * taken); a thrown error fails the node.
 *
 * ctx: { automation: {id, name}, device?, alert?, executionId }
 */

const { CronExpressionParser } = require('cron-parser');
const { getPrisma } = require('../../config/database');
const alertService = require('../alert.service');
const { effectiveStatus } = require('../../utils/device-status');
const { ALERT_RULES, SEVERITIES } = require('../../constants/alert-rules');

const AUTOMATION_RULE = 'automation.raised';
const ALERT_EVENTS = ['opened', 'resolved'];

// Device fields a condition can test (what NetHelper actually stores).
const DEVICE_PROPERTIES = {
  status: (d) => effectiveStatus(d),
  cloudStatus: (d) => d.cloudStatus,
  type: (d) => d.type,
  vendor: (d) => d.vendor,
  platform: (d) => d.platform,
  managementMode: (d) => d.managementMode,
  model: (d) => d.model,
  name: (d) => d.name,
};
const STRING_OPERATORS = ['=', '!=', 'contains'];
const SEVERITY_OPERATORS = ['=', '>=', '<='];

const severityRank = (s) => SEVERITIES.indexOf(s);

/**
 * Subject of an automation-raised alert. Keys are shared across automations
 * (one raises on 'opened', another clears on 'resolved'), never with the
 * built-in rules, which live under their own rule keys.
 */
function automationSubject(key, deviceId) {
  return `${key}:${deviceId || 'global'}`;
}

/** Fill {{device.name}}, {{alert.title}}, {{alert.severity}}, {{automation.name}}. */
function render(text, ctx) {
  return String(text || '').replace(/\{\{\s*(device|alert|automation)\.(\w+)\s*\}\}/g, (_, scope, field) => {
    const value = ctx[scope]?.[field];
    return value == null ? '' : String(value);
  });
}

/** Device ids and group ids a Manual or Schedule trigger runs on (both optional). */
function validateTargets(config) {
  const errors = [];
  for (const field of ['deviceIds', 'deviceGroupIds']) {
    if (config[field] != null && !(Array.isArray(config[field]) && config[field].every((v) => typeof v === 'string'))) {
      errors.push(`${field} must be a list of ids`);
    }
  }
  return errors;
}

/** Parse a Schedule trigger's cron expression; throws with a readable message. */
function parseSchedule(config) {
  const timezone = config.timezone || 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`unknown timezone ${timezone}`);
  }
  try {
    return CronExpressionParser.parse(String(config.schedule || '').trim(), { tz: timezone });
  } catch (error) {
    throw new Error(`invalid cron expression "${config.schedule}": ${error.message}`);
  }
}

function required(config, fields) {
  return fields.filter((f) => !String(config[f] ?? '').trim()).map((f) => `${f} is required`);
}

/** Does an alert trigger's config match this alert event? Group membership is checked by the caller. */
function alertTriggerMatches(config, event, alert) {
  if (alert.rule === AUTOMATION_RULE) return false; // automations never trigger on their own alerts
  if ((config.event || 'opened') !== event) return false;
  if (config.rules?.length && !config.rules.includes(alert.rule)) return false;
  if (config.minSeverity && severityRank(alert.severity) < severityRank(config.minSeverity)) return false;
  return true;
}

const NODES = {
  'trigger:manual': {
    validate: validateTargets,
    run: () => ({ started: 'manual' }),
  },

  'trigger:schedule': {
    validate(config) {
      const errors = [...validateTargets(config), ...required(config, ['schedule'])];
      if (!errors.length) {
        try {
          parseSchedule(config);
        } catch (error) {
          errors.push(error.message);
        }
      }
      return errors;
    },
    run: (ctx, config) => ({ started: 'schedule', schedule: config.schedule, timezone: config.timezone || 'UTC' }),
  },

  'trigger:alert': {
    validate(config) {
      const errors = [];
      if (config.event && !ALERT_EVENTS.includes(config.event)) errors.push(`event must be one of ${ALERT_EVENTS.join(', ')}`);
      for (const rule of config.rules || []) {
        if (!ALERT_RULES[rule] || rule === AUTOMATION_RULE) errors.push(`unknown alert rule ${rule}`);
      }
      if (config.minSeverity && !SEVERITIES.includes(config.minSeverity)) errors.push('minSeverity is not a severity');
      return errors;
    },
    run: (ctx) => ({ alertId: ctx.alert?.id, rule: ctx.alert?.rule }),
  },

  'condition:device-property': {
    needsDevice: true,
    validate(config) {
      const errors = required(config, ['property']);
      if (config.property && !DEVICE_PROPERTIES[config.property]) errors.push(`unknown device property ${config.property}`);
      if (!STRING_OPERATORS.includes(config.operator || '=')) errors.push(`operator must be one of ${STRING_OPERATORS.join(', ')}`);
      return errors;
    },
    run(ctx, config) {
      const actual = String(DEVICE_PROPERTIES[config.property](ctx.device) ?? '').toLowerCase();
      const expected = String(config.value ?? '').toLowerCase();
      switch (config.operator || '=') {
        case '!=': return actual !== expected;
        case 'contains': return actual.includes(expected);
        default: return actual === expected;
      }
    },
  },

  'condition:alert-severity': {
    needsAlert: true,
    validate(config) {
      const errors = [];
      if (!SEVERITIES.includes(config.severity)) errors.push('severity is required');
      if (!SEVERITY_OPERATORS.includes(config.operator || '>=')) errors.push(`operator must be one of ${SEVERITY_OPERATORS.join(', ')}`);
      return errors;
    },
    run(ctx, config) {
      const diff = severityRank(ctx.alert.severity) - severityRank(config.severity);
      switch (config.operator || '>=') {
        case '=': return diff === 0;
        case '<=': return diff <= 0;
        default: return diff >= 0;
      }
    },
  },

  'action:create-backup': {
    needsDevice: true,
    validate: () => [],
    async run(ctx) {
      const configBackupService = require('../config-backup.service');
      const ok = await configBackupService.backupDevice(ctx.device, { trigger: 'automation' });
      if (!ok) throw new Error(`Config backup of ${ctx.device.name} failed (see Backups)`);
      return { backedUp: ctx.device.name };
    },
  },

  'action:raise-alert': {
    validate(config) {
      const errors = required(config, ['key', 'title']);
      if (config.severity && !SEVERITIES.includes(config.severity)) errors.push('severity is not a severity');
      return errors;
    },
    async run(ctx, config) {
      const alert = await alertService.raise(AUTOMATION_RULE, {
        subjectKey: automationSubject(config.key.trim(), ctx.device?.id),
        deviceId: ctx.device?.id,
        title: render(config.title, ctx),
        message: render(config.message, ctx),
        severity: config.severity,
        data: { automationId: ctx.automation.id, automationName: ctx.automation.name, executionId: ctx.executionId, key: config.key.trim() },
      });
      // null: the rule is turned off in Settings → Alerts (or the write failed, which is logged).
      return alert ? { alertId: alert.id, occurrences: alert.occurrences } : { raised: false, reason: 'rule disabled or alert not written' };
    },
  },

  'action:clear-alert': {
    validate: (config) => required(config, ['key']),
    async run(ctx, config) {
      const alert = await alertService.clear(AUTOMATION_RULE, { subjectKey: automationSubject(config.key.trim(), ctx.device?.id) });
      return alert ? { clearedAlertId: alert.id } : { cleared: false, reason: 'no open alert with this key' };
    },
  },

  'action:acknowledge-alert': {
    needsAlert: true,
    validate: () => [],
    async run(ctx) {
      const [alert] = await alertService.acknowledge([ctx.alert.id], null, { automationId: ctx.automation.id });
      return { alertId: ctx.alert.id, status: alert?.status };
    },
  },
};

/** Is deviceId a member of the device group (alert triggers can be scoped to a group)? */
async function deviceInGroup(deviceId, groupId) {
  if (!deviceId) return false;
  const n = await getPrisma().device.count({ where: { id: deviceId, deviceGroups: { some: { id: groupId } } } });
  return n > 0;
}

module.exports = {
  NODES,
  AUTOMATION_RULE,
  DEVICE_PROPERTIES,
  automationSubject,
  alertTriggerMatches,
  deviceInGroup,
  render,
  parseSchedule,
};
