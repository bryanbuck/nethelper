/**
 * Live View (on demand)
 *
 * While at least one browser has a device's Live tab open, poll its counters
 * every LIVE_VIEW_POLL_INTERVAL and emit per-port rates, PoE draw, and
 * CPU/memory to the `device:live:<id>` room. Nothing is stored.
 *
 * Port/PoE state itself comes from the state monitor, which this service
 * holds open per viewer (so a device without always-on monitoring is watched
 * just while someone is looking). Counter polls reuse the monitor's device
 * API instance, and with it the one REST session per device.
 */

const { getPrisma } = require('../../config/database');
const stateMonitor = require('./state-monitor.service');
const { computeRates } = require('./port-state');
const logger = require('../../utils/logger');

const MIN_INTERVAL_MS = 5000;

function intervalMs() {
  const value = Number(process.env.LIVE_VIEW_POLL_INTERVAL);
  return Number.isFinite(value) && value >= MIN_INTERVAL_MS ? value : 15000;
}

function emit(deviceId, event, payload) {
  try {
    const { getIO } = require('../../websocket/socket.handler');
    getIO().to(stateMonitor.liveRoom(deviceId)).emit(event, payload);
  } catch {
    // Socket.io not initialised.
  }
}

class LiveViewService {
  constructor() {
    this.viewers = new Map(); // deviceId -> Set<viewerId>
    this.pollers = new Map(); // deviceId -> { timer, previous, previousAt }
  }

  /** Counts for the System Status page: devices on a Live tab and their viewers. */
  stats() {
    let viewers = 0;
    for (const set of this.viewers.values()) viewers += set.size;
    return { devices: this.viewers.size, viewers };
  }

  /**
   * Start watching a device for one viewer (a socket id).
   * @returns {Promise<Object>} the current state snapshot (may be empty while connecting)
   * @throws {CapabilityError} when the device can't be watched
   */
  async watch(deviceId, viewerId) {
    const device = await getPrisma().device.findUnique({ where: { id: deviceId } });
    if (!device) {
      const error = new Error('Device not found');
      error.statusCode = 404;
      throw error;
    }

    await stateMonitor.hold(device, `view:${viewerId}`);

    const viewers = this.viewers.get(deviceId) || new Set();
    viewers.add(viewerId);
    this.viewers.set(deviceId, viewers);
    if (!this.pollers.has(deviceId)) this.startPolling(deviceId);

    return stateMonitor.getSnapshot(deviceId) || { deviceId, connected: false, ports: [] };
  }

  async unwatch(deviceId, viewerId) {
    const viewers = this.viewers.get(deviceId);
    if (!viewers?.has(viewerId)) return;
    viewers.delete(viewerId);
    if (!viewers.size) {
      this.viewers.delete(deviceId);
      this.stopPolling(deviceId);
    }
    await stateMonitor.release(deviceId, `view:${viewerId}`);
  }

  /** A socket disconnected: drop every device it was watching. */
  async unwatchAll(viewerId) {
    const watching = [...this.viewers.entries()].filter(([, v]) => v.has(viewerId)).map(([id]) => id);
    await Promise.all(watching.map((deviceId) => this.unwatch(deviceId, viewerId)));
  }

  startPolling(deviceId) {
    const state = { timer: null, previous: null, previousAt: null, busy: false };
    const tick = () => this.sample(deviceId, state);
    state.timer = setInterval(tick, intervalMs());
    state.timer.unref?.();
    this.pollers.set(deviceId, state);
    tick();
  }

  stopPolling(deviceId) {
    const state = this.pollers.get(deviceId);
    if (state) clearInterval(state.timer);
    this.pollers.delete(deviceId);
  }

  async sample(deviceId, state) {
    const monitor = stateMonitor.getMonitor(deviceId);
    const api = monitor?.api;
    if (state.busy || !monitor?.connected || !api?.getInterfaceCounters) return;
    state.busy = true;
    try {
      const at = Date.now();
      const [counters, poe, resources] = await Promise.all([
        api.getInterfaceCounters(),
        api.getPoePower ? api.getPoePower() : {},
        api.getResourceUtilization ? api.getResourceUtilization().catch(() => null) : null,
      ]);
      const rates = computeRates(state.previous, counters, (at - (state.previousAt || at)) / 1000);
      state.previous = counters;
      state.previousAt = at;

      const ports = {};
      for (const port of Object.keys(counters)) {
        ports[port] = { ...(rates[port] || {}), poeW: poe[port] ?? null };
      }
      emit(deviceId, 'device:live:metrics', {
        deviceId,
        at: new Date(at).toISOString(),
        intervalMs: intervalMs(),
        // First sample has counters but no rates yet; the UI shows "collecting".
        hasRates: Object.keys(rates).length > 0,
        ports,
        cpu: resources?.cpu ?? null,
        memory: resources?.memory ?? null,
      });
    } catch (error) {
      logger.warn(`Live view sample failed for device ${deviceId}: ${error.message}`);
    } finally {
      state.busy = false;
    }
  }

  async stop() {
    for (const deviceId of this.pollers.keys()) this.stopPolling(deviceId);
    this.viewers.clear();
  }
}

module.exports = new LiveViewService();
module.exports.LiveViewService = LiveViewService;
