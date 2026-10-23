/**
 * DeviceEvent rows: recorded state transitions of one device, from the live
 * monitor (source push|poll|resync) and the clouds (source cloud: the cloud
 * status refresh and the Mist event stream). Each is broadcast as
 * `device:event`. Events are raw; anything acting on them applies its own
 * settle time.
 *
 * Rows older than DEVICE_EVENT_RETENTION_DAYS are pruned once a day.
 */

const { getPrisma } = require('../config/database');
const logger = require('../utils/logger');

const DAY_MS = 24 * 3600 * 1000;

const retentionDays = () => {
  const days = Number(process.env.DEVICE_EVENT_RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 30;
};

function emit(event, payload) {
  try {
    // Lazy: the socket server isn't up in tests or CLI scripts.
    const { getIO } = require('../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch (error) {
    logger.debug(`device-events: could not emit ${event}: ${error.message}`);
  }
}

let pruneTimer = null;

/**
 * Persist an event and broadcast it. Never throws: a lost row is logged and
 * the event is still broadcast.
 * @param {{id, name}} device
 * @param {{type, port?, data?}} event
 * @param {string} source - push | poll | resync | cloud
 */
async function record(device, event, source) {
  const row = await getPrisma().deviceEvent.create({
    data: {
      deviceId: device.id,
      type: event.type,
      port: event.port ?? null,
      data: event.data || {},
      source,
    },
  }).catch((error) => {
    logger.error(`Failed to record device event for ${device.name}: ${error.message}`);
    return null;
  });
  const payload = {
    id: row?.id || null,
    deviceId: device.id,
    deviceName: device.name,
    type: event.type,
    port: event.port ?? null,
    data: event.data || {},
    source,
    occurredAt: row?.occurredAt || new Date(),
  };
  emit('device:event', payload);
  return payload;
}

// "<prefix><deviceId>" for each device whose state this process has already
// compared with its last recorded event (see recordStateOnce).
const checkedStates = new Set();

/**
 * Record `<prefix><state>` unless it is already the device's latest event
 * with that prefix (e.g. 'ping.' + 'online'). For state lanes in the
 * device's history: callers report only transitions, plus once per device
 * per process (recordStateOnce), so a device that never changes still gets
 * a starting state and a change missed while NetHelper was down is caught.
 * Never throws.
 * @returns {Promise<boolean>} whether an event was recorded
 */
async function recordStateIfChanged(device, prefix, state, source, data = {}) {
  checkedStates.add(`${prefix}${device.id}`);
  try {
    const last = await getPrisma().deviceEvent.findFirst({
      where: { deviceId: device.id, type: { startsWith: prefix } },
      orderBy: { occurredAt: 'desc' },
      select: { type: true },
    });
    if (last?.type === `${prefix}${state}`) return false;
    await record(device, {
      type: `${prefix}${state}`,
      data: { ...(last && { previous: last.type.slice(prefix.length) }), ...data },
    }, source);
    return true;
  } catch (error) {
    logger.warn(`Could not record ${prefix}${state} for ${device.name}: ${error.message}`);
    return false;
  }
}

/** recordStateIfChanged, at most once per device and prefix per process. */
async function recordStateOnce(device, prefix, state, source, data = {}) {
  const key = `${prefix}${device.id}`;
  if (checkedStates.has(key)) return false;
  checkedStates.add(key);
  return recordStateIfChanged(device, prefix, state, source, data);
}

// Each device's newest event per state lane, kept by prune whatever its age:
// it is the lane's starting state, and a device that hasn't changed in longer
// than the retention would otherwise show "No data" on its History tab.
async function latestStateEventIds(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON ("deviceId", split_part("type", '.', 1)) "id"
    FROM "DeviceEvent"
    WHERE "type" LIKE 'ping.%' OR "type" LIKE 'cloud.%'
    ORDER BY "deviceId", split_part("type", '.', 1), "occurredAt" DESC`;
  return rows.map((r) => r.id);
}

async function prune() {
  const days = retentionDays();
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const prisma = getPrisma();
  const keep = await latestStateEventIds(prisma);
  const { count } = await prisma.deviceEvent.deleteMany({
    where: { occurredAt: { lt: cutoff }, ...(keep.length && { id: { notIn: keep } }) },
  });
  if (count) logger.info(`Pruned ${count} device event(s) older than ${days} days`);
  return count;
}

/** Prune now and then daily (server start). */
function startPruning() {
  stopPruning();
  pruneTimer = setInterval(() => prune().catch(() => {}), DAY_MS);
  pruneTimer.unref?.();
  prune().catch(() => {});
}

function stopPruning() {
  clearInterval(pruneTimer);
  pruneTimer = null;
}

module.exports = {
  record, recordStateIfChanged, recordStateOnce, prune, startPruning, stopPruning,
  _resetCheckedStates: () => checkedStates.clear(),
};
