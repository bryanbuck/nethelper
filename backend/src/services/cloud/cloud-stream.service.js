/**
 * Cloud event streams: one push connection per integration whose provider
 * supports('events') (Juniper Mist today; Central only offers webhooks to a
 * public URL, see docs/MULTI_VENDOR_ROADMAP.md §8f).
 *
 * The stream is a trigger and an event source, not a status source (Mist's
 * device stats carry no status; a device that disconnects just goes quiet):
 * - a device the database holds as not online that reports, or an online one
 *   whose last report expired (`_ttl`), asks the REST status refresh
 *   (cloud-status.service), which stays the one place statuses, alerts and
 *   `device:status:update` come from;
 * - every (re)connect runs that refresh too, as a resync;
 * - port link changes and restarts become DeviceEvent rows (source `cloud`).
 *
 * Refreshes per integration run one at a time and at most every
 * REFRESH_MIN_GAP_MS, which keeps a storm of reports within Mist's 5,000
 * requests/hour. In-memory and single-instance, like the live monitor.
 */

const { getPrisma } = require('../../config/database');
const CloudProviderFactory = require('../cloud-providers/cloud-provider-factory');
const cloudStatus = require('../cloud-status.service');
const deviceEvents = require('../device-events.service');
const { parseStreamStats, mergeStreamState, streamEvents } = require('./mist-stream');
const { normalizeMac } = require('../../utils/device-key');
const logger = require('../../utils/logger');

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // new sites, devices, integration edits
const SWEEP_INTERVAL_MS = 30 * 1000;
const EXPIRY_GRACE_MS = 30 * 1000;
const REFRESH_MIN_GAP_MS = 30 * 1000;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

const enabled = () => process.env.CLOUD_STREAM_ENABLED !== 'false';

/** Changes to these mean a new connection. */
const fingerprint = (integration) => [
  integration.baseUrl,
  integration.updatedAt ? new Date(integration.updatedAt).getTime() : '',
].join('|');

class IntegrationStream {
  constructor(provider) {
    this.provider = provider;
    this.key = fingerprint(provider.integration);
    this.state = 'idle'; // idle | connecting | connected | disconnected | stopped
    this.stream = null;
    this.stopped = false;
    this.attempts = 0;
    this.connectedAt = null;
    this.lastMessageAt = null;
    this.lastError = null;
    this.devices = { byMac: new Map(), bySerial: new Map(), byId: new Map() };
    this.seen = new Map(); // deviceId -> { state, expiresAt }
    this.refresh = { running: false, pending: null, lastAt: 0, timer: null };
    this.reconnectTimer = null;
  }

  get label() {
    return this.provider.label;
  }

  async start() {
    this.stopped = false;
    await this.connect();
  }

  async connect() {
    if (this.stopped) return;
    this.state = 'connecting';
    let channels;
    try {
      channels = await this.provider.listEventChannels();
      await this.loadDevices();
    } catch (error) {
      this.lastError = error.message;
      this.state = 'disconnected';
      logger.warn(`cloud-stream: ${this.label} not started: ${error.message}`);
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const stream = this.provider.openEventStream(channels);
    this.stream = stream;
    stream.on('open', () => {
      if (stream !== this.stream) return;
      this.state = 'connected';
      this.connectedAt = new Date();
      this.attempts = 0;
      this.lastError = null;
      logger.info(`cloud-stream: ${this.label} connected (${channels.length} channel(s))`);
      // Anything could have changed while we weren't listening.
      this.requestRefresh('stream connected');
    });
    stream.on('data', ({ data }) => {
      if (stream === this.stream) this.onStats(data).catch((error) => logger.warn(`cloud-stream: ${error.message}`));
    });
    stream.on('close', ({ code, error }) => {
      if (stream !== this.stream) return;
      this.stream = null;
      this.connectedAt = null;
      if (this.stopped) return;
      this.state = 'disconnected';
      this.lastError = error?.message || `closed (${code})`;
      logger.warn(`cloud-stream: ${this.label} disconnected: ${this.lastError}`);
      this.scheduleReconnect();
    });
    stream.open();
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempts, BACKOFF_MAX_MS) * (0.8 + Math.random() * 0.4);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /** The integration's cloud devices, by MAC (APs send no serial) and serial. */
  async loadDevices() {
    const rows = await getPrisma().device.findMany({
      where: { cloudIntegrationId: this.provider.id, managementMode: 'cloud' },
      select: { id: true, name: true, serial: true, macAddress: true, cloudStatus: true },
    });
    const devices = { byMac: new Map(), bySerial: new Map(), byId: new Map() };
    for (const row of rows) {
      devices.byId.set(row.id, row);
      const mac = normalizeMac(row.macAddress);
      if (mac) devices.byMac.set(mac, row);
      if (row.serial) devices.bySerial.set(row.serial, row);
    }
    this.devices = devices;
  }

  /** Pick up new sites and devices on a live connection. */
  async refreshTargets() {
    if (!this.stream?.isOpen) return;
    const channels = new Set(await this.provider.listEventChannels());
    for (const channel of channels) this.stream.subscribe(channel);
    for (const channel of [...this.stream.channels]) if (!channels.has(channel)) this.stream.unsubscribe(channel);
    await this.loadDevices();
  }

  async onStats(data) {
    const update = parseStreamStats(data);
    if (!update) return;
    const device = this.devices.byMac.get(update.mac) || (update.serial && this.devices.bySerial.get(update.serial));
    if (!device) return; // not synced yet; the next sync creates it
    this.lastMessageAt = new Date();

    const entry = this.seen.get(device.id);
    const events = streamEvents(entry?.state, update);
    this.seen.set(device.id, {
      state: mergeStreamState(entry?.state, update),
      expiresAt: Date.now() + update.ttlMs + EXPIRY_GRACE_MS,
    });
    for (const event of events) await deviceEvents.record(device, event, 'cloud');

    if (device.cloudStatus !== 'online') this.requestRefresh(`${device.name} is reporting`);
  }

  /** Online devices whose last report expired: ask whether they are gone. */
  sweep(now = Date.now()) {
    for (const [deviceId, entry] of this.seen) {
      if (now < entry.expiresAt) continue;
      const device = this.devices.byId.get(deviceId);
      if (!device) {
        this.seen.delete(deviceId);
        continue;
      }
      // Ask again after another window if the cloud still says online; the
      // entry stays so a restart is still noticed when the device returns.
      entry.expiresAt = now + entry.state.ttlMs;
      if (device.cloudStatus === 'online') this.requestRefresh(`${device.name} stopped reporting`);
    }
  }

  requestRefresh(reason) {
    if (this.stopped) return;
    const refresh = this.refresh;
    if (refresh.running || refresh.timer) {
      refresh.pending = refresh.pending || reason;
      return;
    }
    const wait = refresh.lastAt + REFRESH_MIN_GAP_MS - Date.now();
    if (wait > 0) {
      refresh.pending = reason;
      refresh.timer = setTimeout(() => {
        refresh.timer = null;
        const next = refresh.pending;
        refresh.pending = null;
        this.requestRefresh(next);
      }, wait);
      refresh.timer.unref?.();
      return;
    }
    this.runRefresh(reason);
  }

  async runRefresh(reason) {
    const refresh = this.refresh;
    refresh.running = true;
    try {
      const summary = await cloudStatus.refreshProvider(this.provider);
      logger.debug(`cloud-stream: ${this.label} refresh (${reason}): ${summary.statusChanges} status change(s)`);
      await this.loadDevices();
    } catch (error) {
      logger.warn(`cloud-stream: ${this.label} refresh (${reason}) failed: ${error.message}`);
    } finally {
      refresh.running = false;
      refresh.lastAt = Date.now();
      if (refresh.pending && !this.stopped) {
        const next = refresh.pending;
        refresh.pending = null;
        this.requestRefresh(next);
      }
    }
  }

  stop() {
    this.stopped = true;
    this.state = 'stopped';
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.refresh.timer);
    this.reconnectTimer = null;
    this.refresh.timer = null;
    const { stream } = this;
    this.stream = null;
    stream?.close();
  }

