/**
 * Cisco Meraki neighbors and switch VLANs. NOT yet checked against a live
 * org: shapes follow Cisco's OpenAPI spec (v1.76, 2026-11-10), whose examples
 * are thin, so every lookup here is tolerant (docs/MERAKI.md lists what first
 * contact has to confirm).
 *
 * - `/organizations/:id/switch/ports/topology/discovery/byDevice`: each
 *   switch's ports with the LLDP and CDP TLVs last seen on them, as
 *   `[{ name, value }]` lists keyed by the TLV's display name.
 * - `/networks/:id/topology/linkLayer`: the network's nodes and links, for
 *   the devices the switch read doesn't cover (APs, appliances).
 * - `/organizations/:id/switch/ports/bySwitch`: each switch port's configured
 *   `type` (access | trunk | ...), `vlan` (access VLAN, or a trunk's native)
 *   and `allowedVlans` ("all" or "1,3,5-10").
 *
 * All of it is the devices' own LLDP/CDP tables relayed by the cloud, so the
 * protocol is the one the entry came from.
 */

const { makeNeighbor } = require('../neighbor');
const { normalizeMac } = require('../../../utils/device-key');
const { makeVlanSnapshot } = require('../vlan-membership');

const tlvKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** A TLV list ([{ name, value }]) or a plain object, as a map keyed by normalized TLV name. */
function tlvMap(tlvs) {
  const map = new Map();
  if (Array.isArray(tlvs)) {
    for (const tlv of tlvs) {
      // Either { name, value } objects (v1.76 spec) or [name, value] pairs (older replies).
      const [name, value] = Array.isArray(tlv) ? tlv : [tlv?.name, tlv?.value];
      if (name && value !== undefined && value !== null && !map.has(tlvKey(name))) map.set(tlvKey(name), value);
    }
  } else if (tlvs && typeof tlvs === 'object') {
    for (const [name, value] of Object.entries(tlvs)) map.set(tlvKey(name), value);
  }
  return map;
}

