/**
 * Port Identity: how wired-client sightings age (pure, no I/O).
 *
 * A read is a full snapshot of one device's ports from one source. Applying it
 * to the device's stored PortClient rows:
 *
 *   listed                        -> present, lastSeen = readAt, missedReads 0
 *   left out, port link down      -> gone (link-down), at once
 *   left out, a static port now
 *     has another MAC             -> gone (port-reassigned)
 *   left out, port still up       -> missedReads + 1; unconfirmed at missLimit,
 *                                    gone (omitted) at twice that. MAC tables
 *                                    age a quiet printer out in ~5 min, so one
 *                                    miss proves nothing.
 *   read failed / not read        -> nothing changes (the caller doesn't call
 *                                    applyRead); clientFreshness() turns the
 *                                    age of the last good read into "stale".
 *
 * Between reads, a link-down event (linkDownUpdates) and the same MAC turning
 * up on another port anywhere in the fleet (movedUpdates) also end a sighting.
 */

const { normalizeMac } = require('../../utils/device-key');
const { normalizePortName } = require('../topology/neighbor');

const STATES = Object.freeze(['present', 'unconfirmed', 'gone']);
const GONE_REASONS = Object.freeze(['omitted', 'link-down', 'moved', 'port-reassigned']);
const SOURCES = Object.freeze(['mac-table', 'lldp', 'cloud-wired', 'arp']);
const PORT_KINDS = Object.freeze(['static', 'dynamic', 'uplink', 'ap', 'unused', 'idle', 'new']);
const NOTE_KINDS = Object.freeze(['auto', 'static', 'dynamic', 'uplink', 'unused']);
const FRESHNESS = Object.freeze(['confirmed', 'unconfirmed', 'stale', 'gone']);

const DAY = 24 * 60 * 60 * 1000;
const DEFAULTS = Object.freeze({
  missLimit: 2,
  maxPerPort: 16,
  staticAfterMs: 7 * DAY,
  dynamicWindowMs: 7 * DAY,
  dynamicMinMacs: 3,
  unusedAfterMs: 30 * DAY,
});

const key = (port, mac) => `${port}|${mac}`;
const time = (v) => (v ? new Date(v).getTime() : null);

function union(a, b) {
  return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])].sort();
}

/**
 * Normalize and de-duplicate one read's observations: one entry per
 * (port, MAC), with the sources that saw it merged and the first non-empty
 * value of each field kept. Entries without a usable port or MAC are dropped.
 */
function normalizeObservations(observed) {
  const byKey = new Map();
  for (const o of observed || []) {
    const port = normalizePortName(o?.port);
    const mac = normalizeMac(o?.mac);
    if (!port || !mac) continue;
    const k = key(port, mac);
    const prev = byKey.get(k);
    const entry = {
      port,
      portLabel: o.portLabel || String(o.port).trim(),
      mac,
      ip: o.ip || null,
      hostname: o.hostname || null,
      vendor: o.vendor || null,
      vlan: Number.isInteger(o.vlan) ? o.vlan : null,
      username: o.username || null,
      profile: o.profile || null,
      sources: union([], o.sources || (o.source ? [o.source] : [])),
      lldp: o.lldp || null,
      seenAt: o.seenAt ? new Date(o.seenAt) : null,
      firstSeen: o.firstSeen ? new Date(o.firstSeen) : null,
    };
    if (!prev) {
      byKey.set(k, entry);
      continue;
    }
    for (const f of ['ip', 'hostname', 'vendor', 'vlan', 'username', 'profile', 'lldp', 'firstSeen']) prev[f] = prev[f] ?? entry[f];
    if (entry.seenAt && (!prev.seenAt || entry.seenAt > prev.seenAt)) prev.seenAt = entry.seenAt;
    prev.sources = union(prev.sources, entry.sources);
  }
  return [...byKey.values()];
}

/**
 * Split a read into the clients worth storing and a per-port summary.
 * Uplinks (a link to an inventory device, a LAG member, or more than
 * maxPerPort MACs) keep only a count. An AP port keeps only the AP itself;
 * the wireless clients bridged behind it are counted.
 *
 * @param observed  normalized observations (normalizeObservations)
 * @param opts.uplinkPorts Set of port keys known to be uplinks
 * @param opts.apPorts     Map port key -> AP MAC (from LLDP)
 * @param opts.linkUp      Map port key -> boolean, when the read knows it
 */
