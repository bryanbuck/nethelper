/**
 * The automation nodes that actually run. Every other node the builder
 * offers is reported as not runnable yet (engine.validate), never faked.
 * Mirrored by RUNNABLE_NODES in frontend/src/models/automation-nodes.js.
 *
 * Each entry: { needsDevice?, needsAlert?, validate(config) -> string[],
 * run(ctx, config) -> result }. Conditions return true or false (the branch
 * taken); a thrown error fails the node.
 *
 * ctx: { automation: {id, name}, device?, alert?, configChange?, executionId }
 * (configChange: { backupId, previousBackupId, changedKinds } on a
 * Configuration Change run)
 *
 * Nothing here writes to a device or a cloud. Services a step calls are
 * required inside run(), so loading this registry stays cheap (the frontend
 * parity spec loads it).
 */

const { CronExpressionParser } = require('cron-parser');
const { getPrisma } = require('../../config/database');
const alertService = require('../alert.service');
const { effectiveStatus } = require('../../utils/device-status');
const { ALERT_RULES, SEVERITIES } = require('../../constants/alert-rules');
const { isStored } = require('./secrets');

const AUTOMATION_RULE = 'automation.raised';
const ALERT_EVENTS = ['opened', 'resolved'];
const CONFIG_KINDS = ['cli', 'structured']; // ConfigBackupArtifact kinds

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

/** Where in the web UI this run's subject is ('' when the app's address is unknown). */
function runLink(ctx) {
  const { appBaseUrl } = require('../notification.service');
  const base = appBaseUrl();
  if (!base) return '';
  if (ctx.configChange && ctx.device) return `${base}/devices/${ctx.device.id}?tab=history`;
  if (ctx.alert) return `${base}/alerts`;
  if (ctx.device) return `${base}/devices/${ctx.device.id}`;
  return `${base}/automations/executions`;
}

/**
 * Fill {{device.name}} (any stored device field), {{alert.title}},
 * {{alert.severity}}, {{automation.name}}, {{change.kinds}} and {{link}}.
 * A value that isn't there renders empty. `escape` fits the value to where
 * it lands (a JSON string, a URL).
 */
function render(text, ctx, escape = (value) => value) {
  const scopes = {
    device: ctx.device,
    alert: ctx.alert,
    automation: ctx.automation,
    change: ctx.configChange && { kinds: (ctx.configChange.changedKinds || []).join(', ') },
  };
  return String(text || '').replace(/\{\{\s*(?:(device|alert|automation|change)\.(\w+)|(link))\s*\}\}/g, (_, scope, field, link) => {
    const value = link ? runLink(ctx) : scopes[scope]?.[field];
    return value == null || typeof value === 'object' ? '' : escape(String(value));
  });
}

/** The inside of a JSON string literal (a template value placed between quotes in a JSON body). */
const jsonEscape = (value) => JSON.stringify(value).slice(1, -1);

/** Subject and text a notification step sends when its own are left empty. */
function defaultMessage(ctx) {
  const subject = `${ctx.automation.name}${ctx.device ? `: ${ctx.device.name}` : ''}`;
  const link = runLink(ctx);
  const lines = [
    ...(ctx.alert ? [`Alert (${ctx.alert.severity}): ${ctx.alert.title}`] : []),
    ...(ctx.configChange ? [`Configuration changed${ctx.device ? ` on ${ctx.device.name}` : ''}${ctx.configChange.changedKinds?.length ? ` (${ctx.configChange.changedKinds.join(', ')})` : ''}`] : []),
    ...(!ctx.alert && !ctx.configChange ? [`Automation "${ctx.automation.name}" ran${ctx.device ? ` on ${ctx.device.name}` : ''}.`] : []),
    ...(link ? [link] : []),
  ];
  return { subject, text: lines.join('\n') };
}

