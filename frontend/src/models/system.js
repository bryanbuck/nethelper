/**
 * Display helpers for the System Status page (views/system/). Pure functions,
 * unit tested in tests/unit/system-store.spec.js.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${Math.round(seconds)}s`
}

export function formatNumber(value) {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString()
}

export function formatPercent(value, digits = 0) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`
}

export function formatMs(value) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value >= 100 ? `${Math.round(value)} ms` : `${value.toFixed(1)} ms`
}

/** Requests in one sample interval as a per-minute rate. */
export function perMinute(count, intervalMs) {
  if (count == null || !intervalMs) return null
  return (count * 60000) / intervalMs
}

/**
 * The highest `point[key]` in a series and when it was sampled, or null when
 * no point has a value. A null sample is a failed read, not a zero, so it is
 * skipped.
 */
export function peakOf(points, key) {
  let peak = null
  for (const point of points || []) {
    const value = point?.[key]
    if (value == null || !Number.isFinite(value)) continue
    if (!peak || value > peak.value) peak = { value, at: point.at }
  }
  return peak
}

/** used / total as a percentage, or null when either is unknown. */
export function share(used, total) {
  return used == null || !total ? null : (used / total) * 100
}

export const QUEUE_LABELS = {
  automation: 'Automations',
  'device-sync': 'Cloud sync',
  notification: 'Notifications',
  cleanup: 'Cleanup',
  'ping-monitor': 'Ping monitor',
  discovery: 'Discovery',
  'config-backup': 'Config backups',
  topology: 'Network Map',
}

export const queueLabel = (name) => QUEUE_LABELS[name] || name

export const STREAM_STATE_COLORS = {
  connected: 'success',
  connecting: 'info',
  disconnected: 'error',
  idle: 'grey',
  stopped: 'grey',
}
