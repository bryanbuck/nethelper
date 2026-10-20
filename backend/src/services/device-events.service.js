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

async function prune() {
  const days = retentionDays();
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const { count } = await getPrisma().deviceEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } });
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

module.exports = { record, prune, startPruning, stopPruning };