  status() {
    return {
      state: this.state,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
      channels: this.stream ? this.stream.channels.size : 0,
      devices: this.seen.size,
    };
  }
}

class CloudStreamService {
  constructor() {
    this.streams = new Map(); // integrationId -> IntegrationStream
    this.reconcileTimer = null;
    this.sweepTimer = null;
    this.reconciling = null;
  }

  async start() {
    if (!enabled()) {
      logger.info('Cloud event streams disabled (CLOUD_STREAM_ENABLED=false)');
      return;
    }
    await this.reconcile();
    this.reconcileTimer = setInterval(() => this.reconcile().catch(() => {}), RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  /**
   * Match the open streams to the active integrations: open new ones, close
   * removed or deactivated ones, reconnect edited ones, and pick up new sites
   * and devices on the rest. Called on a timer and after integration edits.
   */
  reconcile() {
    if (!enabled()) return Promise.resolve();
    // Overlapping calls share one pass.
    this.reconciling = this.reconciling || this.reconcileOnce().finally(() => { this.reconciling = null; });
    return this.reconciling;
  }

  async reconcileOnce() {
    let providers;
    try {
      providers = (await CloudProviderFactory.activeProviders()).filter((p) => p.supports('events'));
    } catch (error) {
      logger.warn(`cloud-stream: could not list integrations: ${error.message}`);
      return;
    }
    const wanted = new Map(providers.map((p) => [p.id, p]));
    for (const [id, stream] of this.streams) {
      const provider = wanted.get(id);
      if (provider && fingerprint(provider.integration) === stream.key) continue;
      stream.stop();
      this.streams.delete(id);
    }
    for (const [id, provider] of wanted) {
      const existing = this.streams.get(id);
      if (existing) {
        await existing.refreshTargets().catch((error) => {
          logger.warn(`cloud-stream: ${existing.label} targets not refreshed: ${error.message}`);
        });
        continue;
      }
      const stream = new IntegrationStream(provider);
      this.streams.set(id, stream);
      stream.start();
    }
  }

  sweep(now = Date.now()) {
    for (const stream of this.streams.values()) stream.sweep(now);
  }

  /** Every open stream with its integration, for the System Status page. */
  stats() {
    return {
      enabled: enabled(),
      streams: [...this.streams.entries()].map(([integrationId, stream]) => ({
        integrationId,
        label: stream.label,
        ...stream.status(),
      })),
    };
  }

  /** The stream state of one integration, or null when it has none. */
  status(integrationId) {
    return this.streams.get(integrationId)?.status() || null;
  }

  stop() {
    clearInterval(this.reconcileTimer);
    clearInterval(this.sweepTimer);
    this.reconcileTimer = null;
    this.sweepTimer = null;
    for (const stream of this.streams.values()) stream.stop();
    this.streams.clear();
  }
}

const service = new CloudStreamService();
module.exports = service;
module.exports.CloudStreamService = CloudStreamService;
module.exports.IntegrationStream = IntegrationStream;
