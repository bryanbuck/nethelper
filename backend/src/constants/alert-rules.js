/**
 * Built-in alert rules (services/alert.service.js).
 *
 * Each rule opens at most one alert per subject (device, port, integration,
 * scope) and resolves it on its own when the condition clears. Admins can
 * turn a rule off and change its severity and settle time (AlertRule rows
 * override these defaults); the conditions themselves are fixed.
 *
 * callerSeverity: the caller may pass payload.severity, which wins over the
 * rule's (automations pick a severity per Raise alert step).
 *
 * settleSeconds: how long a condition must hold before the alert opens. A
 * condition that clears inside that window never becomes an alert, which is
 * what keeps a PoE phone's boot-time link bounce out of the list.
 */

const SEVERITIES = ['info', 'warning', 'critical'];
const STATUSES = ['open', 'acknowledged', 'resolved'];
const MAX_SETTLE_SECONDS = 3600;

const ALERT_RULES = {
  'device.offline': {
    label: 'Device offline (ping)',
    description: 'The ping monitor marks a device offline after its consecutive-failure threshold.',
    severity: 'critical',
    settleSeconds: 0,
  },
  'device.cloud-offline': {
    label: 'Device offline (cloud)',
    description: 'A cloud provider reports a device offline at sync time.',
    severity: 'warning',
    settleSeconds: 0,
  },
  'live.poe-fault': {
    label: 'PoE fault',
    description: 'A live-monitored switch port reports a PoE fault.',
    severity: 'warning',
    settleSeconds: 30,
  },
  'live.monitor-down': {
    label: 'Live monitor lost',
    description: 'The live monitor lost its session to a device with Always monitor on.',
    severity: 'warning',
    settleSeconds: 120,
  },
  'backup.failed': {
    label: 'Config backup failed',
    description: 'A device or cloud-scope config backup fails (platforms that have nothing to back up are skipped).',
    severity: 'warning',
    settleSeconds: 0,
  },
  'sync.failed': {
    label: 'Cloud sync failed',
    description: 'A device sync from a cloud integration fails after its retries.',
    severity: 'warning',
    settleSeconds: 0,
  },
  'automation.raised': {
    label: 'Raised by automation',
    description: 'An automation\'s Raise alert step. The step may set its own severity; this one is the default.',
    severity: 'warning',
    settleSeconds: 0,
    callerSeverity: true,
  },
};

module.exports = { ALERT_RULES, SEVERITIES, STATUSES, MAX_SETTLE_SECONDS };
