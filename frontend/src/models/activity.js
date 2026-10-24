/**
 * Display metadata for the fleet Activity feed (GET /activity, backend
 * services/activity.service.js). Category ids mirror backend
 * constants/activity.js (parity-tested).
 */

import { eventInfo } from '@/models/device-events'
import { ALERT_RULE_LABELS, severityMeta, alertLink } from '@/models/alerts'
import { cloudProviderLabel } from '@/models/vendors'

export const ACTIVITY_CATEGORIES = [
  { value: 'status', title: 'Status', icon: 'mdi-lan-check', hint: 'Ping and cloud status changes' },
  { value: 'restart', title: 'Restarts', icon: 'mdi-restart', hint: 'Devices that restarted' },
  { value: 'config', title: 'Config changes', icon: 'mdi-file-compare', hint: 'Backups that found a changed config' },
  { value: 'alert', title: 'Alerts', icon: 'mdi-bell-outline', hint: 'Device alerts opened and cleared' },
  { value: 'cloud-alarm', title: 'Cloud alarms', icon: 'mdi-cloud-alert-outline', hint: 'Alarms raised by Mist and Aruba Central' },
  { value: 'port', title: 'Ports', icon: 'mdi-ethernet', hint: 'Port link, PoE, and live-monitor changes (chatty)' },
]

export const DEFAULT_ACTIVITY_CATEGORIES = ['status', 'restart', 'config', 'alert', 'cloud-alarm']

const BACKUP_TRIGGERS = { manual: 'manual backup', scheduled: 'scheduled backup', automation: 'automation backup' }

export function durationLabel(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} d`
}

export function timeAgo(value, now = Date.now()) {
  const seconds = Math.round((now - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  return `${durationLabel(seconds * 1000)} ago`
}

/**
 * How one feed item reads: { icon, color, label, detail, link }. `link` is
 * where it leads (a route location) or null.
 */
export function activityInfo(item) {
  const device = item.device
  const deviceLink = device && !device.deleted ? { path: `/devices/${device.id}` } : null

  if (item.kind === 'config') {
    return {
      icon: 'mdi-file-compare',
      color: 'info',
      label: 'Config changed',
      detail: [`Found by a ${BACKUP_TRIGGERS[item.trigger] || 'backup'}`, item.warning].filter(Boolean).join(' · '),
      link: deviceLink && { ...deviceLink, query: { tab: 'history' } },
    }
  }

  if (item.kind === 'cloud-alarm') return cloudAlarmInfo(item, deviceLink)

  if (item.kind === 'alert') {
    const rule = ALERT_RULE_LABELS[item.rule] || item.rule
    const link = alertLink({ rule: item.rule, deviceId: item.deviceId })
    if (item.type === 'alert.resolved') {
      return {
        icon: 'mdi-check-circle-outline',
        color: 'success',
        label: `Alert cleared: ${rule}`,
        detail: item.resolvedBy === 'user' ? `${item.title} · resolved by hand` : item.title,
        link,
      }
    }
    const severity = severityMeta(item.severity)
    return {
      icon: severity.icon,
      color: severity.color,
      label: `${severity.title} alert: ${rule}`,
      detail: item.message || item.title,
      link,
    }
  }

  const info = eventInfo(item)
  const label = item.port ? `Port ${item.port} ${info.label}` : capitalize(info.label)
  const details = []
  if (item.count > 1) {
    details.push(`${item.count} changes in ${durationLabel(new Date(item.at) - new Date(item.since))}, now ${info.label}`)
  } else if (item.data?.previous && item.category === 'status') {
    details.push(`was ${item.data.previous}`)
  }
  return {
    icon: info.icon,
    color: item.count > 1 ? 'warning' : info.color,
    label: item.count > 1 ? `${item.port ? `Port ${item.port}` : capitalize(familyLabel(item.type))} flapping` : label,
    detail: details.join(' · '),
    link: deviceLink && (item.category === 'port' ? { ...deviceLink, query: { tab: 'live' } } : { ...deviceLink, query: { tab: 'history' } }),
  }
}

const ALARM_SEVERITY = {
  critical: { icon: 'mdi-cloud-alert', color: 'error' },
  warning: { icon: 'mdi-cloud-alert-outline', color: 'warning' },
  info: { icon: 'mdi-cloud-outline', color: 'info' },
}
// Central clears many alerts on a timer, whether or not the problem went away.
const TIMER_CLEAR = /clear alert timer/i

function cloudAlarmInfo(item, deviceLink) {
  const provider = cloudProviderLabel(item.provider)
  const times = item.count > 1 ? ` ×${item.count}` : ''
  const spread = item.count > 1 ? `${item.count} in ${durationLabel(new Date(item.at) - new Date(item.since))}` : null
  if (item.type === 'cloud-alarm.cleared') {
    let reason = item.clearedReason
    if (!reason) reason = `No longer active in ${provider}`
    else if (TIMER_CLEAR.test(reason)) reason = `Cleared by ${provider}'s timer; the problem may not be fixed`
    return {
      icon: 'mdi-cloud-check-outline',
      color: TIMER_CLEAR.test(item.clearedReason || '') ? 'medium-emphasis' : 'success',
      label: `${provider} cleared: ${item.name}${times}`,
      detail: [spread, reason].filter(Boolean).join(' · '),
      link: deviceLink,
    }
  }
  const severity = ALARM_SEVERITY[item.severity] || ALARM_SEVERITY.info
  return {
    ...severity,
    label: `${provider}: ${item.name}${times}`,
    detail: [
      spread,
      item.summary,
      item.incidents > 1 ? `${item.incidents} incidents` : null,
      item.ports?.length ? `ports ${item.ports.join(', ')}` : null,
    ].filter(Boolean).join(' · '),
    link: deviceLink,
  }
}

function familyLabel(type) {
  if (type.startsWith('ping.')) return 'ping status'
  if (type.startsWith('cloud.')) return 'cloud status'
  if (type.startsWith('monitor.')) return 'live monitor'
  return 'status'
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/** "Today", "Yesterday", or a date: the feed's day headings. */
export function dayLabel(value, now = new Date()) {
  const day = new Date(value)
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((start(now) - start(day)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
