/**
 * Port Identity, read and note side: what the API returns about a switch's
 * ports, port notes (with their revisions), and the fleet-wide search.
 *
 * A port view merges, per port key (normalizePortName):
 *   the latest read summaries (PortReadState.portSummary: label, description,
 *   link, MAC count, uplink/AP), the stored sightings (PortClient), the
 *   user's note (PortNote), the LLDP neighbors (DeviceLink) and the VLAN
 *   snapshot (DeviceTopologyState.vlans). A port appears when any of them
 *   knows it, or when a note names it.
 */

const { getPrisma } = require('../../config/database');
const { normalizeMac } = require('../../utils/device-key');
const { normalizePortName } = require('../topology/neighbor');
const { findPort } = require('../topology/vlan-membership');
const aging = require('./client-aging');
const portClientService = require('./port-client.service');
const logger = require('../../utils/logger');

const RECENT_GONE_MS = 7 * 24 * 60 * 60 * 1000;
const NOTE_FIELDS = ['label', 'location', 'owner', 'notes', 'kind', 'expectedMac'];
const NOTE_LIMITS = {
  label: 64, location: 255, owner: 255, notes: 4000,
};

class PortError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function emit(event, payload) {
  try {
    const { getIO } = require('../../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch (error) {
    logger.debug(`ports: could not emit ${event}: ${error.message}`);
  }
}

/** Natural order: 1/1/2 before 1/1/10, ge-0/0/2 before ge-0/0/10, LAGs after ports. */
function comparePorts(a, b) {
  const lagA = /^(lag|ae|po|trk)/i.test(a);
  const lagB = /^(lag|ae|po|trk)/i.test(b);
  if (lagA !== lagB) return lagA ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function noteView(note) {
  if (!note) return null;
  return {
    label: note.label,
    location: note.location,
    owner: note.owner,
    notes: note.notes,
    kind: note.kind,
    expectedMac: note.expectedMac,
    updatedAt: note.updatedAt,
    updatedBy: note.updatedBy ? { id: note.updatedBy.id, name: note.updatedBy.name } : null,
  };
}

function clientView(row, freshnessOpts) {
  const { freshness, since } = aging.clientFreshness(row, freshnessOpts);
  return {
    id: row.id,
    mac: row.mac,
    ip: row.ip,
    hostname: row.hostname,
    username: row.username,
    vendor: row.vendor,
    vlan: row.vlan,
    profile: row.profile,
    lldp: row.lldp,
    sources: row.sources,
    state: row.state,
    freshness,
    since,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    missedReads: row.missedReads,
    goneAt: row.goneAt,
    goneReason: row.goneReason,
    goneDetail: row.goneDetail,
  };
}

/** Live clients first (newest seen first), then gone ones (newest gone first). */
function sortClients(a, b) {
  const liveA = a.state !== 'gone';
  const liveB = b.state !== 'gone';
  if (liveA !== liveB) return liveA ? -1 : 1;
  const t = (v) => (v ? new Date(v).getTime() : 0);
  return liveA ? t(b.lastSeen) - t(a.lastSeen) : t(b.goneAt) - t(a.goneAt);
}

class PortViewService {
  async loadDevice(deviceId) {
    const device = await getPrisma().device.findUnique({
      where: { id: deviceId },
      select: {
        id: true, name: true, type: true, vendor: true, platform: true, managementMode: true,
      },
    });
    if (!device) throw new PortError('Device not found', 404);
    return device;
  }

  /**
   * Everything known about the device's ports.
   * @param opts.port      only this port (a port name in any spelling)
   * @param opts.allGone   include every gone sighting kept, not only the last 7 days
   */
  async getPorts(deviceId, { port = null, allGone = false, now = new Date() } = {}) {
    const prisma = getPrisma();
    const device = await this.loadDevice(deviceId);
    const only = port ? normalizePortName(port) : null;
    const portWhere = only ? { port: only } : {};
    const [states, clients, notes, links, topology] = await Promise.all([
      prisma.portReadState.findMany({ where: { deviceId } }),
      prisma.portClient.findMany({ where: { deviceId, ...portWhere } }),
      prisma.portNote.findMany({ where: { deviceId, ...portWhere }, include: { updatedBy: { select: { id: true, name: true } } } }),
      prisma.deviceLink.findMany({ where: { deviceId, active: true } }),
      prisma.deviceTopologyState.findUnique({ where: { deviceId }, select: { vlans: true } }),
    ]);

    const lastSuccessAt = states.reduce((max, s) => (s.lastSuccessAt && (!max || s.lastSuccessAt > max) ? s.lastSuccessAt : max), null);
    const observingSince = states.reduce((min, s) => (!min || s.createdAt < min ? s.createdAt : min), null);
    const freshnessOpts = { lastSuccessAt, intervalMs: portClientService.intervalMs, now };

    // Newest summary wins per port.
    const summaries = new Map();
    for (const s of [...states].sort((a, b) => (a.readAt || 0) - (b.readAt || 0))) {
      for (const [key, value] of Object.entries(s.portSummary || {})) summaries.set(key, { ...summaries.get(key), ...value });
    }

    const neighborMacs = links.map((l) => normalizeMac(l.remoteMac)).filter(Boolean);
    const known = neighborMacs.length
      ? await prisma.device.findMany({ where: { macAddress: { not: null } }, select: { id: true, name: true, macAddress: true } })
      : [];
    const byMac = new Map(known.map((d) => [normalizeMac(d.macAddress), { id: d.id, name: d.name }]));

    const keys = new Set([...summaries.keys(), ...clients.map((c) => c.port), ...notes.map((n) => n.port), ...links.map((l) => normalizePortName(l.localPort))]);
    if (only) for (const k of [...keys]) if (k !== only) keys.delete(k);
    if (only) keys.add(only);

    const ports = [...keys].sort(comparePorts).map((key) => {
      const summary = summaries.get(key) || null;
      const note = notes.find((n) => n.port === key) || null;
      const rows = clients.filter((c) => c.port === key);
      const live = rows.filter((c) => c.state !== 'gone');
      const gone = rows.filter((c) => c.state === 'gone').sort(sortClients);
      const shownGone = allGone ? gone : gone.filter((c) => c.goneAt && now - new Date(c.goneAt) <= RECENT_GONE_MS);
      // A port with nothing live still shows who was there last.
      if (!live.length && !shownGone.length && gone.length) shownGone.push(gone[0]);
      const portLinks = links.filter((l) => normalizePortName(l.localPort) === key);
      const vlan = topology?.vlans ? findPort(topology.vlans, key) : null;
      const expectedMac = note?.expectedMac || null;
      return {
        port: key,
        label: summary?.label || note?.portLabel || portLinks[0]?.localPort || rows[0]?.portLabel || key,
        description: summary?.description ?? null,
        linkUp: summary?.linkUp ?? null,
        macCount: summary?.macCount ?? null,
        uplink: summary?.uplink ?? false,
        ap: summary?.ap ?? null,
        kind: aging.derivePortKind({ note, summary, clients: rows, observingSince, now }),
        note: noteView(note),
        expected: expectedMac ? { mac: expectedMac, present: live.some((c) => c.mac === expectedMac) } : null,
        clients: [...live.sort(sortClients), ...shownGone].map((c) => clientView(c, freshnessOpts)),
        goneCount: gone.length,
        neighbors: portLinks.map((l) => ({
          sysName: l.remoteSysName,
          portId: l.remotePortId,
          portDesc: l.remotePortDesc,
          mac: l.remoteMac,
          mgmtIp: l.remoteMgmtIp,
          capabilities: l.remoteCapabilities,
          source: l.source,
          device: byMac.get(normalizeMac(l.remoteMac)) || null,
        })),
        vlan: vlan ? {
          mode: vlan.mode, untagged: vlan.untagged, tagged: vlan.tagged, allTagged: vlan.allTagged,
        } : null,
      };
    });

    return {
      device,
      intervalMs: portClientService.intervalMs,
      lastSuccessAt,
      observingSince,
      reads: states.map((s) => ({
        source: s.source, readAt: s.readAt, lastSuccessAt: s.lastSuccessAt, error: s.error,
      })),
      ports,
    };
  }

  /** One port, every kept sighting, and the note's revisions (newest first). */
  async getPort(deviceId, port) {
    const view = await this.getPorts(deviceId, { port, allGone: true });
    const key = normalizePortName(port);
    const revisions = await getPrisma().portNoteRevision.findMany({
      where: { deviceId, port: key },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { id: true, name: true } } },
    });
    return {
      ...view,
      port: view.ports[0],
      revisions: revisions.map((r) => ({
        action: r.action, values: r.values, createdAt: r.createdAt, user: r.user ? { id: r.user.id, name: r.user.name } : null,
      })),
    };
  }