function summarizePorts(observed, { uplinkPorts = new Set(), apPorts = new Map(), linkUp = new Map(), maxPerPort = DEFAULTS.maxPerPort } = {}) {
  const byPort = new Map();
  for (const o of observed) {
    if (!byPort.has(o.port)) byPort.set(o.port, []);
    byPort.get(o.port).push(o);
  }
  const summary = {};
  const clients = [];
  for (const [port, list] of byPort) {
    const uplink = uplinkPorts.has(port) || list.length > maxPerPort;
    const apMac = normalizeMac(apPorts.get(port));
    summary[port] = { macCount: list.length, uplink, ...(apMac ? { ap: apMac } : {}) };
    if (linkUp.has(port)) summary[port].linkUp = linkUp.get(port);
    if (uplink) continue;
    if (apMac) {
      clients.push(...list.filter((o) => o.mac === apMac));
      continue;
    }
    clients.push(...list);
  }
  for (const [port, up] of linkUp) {
    if (!summary[port]) summary[port] = { macCount: 0, uplink: uplinkPorts.has(port), linkUp: up };
  }
  return { clients, summary };
}

/**
 * Apply one successful read to a device's stored sightings.
 *
 * @param existing  PortClient rows of this device (any state)
 * @param observed  the read's clients (summarizePorts().clients). An entry's
 *                  `seenAt`/`firstSeen` (a cloud's own times) win over readAt.
 * @param opts.readAt       Date of the read
 * @param opts.linkUp       Map port -> boolean (false = link down)
 * @param opts.staticPorts  Set of ports whose kind is static
 * @param opts.skipPorts    Set of ports this read says nothing about (uplinks:
 *                          their clients were not stored, so they can't be
 *                          "left out")
 * @param opts.missLimit
 * @returns {{ create: object[], update: {id, data}[], touch: string[] }}
 *   `touch` are rows whose only change is "listed again" (lastSeen = readAt),
 *   written with one updateMany.
 */
function applyRead(existing, observed, {
  readAt = new Date(), linkUp = new Map(), staticPorts = new Set(), skipPorts = new Set(), missLimit = DEFAULTS.missLimit,
} = {}) {
  const rows = new Map((existing || []).map((r) => [key(r.port, r.mac), r]));
  const seen = new Set();
  const macsByPort = new Map();
  const create = [];
  const update = [];
  const touch = [];

  for (const o of observed || []) {
    const k = key(o.port, o.mac);
    seen.add(k);
    if (!macsByPort.has(o.port)) macsByPort.set(o.port, new Set());
    macsByPort.get(o.port).add(o.mac);
    const row = rows.get(k);
    const seenAt = o.seenAt || readAt;
    if (!row) {
      create.push({
        port: o.port,
        portLabel: o.portLabel,
        mac: o.mac,
        ip: o.ip,
        hostname: o.hostname,
        vendor: o.vendor,
        vlan: o.vlan,
        username: o.username || null,
        profile: o.profile || null,
        sources: o.sources,
        lldp: o.lldp,
        state: 'present',
        missedReads: 0,
        firstSeen: o.firstSeen && o.firstSeen < seenAt ? o.firstSeen : seenAt,
        lastSeen: seenAt,
      });
      continue;
    }
    const data = {};
    if (row.state !== 'present') data.state = 'present';
    if (row.missedReads) data.missedReads = 0;
    if (row.goneAt || row.goneReason || row.goneDetail) Object.assign(data, { goneAt: null, goneReason: null, goneDetail: null });
    for (const f of ['ip', 'hostname', 'vendor', 'vlan', 'username']) {
      if (o[f] != null && o[f] !== row[f]) data[f] = o[f];
    }
    for (const f of ['lldp', 'profile']) {
      if (o[f] && JSON.stringify(o[f]) !== JSON.stringify(row[f])) data[f] = o[f];
    }
    const sources = union(row.sources, o.sources);
    if (JSON.stringify(sources) !== JSON.stringify(union(row.sources, []))) data.sources = sources;
    if (o.portLabel && o.portLabel !== row.portLabel) data.portLabel = o.portLabel;
    if (Object.keys(data).length || time(seenAt) !== time(readAt)) update.push({ id: row.id, data: { ...data, lastSeen: seenAt } });
    else touch.push(row.id);
  }

  for (const [k, row] of rows) {
    if (seen.has(k) || row.state === 'gone' || skipPorts.has(row.port)) continue;
    if (linkUp.get(row.port) === false) {
      update.push({ id: row.id, data: gone('link-down', readAt) });
      continue;
    }
    const others = macsByPort.get(row.port);
    if (staticPorts.has(row.port) && others && others.size && !others.has(row.mac)) {
      update.push({ id: row.id, data: gone('port-reassigned', readAt) });
      continue;
    }
    const missed = (row.missedReads || 0) + 1;
    if (missed >= 2 * missLimit) update.push({ id: row.id, data: { ...gone('omitted', readAt), missedReads: missed } });
    else if (missed >= missLimit) update.push({ id: row.id, data: { state: 'unconfirmed', missedReads: missed } });
    else update.push({ id: row.id, data: { missedReads: missed } });
  }
  return { create, update, touch };
}