const pick = (map, ...names) => {
  for (const name of names) {
    const value = map.get(name);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
};

/** One neighbor from a port's LLDP TLVs, or null. */
function lldpNeighbor(localPort, tlvs) {
  const t = tlvMap(tlvs);
  if (!t.size) return null;
  return makeNeighbor({
    localPort,
    chassisId: pick(t, 'chassisid', 'deviceid'),
    portId: pick(t, 'portid'),
    portDesc: pick(t, 'portdescription', 'portdesc'),
    sysName: pick(t, 'systemname', 'sysname'),
    sysDesc: pick(t, 'systemdescription', 'sysdesc'),
    mgmtIp: pick(t, 'managementaddress', 'mgmtaddress', 'address'),
    capabilities: pick(t, 'systemcapabilities', 'enabledcapabilities', 'capabilities'),
    protocol: 'lldp',
  });
}

/** One neighbor from a port's CDP TLVs, or null. */
function cdpNeighbor(localPort, tlvs) {
  const t = tlvMap(tlvs);
  if (!t.size) return null;
  const deviceId = pick(t, 'deviceid', 'systemname');
  return makeNeighbor({
    localPort,
    // A CDP device id is a hostname or a bare MAC; makeNeighbor keeps either.
    chassisId: deviceId,
    portId: pick(t, 'portid'),
    sysName: normalizeMac(String(deviceId || '')) ? null : deviceId,
    sysDesc: pick(t, 'platform', 'softwareversion', 'version'),
    mgmtIp: pick(t, 'managementaddress', 'address', 'addresses'),
    capabilities: pick(t, 'capabilities'),
    protocol: 'cdp',
  });
}

/** LLDP when the port has it, else CDP: the same neighbor seen twice is one link. */
function portNeighbor(localPort, port) {
  return lldpNeighbor(localPort, port?.lldp) || cdpNeighbor(localPort, port?.cdp);
}

/** "all" | "1,3,5-10" | [1, 3] -> { all, ids }. */
function parseAllowedVlans(value) {
  if (value === null || value === undefined || value === '') return { all: false, ids: [] };
  if (Array.isArray(value)) return { all: false, ids: value.map(Number).filter(Number.isInteger) };
  const text = String(value).trim().toLowerCase();
  if (text === 'all' || text === '1-4094') return { all: true, ids: [] };
  const ids = new Set();
  for (const part of text.split(',')) {
    const match = part.trim().match(/^(\d{1,4})(?:-(\d{1,4}))?$/);
    if (!match) continue;
    const from = parseInt(match[1], 10);
    const to = match[2] ? parseInt(match[2], 10) : from;
    if (to < from || to > 4094) continue;
    for (let id = from; id <= to; id++) ids.add(id);
  }
  return { all: false, ids: [...ids] };
}

/** VLAN membership of one configured switch port, or null when it has none (stack, disabled type). */
function merakiPortVlans(port) {
  if (!port?.portId) return null;
  const vlan = Number(port.vlan);
  const native = Number.isInteger(vlan) && vlan >= 1 ? vlan : null;
  if (port.type === 'access') return native ? { port: port.portId, mode: 'access', untagged: native } : null;
  if (port.type === 'trunk') {
    const allowed = parseAllowedVlans(port.allowedVlans);
    return {
      port: port.portId,
      mode: 'trunk',
      untagged: native,
      tagged: allowed.ids.filter((id) => id !== native),
      allTagged: allowed.all,
    };
  }
  if (port.type === 'routed') return { port: port.portId, mode: 'routed' };
  return null;
}

/**
 * Neighbors of the non-switch devices in one network's link-layer topology.
 * A link has two `ends`; an end names its device (`device.serial`) and what
 * was discovered about that end's port (`discovered.lldp|cdp.portId`).
 * @returns {Map<string, Object[]>} neighbors by serial
 */
function parseLinkLayer(topology) {
  const nodes = new Map((topology?.nodes || []).map((node) => [String(node?.derivedId), node]));
  const out = new Map();
  for (const link of topology?.links || []) {
    const ends = Array.isArray(link?.ends) ? link.ends : [];
    if (ends.length !== 2) continue;
    for (const [local, remote] of [[ends[0], ends[1]], [ends[1], ends[0]]]) {
      const serial = local?.device?.serial;
      if (!serial) continue;
      const remoteNode = nodes.get(String(remote?.node?.derivedId)) || {};
      const lldp = { ...(remoteNode.discovered?.lldp || {}), ...(remote?.discovered?.lldp || {}) };
      const cdp = { ...(remoteNode.discovered?.cdp || {}), ...(remote?.discovered?.cdp || {}) };
      const localPort = local?.discovered?.lldp?.portId || local?.discovered?.cdp?.portId
        || local?.discovered?.lldp?.portDescription;
      const neighbor = makeNeighbor({
        localPort,
        chassisId: remoteNode.mac || lldp.chassisId || cdp.deviceId,
        mac: remoteNode.mac,
        portId: lldp.portId || cdp.portId,
        portDesc: lldp.portDescription,
        sysName: remote?.device?.name || remoteNode.device?.name || lldp.systemName || cdp.deviceId,
        sysDesc: lldp.systemDescription || cdp.platform,
        mgmtIp: lldp.managementAddress || cdp.managementAddress || cdp.address,
        capabilities: lldp.systemCapabilities || cdp.capabilities,
        protocol: Object.keys(lldp).length ? 'lldp' : 'cdp',
      });
      if (!neighbor) continue;
      if (!out.has(serial)) out.set(serial, []);
      out.get(serial).push(neighbor);
    }
  }
  return out;
}

/**
 * @param {Object} input
 * @param {Object[]} input.availabilities - /devices/availabilities rows (every device: serial, mac, name, status)
 * @param {Object[]} input.discovery - discovery/byDevice items (switches)
 * @param {Object[]} input.switchPorts - switch/ports/bySwitch rows
 * @param {Object[]} input.linkLayers - linkLayer replies, one per network read
 * @returns {Map<string, {neighbors: Object[], identity: {chassisId, sysName}, online: boolean, vlans: Object|null}>} by serial
 */
function parseMerakiNeighbors({ availabilities = [], discovery = [], switchPorts = [], linkLayers = [] }) {
  const bySerial = new Map();
  const entryFor = (row) => {
    if (!row?.serial) return null;
    if (!bySerial.has(row.serial)) {
      bySerial.set(row.serial, {
        neighbors: [],
        identity: { chassisId: normalizeMac(row.mac), sysName: row.name || null },
        // A device the availability read left out is unknown, not offline.
        online: true,
        vlans: null,
      });
    }
    return bySerial.get(row.serial);
  };

  for (const row of availabilities) {
    const entry = entryFor(row);
    if (entry) entry.online = row.status === 'online' || row.status === 'alerting';
  }

  const fromSwitchRead = new Set();
  for (const item of discovery) {
    const entry = entryFor(item);
    if (!entry) continue;
    fromSwitchRead.add(item.serial);
    for (const port of item.ports || []) {
      const neighbor = portNeighbor(port?.portId, port);
      if (neighbor) entry.neighbors.push(neighbor);
    }
  }

  for (const topology of linkLayers) {
    for (const [serial, neighbors] of parseLinkLayer(topology)) {
      // The switch read is the switches' own table; don't list their links twice.
      if (fromSwitchRead.has(serial)) continue;
      const entry = entryFor({ serial });
      const seen = new Set(entry.neighbors.map((n) => `${n.localPort}|${n.chassisId}`));
      for (const neighbor of neighbors) {
        const key = `${neighbor.localPort}|${neighbor.chassisId}`;
        if (!seen.has(key)) {
          seen.add(key);
          entry.neighbors.push(neighbor);
        }
      }
    }
  }

  for (const item of switchPorts) {
    const entry = entryFor(item);
    if (!entry) continue;
    entry.vlans = makeVlanSnapshot({ ports: (item.ports || []).map(merakiPortVlans).filter(Boolean) });
  }

  return bySerial;
}

module.exports = { parseMerakiNeighbors, parseLinkLayer, parseAllowedVlans, merakiPortVlans, portNeighbor };