  /** Validate and normalize a note body; unknown keys are ignored. */
  cleanNote(body = {}) {
    const data = {};
    for (const field of NOTE_FIELDS) {
      if (!(field in body)) continue;
      let value = body[field];
      if (value === undefined) continue;
      if (value === null || value === '') {
        data[field] = field === 'kind' ? 'auto' : null;
        continue;
      }
      if (typeof value !== 'string') throw new PortError(`${field} must be text`);
      value = value.trim();
      if (field === 'kind') {
        if (!aging.NOTE_KINDS.includes(value)) throw new PortError(`kind must be one of ${aging.NOTE_KINDS.join(', ')}`);
      } else if (field === 'expectedMac') {
        const mac = normalizeMac(value);
        if (!mac) throw new PortError('expectedMac is not a MAC address');
        value = mac;
      } else if (value.length > NOTE_LIMITS[field]) {
        throw new PortError(`${field} is limited to ${NOTE_LIMITS[field]} characters`);
      }
      data[field] = value || null;
    }
    return data;
  }

  /**
   * Create or change a port's note. A note left with no content is cleared.
   * @returns the port's note view, or null when cleared
   */
  async setNote(deviceId, port, body, userId) {
    const prisma = getPrisma();
    await this.loadDevice(deviceId);
    const key = normalizePortName(port);
    if (!key || key.length > 64) throw new PortError('Invalid port');
    const data = this.cleanNote(body);
    const existing = await prisma.portNote.findUnique({ where: { deviceId_port: { deviceId, port: key } } });
    const merged = { ...(existing && Object.fromEntries(NOTE_FIELDS.map((f) => [f, existing[f]]))), ...data };
    const empty = NOTE_FIELDS.every((f) => (f === 'kind' ? !merged.kind || merged.kind === 'auto' : !merged[f]));
    if (empty) {
      await this.clearNote(deviceId, port, userId);
      return null;
    }
    const portLabel = typeof body.portLabel === 'string' && body.portLabel.trim() ? body.portLabel.trim().slice(0, 64) : (existing?.portLabel || String(port).trim());
    const note = await prisma.$transaction(async (tx) => {
      const saved = await tx.portNote.upsert({
        where: { deviceId_port: { deviceId, port: key } },
        create: {
          deviceId, port: key, portLabel, ...data, updatedById: userId,
        },
        update: { ...data, portLabel, updatedById: userId },
        include: { updatedBy: { select: { id: true, name: true } } },
      });
      await tx.portNoteRevision.create({
        data: {
          deviceId, port: key, action: 'set', values: Object.fromEntries(NOTE_FIELDS.map((f) => [f, saved[f] ?? null])), userId,
        },
      });
      return saved;
    });
    emit('ports:updated', { deviceId });
    return noteView(note);
  }

