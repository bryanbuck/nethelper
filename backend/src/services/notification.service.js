/**
 * Delivery of alert notifications: email over SMTP and webhook POSTs, plus
 * the message text both use. notification-channel.service.js decides what
 * goes where; this module only sends, and throws on failure so the Bull job
 * can retry and the channel can show why.
 *
 * Email uses SMTP_* from the environment (an unauthenticated relay needs only
 * SMTP_HOST). Webhook URLs carry their secret in the path (Slack, Teams), so
 * they are never logged.
 */

const nodemailer = require('nodemailer');
const axios = require('axios');
const { ALERT_RULES } = require('../constants/alert-rules');
const logger = require('../utils/logger');

const WEBHOOK_TIMEOUT_MS = 5000;

/** The public address of the web UI, for links in notifications ('' when unknown). */
function appBaseUrl(env = process.env) {
  const candidates = [env.APP_BASE_URL, (env.CORS_ORIGINS || '').split(',')[0], env.FRONTEND_URL];
  const url = candidates.map((c) => (c || '').trim()).find(Boolean) || '';
  return url.replace(/\/+$/, '');
}

const ruleLabel = (rule) => ALERT_RULES[rule]?.label || rule;

/**
 * Subject, plain text and webhook payload for one alert notification.
 * @param {'opened'|'resolved'|'test'} event
 * @param {object} alert - snapshot: id, rule, severity, title, message, device {id,name}|null, port, firstSeenAt, resolvedAt, occurrences
 */
function formatAlert(event, alert, baseUrl = appBaseUrl()) {
  const url = baseUrl ? `${baseUrl}/alerts` : null;
  const severity = (alert.severity || 'info').toUpperCase();
  const subject = event === 'resolved'
    ? `[Resolved] ${alert.title}`
    : `${event === 'test' ? '[Test] ' : ''}[${severity}] ${alert.title}`;
  const lines = [
    event === 'resolved' ? `Resolved: ${alert.title}` : alert.title,
    alert.message,
    '',
    `Rule: ${ruleLabel(alert.rule)}`,
    `Severity: ${alert.severity}`,
    ...(alert.device ? [`Device: ${alert.device.name}${alert.port ? ` (port ${alert.port})` : ''}`] : []),
    `Opened: ${new Date(alert.firstSeenAt).toISOString()}`,
    ...(alert.resolvedAt ? [`Resolved: ${new Date(alert.resolvedAt).toISOString()}`] : []),
    ...(url ? ['', url] : []),
  ].filter((line) => line !== undefined && line !== null);
  const text = lines.join('\n');
  const payload = {
    event: `alert.${event}`,
    // Slack and Teams incoming webhooks show `text` as the message.
    text: `${subject}${alert.message ? `\n${alert.message}` : ''}${url ? `\n${url}` : ''}`,
    alert: {
      id: alert.id,
      rule: alert.rule,
      ruleLabel: ruleLabel(alert.rule),
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      device: alert.device || null,
      port: alert.port || null,
      occurrences: alert.occurrences ?? 1,
      firstSeenAt: alert.firstSeenAt,
      resolvedAt: alert.resolvedAt || null,
      url,
    },
    sentAt: new Date().toISOString(),
  };
  return { subject, text, payload };
}

const PROVIDER_LABELS = { aruba_central: 'Aruba Central', juniper_mist: 'Juniper Mist', cisco_meraki: 'Cisco Meraki' };

/**
 * Subject, plain text and webhook payload for a cloud alarm (CloudAlarm
 * snapshot from cloud-alarm.service alarmSnapshot()).
 * @param {'raised'|'cleared'} event
 */
