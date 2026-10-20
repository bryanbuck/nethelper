// Display metadata for alerts. Rule keys mirror backend constants/alert-rules.js;
// the rules' labels and descriptions themselves come from GET /alerts/rules.

export const ALERT_SEVERITIES = [
  { value: 'critical', title: 'Critical', color: 'error', icon: 'mdi-alert-octagon' },
  { value: 'warning', title: 'Warning', color: 'warning', icon: 'mdi-alert' },
  { value: 'info', title: 'Info', color: 'info', icon: 'mdi-information' }
]

export const ALERT_STATUSES = [
  { value: 'open', title: 'Open', color: 'error' },
  { value: 'acknowledged', title: 'Acknowledged', color: 'warning' },
  { value: 'resolved', title: 'Resolved', color: 'success' }
]

// Rule key -> short label for the table and the rule filter
export const ALERT_RULE_LABELS = {
  'device.offline': 'Offline (ping)',
  'device.cloud-offline': 'Offline (cloud)',
  'device.cloud-config': 'Config out of sync (cloud)',
  'live.poe-fault': 'PoE fault',
  'live.monitor-down': 'Live monitor lost',
  'backup.failed': 'Backup failed',
  'sync.failed': 'Cloud sync failed',
  'automation.raised': 'Raised by automation'
}

export const severityMeta = (severity) =>
  ALERT_SEVERITIES.find((s) => s.value === severity) || ALERT_SEVERITIES[2]

export const statusMeta = (status) =>
  ALERT_STATUSES.find((s) => s.value === status) || ALERT_STATUSES[0]

/** Where an alert's subject lives in the app. */
export function alertLink(alert) {
  if (alert.rule === 'automation.raised' && !alert.deviceId && alert.data?.automationId) {
    return { path: `/automations/builder/${alert.data.automationId}` }
  }
  if (alert.deviceId) {
    return alert.rule?.startsWith('live.')
      ? { path: `/devices/${alert.deviceId}`, query: { tab: 'live' } }
      : { path: `/devices/${alert.deviceId}` }
  }
  if (alert.rule === 'backup.failed') return { path: '/devices/backups' }
  if (alert.rule === 'sync.failed') return { path: '/settings' }
  return null
}
