/**
 * A device's history for the device page's History tab: one status lane per
 * point of view (ping from NetHelper, the device's cloud) built from the
 * `ping.*` and `cloud.*` DeviceEvents, a combined lane showing where the two
 * disagree (effectiveStatus), and point-in-time markers (config backups,
 * restarts).
 *
 * Lanes come only from recorded transitions. Time before a lane's first
 * known state is 'unknown', never guessed: ping states are recorded since
 * 2026-10-22, and events are pruned after DEVICE_EVENT_RETENTION_DAYS.
 */

const { getPrisma } = require('../config/database');
const { effectiveStatus } = require('../utils/device-status');

const HOUR_MS = 3600 * 1000;
const MAX_RANGE_MS = 90 * 24 * HOUR_MS;
const RANGES = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS, '30d': 30 * 24 * HOUR_MS };

class HistoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HistoryError';
    this.statusCode = 400;
  }
}

/**
 * The window to show: `range` (24h|7d|30d) ending now, or explicit
 * `from`/`to` ISO timestamps (at most 90 days).
 */
function resolveWindow({ range, from, to } = {}, now = new Date()) {
  if (from || to) {
    const end = to ? new Date(to) : now;
    const start = from ? new Date(from) : new Date(end.getTime() - RANGES['24h']);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new HistoryError('from/to must be ISO timestamps');
    if (start >= end) throw new HistoryError('from must be before to');
    if (end - start > MAX_RANGE_MS) throw new HistoryError('The window is at most 90 days');
    return { from: start, to: end };
  }
  const span = RANGES[range || '24h'];
  if (!span) throw new HistoryError(`range must be one of ${Object.keys(RANGES).join(', ')}`);
  return { from: new Date(now.getTime() - span), to: now };
}

/**
 * Segments covering [from, to] for one lane.
 * @param {Array<{occurredAt, type}>} events - in the window, oldest first
 * @param {{type}|null} prior - the lane's last event before `from`
 * @param {string} prefix - 'ping.' | 'cloud.'
 * @returns {Array<{from: Date, to: Date, state: string}>}
 */
function buildSegments(events, prior, prefix, from, to) {
  const segments = [];
  let state = prior ? prior.type.slice(prefix.length) : 'unknown';
  let start = from;
  for (const event of events) {
    const at = new Date(event.occurredAt);
    const next = event.type.slice(prefix.length);
    if (at <= start) {
      state = next;
      continue;
    }
    if (next === state) continue;
    segments.push({ from: start, to: at, state });
    state = next;
    start = at;
  }
  segments.push({ from: start, to, state });
  return segments;
}

const stateAt = (segments, t) => segments.find((s) => s.from <= t && t < s.to)?.state ?? segments[segments.length - 1]?.state;

/**
 * Where ping and the cloud agree or not, as effectiveStatus() would show it
 * at each moment. 'warning' segments carry why: 'cloud-only' (the cloud sees
 * it, ping doesn't) or 'ping-only' (it answers ping, the cloud says offline).
 */
function combineSegments(ping, cloud, from, to) {
  const cuts = [...new Set([from, to, ...ping.map((s) => s.from), ...cloud.map((s) => s.from)]
    .map((d) => d.getTime()))].sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const t = new Date(cuts[i]);
    const p = stateAt(ping, t);
    const c = stateAt(cloud, t);
    let state;
    let reason = null;
    if (p === 'unknown' && c === 'unknown') state = 'unknown';
    else {
      state = effectiveStatus({
        managementMode: 'cloud',
        pingStatus: p === 'unknown' ? null : p,
        cloudStatus: c === 'unknown' ? null : c,
      });
      if (state === 'warning') reason = p === 'online' ? 'ping-only' : 'cloud-only';
    }
    const last = segments[segments.length - 1];
    if (last && last.state === state && (last.reason || null) === reason) last.to = new Date(cuts[i + 1]);
    else segments.push({ from: t, to: new Date(cuts[i + 1]), state, ...(reason && { reason }) });
  }
  return segments;
}