function gone(reason, at, detail = null) {
  return { state: 'gone', goneAt: at, goneReason: reason, goneDetail: detail };
}

/** A port.link.down event: every live sighting on that port is gone. */
function linkDownUpdates(rows, port, at = new Date()) {
  const p = normalizePortName(port);
  return (rows || [])
    .filter((r) => r.port === p && r.state !== 'gone')
    .map((r) => ({ id: r.id, data: gone('link-down', at) }));
}

/**
 * A MAC is in one place at a time: once a read lists it on (deviceId, port),
 * its live sightings anywhere else are gone (moved), pointing at the new spot.
 * The caller passes only non-uplink observations.
 */
function movedUpdates(rows, { deviceId, port }, at = new Date()) {
  return (rows || [])
    .filter((r) => r.state !== 'gone' && !(r.deviceId === deviceId && r.port === port))
    .map((r) => ({ id: r.id, data: gone('moved', at, { deviceId, port }) }));
}

/**
 * What kind of port this is, from the user's override and the sightings.
 * @param opts.note        PortNote row or null
 * @param opts.summary     this port's PortReadState summary entry or null
 * @param opts.clients     every PortClient row of the port (any state)
 * @param opts.observingSince when this device's ports were first read
 * @returns {{ kind: string, source: 'note'|'derived', reason: string }}
 */
function derivePortKind({ note = null, summary = null, clients = [], observingSince = null, now = new Date() } = {}, cfg = DEFAULTS) {
  if (note?.kind && note.kind !== 'auto') return { kind: note.kind, source: 'note', reason: 'set by a user' };
  const t = now.getTime();
  if (summary?.uplink) return { kind: 'uplink', source: 'derived', reason: `${summary.macCount ?? 0} MACs or a link to a managed device` };
  if (summary?.ap) return { kind: 'ap', source: 'derived', reason: 'an access point is connected' };

  const recent = clients.filter((c) => time(c.lastSeen) >= t - cfg.dynamicWindowMs);
  const recentMacs = new Set(recent.map((c) => c.mac));
  if (recentMacs.size >= cfg.dynamicMinMacs) {
    return { kind: 'dynamic', source: 'derived', reason: `${recentMacs.size} different clients in ${Math.round(cfg.dynamicWindowMs / DAY)} days` };
  }
  const live = clients.filter((c) => c.state !== 'gone');
  if (live.length === 1 && recentMacs.size <= 1 && time(live[0].firstSeen) <= t - cfg.staticAfterMs) {
    return { kind: 'static', source: 'derived', reason: `the same client for ${Math.floor((t - time(live[0].firstSeen)) / DAY)} days` };
  }
  if (live.length) return { kind: 'new', source: 'derived', reason: 'not watched long enough to tell' };

  const lastSeen = Math.max(0, ...clients.map((c) => time(c.lastSeen) || 0));
  const watchedLongEnough = observingSince && time(observingSince) <= t - cfg.unusedAfterMs;
  if (watchedLongEnough && summary?.linkUp !== true && lastSeen <= t - cfg.unusedAfterMs) {
    return { kind: 'unused', source: 'derived', reason: `no client for ${Math.round(cfg.unusedAfterMs / DAY)} days` };
  }
  return { kind: 'idle', source: 'derived', reason: 'no client now' };
}

/**
 * How much to trust a sighting now. A failed or missing read never ages a row
 * by itself; it makes it "stale" once the last good read is older than twice
 * the collection interval.
 * @returns {{ freshness: string, since: Date|null }}
 */
function clientFreshness(row, { lastSuccessAt = null, intervalMs, now = new Date() } = {}) {
  if (row.state === 'gone') return { freshness: 'gone', since: row.goneAt ? new Date(row.goneAt) : null };
  const last = time(lastSuccessAt);
  if (!last || (intervalMs && now.getTime() - last > 2 * intervalMs)) {
    return { freshness: 'stale', since: last ? new Date(last) : null };
  }
  if (row.state === 'unconfirmed') return { freshness: 'unconfirmed', since: new Date(row.lastSeen) };
  return { freshness: 'confirmed', since: new Date(row.lastSeen) };
}

module.exports = {
  STATES,
  GONE_REASONS,
  SOURCES,
  PORT_KINDS,
  NOTE_KINDS,
  FRESHNESS,
  DEFAULTS,
  normalizeObservations,
  summarizePorts,
  applyRead,
  linkDownUpdates,
  movedUpdates,
  derivePortKind,
  clientFreshness,
};