/** What a notification step says: its own subject/message (templated), else the default. */
function composeMessage(ctx, config) {
  const fallback = defaultMessage(ctx);
  return {
    subject: render(config.subject, ctx).trim() || fallback.subject,
    text: render(config.message, ctx).trim() || fallback.text,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 20;
const MAX_HEADERS = 10;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function validTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** { day: 0-6 (Sunday = 0), minutes since midnight } of `date` in a timezone. */
function localTime(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: DAYS.indexOf(parts.weekday.toLowerCase()), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * Is `date` inside the window? The end is exclusive. A window whose end is
 * not after its start runs past midnight (22:00–06:00), and its days are the
 * days it starts on: Friday 22:00–06:00 covers Saturday 03:00.
 */
function inTimeWindow(config, date = new Date()) {
  const { day, minutes } = localTime(date, config.timezone || 'UTC');
  const start = minutesOf(config.startTime);
  const end = minutesOf(config.endTime);
  const days = config.days?.length ? config.days.map((d) => DAYS.indexOf(d)) : null;
  const onDay = (d) => !days || days.includes(d);
  if (start < end) return minutes >= start && minutes < end && onDay(day);
  if (minutes >= start) return onDay(day);
  if (minutes < end) return onDay((day + 6) % 7);
  return false;
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

/** Does a Configuration Change trigger's config match this change? Group membership is checked by the caller. */
function configChangeTriggerMatches(config, change) {
  if (!config.kinds?.length) return true;
  return (change.changedKinds || []).some((kind) => config.kinds.includes(kind));
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

  'trigger:config-change': {
    validate(config) {
      const errors = [];
      if (config.deviceGroupId != null && typeof config.deviceGroupId !== 'string') errors.push('deviceGroupId must be an id');
      if (config.kinds != null && !(Array.isArray(config.kinds) && config.kinds.every((k) => CONFIG_KINDS.includes(k)))) {
        errors.push(`kinds must be a list of ${CONFIG_KINDS.join(', ')}`);
      }
      return errors;
    },
    run: (ctx) => ({
      backupId: ctx.configChange?.backupId,
      previousBackupId: ctx.configChange?.previousBackupId,
      changedKinds: ctx.configChange?.changedKinds,
    }),
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

  // Starts a scan and moves on: results land on the Discovery page. One scan
  // runs at a time, so a run per device starts one and the rest report that.
  'action:run-discovery': {
    validate(config) {
      if (config.subnets == null) return [];
      if (!Array.isArray(config.subnets)) return ['subnets must be a list'];
      const discoveryService = require('../discovery.service');
      const invalid = config.subnets.filter((s) => !discoveryService.isValidCidr(String(s)));
      return invalid.length ? [`invalid subnet(s) ${invalid.join(', ')} (a CIDR between /16 and /32)`] : [];
    },
    async run(ctx, config) {
      const discoveryService = require('../discovery.service');
      let scan;
      try {
        scan = await discoveryService.createScan(config.subnets || [], null);
      } catch (error) {
        if (error.statusCode === 409) return { started: false, reason: 'a discovery scan is already in progress' };
        throw error;
      }
      const { getQueue } = require('../../config/bull');
      await getQueue('discovery').add('runScan', { scanId: scan.id, triggeredBy: `automation ${ctx.automation.id}` }, { attempts: 1 });
      return { started: true, scanId: scan.id, subnets: scan.subnets };
    },
  },

  // An outbound call to another system. Header values are secrets (secrets.js);
  // the URL and body are templated. Anything but a 2xx answer fails the step.
  'action:http-request': {
    validate(config) {
      const { METHODS, checkUrl } = require('./http-request');
      const errors = [];
      if (!METHODS.includes(config.method || 'POST')) errors.push(`method must be one of ${METHODS.join(', ')}`);
      if (!String(config.url ?? '').trim()) errors.push('url is required');
      else {
        try {
          checkUrl(render(config.url, { automation: {} }));
        } catch (error) {
          errors.push(error.message);
        }
      }
      const headers = config.headers ?? [];
      if (!Array.isArray(headers)) errors.push('headers must be a list');
      else {
        if (headers.length > MAX_HEADERS) errors.push(`at most ${MAX_HEADERS} headers`);
        for (const h of headers) {
          if (!HEADER_NAME_RE.test(h?.name || '')) errors.push(`"${h?.name}" is not a valid header name`);
          else if (!isStored(h.value)) errors.push(`header "${h.name}" needs its value entered again`);
        }
      }
      const body = String(config.body ?? '').trim();
      if (body && /^[[{]/.test(body)) {
        try {
          JSON.parse(render(body, { automation: {} }));
        } catch {
          errors.push('the body looks like JSON but is not valid JSON');
        }
      }
      return errors;
    },
    async run(ctx, config) {
      const { request } = require('./http-request');
      const { revealHeaders } = require('./secrets');
      const method = config.method || 'POST';
      const headers = revealHeaders(config.headers);
      const template = String(config.body ?? '').trim();
      const isJson = /^[[{]/.test(template);
      let body;
      if (template && method !== 'GET') {
        body = render(template, ctx, isJson ? jsonEscape : undefined);
        if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = isJson ? 'application/json' : 'text/plain; charset=utf-8';
        }
      }
      const answer = await request({ method, url: render(config.url, ctx, encodeURIComponent), headers, body });
      if (!answer.ok) throw new Error(`${method} answered HTTP ${answer.status}${answer.body ? `: ${answer.body.slice(0, 200)}` : ''}`);
      return { status: answer.status, durationMs: answer.durationMs, body: answer.body };
    },
  },

  // Sends through a channel from Settings → Notifications (a Slack or Teams
  // webhook, any webhook, or an email list). The channel keeps the address
  // and its secrets; the graph holds only its id.
  'notification:channel': {
    validate: (config) => required(config, ['channelId']),
    async run(ctx, config) {
      const channels = require('../notification-channel.service');
      const { subject, text } = composeMessage(ctx, config);
      const link = runLink(ctx);
      const channel = await channels.sendMessage(config.channelId, {
        subject,
        text,
        payload: {
          event: 'automation.notification',
          // Slack and Teams incoming webhooks show `text` as the message.
          text: `${subject}\n${text}`,
          automation: ctx.automation,
          device: ctx.device ? { id: ctx.device.id, name: ctx.device.name } : null,
          alert: ctx.alert ? { id: ctx.alert.id, rule: ctx.alert.rule, severity: ctx.alert.severity, title: ctx.alert.title } : null,
          configChange: ctx.configChange || null,
          url: link || null,
          sentAt: new Date().toISOString(),
        },
      });
      return { sentTo: channel.name, type: channel.type };
    },
  },

  // Email to addresses named on the step, over the server's SMTP settings.
  'notification:email': {
    validate(config) {
      const recipients = Array.isArray(config.recipients) ? config.recipients.map((r) => String(r).trim()).filter(Boolean) : [];
      if (!recipients.length) return ['add at least one recipient'];
      if (recipients.length > MAX_RECIPIENTS) return [`at most ${MAX_RECIPIENTS} recipients`];
      const invalid = recipients.find((r) => !EMAIL_RE.test(r));
      return invalid ? [`"${invalid}" is not an email address`] : [];
    },
    async run(ctx, config) {
      const notifier = require('../notification.service');
      const recipients = config.recipients.map((r) => String(r).trim()).filter(Boolean);
      const { subject, text } = composeMessage(ctx, config);
      await notifier.sendEmail(recipients, subject, text);
      return { sentTo: recipients.length, subject };
    },
  },

  'condition:time-window': {
    validate(config) {
      const errors = [];
      for (const field of ['startTime', 'endTime']) {
        if (!TIME_RE.test(config[field] || '')) errors.push(`${field} must be a time like 08:00`);
      }
      if (!errors.length && config.startTime === config.endTime) errors.push('startTime and endTime are the same');
      if (config.days != null && !(Array.isArray(config.days) && config.days.every((d) => DAYS.includes(d)))) {
        errors.push('days must be a list of weekdays');
      }
      if (config.timezone && !validTimezone(config.timezone)) errors.push(`unknown timezone ${config.timezone}`);
      return errors;
    },
    run: (ctx, config) => inTimeWindow(config),
  },
};

/** Is deviceId a member of the device group (alert and config change triggers can be scoped to a group)? */
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
  configChangeTriggerMatches,
  deviceInGroup,
  render,
  parseSchedule,
  inTimeWindow,
  defaultMessage,
};
