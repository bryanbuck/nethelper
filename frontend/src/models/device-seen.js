/**
 * The device page's "Last Seen" card: when the device was last confirmed
 * alive, and by whom, from the per-source times the backend keeps
 * (pingLastSeen, cloudCheckedAt/cloudLastSeen, the last connection test).
 *
 * Ping only proves that something answers at the device's address. When the
 * device's cloud says it is offline, a ping reply doesn't confirm this
 * device (another one may have taken its IP), so it is shown on the side
 * (`ping`), not as the confirmation. The History tab has the full timeline.
 */

const time = (value) => (value ? new Date(value) : null)
const newest = (sources) => sources.reduce((a, b) => (b.at > a.at ? b : a))

/** The cloud's last sighting: its latest read while online, else its own last-seen. */
export function cloudSeenAt(device) {
  if (device.cloudStatus === 'online') return time(device.cloudCheckedAt) || time(device.cloudLastSeen)
  return time(device.cloudLastSeen)
}

/**
 * @param {Object} device - a device row
 * @param {{ cloudName?: string }} options
 * @returns {{
 *   at: Date|null,     // when it was last confirmed alive
 *   by: string|null,   // who confirmed it ('ping and Mist', 'Central', 'a connection test')
 *   current: boolean,  // a source sees it now (vs. last seen in the past)
 *   tone: 'success'|'warning'|null,
 *   ping: { at: Date|null }|null, // ping's own last reply, when ping and the cloud disagree
 * }}
 */
export function lastSeenSummary(device, { cloudName = 'Cloud' } = {}) {
  const cloudManaged = device.managementMode === 'cloud' || Boolean(device.cloudIntegrationId)
  const pingAt = time(device.pingLastSeen)
  const cloudAt = cloudManaged ? cloudSeenAt(device) : null
  const testAt = device.apiTestStatus === 'success' ? time(device.apiLastTested) : null

  const ping = pingAt && { label: 'ping', at: pingAt, up: device.pingStatus === 'online' }
  const cloud = cloudAt && { label: cloudName, at: cloudAt, up: device.cloudStatus === 'online' }
  const test = testAt && { label: 'a connection test', at: testAt, up: false }
  // The cloud says it's gone, so whatever answers ping may not be this device.
  const pingDisputed = Boolean(ping && cloudManaged && device.cloudStatus !== 'online')

  const trusted = [pingDisputed ? null : ping, cloud, test].filter(Boolean)
  const current = trusted.filter((s) => s.up)

  let summary
  if (current.length) {
    summary = { at: newest(current).at, by: current.map((s) => s.label).join(' and '), current: true, tone: 'success' }
  } else if (trusted.length) {
    const last = newest(trusted)
    summary = { at: last.at, by: last.label, current: false, tone: null }
  } else {
    // Rows from before per-source times were kept.
    summary = { at: time(device.lastSeen), by: null, current: false, tone: null }
  }

  // The disagreement itself is the page's warning banner; the card only
  // adds ping's own time.
  const disagree = (pingDisputed && ping.up) || (cloud?.up && device.ipAddress && device.pingStatus === 'offline')
  if (disagree) summary.tone = 'warning'
  return { ...summary, ping: disagree ? { at: ping?.at || null } : null }
}
