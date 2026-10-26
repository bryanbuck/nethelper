/**
 * Alert notification channels: where alerts go besides the app (email
 * recipients or a webhook such as a Slack or Teams incoming webhook).
 *
 * Listens to the alert service's in-process 'opened' and 'resolved' events
 * (the same ones automation triggers use: a bump is neither) and queues one
 * delivery job per matching channel on the Bull `notification` queue
 * (jobs/notification.job.js), which retries with backoff. A channel matches
 * when it is enabled, the alert's severity is at least its minSeverity, and
 * its rules list names the alert's rule (empty = every built-in rule;
 * automation.raised only when named).
 *
 * Channels with cloudAlarms on also deliver the clouds' own alarms (the
 * cloud-alarm mirror's 'raised' and 'cleared' events): severity at least
 * minSeverity, and the alarm's name or type in cloudAlarmNames (empty = any;
 * compared ignoring case, spaces, dashes and underscores, so "Port flap"
 * matches Central's "Port Flap" and Mist's port_flap). The alarm is still the
 * cloud's: NetHelper never acks or clears it there.
 *
 * A failed delivery is recorded on the channel and logged, never raised as an
 * alert (that could loop). Webhook URLs and header values are secrets:
 * field-encrypted at rest, never returned, and a blank or masked value on
 * update keeps the stored one. Channels are cached in memory and the cache
 * is dropped on every write (single instance, like the alert service).
 */

const { getPrisma } = require('../config/database');
const alertService = require('./alert.service');
const cloudAlarmService = require('./cloud-alarm.service');
const notifier = require('./notification.service');
const { formatAlert, formatCloudAlarm } = require('./notification.service');
const encryption = require('../utils/encryption');
const { ALERT_RULES, SEVERITIES } = require('../constants/alert-rules');
const logger = require('../utils/logger');

