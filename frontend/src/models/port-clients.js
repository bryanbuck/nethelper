// Port Identity display metadata. The value lists mirror
// backend/src/services/ports/client-aging.js (parity-tested).
import { timeAgo } from '@/models/activity'

// How much to trust a sighting now (clientFreshness on the backend).
export const FRESHNESS = {
  confirmed: { label: 'Confirmed', color: 'success', icon: 'mdi-check-circle-outline' },
  unconfirmed: { label: 'Unconfirmed', color: 'warning', icon: 'mdi-help-circle-outline' },
  stale: { label: 'Stale', color: 'warning', icon: 'mdi-clock-alert-outline' },
  gone: { label: 'Gone', color: 'grey', icon: 'mdi-minus-circle-outline' }
}

export const GONE_REASONS = {
  omitted: 'no longer seen',
  'link-down': 'port went down',
  moved: 'moved',
  'port-reassigned': 'another device took the port'
}

export const SOURCES = {
  'mac-table': 'Switch MAC table',
  lldp: 'LLDP',
  'cloud-wired': 'Cloud',
  arp: 'ARP'
}

// Derived kinds (derivePortKind) and the ones a user can set on a note.
export const PORT_KINDS = {
  static: { label: 'Static', color: 'primary', hint: 'The same device for a week or more' },
  dynamic: { label: 'Dynamic', color: 'info', hint: 'Several different devices this week' },
  uplink: { label: 'Uplink', color: 'secondary', hint: 'Another switch, router or gateway' },
  ap: { label: 'Access point', color: 'secondary', hint: 'An access point; its wireless clients are not listed' },
  unused: { label: 'Unused', color: 'grey', hint: 'No link and no device for 30 days' },
  idle: { label: 'Empty', color: 'grey', hint: 'Nothing connected now' },
  new: { label: 'New', color: 'grey', hint: 'Not watched long enough to tell' }
}

export const NOTE_KINDS = ['auto', 'static', 'dynamic', 'uplink', 'unused']
export const NOTE_KIND_ITEMS = [
  { value: 'auto', title: 'Decide from what is seen' },
  { value: 'static', title: 'Static: one fixed device' },
  { value: 'dynamic', title: 'Dynamic: hot desk, meeting room' },
  { value: 'uplink', title: 'Uplink' },
  { value: 'unused', title: 'Unused' }
]

export const LABEL_MAX = 64

// A cloud's "I don't know" is not a name.
const NO_CLASS = /^(unclassified|unknown)$/i
const knownOs = (profile) => (profile?.os && !NO_CLASS.test(profile.os) ? profile.os : null)

/** The best short name for a client: hostname, LLDP name, what the cloud classifies it as, vendor, then MAC. */
export function clientTitle(client) {
  if (!client) return ''
  return client.hostname || client.lldp?.sysName || knownOs(client.profile) || client.vendor || client.mac
}

/** "Aruba Central classifies this as Cisco IP Phone (VoIP Phone)": cloud profiling is evidence, not fact. */
export function profileText(profile) {
  if (!knownOs(profile) && !profile?.function) return ''
  const os = knownOs(profile)
  const what = [os, profile.function && profile.function !== os ? `(${profile.function})` : null].filter(Boolean).join(' ')
  return profile.source ? `${profile.source} classifies this as ${what}` : what
}

/** "Confirmed 5 min ago", "Gone 2 d ago: port went down", "Stale: no good read for 2 h". */
export function freshnessText(client, now = Date.now()) {
  const f = client?.freshness
  const since = client?.since ? timeAgo(client.since, now) : null
  if (f === 'gone') {
    const reason = GONE_REASONS[client.goneReason]
    return `Gone${since ? ` ${since}` : ''}${reason ? `: ${reason}` : ''}`
  }
  if (f === 'stale') return since ? `Stale: no good read since ${since}` : 'Stale: never read successfully'
  if (f === 'unconfirmed') return `Not in the last ${client.missedReads || 2} reads; last seen ${since || 'earlier'}`
  return since ? `Confirmed ${since}` : 'Confirmed'
}

/** Port label lookup for other views: matches the API's port key or the device's own spelling. */
export function portKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '')
}
