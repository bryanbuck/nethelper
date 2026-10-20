/**
 * Network topology: collects LLDP/CDP neighbor tables over the transports
 * NetHelper already uses (AOS-CX REST, Junos NETCONF, SSH CLI, and the cloud
 * planes' neighbor views for devices none of those reach: Mist relays its
 * devices' LLDP, Central serves site topology), stores them as DeviceLink rows,
 * records link changes, and builds the Network Map graph.
 *
 * Read-only on every device. Nothing here needs switch-side setup: LLDP (and
 * CDP on Cisco) is on by default.
 */

const { getPrisma } = require('../../config/database');
const settingsService = require('../settings.service');
const sshDeviceService = require('../ssh-device.service');
const devicePollerService = require('../device-poller.service');
const JunosAPI = require('../device-api/junos-api');
const NetconfClient = require('../device-api/netconf-client');
const CloudProviderFactory = require('../cloud-providers/cloud-provider-factory');
const { CapabilityError } = require('../cloud-providers/errors');
const { resolveTransport } = require('../../utils/transport-router');
const { detectPlatform, isCxRestCapable } = require('../../utils/device-platform');
const { reconcileLinks } = require('./link-diff');
const { buildGraph, buildResolver, discoveredSummary } = require('./graph');
const logger = require('../../utils/logger');

const num = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const DEVICE_FIELDS = {
  id: true,
  name: true,
  type: true,
  vendor: true,
  platform: true,
  model: true,
  ipAddress: true,
  macAddress: true,
  location: true,
  managementMode: true,
  pingStatus: true,
  cloudStatus: true,
};

const MAX_LAYOUT_NODES = 5000;
const SCOPE_RE = /^(all|site:.{1,200})$/;

/** A collection that could not run: no transport, credentials or capability. */
class TopologySkip extends Error {
  constructor(message, status = 'skipped') {
    super(message);
    this.status = status; // skipped | unsupported
  }
}