function formatCloudAlarm(event, alarm, baseUrl = appBaseUrl()) {
  const cloud = alarm.integrationName || PROVIDER_LABELS[alarm.provider] || 'The cloud';
  const where = alarm.device?.name ? ` on ${alarm.device.name}` : alarm.siteName ? ` at ${alarm.siteName}` : '';
  const title = `${alarm.name}${where}`;
  const alreadyCleared = event === 'raised' && alarm.status === 'cleared';
  // Central clears some alerts on a timer: that is not the problem going away.
  const timerClear = /timer/i.test(alarm.clearedReason || '');
  const query = new URLSearchParams({ categories: 'cloud-alarm', ...(alarm.device?.id && { deviceId: alarm.device.id }) });
  const url = baseUrl ? `${baseUrl}/activity?${query}` : null;
  const subject = event === 'cleared'
    ? `[Cleared] ${cloud}: ${title}`
    : `[${(alarm.severity || 'info').toUpperCase()}] ${cloud}: ${title}`;
  const lines = [
    `${event === 'cleared' ? 'Cleared: ' : ''}${title}`,
    alarm.summary,
    '',
    `Cloud: ${cloud}`,
    `Alarm: ${alarm.name}${alarm.type && alarm.type !== alarm.name ? ` (${alarm.type})` : ''}`,
    `Severity: ${alarm.severity}`,
    ...(alarm.device?.name ? [`Device: ${alarm.device.name}`] : []),
    ...(alarm.siteName ? [`Site: ${alarm.siteName}`] : []),
    ...(alarm.count > 1 ? [`Incidents: ${alarm.count}`] : []),
    `Raised: ${new Date(alarm.raisedAt).toISOString()}`,
    ...(alarm.clearedAt && (event === 'cleared' || alreadyCleared) ? [`Cleared: ${new Date(alarm.clearedAt).toISOString()}${alarm.clearedReason ? ` (${alarm.clearedReason})` : ''}`] : []),
    ...(timerClear && (event === 'cleared' || alreadyCleared) ? ['Cleared by the cloud\'s alert timer: the problem may not be fixed.'] : []),
    '',
    `Raised by ${cloud}; acknowledge or clear it there.`,
    ...(url ? [url] : []),
  ].filter((line) => line !== undefined && line !== null);
  const payload = {
    event: `cloud-alarm.${event}`,
    text: `${subject}${alarm.summary ? `\n${alarm.summary}` : ''}${url ? `\n${url}` : ''}`,
    cloudAlarm: { ...alarm, integrationName: cloud, url },
    sentAt: new Date().toISOString(),
  };
  return { subject, text: lines.join('\n'), payload };
}

class NotificationService {
  constructor() {
    this.transport = null;
  }

  /** SMTP is usable: SMTP_HOST is set (credentials optional). */
  emailConfigured() {
    return Boolean(process.env.SMTP_HOST);
  }

  emailTransport() {
    if (!this.emailConfigured()) {
      throw new Error('Email is not configured on the server (set SMTP_HOST, see docs/CONFIGURATION.md)');
    }
    if (!this.transport) {
      const port = parseInt(process.env.SMTP_PORT, 10) || 587;
      this.transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
        ...(process.env.SMTP_USER && { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }),
      });
    }
    return this.transport;
  }

  async sendEmail(recipients, subject, text) {
    const result = await this.emailTransport().sendMail({
      from: process.env.SMTP_FROM || 'nethelper@localhost',
      to: recipients.join(', '),
      subject,
      text,
    });
    logger.info('Notification email sent', { recipients: recipients.length, messageId: result.messageId });
  }

  /** POST JSON; any non-2xx or network failure throws (without the URL). */
  async postWebhook(url, headers, payload) {
    try {
      await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json', ...headers },
        timeout: WEBHOOK_TIMEOUT_MS,
        maxRedirects: 0,
      });
    } catch (error) {
      const status = error.response?.status;
      throw new Error(status ? `The webhook answered HTTP ${status}` : `The webhook could not be reached (${error.code || error.message})`);
    }
  }
}

module.exports = new NotificationService();
module.exports.formatAlert = formatAlert;
module.exports.formatCloudAlarm = formatCloudAlarm;
module.exports.appBaseUrl = appBaseUrl;
module.exports.WEBHOOK_TIMEOUT_MS = WEBHOOK_TIMEOUT_MS;
