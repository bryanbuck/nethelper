/**
 * Live State Monitor (the event layer)
 *
 * Watches port link/PoE state on devices and turns changes into DeviceEvent
 * rows plus WebSocket events. A device is watched while it has at least one
 * holder:
 *   - 'always'   - Device.liveMonitoring is on (loaded at boot, toggled via API)
 *   - 'view:<n>' - someone has the device's Live tab open (live-view.service)
 *
 * Delivery per platform comes from PLATFORMS[platform].liveState:
 *   'push' - AOS-CX REST notification WebSocket. One session per device is
 *            shared by the stream, resyncs, and the live view's counter polls.
 *   'poll' - getPortState() every LIVE_STATE_POLL_INTERVAL, diffed.
 *
 * Correctness over cleverness: every (re)connect takes a full snapshot and
 * diffs it against the last one, so changes made while we were disconnected
 * still become events; a skipped notification sequence number forces the
 * same resync, and a periodic resync (LIVE_RESYNC_INTERVAL) is the backstop.
 *
 * Single-instance assumption: each backend process watches every enabled
 * device. Running several backend replicas would open duplicate sessions
 * and record duplicate events; a Redis leader lock is a roadmap item.
 */

const { getPrisma } = require('../../config/database');
const settingsService = require('../settings.service');
const DeviceAPIFactory = require('../device-api/device-api-factory');
const { resolveTransport } = require('../../utils/transport-router');
const { detectPlatform } = require('../../utils/device-platform');
const { PLATFORMS } = require('../../constants/vendors');
const { CapabilityError } = require('../cloud-providers/errors');
const { mergePort, diffPort, diffSnapshots } = require('./port-state');
const logger = require('../../utils/logger');

const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

function config() {
  return {
    enabled: process.env.LIVE_MONITOR_ENABLED !== 'false',
    pollIntervalMs: num(process.env.LIVE_STATE_POLL_INTERVAL, 60000),
    resyncIntervalMs: num(process.env.LIVE_RESYNC_INTERVAL, 600000),
    // AOS-CX ends every REST session after an absolute 480 minutes, and the
    // notification socket can outlive its session. Recycle well before that.
    sessionMaxAgeMs: num(process.env.LIVE_SESSION_MAX_AGE, 6 * 3600000),
    maxConnections: num(process.env.LIVE_MAX_CONNECTIONS, 200),
    retentionDays: num(process.env.DEVICE_EVENT_RETENTION_DAYS, 30),
    backoffBaseMs: 5000,
    backoffMaxMs: 300000,
  };
}

function emit(event, payload, room = null) {
  try {
    const { getIO } = require('../../websocket/socket.handler');
    const io = getIO();
    (room ? io.to(room) : io).emit(event, payload);
  } catch {
    // Socket.io not initialised (tests, CLI scripts): events are still persisted.
  }
}

const liveRoom = (deviceId) => `device:live:${deviceId}`;

/** Why a device can't be watched, or null if it can. */
function unsupportedReason(device) {
  if (!device.ipAddress) return 'Live state needs the device IP address';
  if (resolveTransport(device, 'live').length === 0) {
    return `Live state is not available for ${PLATFORMS[detectPlatform(device)]?.label || 'this platform'} yet`;
  }
  return null;
}

class DeviceMonitor {
  constructor(service, device) {
    this.service = service;
    this.device = device;
    this.mode = PLATFORMS[detectPlatform(device)]?.liveState || 'poll';
    this.api = null;
    this.stream = null;
    this.ports = new Map();
    this.sequences = new Map();
    this.connected = false;
    this.wasConnected = false;
    this.lastError = null;
    this.updatedAt = null;
    this.attempt = 0;
    this.timers = new Set();
    this.stopped = false;
    // Bumped on every connect/disconnect; callbacks from an older stream or
    // timer compare against it and drop out, so one failure schedules one retry.
    this.generation = 0;
  }

  timer(fn, ms, repeat = false) {
    const handle = (repeat ? setInterval : setTimeout)(() => {
      if (!repeat) this.timers.delete(handle);
      fn();
    }, ms);
    handle.unref?.();
    this.timers.add(handle);
    return handle;
  }

  clearTimers() {
    for (const handle of this.timers) {
      clearTimeout(handle);
      clearInterval(handle);
    }
    this.timers.clear();
  }

  async start(delayMs = 0) {
    if (delayMs) this.timer(() => this.connect(), delayMs);
    else await this.connect();
  }

