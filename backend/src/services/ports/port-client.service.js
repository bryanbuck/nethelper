/**
 * Port Identity collector: wired clients on switch ports.
 *
 * One run (Bull job `port-clients`, every PORT_CLIENT_INTERVAL):
 *   1. read every switch over resolveTransport(device, 'clients'): AOS-CX
 *      REST MAC/ARP tables, and each cloud's wired-client list once per
 *      integration (shared by all its switches);
 *   2. build a fleet-wide MAC -> IP map from every ARP table and cloud IP;
 *   3. per switch: classify ports (client-merge.js), pick presence (the
 *      switch's own table first, else the cloud's), enrich, then age the
 *      stored sightings (client-aging.js) and write the changes;
 *   4. a MAC now present on one edge port ends its sightings elsewhere (moved).
 * A failed or skipped read changes no sighting; PortReadState records it.
 * Between runs, a port.link.down event ends that port's sightings.
 *
 * Read-only towards devices and clouds. Single-instance, like the live monitor.
 */

const { Prisma } = require('@prisma/client');
const { getPrisma } = require('../../config/database');
const settingsService = require('../settings.service');
const devicePollerService = require('../device-poller.service');
const CloudProviderFactory = require('../cloud-providers/cloud-provider-factory');
const { CapabilityError } = require('../cloud-providers/errors');
const deviceEvents = require('../device-events.service');
const { resolveTransport } = require('../../utils/transport-router');
const { isCxRestCapable, detectPlatform } = require('../../utils/device-platform');
const { normalizeMac } = require('../../utils/device-key');
const { normalizePortName } = require('../topology/neighbor');
const { parseCxInterfaces, parseCxMacTable, parseCxArp } = require('./parsers/aos-cx-clients');
const {
  classifyPorts, presenceObservations, enrich, linkStates,
} = require('./client-merge');
const aging = require('./client-aging');
const logger = require('../../utils/logger');

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function emit(event, payload) {
  try {
    const { getIO } = require('../../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch (error) {
    logger.debug(`port-clients: could not emit ${event}: ${error.message}`);
  }
}

// Nullable JSON columns: a plain null would be stored as JSON null, not SQL NULL.
const JSON_COLUMNS = ['lldp', 'profile', 'goneDetail'];
function toDb(data) {
  const out = { ...data };
  for (const k of JSON_COLUMNS) if (k in out && out[k] === null) out[k] = Prisma.DbNull;
  return out;
}

class ReadSkip extends Error {
  constructor(message, status = 'skipped') {
    super(message);
    this.status = status;
  }
}

function vendorOf(mac) {
  try {
    return require('../discovery.service').lookupVendor(mac);
  } catch {
    return null;
  }
}

class PortClientService {
  constructor() {
    this.intervalMs = num(process.env.PORT_CLIENT_INTERVAL, 1800000);
    this.concurrency = num(process.env.PORT_CLIENT_CONCURRENCY, 4);
    this.missLimit = num(process.env.PORT_CLIENT_MISS_LIMIT, aging.DEFAULTS.missLimit);
    this.retentionDays = num(process.env.PORT_CLIENT_RETENTION_DAYS, 30);
    this.listening = false;
  }

  /** Subscribe to link-down events (idempotent). */
  start() {
    if (this.listening) return;
    this.listening = true;
    deviceEvents.events.on('recorded', (event) => {
      if (event?.type !== 'port.link.down' || !event.port) return;
      this.portWentDown(event.deviceId, event.port, new Date(event.occurredAt || Date.now()))
        .catch((error) => logger.warn(`port-clients: link-down update failed: ${error.message}`));
    });
  }

  async portWentDown(deviceId, port, at = new Date()) {
    const prisma = getPrisma();
    const rows = await prisma.portClient.findMany({
      where: { deviceId, port: normalizePortName(port), state: { not: 'gone' } },
    });
    const updates = aging.linkDownUpdates(rows, port, at);
    for (const u of updates) await prisma.portClient.update({ where: { id: u.id }, data: toDb(u.data) });
    if (updates.length) emit('ports:updated', { deviceId });
    return updates.length;
  }

  /**
   * A cloud's wired clients, read once per integration per run, indexed by
   * switch serial and switch MAC.
   */
  cloudClients(provider, run) {
    const key = provider.integration.id;
    if (!run.cloud.has(key)) {
      run.cloud.set(key, provider.listWiredClients({ windowMs: 2 * this.intervalMs }).then((list) => {
        const bySerial = new Map();
        const byMac = new Map();
        for (const o of list) {
          if (o.switch?.serial) {
            if (!bySerial.has(o.switch.serial)) bySerial.set(o.switch.serial, []);
            bySerial.get(o.switch.serial).push(o);
          }
          const mac = normalizeMac(o.switch?.mac);
          if (mac) {
            if (!byMac.has(mac)) byMac.set(mac, []);
            byMac.get(mac).push(o);
          }
        }
        return { bySerial, byMac };
      }));
    }
    return run.cloud.get(key);
  }

  /** The cloud's observations for one switch, or null when it has none. */
  async cloudFor(device, run) {
    if (device.managementMode !== 'cloud') return null;
    const provider = await CloudProviderFactory.forDevice(device);
    if (!provider.supports('wired-clients')) throw new CapabilityError(`${provider.label} does not support wired clients`);
    const index = await this.cloudClients(provider, run);
    const list = (device.serial && index.bySerial.get(device.serial))
      || index.byMac.get(normalizeMac(device.macAddress))
      || [];
    return { list, label: provider.label };
  }

  /**
   * Read one switch. Never writes.
   * @returns {{ direct: {observations, infraPorts, arp, ifaces}|null, cloud: Object[]|null,
   *   source: 'device-rest'|'cloud', label, directError?: string, cloudError?: string }}
   * @throws {ReadSkip} when nothing could be read
   */
  async readDevice(device, run) {
    const transports = resolveTransport(device, 'clients');
    if (!transports.length) {
      throw new ReadSkip(`No client source for platform "${detectPlatform(device) || 'unknown'}" yet`, 'unsupported');
    }
    const out = { direct: null, cloud: null };
    const notes = [];

    if (transports.includes('device-rest')) {
      const credentials = await settingsService.getDeviceCredentialsForUse(device.id);
      if (!device.ipAddress || !credentials) notes.push('device API needs an IP address and a linked credential');
      else if (!isCxRestCapable(device)) notes.push(`no client-table reader for platform "${detectPlatform(device)}" yet`);
      else {
        try {
          const raw = await devicePollerService.withCxSession(device, credentials, (api) => api.getClientTables());
          const ifaces = parseCxInterfaces(raw.interfaces);
          const { observations, infraPorts } = parseCxMacTable(raw.macs, ifaces);
          out.direct = { observations, infraPorts, arp: parseCxArp(raw.arp), ifaces };
          out.source = 'device-rest';
          out.label = 'AOS-CX REST';
          if (raw.arpError) out.directWarning = `ARP: ${raw.arpError}`;
        } catch (error) {
          out.directError = error.message;
          logger.warn(`port-clients: AOS-CX read failed for ${device.name}: ${error.message}`);
        }
      }
    }

    if (transports.includes('cloud')) {
      try {
        const cloud = await this.cloudFor(device, run);
        if (cloud) {
          out.cloud = cloud.list;
          if (!out.direct) {
            out.source = 'cloud';
            out.label = cloud.label;
          }
        }
      } catch (error) {
        if (error instanceof CapabilityError) notes.push(error.message);
        else out.cloudError = error.message;
      }
    }

    if (!out.direct && !out.cloud) {
      const reasons = [out.directError, out.cloudError, ...notes].filter(Boolean);
      const failed = out.directError || out.cloudError;
      throw new ReadSkip(reasons.join('; ') || 'No transport available', failed ? 'failed' : 'skipped');
    }
    return out;
  }

  async recordFailure(device, source, message, now) {
    await getPrisma().portReadState.upsert({
      where: { deviceId_source: { deviceId: device.id, source } },
      create: { deviceId: device.id, source, readAt: now, error: message },
      update: { readAt: now, error: message },
    });
  }

  /**
   * Turn one switch's read into stored sightings.
   * @param ctx { now, inventoryByMac, arpByMac }
   * @returns {{ changed: number, present: {mac, port}[] }}
   */
  async applyDevice(device, read, ctx) {
    const prisma = getPrisma();
    const { now } = ctx;
    const [links, notes, existing] = await Promise.all([
      prisma.deviceLink.findMany({ where: { deviceId: device.id, active: true } }),
      prisma.portNote.findMany({ where: { deviceId: device.id } }),
      prisma.portClient.findMany({ where: { deviceId: device.id } }),
    ]);

    const raw = presenceObservations({ direct: read.direct, cloud: read.cloud });
    const { uplinkPorts, apPorts, lldp } = classifyPorts({
      links, infraPorts: read.direct?.infraPorts, observations: raw, inventoryByMac: ctx.inventoryByMac,
    });
    const observed = aging.normalizeObservations(enrich(raw, { arpByMac: ctx.arpByMac, lldp, vendorOf }));
    const linkUp = linkStates(read.direct?.ifaces);
    const { clients, summary } = aging.summarizePorts(observed, { uplinkPorts, apPorts, linkUp });

    const staticPorts = new Set(notes.filter((n) => n.kind === 'static').map((n) => n.port));
    const byPort = new Map();
    for (const r of existing) {
      if (!byPort.has(r.port)) byPort.set(r.port, []);
      byPort.get(r.port).push(r);
    }
    for (const [port, rows] of byPort) {
      const note = notes.find((n) => n.port === port);
      if (!note || note.kind === 'auto') {
        if (aging.derivePortKind({ clients: rows, now }).kind === 'static') staticPorts.add(port);
      }
    }

    const { create, update, touch } = aging.applyRead(existing, clients, {
      readAt: now, linkUp, staticPorts, missLimit: this.missLimit,
    });
    const source = read.source;
    await prisma.$transaction(async (tx) => {
      if (create.length) {
        await tx.portClient.createMany({ data: create.map((c) => toDb({ ...c, deviceId: device.id })), skipDuplicates: true });
      }
      for (const u of update) await tx.portClient.update({ where: { id: u.id }, data: toDb(u.data) });
      if (touch.length) await tx.portClient.updateMany({ where: { id: { in: touch } }, data: { lastSeen: now } });
      await tx.portReadState.upsert({
        where: { deviceId_source: { deviceId: device.id, source } },
        create: {
          deviceId: device.id, source, readAt: now, lastSuccessAt: now, error: null, portSummary: summary,
        },
        update: {
          readAt: now, lastSuccessAt: now, error: read.directWarning || null, portSummary: summary,
        },
      });
    });
    if (read.directError && source === 'cloud') await this.recordFailure(device, 'device-rest', read.directError, now);

    const changed = create.length + update.filter((u) => u.data.state || u.data.goneReason).length;
    if (changed) emit('ports:updated', { deviceId: device.id });
    return {
      changed,
      clients: clients.length,
      present: clients.map((c) => ({ mac: c.mac, port: c.port })),
    };
  }

  /**
   * A MAC present on exactly one edge port in this run ends its live
   * sightings on every other port (moved).
   */
  async applyMoves(placements, now) {
    const prisma = getPrisma();
    const single = [...placements].filter(([, at]) => at.length === 1);
    let moved = 0;
    for (let i = 0; i < single.length; i += 1000) {
      const chunk = single.slice(i, i + 1000);
      const rows = await prisma.portClient.findMany({
        where: { mac: { in: chunk.map(([mac]) => mac) }, state: { not: 'gone' } },
      });
      const byMac = new Map();
      for (const r of rows) {
        if (!byMac.has(r.mac)) byMac.set(r.mac, []);
        byMac.get(r.mac).push(r);
      }
      for (const [mac, [at]] of chunk) {
        for (const u of aging.movedUpdates(byMac.get(mac) || [], at, now)) {
          await prisma.portClient.update({ where: { id: u.id }, data: toDb(u.data) });
          emit('ports:updated', { deviceId: (byMac.get(mac).find((r) => r.id === u.id) || {}).deviceId });
          moved++;
        }
      }
    }
    return moved;
  }

  /** Read and apply every switch (or `deviceIds`). */
  async collectAll({ deviceIds = null, trigger = 'scheduled' } = {}) {
    const prisma = getPrisma();
    const now = new Date();
    const [switches, inventory] = await Promise.all([
      prisma.device.findMany({ where: { type: 'switch', ...(deviceIds?.length && { id: { in: deviceIds } }) } }),
      prisma.device.findMany({ where: { macAddress: { not: null } }, select: { id: true, type: true, macAddress: true } }),
    ]);
    const inventoryByMac = new Map(inventory.map((d) => [normalizeMac(d.macAddress), { id: d.id, type: d.type }]).filter(([m]) => m));

    // 1. Reads.
    const run = { cloud: new Map() };
    const reads = [];
    let next = 0;
    const worker = async () => {
      while (next < switches.length) {
        const device = switches[next++];
        try {
          reads.push({ device, read: await this.readDevice(device, run) });
        } catch (error) {
          const status = error instanceof ReadSkip ? error.status : 'failed';
          reads.push({ device, status, reason: error.message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, switches.length) }, worker));

    // 2. Fleet-wide MAC -> IP: every switch's ARP, then the clouds' client IPs.
    const arpByMac = new Map();
    for (const { read } of reads) for (const a of read?.direct?.arp || []) if (!arpByMac.has(a.mac)) arpByMac.set(a.mac, a.ip);
    for (const { read } of reads) for (const c of read?.cloud || []) if (c.ip && !arpByMac.has(c.mac)) arpByMac.set(c.mac, c.ip);

    // 3. Apply per switch.
    const results = [];
    const placements = new Map();
    for (const { device, read, status, reason } of reads) {
      if (!read) {
        if (status === 'failed') {
          await this.recordFailure(device, resolveTransport(device, 'clients')[0] || 'device-rest', reason, now)
            .catch((error) => logger.warn(`port-clients: could not record failure for ${device.name}: ${error.message}`));
        }
        results.push({ deviceId: device.id, name: device.name, status, reason });
        continue;
      }
      try {
        const r = await this.applyDevice(device, read, { now, inventoryByMac, arpByMac });
        for (const p of r.present) {
          if (!placements.has(p.mac)) placements.set(p.mac, []);
          placements.get(p.mac).push({ deviceId: device.id, port: p.port });
        }
        results.push({
          deviceId: device.id, name: device.name, status: 'ok', source: read.label, clients: r.clients, changed: r.changed,
        });
      } catch (error) {
        logger.error(`port-clients: could not record ${device.name}: ${error.message}`);
        results.push({ deviceId: device.id, name: device.name, status: 'failed', reason: error.message });
      }
    }

    // 4. Moves, then retention.
    const moved = await this.applyMoves(placements, now)
      .catch((error) => { logger.warn(`port-clients: move detection failed: ${error.message}`); return 0; });
    await this.prune().catch((error) => logger.warn(`port-clients: prune failed: ${error.message}`));

    const summary = {
      trigger,
      total: switches.length,
      ok: results.filter((r) => r.status === 'ok').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped' || r.status === 'unsupported').length,
      clients: results.reduce((sum, r) => sum + (r.clients || 0), 0),
      changed: results.reduce((sum, r) => sum + (r.changed || 0), 0),
      moved,
      completedAt: new Date().toISOString(),
    };
    emit('ports:collected', summary);
    logger.info(`port-clients: read ${summary.ok}/${summary.total} switch(es), ${summary.clients} client(s), ${summary.changed} change(s), ${moved} moved`);
    return { ...summary, results };
  }

  /** Drop gone sightings past retention, keeping each port's newest. */
  async prune() {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    return getPrisma().$executeRaw`
      DELETE FROM "PortClient"
      WHERE "state" = 'gone' AND "goneAt" < ${cutoff}
        AND "id" NOT IN (
          SELECT DISTINCT ON ("deviceId", "port") "id" FROM "PortClient"
          ORDER BY "deviceId", "port", "lastSeen" DESC
        )`;
  }
}

module.exports = new PortClientService();
module.exports.ReadSkip = ReadSkip;