  async clearNote(deviceId, port, userId) {
    const prisma = getPrisma();
    await this.loadDevice(deviceId);
    const key = normalizePortName(port);
    const existing = await prisma.portNote.findUnique({ where: { deviceId_port: { deviceId, port: key } } });
    if (!existing) return false;
    await prisma.$transaction([
      prisma.portNote.delete({ where: { id: existing.id } }),
      prisma.portNoteRevision.create({
        data: {
          deviceId, port: key, action: 'clear', values: {}, userId,
        },
      }),
    ]);
    emit('ports:updated', { deviceId });
    return true;
  }

  /**
   * Fleet-wide "where is this?": sightings by MAC (any spelling, or 4+ hex
   * digits of it), IP, hostname, user, vendor, a cloud's classification
   * (os/function/category) or the client's LLDP name, and notes by any text field.
   */
  async search(q, { limit = 50 } = {}) {
    const prisma = getPrisma();
    const text = String(q || '').trim();
    if (text.length < 2) throw new PortError('Search needs at least 2 characters');
    const hex = text.toLowerCase().replace(/[:.-]/g, '');
    // "192.168.20" is all hex digits once its dots go; an IP-shaped query is an IP.
    const ipLike = /^\d{1,3}(\.\d{0,3}){1,3}$/.test(text);
    const macIds = !ipLike && /^[0-9a-f]{4,12}$/.test(hex)
      ? (await prisma.$queryRaw`SELECT "id" FROM "PortClient" WHERE replace("mac", ':', '') LIKE ${`%${hex}%`} LIMIT 500`).map((r) => r.id)
      : [];
    // What a cloud classifies the client as, and its own LLDP name ("camera", "phone", "SEP…").
    const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const textIds = ipLike ? [] : (await prisma.$queryRaw`
      SELECT "id" FROM "PortClient"
      WHERE "profile"->>'os' ILIKE ${like} OR "profile"->>'function' ILIKE ${like}
         OR "profile"->>'category' ILIKE ${like} OR "lldp"->>'sysName' ILIKE ${like}
      LIMIT 500`).map((r) => r.id);
    const ids = [...new Set([...macIds, ...textIds])];
    const contains = { contains: text, mode: 'insensitive' };
    const deviceSelect = { select: { id: true, name: true } };
    const [clients, notes] = await Promise.all([
      prisma.portClient.findMany({
        where: {
          OR: [
            ...(ids.length ? [{ id: { in: ids } }] : []),
            { ip: text.includes('.') ? { startsWith: text } : { equals: text } },
            { hostname: contains },
            { username: contains },
            { vendor: contains },
          ],
        },
        include: { device: deviceSelect },
        orderBy: [{ lastSeen: 'desc' }],
        take: limit * 2,
      }),
      prisma.portNote.findMany({
        where: {
          OR: [{ label: contains }, { location: contains }, { owner: contains }, { notes: contains }, { expectedMac: normalizeMac(text) || undefined }]
            .filter((c) => Object.values(c)[0] !== undefined),
        },
        include: { device: deviceSelect },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
    ]);
    return {
      clients: clients.sort(sortClients).slice(0, limit).map((c) => ({
        device: c.device, port: c.port, portLabel: c.portLabel, mac: c.mac, ip: c.ip, hostname: c.hostname, username: c.username,
        vendor: c.vendor, profile: c.profile, state: c.state, lastSeen: c.lastSeen, goneAt: c.goneAt, goneReason: c.goneReason,
      })),
      notes: notes.map((n) => ({
        device: n.device, port: n.port, portLabel: n.portLabel, ...noteView({ ...n, updatedBy: null }),
      })),
    };
  }
}

module.exports = new PortViewService();
module.exports.PortError = PortError;
module.exports.comparePorts = comparePorts;