  async connect() {
    if (this.stopped) return;
    const cfg = config();
    const gen = ++this.generation;
    try {
      await this.api?.logout?.().catch(() => {});
      const credentials = await settingsService.getDeviceCredentialsForUse(this.device.id);
      if (!credentials) throw new CapabilityError('Live state needs a device credential linked to this device');
      this.api = DeviceAPIFactory.createDeviceAPI(this.device, credentials);
      if (typeof this.api.getPortState !== 'function') {
        throw new CapabilityError('This device API has no port state reader');
      }

      await this.resync('connect');

      if (this.mode === 'push') {
        this.sequences.clear();
        const stream = await this.api.openNotificationStream([...this.ports.keys()], {
          onUpdate: (msg) => gen === this.generation && this.onNotification(msg, gen),
          onClose: (code) => this.onDisconnect(new Error(`notification socket closed (${code})`), gen),
          onError: (error) => logger.warn(`Live stream error on ${this.device.name}: ${error.message}`),
        });
        if (gen !== this.generation || this.stopped) {
          stream.close();
          return;
        }
        this.stream = stream;
        this.streamSession = this.api.session?.loginTime || null;
        // The periodic resync is also what keeps the REST session from idling out.
        this.timer(() => this.safeResync('periodic', gen), cfg.resyncIntervalMs, true);
        this.timer(() => this.recycle(gen), cfg.sessionMaxAgeMs);
      } else {
        this.timer(() => this.safeResync('poll', gen), cfg.pollIntervalMs, true);
      }

      this.attempt = 0;
      this.lastError = null;
      if (!this.connected) {
        this.connected = true;
        if (this.wasConnected) await this.service.recordEvent(this.device, { type: 'monitor.connected', port: null, data: {} }, 'poll');
        this.wasConnected = true;
        this.service.emitStatus(this);
      }
    } catch (error) {
      await this.onDisconnect(error, gen);
    }
  }

  async onDisconnect(error, gen) {
    if (this.stopped || gen !== this.generation) return;
    this.generation += 1;
    this.clearTimers();
    const stream = this.stream;
    this.stream = null;
    try {
      stream?.close();
    } catch {
      // already closed
    }
    this.lastError = error.message;
    const cfg = config();

    if (this.connected) {
      this.connected = false;
      await this.service.recordEvent(this.device, { type: 'monitor.disconnected', port: null, data: { reason: error.message } }, 'poll');
      this.service.emitStatus(this);
    } else if (this.attempt === 0) {
      logger.warn(`Live monitor could not start for ${this.device.name}: ${error.message}`);
      this.service.emitStatus(this);
    }

    if (error instanceof CapabilityError) return; // retrying won't help
    // Jittered exponential backoff so a NetHelper restart doesn't hit every switch at once.
    const delay = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * 2 ** this.attempt) * (0.5 + Math.random() / 2);
    this.attempt += 1;
    this.timer(() => this.connect(), delay);
  }

  async safeResync(reason, gen = this.generation) {
    try {
      await this.resync(reason);
      // A resync that had to log in again leaves the stream on a dead session.
      if (this.stream && (this.api.session?.loginTime || null) !== this.streamSession) await this.recycle(gen);
    } catch (error) {
      await this.onDisconnect(error, gen);
    }
  }

  /**
   * Planned reconnect onto a fresh session: no disconnected/connected events,
   * and the reconnect's snapshot diff still records anything that changed.
   */
  async recycle(gen) {
    if (this.stopped || gen !== this.generation) return;
    this.generation += 1;
    this.clearTimers();
    const stream = this.stream;
    this.stream = null;
    try {
      stream?.close();
    } catch {
      // already closed
    }
    await this.connect();
  }

  /** Full snapshot; diff against what we had so missed changes become events. */
  async resync(reason) {
    const next = await this.api.getPortState();
    const previous = [...this.ports.values()];
    this.ports = new Map(next.map((p) => [p.port, p]));
    this.updatedAt = new Date();
    if (previous.length) {
      const source = reason === 'poll' ? 'poll' : 'resync';
      for (const event of diffSnapshots(previous, next)) {
        await this.service.recordEvent(this.device, event, source);
      }
    }
    emit('device:live:snapshot', this.snapshot(), liveRoom(this.device.id));
  }

  async onNotification({ updates, sequences, initial }, gen = this.generation) {
    let gap = false;
    for (const { topic, seq } of sequences) {
      const last = this.sequences.get(topic);
      if (!initial && last !== undefined && seq !== last + 1) gap = true;
      this.sequences.set(topic, seq);
    }
    if (initial) return; // values in the ack are already in the baseline snapshot
    if (gap) {
      logger.warn(`Live stream sequence gap on ${this.device.name}; resyncing`);
      await this.safeResync('gap', gen);
      return;
    }

    for (const update of updates) {
      const before = this.ports.get(update.port);
      if (!before) {
        if (update.operation === 'inserted' || update.operation === 'deleted') await this.safeResync('topology', gen);
        continue;
      }
      const after = mergePort(before, update);
      this.ports.set(update.port, after);
      this.updatedAt = new Date();
      for (const event of diffPort(before, after)) {
        await this.service.recordEvent(this.device, event, 'push');
      }
      emit('device:live:port', { deviceId: this.device.id, port: after }, liveRoom(this.device.id));
    }
  }

  snapshot() {
    return {
      deviceId: this.device.id,
      mode: this.mode,
      connected: this.connected,
      lastError: this.lastError,
      updatedAt: this.updatedAt,
      ports: [...this.ports.values()],
    };
  }

  async stop() {
    this.stopped = true;
    this.clearTimers();
    try {
      this.stream?.close();
    } catch {
      // already closed
    }
    this.stream = null;
    await this.api?.logout?.().catch(() => {});
  }
}

