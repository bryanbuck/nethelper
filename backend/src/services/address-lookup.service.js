/**
 * "Who has this address?": for a device the cloud reports offline whose
 * address still answers ping, ask what NetHelper already knows about that IP.
 * On demand, read-only, and no scan of the address itself: each source is
 * something NetHelper already holds or can read cheaply.
 *
 *   devices    other rows in NetHelper with this IP
 *   cloud      every active cloud's devices and clients with this IP, from the
 *              providers' filtered searches (finds endpoints DHCP gave the
 *              address to, with the switch port or AP they are on)
 *   neighbor   the backend host's ARP/neighbor table: the MAC answering, and
 *              its vendor (only on the host's own network segment)
 *   lldp       LLDP/CDP neighbors (the Network Map) advertising this IP or MAC
 *   discovery  the latest discovery scan's entry for this IP
 *
 * A source that can't answer says why (`status: 'skipped'`), and one that
 * fails never stops the others. The MAC holding the address (the neighbor
 * table's, else the cloud client seen most recently with it) is compared with
 * the device's own: equal means the device is what answers, different means
 * something else is.
 */

const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getPrisma } = require('../config/database');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const discovery = require('./discovery.service');
const { effectiveStatus } = require('../utils/device-status');
const { normalizeMac, macVariants } = require('../utils/device-key');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

const found = (key, label, items, extra = {}) => ({ key, label, status: items.length ? 'found' : 'none', items, ...extra });
const skipped = (key, label, reason) => ({ key, label, status: 'skipped', reason, items: [] });

