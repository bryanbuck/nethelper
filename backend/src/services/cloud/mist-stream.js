/**
 * Juniper Mist WebSocket stream (wss://api-ws.<region>.mist.com/api-ws/v1/stream),
 * checked against a live org on 2026-10-19 (tests/fixtures/mist-live/stream-*.json):
 *
 * - The upgrade request carries the same `Authorization: Token …` as REST.
 * - `{"subscribe": "<channel>"}` is acked by `{"event":"channel_subscribed","channel":…}`;
 *   a channel Mist doesn't serve gets no reply at all.
 * - Data arrives as `{"event":"data","channel":…,"data":"<JSON string>"}`.
 * - `/sites/:id/stats/devices` sends partial stats, about once a minute per
 *   connected device: a switch one message (serial, uptime, if_stat), an AP
 *   two (port_stat, then uptime/version), keyed by MAC with no serial. No
 *   message carries `status`, and a device that disconnects just goes quiet.
 *   Each message says how long it stays valid (`_ttl`, 190 s seen).
 *
 * So the stream is a trigger, not a status source: cloud-stream.service asks
 * the REST status refresh when a device starts or stops reporting. Port link
 * changes and restarts (uptime going backwards) come from the stream itself.
 *
 * Read-only: the client only ever sends `subscribe`/`unsubscribe`.
 */

const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { normalizeMac } = require('../../utils/device-key');

const DEFAULT_TTL_MS = 190000;
// A restart, not clock jitter between an AP's two messages.
const RESTART_MARGIN_S = 60;
// Physical ports and LAGs in a switch's if_stat; skips irb, vme, me0, lo0.
const SWITCH_PORT = /^(?:(?:ge|xe|mge|et)-\d+\/\d+\/\d+|ae\d+)$/;

/** Link state by port from one stats message, or null when it carries none. */
function streamPorts(data) {
  if (data.port_stat && typeof data.port_stat === 'object') {
    const ports = {};
    for (const [port, stat] of Object.entries(data.port_stat)) {
      if (!stat || typeof stat !== 'object' || typeof stat.up !== 'boolean') continue;
      ports[port] = { up: stat.up, speedMbps: Number(stat.speed) > 0 ? Number(stat.speed) : null };
    }
    return ports;
  }
  if (data.if_stat && typeof data.if_stat === 'object') {
    const ports = {};
    for (const unit of Object.values(data.if_stat)) {
      const port = unit?.port_id;
      if (!port || !SWITCH_PORT.test(port) || typeof unit.up !== 'boolean') continue;
      // A port is up when any of its logical units is.
      ports[port] = { up: Boolean(ports[port]?.up) || unit.up, speedMbps: null };
    }
    return ports;
  }
  return null;
}

/**
 * One device-stats message as { mac, serial, ttlMs, uptime?, ports? }, or null
 * when it names no device.
 */
function parseStreamStats(data) {
  if (!data || typeof data !== 'object') return null;
  const mac = normalizeMac(data.mac);
  if (!mac) return null;
  const update = {
    mac,
    serial: data.serial || null,
    name: data.name || data.hostname || null,
    ttlMs: Number(data._ttl) > 0 ? Number(data._ttl) * 1000 : DEFAULT_TTL_MS,
  };
  if (Number.isFinite(Number(data.uptime)) && data.uptime !== null) update.uptime = Number(data.uptime);
  const ports = streamPorts(data);
  if (ports) update.ports = ports;
  return update;
}

/** Fold a message into what is known of the device (messages are partial). */
function mergeStreamState(state, update) {
  return {
    ...(state || {}),
    mac: update.mac,
    serial: update.serial || state?.serial || null,
    ttlMs: update.ttlMs,
    ...(update.uptime !== undefined && { uptime: update.uptime }),
    ...(update.ports && { ports: { ...(state?.ports || {}), ...update.ports } }),
  };
}

/**
 * Events between what was known and a new message: a restart when uptime
 * went backwards, a link change per port seen in both. Nothing on the first
 * message, which is only a baseline.
 */
function streamEvents(state, update) {
  if (!state) return [];
  const events = [];
  if (state.uptime !== undefined && update.uptime !== undefined && update.uptime + RESTART_MARGIN_S < state.uptime) {
    events.push({ type: 'device.restarted', port: null, data: { uptimeSec: update.uptime } });
  }
  for (const [port, next] of Object.entries(update.ports || {})) {
    const before = state.ports?.[port];
    if (!before || before.up === next.up) continue;
    events.push({
      type: next.up ? 'port.link.up' : 'port.link.down',
      port,
      data: next.up && next.speedMbps ? { speedMbps: next.speedMbps } : {},
    });
  }
  return events;
}

/**
 * One org's stream connection. Emits `open`, `subscribed` (channel), `data`
 * ({ channel, data }) and `close` ({ code, error }). Not reconnecting: the
 * owner (cloud-stream.service) decides when to open a new one.
 */
class MistStream extends EventEmitter {
  constructor({ url, headers, channels = [], pingIntervalMs = 30000 }) {
    super();
    this.url = url;
    this.headers = headers;
    this.channels = new Set(channels);
    this.pingIntervalMs = pingIntervalMs;
    this.ws = null;
    this.error = null;
  }

  open() {
    const ws = new WebSocket(this.url, { headers: this.headers, handshakeTimeout: 15000 });
    this.ws = ws;
    ws.on('open', () => {
      for (const channel of this.channels) this.send({ subscribe: channel });
      this.startPing();
      this.emit('open');
    });
    ws.on('message', (raw) => this.onMessage(raw));
    ws.on('pong', () => { this.alive = true; });
    // ws follows every error with close; report them together.
    ws.on('error', (error) => { this.error = error; });
    ws.on('close', (code) => {
      this.stopPing();
      this.emit('close', { code, error: this.error });
    });
    return this;
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(message) {
    if (this.isOpen) this.ws.send(JSON.stringify(message));
  }

  subscribe(channel) {
    if (this.channels.has(channel)) return;
    this.channels.add(channel);
    this.send({ subscribe: channel });
  }

  unsubscribe(channel) {
    if (!this.channels.delete(channel)) return;
    this.send({ unsubscribe: channel });
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.event === 'channel_subscribed') {
      this.emit('subscribed', message.channel);
      return;
    }
    if (message.event !== 'data') return;
    let { data } = message;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    this.emit('data', { channel: message.channel, data });
  }

  /** A socket that stops answering pings is dead even if TCP hasn't noticed. */
  startPing() {
    this.alive = true;
    this.pingTimer = setInterval(() => {
      if (!this.alive) {
        this.error = this.error || new Error('Mist stopped answering pings');
        this.ws.terminate();
        return;
      }
      this.alive = false;
      this.ws.ping();
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  stopPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  close() {
    this.stopPing();
    if (!this.ws) return;
    if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
    else this.ws.close(1000);
  }
}

module.exports = { MistStream, parseStreamStats, mergeStreamState, streamEvents, DEFAULT_TTL_MS };