class StateMonitorService {
  constructor() {
    this.monitors = new Map(); // deviceId -> DeviceMonitor
    this.holders = new Map(); // deviceId -> Set<holder>
    this.pruneTimer = null;
  }

  /** Boot: watch every device with liveMonitoring on, staggered. */
  async start() {
    const cfg = config();
    if (!cfg.enabled) {
      logger.info('Live state monitoring disabled (LIVE_MONITOR_ENABLED=false)');
      return;
    }
    const devices = await getPrisma().device.findMany({ where: { liveMonitoring: true } });
    let index = 0;
    for (const device of devices) {
      // ~4 connects per second at boot.
      await this.hold(device, 'always', { delayMs: 250 * index }).catch((error) => {
        logger.warn(`Live monitor skipped ${device.name}: ${error.message}`);
      });
      index += 1;
    }
    this.pruneTimer = setInterval(() => this.pruneEvents().catch(() => {}), 24 * 3600 * 1000);
    this.pruneTimer.unref?.();
    this.pruneEvents().catch(() => {});
    logger.info(`Live state monitoring started for ${this.monitors.size} device(s)`);
  }

  async stop() {
    clearInterval(this.pruneTimer);
    await Promise.all([...this.monitors.values()].map((m) => m.stop()));
    this.monitors.clear();
    this.holders.clear();
  }

  /**
   * Add a holder for a device, starting its monitor if needed.
   * @throws {CapabilityError} when the device can't be watched
   */
  async hold(device, holder, { delayMs = 0 } = {}) {
    const reason = unsupportedReason(device);
    if (reason) throw new CapabilityError(reason, { capability: 'live' });

    const holders = this.holders.get(device.id) || new Set();
    holders.add(holder);
    this.holders.set(device.id, holders);

    if (!this.monitors.has(device.id)) {
      if (this.monitors.size >= config().maxConnections) {
        holders.delete(holder);
        if (!holders.size) this.holders.delete(device.id);
        throw new CapabilityError(`Live monitoring is at its limit of ${config().maxConnections} devices (LIVE_MAX_CONNECTIONS)`);
      }
      const monitor = new DeviceMonitor(this, device);
      this.monitors.set(device.id, monitor);
      await monitor.start(delayMs);
    }
    return this.monitors.get(device.id);
  }

  /** Drop a holder; the monitor stops when the last one goes. */
  async release(deviceId, holder) {
    const holders = this.holders.get(deviceId);
    if (!holders) return;
    holders.delete(holder);
    if (holders.size) return;
    this.holders.delete(deviceId);
    const monitor = this.monitors.get(deviceId);
    this.monitors.delete(deviceId);
    await monitor?.stop();
  }

  /** Stop watching a device regardless of holders (device deleted). */
  async forget(deviceId) {
    const monitor = this.monitors.get(deviceId);
    this.monitors.delete(deviceId);
    this.holders.delete(deviceId);
    await monitor?.stop();
  }

  /**
   * Restart a watched device's monitor from a fresh row (IP, platform, or
   * credential may have changed). Keeps its holders; stops it if the device
   * can no longer be watched.
   */
  async refresh(device) {
    const old = this.monitors.get(device.id);
    if (!old) return;
    this.monitors.delete(device.id);
    await old.stop();
    const reason = unsupportedReason(device);
    if (reason) {
      this.holders.delete(device.id);
      emit('device:live:status', { deviceId: device.id, connected: false, lastError: reason }, liveRoom(device.id));
      return;
    }
    const monitor = new DeviceMonitor(this, device);
    this.monitors.set(device.id, monitor);
    await monitor.start();
  }

  getMonitor(deviceId) {
    return this.monitors.get(deviceId) || null;
  }

  getSnapshot(deviceId) {
    return this.monitors.get(deviceId)?.snapshot() || null;
  }

  /** Persist an event and broadcast it. */
  async recordEvent(device, event, source) {
    const row = await getPrisma().deviceEvent.create({
      data: {
        deviceId: device.id,
        type: event.type,
        port: event.port,
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
      port: event.port,
      data: event.data || {},
      source,
      occurredAt: row?.occurredAt || new Date(),
    };
    emit('device:event', payload);
    return payload;
  }

  emitStatus(monitor) {
    emit('device:live:status', {
      deviceId: monitor.device.id,
      connected: monitor.connected,
      lastError: monitor.lastError,
    }, liveRoom(monitor.device.id));
  }

  /** Apply Device.liveMonitoring after it changes. */
  async setAlwaysOn(device, enabled) {
    if (enabled) {
      if (config().enabled) await this.hold(device, 'always');
    } else {
      await this.release(device.id, 'always');
    }
  }

  async pruneEvents() {
    const cutoff = new Date(Date.now() - config().retentionDays * 24 * 3600 * 1000);
    const { count } = await getPrisma().deviceEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } });
    if (count) logger.info(`Pruned ${count} device event(s) older than ${config().retentionDays} days`);
  }
}

const service = new StateMonitorService();
module.exports = service;
module.exports.StateMonitorService = StateMonitorService;
module.exports.unsupportedReason = unsupportedReason;
module.exports.liveRoom = liveRoom;