async function laneEvents(deviceId, prefix, from, to) {
  const prisma = getPrisma();
  const [prior, events] = await Promise.all([
    prisma.deviceEvent.findFirst({
      where: { deviceId, type: { startsWith: prefix }, occurredAt: { lt: from } },
      orderBy: { occurredAt: 'desc' },
      select: { type: true, occurredAt: true },
    }),
    prisma.deviceEvent.findMany({
      where: { deviceId, type: { startsWith: prefix }, occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: 'asc' },
      select: { type: true, occurredAt: true, data: true, source: true },
    }),
  ]);
  return { prior, events };
}

/**
 * @returns {Promise<{from, to, lanes, markers}|null>} null when the device doesn't exist
 */
async function getHistory(deviceId, query = {}) {
  const { from, to } = resolveWindow(query);
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true, managementMode: true, ipAddress: true, cloudIntegrationId: true,
      cloudIntegration: { select: { name: true, provider: true } },
    },
  });
  if (!device) return null;

  const hasCloud = device.managementMode === 'cloud' || Boolean(device.cloudIntegrationId);
  const [ping, cloud, backups, priorBackup, restarts] = await Promise.all([
    laneEvents(deviceId, 'ping.', from, to),
    hasCloud ? laneEvents(deviceId, 'cloud.', from, to) : null,
    prisma.configBackup.findMany({
      where: { deviceId, createdAt: { gte: from, lte: to }, status: { in: ['success', 'failed'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, status: true, trigger: true, hasChanges: true, error: true, warning: true },
    }),
    // The success before the window, so the first change in it has a "since".
    prisma.configBackup.findFirst({
      where: { deviceId, createdAt: { lt: from }, status: 'success' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.deviceEvent.findMany({
      where: { deviceId, type: 'device.restarted', occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true, source: true, data: true },
    }),
  ]);

  const pingSegments = buildSegments(ping.events, ping.prior, 'ping.', from, to);
  const lanes = [{
    key: 'ping',
    label: 'Ping from NetHelper',
    segments: pingSegments,
    events: ping.events.map((e) => ({ at: e.occurredAt, state: e.type.slice(5), data: e.data })),
  }];
  if (cloud) {
    const cloudSegments = buildSegments(cloud.events, cloud.prior, 'cloud.', from, to);
    lanes.push({
      key: 'cloud',
      label: device.cloudIntegration?.name || 'Cloud',
      provider: device.cloudIntegration?.provider || null,
      segments: cloudSegments,
      events: cloud.events.map((e) => ({ at: e.occurredAt, state: e.type.slice(6), data: e.data })),
    });
    lanes.push({ key: 'combined', label: 'Combined', segments: combineSegments(pingSegments, cloudSegments, from, to) });
  }

  // A backup that found a change brackets it: the config changed on the
  // device some time after the previous successful backup.
  const markers = [];
  let lastSuccess = priorBackup?.createdAt || null;
  for (const b of backups) {
    markers.push({
      kind: 'backup',
      at: b.createdAt,
      id: b.id,
      status: b.status,
      trigger: b.trigger,
      changed: b.status === 'success' && b.hasChanges === true,
      ...(b.status === 'success' && b.hasChanges && lastSuccess && { changedSince: lastSuccess }),
      ...(b.error && { error: b.error }),
      ...(b.warning && { warning: b.warning }),
    });
    if (b.status === 'success') lastSuccess = b.createdAt;
  }
  for (const r of restarts) markers.push({ kind: 'restart', at: r.occurredAt, source: r.source });
  markers.sort((a, b) => new Date(a.at) - new Date(b.at));

  return { from, to, lanes, markers };
}

module.exports = { getHistory, resolveWindow, buildSegments, combineSegments, HistoryError, RANGES };
