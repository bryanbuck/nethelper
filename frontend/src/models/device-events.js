/**
 * Display metadata for DeviceEvent rows (backend services/device-events.service.js):
 * live-monitor port/PoE transitions (source push|poll|resync), cloud
 * events (source cloud): status changes from the cloud status refresh and
 * sync, and port link changes and restarts from the Mist event stream, and
 * the ping monitor's settled up/down changes (source ping).
 */

import { cloudProviderLabel } from '@/models/vendors'

export const DEVICE_EVENTS = {
  'port.link.up': { label: 'link up', icon: 'mdi-arrow-up-bold', color: 'success' },
  'port.link.down': { label: 'link down', icon: 'mdi-arrow-down-bold', color: 'medium-emphasis' },
  'port.admin.up': { label: 'enabled', icon: 'mdi-check-circle-outline', color: 'success' },
  'port.admin.down': { label: 'disabled', icon: 'mdi-cancel', color: 'medium-emphasis' },
  'port.poe.up': { label: 'PoE delivering', icon: 'mdi-flash', color: 'success' },
  'port.poe.down': { label: 'PoE stopped', icon: 'mdi-flash-off', color: 'medium-emphasis' },
  'port.poe.fault': { label: 'PoE fault', icon: 'mdi-flash-alert', color: 'error' },
  'monitor.connected': { label: 'Monitoring reconnected', icon: 'mdi-lan-connect', color: 'success' },
  'monitor.disconnected': { label: 'Monitoring lost contact', icon: 'mdi-lan-disconnect', color: 'warning' },
  'cloud.online': { label: 'Cloud reports online', icon: 'mdi-cloud-check-outline', color: 'success' },
  'cloud.offline': { label: 'Cloud reports offline', icon: 'mdi-cloud-off-outline', color: 'error' },
  'cloud.warning': { label: 'Cloud reports warning', icon: 'mdi-cloud-alert-outline', color: 'warning' },
  'cloud.maintenance': { label: 'Cloud reports maintenance', icon: 'mdi-cloud-cog-outline', color: 'medium-emphasis' },
  'device.restarted': { label: 'Restarted', icon: 'mdi-restart', color: 'warning' },
  'ping.online': { label: 'Answers ping', icon: 'mdi-lan-check', color: 'success' },
  'ping.offline': { label: 'Stopped answering ping', icon: 'mdi-lan-disconnect', color: 'error' },
}

export const EVENT_SOURCE_LABELS = {
  push: 'pushed by the device',
  poll: 'polled',
  resync: 'found on resync',
  cloud: 'from the cloud',
  ping: 'ping from NetHelper',
}

export function speedLabel(mbps) {
  return mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`
}

/** { label, icon, color } for one event, with its details folded into the label. */
export function eventInfo(e) {
  const info = DEVICE_EVENTS[e.type] || { label: e.type, icon: 'mdi-information-outline', color: 'medium-emphasis' }
  if (e.type === 'port.link.up' && e.data?.speedMbps) return { ...info, label: `link up at ${speedLabel(e.data.speedMbps)}` }
  if (e.type === 'port.poe.up' && e.data?.pdClass) return { ...info, label: `PoE delivering (${e.data.pdClass})` }
  if (e.type.startsWith('cloud.') && e.data?.provider) {
    return { ...info, label: `${cloudProviderLabel(e.data.provider)} reports ${e.type.slice('cloud.'.length)}` }
  }
  return info
}