async function sameIpDevices(prisma, device) {
  const rows = await prisma.device.findMany({
    where: { ipAddress: device.ipAddress, id: { not: device.id } },
    select: {
      id: true, name: true, model: true, managementMode: true, pingStatus: true, cloudStatus: true,
      cloudIntegration: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
    take: 10,
  });
  return found('devices', 'Devices in NetHelper with this address', rows.map((row) => ({
    title: row.name,
    detail: `${effectiveStatus(row)}${row.model ? `, ${row.model}` : ''}`,
    deviceId: row.id,
  })));
}

/** NetHelper devices by serial and by MAC, for linking what the clouds name. */
async function deviceIndex(prisma, serials, macs) {
  const or = [
    ...(serials.length ? [{ serial: { in: serials } }] : []),
    ...(macs.length ? [{ macAddress: { in: macs.flatMap(macVariants), mode: 'insensitive' } }] : []),
  ];
  const rows = or.length
    ? await prisma.device.findMany({ where: { OR: or }, select: { id: true, name: true, serial: true, macAddress: true } })
    : [];
  return {
    bySerial: new Map(rows.filter((r) => r.serial).map((r) => [r.serial, r])),
    byMac: new Map(rows.filter((r) => r.macAddress).map((r) => [normalizeMac(r.macAddress), r])),
  };
}

function holderItem(holder, integration, ownMac, index) {
  const known = (holder.serial && index.bySerial.get(holder.serial)) || (holder.mac && index.byMac.get(holder.mac));
  // "connected now" already says when.
  const at = holder.status === 'connected' ? null : holder.lastSeen || null;
  if (holder.kind === 'device') {
    const status = holder.status ? `, reports it ${holder.status}` : '';
    return {
      title: holder.name || holder.serial || holder.mac,
      detail: `${integration} device${holder.model ? ` (${holder.model})` : ''}${status}${known ? '' : ', not in NetHelper'}`,
      ...(known && { deviceId: known.id }),
      at,
    };
  }
  const via = holder.connectedTo || {};
  const upstream = via.name || (via.serial && index.bySerial.get(via.serial)?.name) || (via.mac && index.byMac.get(via.mac)?.name) || via.mac;
  const where = [
    upstream && `on ${upstream}${via.port ? ` port ${via.port}` : ''}`,
    via.ssid && `SSID ${via.ssid}`,
    via.vlan != null && via.vlan !== '' && `VLAN ${via.vlan}`,
  ].filter(Boolean).join(', ');
  const mac = holder.mac && `MAC ${holder.mac}${holder.mac === ownMac ? " (this device's own)" : ''}${holder.manufacturer ? `, ${holder.manufacturer}` : ''}`;
  const state = holder.status === 'connected' ? 'connected now' : holder.status === 'disconnected' ? 'disconnected' : null;
  return {
    title: holder.name || holder.mac || 'Unnamed client',
    detail: [`${integration} client${where ? ` ${where}` : ''}`, mac, state].filter(Boolean).join('; '),
    ...(known && { deviceId: known.id }),
    at,
  };
}

/**
 * Every active cloud's devices and clients holding this IP (providers'
 * findByAddress: a few filtered reads each, never the whole inventory).
 * Also returns `macHolder`: the most recently seen client MAC, for the MAC
 * comparison when the host's neighbor table has none.
 */
async function cloudRecords(prisma, device) {
  const label = 'Cloud devices and clients';
  const providers = await CloudProviderFactory.activeProviders().catch(() => []);
  if (!providers.length) return skipped('cloud', label, 'No cloud integration is active.');

  const ownMac = normalizeMac(device.macAddress);
  const failed = [];
  const unsupported = [];
  const matches = [];
  await Promise.all(providers.map(async (provider) => {
    const integration = provider.integration?.name || provider.label;
    if (!provider.supports('address-lookup')) {
      unsupported.push(integration);
      return;
    }
    try {
      for (const holder of await provider.findByAddress(device.ipAddress)) {
        const self = holder.kind === 'device'
          && ((device.serial && holder.serial === device.serial) || (ownMac && holder.mac === ownMac));
        if (!self) matches.push({ holder, integration });
      }
    } catch (error) {
      logger.warn(`Address lookup: ${provider.label} unavailable: ${error.message}`);
      failed.push(integration);
    }
  }));

  const serials = matches.flatMap(({ holder }) => [holder.serial, holder.connectedTo?.serial]).filter(Boolean);
  const macs = [...new Set(matches.flatMap(({ holder }) => [holder.mac, holder.connectedTo?.mac]).filter(Boolean))].slice(0, 50);
  const index = await deviceIndex(prisma, serials, macs);

  // Devices first, then clients newest first (a connected one before one that left).
  const rank = ({ holder }) => (holder.kind === 'device' || holder.status === 'connected' ? Number.MAX_SAFE_INTEGER : holder.lastSeen?.getTime() || 0);
  matches.sort((a, b) => (a.holder.kind === 'device' ? 0 : 1) - (b.holder.kind === 'device' ? 0 : 1) || rank(b) - rank(a));
  const clients = matches.filter(({ holder }) => holder.kind === 'client' && holder.mac);
  const reasons = [
    failed.length && `Couldn't read: ${failed.join(', ')}.`,
    unsupported.length && `Can't search by address: ${unsupported.join(', ')}.`,
  ].filter(Boolean);

  return {
    ...found('cloud', label, matches.slice(0, 10).map(({ holder, integration }) => holderItem(holder, integration, ownMac, index))),
    ...(reasons.length && { reason: reasons.join(' ') }),
    macHolder: clients.length ? { mac: clients[0].holder.mac, integration: clients[0].integration } : null,
  };
}

/** The kernel's neighbor entry for an IP: { mac, state } or null. */
async function readNeighbor(ip) {
  const { stdout } = await execFileAsync('ip', ['neigh', 'show', 'to', ip], { timeout: 5000 });
  const line = stdout.split('\n').find((l) => /lladdr/i.test(l));
  if (!line) return null;
  const mac = normalizeMac(/lladdr\s+([0-9a-f:]{17})/i.exec(line)?.[1]);
  return mac ? { mac, state: line.trim().split(/\s+/).pop() } : null;
}

async function neighborTable(prisma, device) {
  const label = 'Network neighbor table';
  let entry;
  try {
    entry = await readNeighbor(device.ipAddress);
  } catch (error) {
    return skipped('neighbor', label, `Couldn't read the host's neighbor table: ${error.code === 'ENOENT' ? '`ip` is not installed' : error.message}.`);
  }
  if (!entry) {
    return { ...found('neighbor', label, []), reason: "NetHelper's host has no MAC for this address: it isn't on the host's own network segment, or hasn't been seen recently." };
  }

  const ownMac = normalizeMac(device.macAddress);
  const vendor = discovery.lookupVendor(entry.mac);
  const owners = await prisma.device.findMany({
    where: { macAddress: { in: macVariants(entry.mac), mode: 'insensitive' }, id: { not: device.id } },
    select: { id: true, name: true },
    take: 5,
  });
  const items = [{
    title: entry.mac,
    detail: [vendor || 'vendor not in the built-in list', ownMac && (ownMac === entry.mac ? "this device's own MAC" : "not this device's MAC")]
      .filter(Boolean).join(', '),
  }];
  for (const owner of owners) items.push({ title: owner.name, detail: 'has this MAC address', deviceId: owner.id });
  return { ...found('neighbor', label, items), mac: entry.mac };
}

async function lldpNeighbors(prisma, device, mac) {
  const label = 'LLDP/CDP neighbors';
  const links = await prisma.deviceLink.findMany({
    where: {
      active: true,
      deviceId: { not: device.id },
      OR: [{ remoteMgmtIp: device.ipAddress }, ...(mac ? [{ remoteMac: mac }] : [])],
    },
    select: {
      localPort: true, remoteChassisId: true, remoteMac: true, remoteSysName: true, remoteSysDesc: true, source: true,
      lastSeen: true, device: { select: { name: true } },
    },
    orderBy: { lastSeen: 'desc' },
    take: 50,
  });

  // Several switches usually report the same neighbor: one item per neighbor.
  const groups = new Map();
  for (const link of links) {
    const key = link.remoteMac || link.remoteChassisId;
    const group = groups.get(key) || { link, seenBy: [] };
    group.seenBy.push(`${link.device.name} port ${link.localPort}`);
    groups.set(key, group);
  }
  // A neighbor that is a device in NetHelper (by MAC) links to its page.
  const macs = [...groups.values()].map((g) => g.link.remoteMac).filter(Boolean);
  const owners = macs.length
    ? await prisma.device.findMany({ where: { macAddress: { in: macs.flatMap(macVariants), mode: 'insensitive' } }, select: { id: true, macAddress: true } })
    : [];
  const byMac = new Map(owners.map((o) => [normalizeMac(o.macAddress), o.id]));

  return found('lldp', label, [...groups.values()].slice(0, 5).map(({ link, seenBy }) => ({
    title: link.remoteSysName || link.remoteChassisId,
    detail: `${link.source === 'cloud' ? 'reported by its cloud' : link.source.toUpperCase()} via ${seenBy.slice(0, 3).join(', ')}${seenBy.length > 3 ? ` and ${seenBy.length - 3} more` : ''}${link.remoteSysDesc ? `: ${link.remoteSysDesc.slice(0, 120)}` : ''}`,
    ...(byMac.has(link.remoteMac) && { deviceId: byMac.get(link.remoteMac) }),
    at: link.lastSeen,
  })));
}

async function discoveryScan(prisma, device) {
  const label = 'Latest discovery scan';
  const row = await prisma.discoveredDevice.findFirst({
    where: { ipAddress: device.ipAddress },
    orderBy: { createdAt: 'desc' },
    select: { hostname: true, macAddress: true, vendor: true, openPorts: true, suggestedName: true, createdAt: true },
  });
  if (!row) return found('discovery', label, []);
  const ports = Array.isArray(row.openPorts) && row.openPorts.length ? `open ports ${row.openPorts.join(', ')}` : null;
  return found('discovery', label, [{
    title: row.hostname || row.suggestedName || row.macAddress || device.ipAddress,
    detail: [row.vendor, row.macAddress, ports].filter(Boolean).join(', ') || 'responded to the sweep',
    at: row.createdAt,
  }]);
}

/**
 * @param {string} deviceId
 * @returns {Promise<null|{ip, checkedAt, mac, macFrom, sameMac, sources}>} macFrom = 'neighbor' or the cloud integration's name null when the device doesn't exist
 */
async function lookup(deviceId) {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, name: true, serial: true, ipAddress: true, macAddress: true },
  });
  if (!device) return null;
  if (!net.isIPv4(device.ipAddress || '')) {
    return { ip: device.ipAddress || null, checkedAt: new Date(), mac: null, macFrom: null, sameMac: null, sources: [] };
  }

  // The neighbor table comes first: its MAC narrows the LLDP search.
  const neighbor = await neighborTable(prisma, device);
  const settle = (key, label, work) => work.catch((error) => {
    logger.warn(`Address lookup: ${key} failed: ${error.message}`);
    return skipped(key, label, `Couldn't check: ${error.message}`);
  });
  const [devices, cloud, lldp, scan] = await Promise.all([
    settle('devices', 'Devices in NetHelper with this address', sameIpDevices(prisma, device)),
    settle('cloud', 'Cloud devices and clients', cloudRecords(prisma, device)),
    settle('lldp', 'LLDP/CDP neighbors', lldpNeighbors(prisma, device, neighbor.mac)),
    settle('discovery', 'Latest discovery scan', discoveryScan(prisma, device)),
  ]);

  // The host's own table first; a cloud's client record when the address is
  // off the host's segment.
  const ownMac = normalizeMac(device.macAddress);
  const { macHolder, ...cloudSource } = cloud;
  const holder = neighbor.mac
    ? { mac: neighbor.mac, from: 'neighbor' }
    : macHolder && { mac: macHolder.mac, from: macHolder.integration };
  const { mac: _mac, ...neighborSource } = neighbor; // eslint-disable-line no-unused-vars

  return {
    ip: device.ipAddress,
    checkedAt: new Date(),
    mac: holder?.mac || null,
    macFrom: holder?.from || null,
    sameMac: holder && ownMac ? holder.mac === ownMac : null,
    sources: [devices, cloudSource, neighborSource, lldp, scan],
  };
}

module.exports = { lookup };