function emit(event, payload) {
  try {
    // Lazy: the socket server isn't up in tests or CLI scripts.
    const { getIO } = require('../../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch (error) {
    logger.debug(`topology: could not emit ${event}: ${error.message}`);
  }
}

/** Per-collection-run state: one cloud neighbor read per integration. */
const newRun = () => ({ cloudNeighbors: new Map() });

class TopologyService {
  constructor() {
    this.concurrency = num(process.env.TOPOLOGY_CONCURRENCY, 4);
    this.retentionDays = num(process.env.TOPOLOGY_CHANGE_RETENTION_DAYS, 90);
  }

  /**
   * A cloud plane's neighbor table for all of its devices, read once per
   * collection run (`run.cloudNeighbors`) and shared by every device on it.
   */
  cloudNeighbors(provider, run) {
    const key = provider.integration.id;
    if (!run.cloudNeighbors.has(key)) run.cloudNeighbors.set(key, provider.listNeighbors());
    return run.cloudNeighbors.get(key);
  }

  /**
   * Read one device's neighbor table over the first transport that answers.
   * @param {Object} [run] - per-run state from collectAll (shared cloud reads)
   * @returns {Promise<{neighbors: Object[], identity: {chassisId, sysName}, source: string}>}
   * @throws {TopologySkip} when no transport can run; other errors are real failures
   */
  async collectNeighbors(device, run = newRun()) {
    const transports = resolveTransport(device, 'topology');
    if (!transports.length) {
      throw new TopologySkip(
        `No neighbor source for platform "${detectPlatform(device) || 'unknown'}" yet`,
        'unsupported'
      );
    }

    const credentials = await settingsService.getDeviceCredentialsForUse(device.id);
    const skipped = [];

    for (const transport of transports) {
      if (transport === 'device-rest') {
        if (!device.ipAddress || !credentials) {
          skipped.push('device API needs an IP address and a linked credential');
          continue;
        }
        if (isCxRestCapable(device)) {
          return devicePollerService.withCxSession(device, credentials, async (api) => {
            const neighbors = await api.getLldpNeighbors();
            let identity = { chassisId: null, sysName: null };
            try {
              identity = await api.getLldpIdentity();
            } catch (error) {
              logger.debug(`topology: no LLDP identity from ${device.name}: ${error.message}`);
            }
            return { neighbors, identity, source: 'AOS-CX REST' };
          });
        }
        if (detectPlatform(device) === 'junos') {
          try {
            const result = await new JunosAPI(device, credentials).getLldpTopology();
            return { ...result, source: 'Junos NETCONF' };
          } catch (error) {
            // NETCONF is off by default on Junos; the SSH CLI is next in the matrix.
            if (error.code !== NetconfClient.NETCONF_UNAVAILABLE) throw error;
            skipped.push('NETCONF is not enabled on the device');
            continue;
          }
        }
        skipped.push(`no device API client for platform "${detectPlatform(device)}"`);
        continue;
      }

      if (transport === 'cloud') {
        try {
          const provider = await CloudProviderFactory.forDevice(device);
          const entry = (await this.cloudNeighbors(provider, run)).get(device.serial);
          if (!entry) {
            skipped.push(`${provider.label} has no neighbor data for this device`);
            continue;
          }
          if (!entry.online) {
            // Its last report would be stale; keep the links last collected.
            skipped.push(`${provider.label} reports the device offline`);
            continue;
          }
          return { neighbors: entry.neighbors, identity: entry.identity, source: provider.label };
        } catch (error) {
          if (error instanceof CapabilityError) {
            skipped.push(error.message);
            continue;
          }
          throw error;
        }
      }

      if (transport === 'ssh') {
        if (!device.ipAddress || !credentials) {
          skipped.push('SSH needs an IP address and a linked credential');
          continue;
        }
        const result = await sshDeviceService.getNeighbors(device, credentials);
        return { ...result, source: 'SSH' };
      }
    }

    // Every transport declined. A missing capability is "unsupported"; a
    // missing IP/credential is something the user can fix ("skipped").
    const onlyCapability = skipped.length && skipped.every((s) => /does not support/.test(s));
    throw new TopologySkip(skipped.join('; ') || 'No transport available', onlyCapability ? 'unsupported' : 'skipped');
  }

  /**
   * Collect, reconcile and persist one device.
   * @returns {Promise<{deviceId, name, status, reason?, neighbors?, changes?}>}
   */
  async collectDevice(device, run = newRun()) {
    const prisma = getPrisma();
    const now = new Date();
    const prior = await prisma.deviceTopologyState.findUnique({ where: { deviceId: device.id } });

    let result;
    try {
      result = await this.collectNeighbors(device, run);
    } catch (error) {
      const status = error instanceof TopologySkip ? error.status : 'failed';
      if (status === 'failed') logger.warn(`topology: collection failed for ${device.name}: ${error.message}`);
      await prisma.deviceTopologyState.upsert({
        where: { deviceId: device.id },
        create: { deviceId: device.id, status, reason: error.message, collectedAt: now },
        update: { status, reason: error.message, collectedAt: now },
      });
      return { deviceId: device.id, name: device.name, status, reason: error.message };
    }

    const existing = await prisma.deviceLink.findMany({ where: { deviceId: device.id } });
    const { creates, updates, changes } = reconcileLinks(existing, result.neighbors, {
      now,
      initial: !prior?.lastSuccessAt,
    });

    const state = {
      status: 'ok',
      reason: null,
      source: result.source,
      chassisId: result.identity?.chassisId || null,
      sysName: result.identity?.sysName || null,
      neighborCount: result.neighbors.length,
      collectedAt: now,
      lastSuccessAt: now,
    };
    await prisma.$transaction([
      ...creates.map((data) => prisma.deviceLink.create({ data: { ...data, deviceId: device.id } })),
      ...updates.map(({ id, data }) => prisma.deviceLink.update({ where: { id }, data })),
      ...(changes.length
        ? [prisma.topologyChange.createMany({
          data: changes.map((c) => ({ ...c, deviceId: device.id, occurredAt: now })),
        })]
        : []),
      prisma.deviceTopologyState.upsert({
        where: { deviceId: device.id },
        create: { deviceId: device.id, ...state },
        update: state,
      }),
    ]);

    return {
      deviceId: device.id,
      name: device.name,
      status: 'ok',
      source: result.source,
      neighbors: result.neighbors.length,
      changes: changes.length,
    };
  }

  /**
   * Collect every device (or the given ones) with bounded concurrency. AOS-CX
   * allows few REST sessions per user, and the live monitor holds one per
   * watched switch, so this never opens more than one session per device.
   */
  async collectAll({ deviceIds = null, trigger = 'scheduled' } = {}) {
    const prisma = getPrisma();
    const devices = await prisma.device.findMany({
      where: deviceIds?.length ? { id: { in: deviceIds } } : {},
    });
    const results = [];
    const run = newRun();
    let done = 0;
    let next = 0;
    emit('topology:progress', { done: 0, total: devices.length, trigger });

    const worker = async () => {
      while (next < devices.length) {
        const device = devices[next++];
        let result;
        try {
          result = await this.collectDevice(device, run);
        } catch (error) {
          // Persisting failed (database), not the device read.
          logger.error(`topology: could not record ${device.name}: ${error.message}`);
          result = { deviceId: device.id, name: device.name, status: 'failed', reason: error.message };
        }
        results.push(result);
        done++;
        emit('topology:progress', {
          done, total: devices.length, deviceId: device.id, status: result.status, trigger,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, devices.length) }, worker));

    await this.prune().catch((error) => logger.warn(`topology: prune failed: ${error.message}`));

    const summary = {
      trigger,
      total: devices.length,
      ok: results.filter((r) => r.status === 'ok').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped' || r.status === 'unsupported').length,
      changes: results.reduce((sum, r) => sum + (r.changes || 0), 0),
      completedAt: new Date().toISOString(),
    };
    emit('topology:updated', summary);
    logger.info(`topology: collected ${summary.ok}/${summary.total} device(s), ${summary.changes} change(s)`);
    return { ...summary, results };
  }

  /** Drop changes, and links unseen for longer than the retention window. */
  async prune() {
    const prisma = getPrisma();
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    await prisma.topologyChange.deleteMany({ where: { occurredAt: { lt: cutoff } } });
    await prisma.deviceLink.deleteMany({ where: { active: false, lastSeen: { lt: cutoff } } });
  }

  /** Unimported discovery hosts, newest sighting per IP. */
  async loadDiscovered() {
    const rows = await getPrisma().discoveredDevice.findMany({
      where: { status: 'new' },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const seen = new Set();
    return rows.filter((r) => {
      if (seen.has(r.ipAddress)) return false;
      seen.add(r.ipAddress);
      return true;
    });
  }

  async getGraph({ site = null, includeDiscovered = false } = {}) {
    const prisma = getPrisma();
    const [devices, links, states, discovered] = await Promise.all([
      prisma.device.findMany({ select: DEVICE_FIELDS, orderBy: { name: 'asc' } }),
      prisma.deviceLink.findMany({ where: { active: true } }),
      prisma.deviceTopologyState.findMany(),
      this.loadDiscovered(),
    ]);
    return buildGraph({
      devices, links, states, discovered, site, includeDiscovered,
    });
  }

  /** One device's neighbors (current and recently gone), with far ends resolved. */
  async getDeviceNeighbors(deviceId) {
    const prisma = getPrisma();
    const [devices, links, states, discovered] = await Promise.all([
      prisma.device.findMany({ select: DEVICE_FIELDS }),
      prisma.deviceLink.findMany({
        where: { deviceId },
        orderBy: [{ active: 'desc' }, { localPort: 'asc' }],
      }),
      prisma.deviceTopologyState.findMany(),
      this.loadDiscovered(),
    ]);
    const resolver = buildResolver(devices, states, discovered);
    const byId = new Map(devices.map((d) => [d.id, d]));
    const state = states.find((s) => s.deviceId === deviceId) || null;
    return {
      state,
      links: links.map((link) => {
        const remoteId = resolver.device(link);
        const remote = remoteId && remoteId !== deviceId ? byId.get(remoteId) : null;
        const disc = remote ? null : resolver.discovered(link);
        return {
          ...link,
          remoteDevice: remote ? { id: remote.id, name: remote.name, type: remote.type } : null,
          discovered: disc ? discoveredSummary(disc) : null,
        };
      }),
    };
  }

  async getChanges({ since = null, deviceId = null, limit = 100 } = {}) {
    const where = {};
    if (since) where.occurredAt = { gte: since };
    if (deviceId) where.deviceId = deviceId;
    return getPrisma().topologyChange.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      include: { device: { select: { id: true, name: true, location: true } } },
    });
  }

  validScope(scope) {
    return typeof scope === 'string' && SCOPE_RE.test(scope);
  }

  async getLayout(scope) {
    const row = await getPrisma().mapLayout.findUnique({ where: { scope } });
    return row || { scope, positions: {}, updatedBy: null, updatedAt: null };
  }

  /** Replace a scope's saved positions. Keeps only finite {x, y} pairs. */
  async saveLayout(scope, positions, userId) {
    const clean = {};
    for (const [key, pos] of Object.entries(positions || {}).slice(0, MAX_LAYOUT_NODES)) {
      if (typeof key !== 'string' || key.length > 300) continue;
      const x = Number(pos?.x);
      const y = Number(pos?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) clean[key] = { x: Math.round(x), y: Math.round(y) };
    }
    return getPrisma().mapLayout.upsert({
      where: { scope },
      create: { scope, positions: clean, updatedBy: userId || null },
      update: { positions: clean, updatedBy: userId || null },
    });
  }
}

module.exports = new TopologyService();
module.exports.TopologySkip = TopologySkip;