const TYPES = ['email', 'webhook'];
const SECRET_MASK = '***';
const MAX_RECIPIENTS = 20;
const MAX_HEADERS = 10;
const MAX_ALARM_NAMES = 50;
// Offered in the channel dialog before either cloud has raised them here.
const KNOWN_ALARM_NAMES = [
  { provider: 'aruba_central', name: 'Port Flap' },
  { provider: 'juniper_mist', name: 'Port flap' },
];
const CACHE_TTL_MS = 60 * 1000;
const JOB_OPTIONS = { attempts: 3, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: 100, removeOnFail: 100 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;

const rank = (severity) => SEVERITIES.indexOf(severity);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** A channel takes this alert: enabled, severe enough, and its rule is selected. */
function channelMatches(channel, alert) {
  if (!channel.enabled) return false;
  if (rank(alert.severity) < rank(channel.minSeverity)) return false;
  const rules = channel.rules || [];
  if (!rules.length) return alert.rule !== 'automation.raised';
  return rules.includes(alert.rule);
}

// "Port Flap", "port_flap" and "port-flap" are one name.
const alarmKey = (name) => String(name || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

/** A channel takes this cloud alarm: enabled, opted in, severe enough, and named (or no names). */
function channelTakesCloudAlarm(channel, alarm) {
  if (!channel.enabled || !channel.cloudAlarms) return false;
  if (rank(alarm.severity) < rank(channel.minSeverity)) return false;
  const names = (channel.cloudAlarmNames || []).map(alarmKey);
  if (!names.length) return true;
  return names.includes(alarmKey(alarm.name)) || names.includes(alarmKey(alarm.type));
}

/** What a notification says about the alert, frozen when it is queued. */
function alertSnapshot(alert) {
  return {
    id: alert.id,
    rule: alert.rule,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    device: alert.device ? { id: alert.device.id, name: alert.device.name } : null,
    port: alert.port || null,
    occurrences: alert.occurrences ?? 1,
    firstSeenAt: alert.firstSeenAt,
    resolvedAt: alert.resolvedAt || null,
  };
}

/** "https://hooks.slack.com/…": enough to recognise a webhook, without its secret path. */
function urlHint(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/…`;
}

class NotificationChannelService {
  constructor() {
    this.cache = null;
    this.onOpened = (alert) => this.dispatch('opened', alert);
    this.onResolved = (alert) => this.dispatch('resolved', alert);
    this.onAlarmRaised = (alarm) => this.dispatchCloudAlarm('raised', alarm);
    this.onAlarmCleared = (alarm) => this.dispatchCloudAlarm('cleared', alarm);
  }

  start() {
    alertService.on('opened', this.onOpened);
    alertService.on('resolved', this.onResolved);
    cloudAlarmService.events.on('raised', this.onAlarmRaised);
    cloudAlarmService.events.on('cleared', this.onAlarmCleared);
  }

  stop() {
    alertService.off('opened', this.onOpened);
    alertService.off('resolved', this.onResolved);
    cloudAlarmService.events.off('raised', this.onAlarmRaised);
    cloudAlarmService.events.off('cleared', this.onAlarmCleared);
  }

  invalidate() {
    this.cache = null;
  }

  async enabledChannels() {
    if (!this.cache || Date.now() - this.cache.at > CACHE_TTL_MS) {
      const rows = await getPrisma().notificationChannel.findMany({ where: { enabled: true } });
      this.cache = { at: Date.now(), rows };
    }
    return this.cache.rows;
  }

  /** Queue one delivery per matching channel. Never throws (it runs inside an event listener). */
  async dispatch(event, alert) {
    try {
      const channels = (await this.enabledChannels()).filter((channel) => channelMatches(channel, alert));
      if (!channels.length) return 0;
      const { getQueue } = require('../config/bull');
      const queue = getQueue('notification');
      const snapshot = alertSnapshot(alert);
      await Promise.all(channels.map((channel) =>
        queue.add('deliver', { channelId: channel.id, event, alert: snapshot }, JOB_OPTIONS)));
      return channels.length;
    } catch (error) {
      logger.warn(`Could not queue notifications for alert ${alert?.id}: ${error.message}`);
      return 0;
    }
  }

  /** Queue one delivery per channel that takes this cloud alarm. Never throws. */
  async dispatchCloudAlarm(event, alarm) {
    try {
      const channels = (await this.enabledChannels()).filter((channel) => channelTakesCloudAlarm(channel, alarm));
      if (!channels.length) return 0;
      const { getQueue } = require('../config/bull');
      const queue = getQueue('notification');
      await Promise.all(channels.map((channel) =>
        queue.add('deliver', { channelId: channel.id, event, cloudAlarm: alarm }, JOB_OPTIONS)));
      return channels.length;
    } catch (error) {
      logger.warn(`Could not queue notifications for cloud alarm ${alarm?.externalId}: ${error.message}`);
      return 0;
    }
  }

  /** Send one notification (an alert, or a cloud alarm) through a channel row. Throws on failure. */
  async send(channel, event, alert, cloudAlarm = null) {
    const { subject, text, payload } = cloudAlarm ? formatCloudAlarm(event, cloudAlarm) : formatAlert(event, alert);
    if (channel.type === 'email') {
      await notifier.sendEmail(channel.config.recipients || [], subject, text);
    } else if (channel.type === 'webhook') {
      const headers = Object.fromEntries(Object.entries(channel.config.headers || {})
        .map(([name, value]) => [name, encryption.decrypt(value)]));
      await notifier.postWebhook(encryption.decrypt(channel.config.url), headers, payload);
    } else {
      throw new Error(`Unknown channel type "${channel.type}"`);
    }
  }

  /**
   * The notification job's work: deliver, then record the outcome on the
   * channel. A failure is recorded only on the last attempt (earlier ones are
   * retried) and rethrown so Bull retries it.
   */
  async deliver({ channelId, event, alert, cloudAlarm }, { finalAttempt = true } = {}) {
    const prisma = getPrisma();
    const channel = await prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!channel || !channel.enabled) return { skipped: true };
    try {
      await this.send(channel, event, alert, cloudAlarm);
    } catch (error) {
      if (finalAttempt) {
        logger.warn(`Notification channel "${channel.name}" failed: ${error.message}`);
        await this.recordDelivery(channelId, 'failed', error.message);
      }
      throw error;
    }
    await this.recordDelivery(channelId, 'success', null);
    return { delivered: true };
  }

  async recordDelivery(channelId, status, error) {
    await getPrisma().notificationChannel.update({
      where: { id: channelId },
      data: { lastDeliveryAt: new Date(), lastDeliveryStatus: status, lastDeliveryError: error ? String(error).slice(0, 500) : null },
    }).catch((err) => logger.warn(`Could not record a notification delivery: ${err.message}`));
  }

  /** Send a sample notification now. Not retried, not recorded. @returns {{ success, error? }} */
  async test(channelId) {
    const channel = await getPrisma().notificationChannel.findUnique({ where: { id: channelId } });
    if (!channel) {
      const error = new Error('Notification channel not found');
      error.statusCode = 404;
      throw error;
    }
    const sample = {
      id: 'test',
      rule: 'device.offline',
      severity: 'critical',
      title: 'NetHelper test notification',
      message: `A test sent from Settings → Notifications for the channel "${channel.name}". No device is affected.`,
      device: null,
      firstSeenAt: new Date().toISOString(),
    };
    try {
      await this.send(channel, 'test', sample);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------
  // CRUD (admin only; routes in routes/settings.routes.js)
  // ---------------------------------------------------------------------

  /** A row as the API returns it: secrets replaced by hints and masks. */
  sanitize(channel) {
    const { config = {}, ...rest } = channel;
    const shown = channel.type === 'webhook'
      ? {
        url: config.url ? SECRET_MASK : null,
        urlHint: config.urlHint || null,
        insecure: Boolean(config.urlHint?.startsWith('http:')),
        headers: Object.fromEntries(Object.keys(config.headers || {}).map((name) => [name, SECRET_MASK])),
      }
      : { recipients: config.recipients || [] };
    return { ...rest, config: shown };
  }

  /** Validate and encrypt a config for storage; blank or masked secrets keep `existing`'s. */
  storedConfig(type, config = {}, existing = {}) {
    if (type === 'email') {
      const recipients = [...new Set((Array.isArray(config.recipients) ? config.recipients : [])
        .map((r) => String(r).trim().toLowerCase()).filter(Boolean))];
      if (!recipients.length) throw badRequest('Add at least one email recipient');
      if (recipients.length > MAX_RECIPIENTS) throw badRequest(`At most ${MAX_RECIPIENTS} recipients per channel`);
      const invalid = recipients.find((r) => !EMAIL_RE.test(r));
      if (invalid) throw badRequest(`"${invalid}" is not an email address`);
      return { recipients };
    }

    const stored = {};
    const url = typeof config.url === 'string' ? config.url.trim() : '';
    if (!url || url === SECRET_MASK) {
      if (!existing.url) throw badRequest('The webhook URL is required');
      stored.url = existing.url;
      stored.urlHint = existing.urlHint;
    } else {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw badRequest('The webhook URL is not a valid URL');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest('The webhook URL must start with https:// (or http://)');
      stored.url = encryption.encrypt(url);
      stored.urlHint = urlHint(url);
    }

    const headers = config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers) ? config.headers : {};
    const names = Object.keys(headers);
    if (names.length > MAX_HEADERS) throw badRequest(`At most ${MAX_HEADERS} headers`);
    stored.headers = {};
    for (const name of names) {
      if (!HEADER_NAME_RE.test(name)) throw badRequest(`"${name}" is not a valid header name`);
      const value = headers[name] == null ? '' : String(headers[name]);
      if (value === '' || value === SECRET_MASK) {
        if (existing.headers?.[name] === undefined) throw badRequest(`Header "${name}" needs a value`);
        stored.headers[name] = existing.headers[name];
      } else {
        stored.headers[name] = encryption.encrypt(value);
      }
    }
    return stored;
  }

  fields(data, existing = null) {
    const type = existing?.type || data.type;
    if (!TYPES.includes(type)) throw badRequest(`type must be one of: ${TYPES.join(', ')}`);
    const out = {};
    if (data.name !== undefined || !existing) {
      const name = String(data.name || '').trim();
      if (!name) throw badRequest('A name is required');
      out.name = name.slice(0, 100);
    }
    if (data.minSeverity !== undefined) {
      if (!SEVERITIES.includes(data.minSeverity)) throw badRequest(`minSeverity must be one of: ${SEVERITIES.join(', ')}`);
      out.minSeverity = data.minSeverity;
    }
    if (data.rules !== undefined) {
      if (!Array.isArray(data.rules)) throw badRequest('rules must be a list');
      const unknown = data.rules.find((rule) => !ALERT_RULES[rule]);
      if (unknown) throw badRequest(`Unknown alert rule "${unknown}"`);
      out.rules = [...new Set(data.rules)];
    }
    if (data.cloudAlarms !== undefined) out.cloudAlarms = Boolean(data.cloudAlarms);
    if (data.cloudAlarmNames !== undefined) {
      if (!Array.isArray(data.cloudAlarmNames)) throw badRequest('cloudAlarmNames must be a list');
      const names = [...new Set(data.cloudAlarmNames.map((n) => String(n).trim()).filter(Boolean))];
      if (names.length > MAX_ALARM_NAMES) throw badRequest(`At most ${MAX_ALARM_NAMES} cloud alarm names`);
      const long = names.find((n) => n.length > 100);
      if (long) throw badRequest(`"${long.slice(0, 40)}…" is too long for an alarm name`);
      out.cloudAlarmNames = names;
    }
    if (data.enabled !== undefined) out.enabled = Boolean(data.enabled);
    if (data.config !== undefined || !existing) out.config = this.storedConfig(type, data.config, existing?.config || {});
    return { type, ...out };
  }

  /**
   * Alarm names a channel can pick: the ones the clouds have raised here,
   * plus well-known ones not seen yet. [{ provider, name }], by name.
   */
  async cloudAlarmNames() {
    const seen = await getPrisma().cloudAlarm.findMany({
      distinct: ['provider', 'name'],
      select: { provider: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const all = [...seen];
    for (const known of KNOWN_ALARM_NAMES) {
      if (!all.some((s) => s.provider === known.provider && alarmKey(s.name) === alarmKey(known.name))) all.push(known);
    }
    return all.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.provider.localeCompare(b.provider));
  }

  async list() {
    const rows = await getPrisma().notificationChannel.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => this.sanitize(row));
  }

  async create(userId, data) {
    const { type, ...fields } = this.fields(data);
    const row = await getPrisma().notificationChannel.create({ data: { ...fields, type, userId } });
    this.invalidate();
    return this.sanitize(row);
  }

  async update(id, data) {
    const prisma = getPrisma();
    const existing = await prisma.notificationChannel.findUnique({ where: { id } });
    if (!existing) {
      const error = new Error('Notification channel not found');
      error.statusCode = 404;
      throw error;
    }
    const { type: _type, ...fields } = this.fields(data, existing);
    const row = await prisma.notificationChannel.update({ where: { id }, data: fields });
    this.invalidate();
    return this.sanitize(row);
  }

  async remove(id) {
    await getPrisma().notificationChannel.delete({ where: { id } });
    this.invalidate();
  }
}

module.exports = new NotificationChannelService();
module.exports.channelMatches = channelMatches;
module.exports.channelTakesCloudAlarm = channelTakesCloudAlarm;
module.exports.alertSnapshot = alertSnapshot;
module.exports.SECRET_MASK = SECRET_MASK;
module.exports.JOB_OPTIONS = JOB_OPTIONS;
