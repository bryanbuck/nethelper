/**
 * Build the Network Map graph from stored rows. Pure: no database access.
 *
 * Nodes:
 *   device:<id>     a managed Device (outOfScope when it is only here because
 *                   an in-scope device links to it from another site)
 *   ghost:<key>     a neighbor that matches no Device; carries the matching
 *                   DiscoveredDevice (when there is one) so the UI can import it
 *   subnet:<cidr>   unmanaged discovery hosts grouped by subnet (no edges)
 *
 * Edges: one per physical link. A link reported from both ends is merged, so
 * A→B and B→A become one edge with both port names.
 */

const { normalizeMac } = require('../../utils/mac');
const { normalizePortName } = require('./neighbor');

const TIER = { gateway: 0, switch: 1, access_point: 2 };
const GHOST_TIER = { gateway: 0, switch: 1, access_point: 2, phone: 3, host: 3, unknown: 3 };
const MAX_SUBNET_HOSTS = 200;

/** Best guess at what an unmanaged neighbor is, from its LLDP/CDP capabilities. */
function guessType(capabilities = []) {
  const caps = new Set(capabilities);
  if (caps.has('wlan-ap')) return 'access_point';
  if (caps.has('telephone')) return 'phone';
  if (caps.has('bridge')) return 'switch';
  if (caps.has('router')) return 'gateway';
  if (caps.has('station')) return 'host';
  return 'unknown';
}

const shortName = (name) => String(name || '').trim().toLowerCase().split('.')[0];

/** Index devices by every identity a neighbor might advertise for them. */
function buildResolver(devices, states, discovered) {
  const byMac = new Map();
  const byIp = new Map();
  const byName = new Map();
  const ambiguousNames = new Set();
  const addName = (name, id) => {
    const key = shortName(name);
    if (!key) return;
    if (byName.has(key) && byName.get(key) !== id) ambiguousNames.add(key);
    else byName.set(key, id);
  };
  const stateById = new Map(states.map((s) => [s.deviceId, s]));

  for (const d of devices) {
    const mac = normalizeMac(d.macAddress);
    if (mac) byMac.set(mac, d.id);
    if (d.ipAddress) byIp.set(d.ipAddress, d.id);
    addName(d.name, d.id);
    const state = stateById.get(d.id);
    // The device's own advertised chassis id beats the inventory MAC, which
    // may be a port or management MAC.
    if (state?.chassisId) byMac.set(state.chassisId, d.id);
    if (state?.sysName) addName(state.sysName, d.id);
  }
  for (const key of ambiguousNames) byName.delete(key);

  const discByMac = new Map();
  const discByIp = new Map();
  for (const h of discovered) {
    const mac = normalizeMac(h.macAddress);
    if (mac && !discByMac.has(mac)) discByMac.set(mac, h);
    if (h.ipAddress && !discByIp.has(h.ipAddress)) discByIp.set(h.ipAddress, h);
  }

  return {
    /** Device id for a link's far end, or null. */
    device(link) {
      const mac = link.remoteMac || normalizeMac(link.remoteChassisId);
      if (mac && byMac.has(mac)) return byMac.get(mac);
      if (link.remoteMgmtIp && byIp.has(link.remoteMgmtIp)) return byIp.get(link.remoteMgmtIp);
      const name = shortName(link.remoteSysName);
      if (name && byName.has(name)) return byName.get(name);
      return null;
    },
    /** Latest unimported DiscoveredDevice for a far end, or null. */
    discovered(link) {
      const mac = link.remoteMac || normalizeMac(link.remoteChassisId);
      if (mac && discByMac.has(mac)) return discByMac.get(mac);
      if (link.remoteMgmtIp && discByIp.has(link.remoteMgmtIp)) return discByIp.get(link.remoteMgmtIp);
      return null;
    },
  };
}

function ghostKey(link) {
  const mac = link.remoteMac || normalizeMac(link.remoteChassisId);
  return `ghost:${mac || String(link.remoteChassisId).toLowerCase()}`;
}

function deviceNode(device, state, extra = {}) {
  return {
    id: `device:${device.id}`,
    kind: 'device',
    data: {
      deviceId: device.id,
      name: device.name,
      type: device.type,
      vendor: device.vendor,
      platform: device.platform,
      model: device.model,
      ipAddress: device.ipAddress,
      location: device.location,
      managementMode: device.managementMode,
      pingStatus: device.pingStatus,
      cloudStatus: device.cloudStatus,
      topology: state
        ? {
          status: state.status,
          reason: state.reason,
          source: state.source,
          neighborCount: state.neighborCount,
          collectedAt: state.collectedAt,
          lastSuccessAt: state.lastSuccessAt,
        }
        : null,
      ...extra,
    },
  };
}

function discoveredSummary(h) {
  return {
    id: h.id,
    ipAddress: h.ipAddress,
    macAddress: h.macAddress,
    vendor: h.vendor,
    hostname: h.hostname,
    suggestedType: h.suggestedType,
    suggestedName: h.suggestedName,
    subnet: h.subnet,
    scanId: h.scanId,
  };
}

/**
 * @param {Object} input
 * @param {Object[]} input.devices - Device rows
 * @param {Object[]} input.links - active DeviceLink rows
 * @param {Object[]} input.states - DeviceTopologyState rows
 * @param {Object[]} input.discovered - unimported DiscoveredDevice rows, newest first
 * @param {string|null} input.site - Device.location to scope to, or null for all
 * @param {boolean} input.includeDiscovered - add subnet groups of unmanaged hosts
 */
function buildGraph({ devices, links, states = [], discovered = [], site = null, includeDiscovered = false }) {
  const resolver = buildResolver(devices, states, discovered);
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const stateById = new Map(states.map((s) => [s.deviceId, s]));
  const inScope = (d) => !site || d.location === site;

  const nodes = new Map();
  for (const d of devices) {
    if (inScope(d)) nodes.set(`device:${d.id}`, deviceNode(d, stateById.get(d.id)));
  }

  const edges = new Map(); // edge id -> edge
  const byPair = new Map(); // "a~b" -> [edge]
  const usedDiscovered = new Set();

  for (const link of links) {
    const local = deviceById.get(link.deviceId);
    if (!local || !inScope(local)) continue;
    const source = `device:${local.id}`;

    let target;
    const remoteId = resolver.device(link);
    if (remoteId === local.id) continue; // a device hearing itself (loop or shared chassis)
    if (remoteId) {
      target = `device:${remoteId}`;
      if (!nodes.has(target)) {
        nodes.set(target, deviceNode(deviceById.get(remoteId), stateById.get(remoteId), { outOfScope: true }));
      }
    } else {
      target = ghostKey(link);
      if (!nodes.has(target)) {
        const disc = resolver.discovered(link);
        if (disc) usedDiscovered.add(disc.id);
        nodes.set(target, {
          id: target,
          kind: 'ghost',
          data: {
            name: link.remoteSysName || link.remoteMgmtIp || link.remoteChassisId,
            sysName: link.remoteSysName,
            sysDesc: link.remoteSysDesc,
            chassisId: link.remoteChassisId,
            mgmtIp: link.remoteMgmtIp,
            macAddress: link.remoteMac,
            capabilities: link.remoteCapabilities || [],
            guessedType: guessType(link.remoteCapabilities || []),
            discovered: disc ? discoveredSummary(disc) : null,
          },
        });
      }
    }

    mergeEdge(edges, byPair, {
      a: source, aPort: link.localPort, b: target, bPort: link.remotePortId, link,
    });
  }

  // Orient edges top-down for layered layout: gateway → switch → AP → others;
  // between peers, the better-connected node is the upstream one.
  const degree = new Map();
  for (const e of edges.values()) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const tier = (key) => {
    const n = nodes.get(key);
    if (!n) return 9;
    if (n.kind === 'ghost') return GHOST_TIER[n.data.guessedType] ?? 3;
    return TIER[n.data.type] ?? 3;
  };
  const edgeList = [...edges.values()].map((e) => {
    const flip = tier(e.target) < tier(e.source)
      || (tier(e.target) === tier(e.source) && (degree.get(e.target) || 0) > (degree.get(e.source) || 0));
    if (!flip) return e;
    return {
      ...e, source: e.target, target: e.source, sourcePort: e.targetPort, targetPort: e.sourcePort,
    };
  });

  if (includeDiscovered && !site) {
    const groups = new Map();
    for (const h of discovered) {
      if (usedDiscovered.has(h.id)) continue;
      const subnet = h.subnet || 'unknown';
      if (!groups.has(subnet)) groups.set(subnet, []);
      groups.get(subnet).push(h);
    }
    for (const [subnet, hosts] of groups) {
      nodes.set(`subnet:${subnet}`, {
        id: `subnet:${subnet}`,
        kind: 'subnet',
        data: {
          subnet,
          name: subnet === 'unknown' ? 'Unknown subnet' : subnet,
          count: hosts.length,
          hosts: hosts.slice(0, MAX_SUBNET_HOSTS).map(discoveredSummary),
        },
      });
    }
  }

  const nodeList = [...nodes.values()];
  const sites = [...new Set(devices.map((d) => d.location).filter(Boolean))].sort();
  const inScopeDevices = nodeList.filter((n) => n.kind === 'device' && !n.data.outOfScope);
  return {
    nodes: nodeList,
    edges: edgeList,
    sites,
    stats: {
      devices: inScopeDevices.length,
      links: edgeList.length,
      ghosts: nodeList.filter((n) => n.kind === 'ghost').length,
      collected: inScopeDevices.filter((n) => n.data.topology?.status === 'ok').length,
      neverCollected: inScopeDevices.filter((n) => !n.data.topology).length,
    },
  };
}

/**
 * Add one reported link, merging it with the far end's report of the same
 * link. Ports are compared normalized, and the reporting side's own name for
 * its port wins over the far end's description of it.
 */
function mergeEdge(edges, byPair, { a, aPort, b, bPort, link }) {
  const pair = [a, b].sort().join('~');
  const candidates = byPair.get(pair) || [];
  const na = normalizePortName(aPort);
  const nb = normalizePortName(bPort);
  const existing = candidates.find((e) => {
    const ea = e.ports[a];
    const eb = e.ports[b];
    if (!ea || !eb) return false;
    // Same report seen twice (e.g. CDP + LLDP), or the far end's report.
    return normalizePortName(ea.port) === na || normalizePortName(eb.port) === nb;
  });

  if (existing) {
    // Prefer each side's own name for its port.
    existing.ports[a] = { port: aPort, reported: true };
    if (!existing.ports[b].reported) existing.ports[b] = { port: bPort, reported: false };
    existing.protocols = [...new Set([...existing.protocols, link.source])].sort();
    // Seen from both ends: the far end confirmed it.
    if (!existing.reporters.has(a)) existing.bidirectional = true;
    existing.reporters.add(a);
    if (link.lastSeen && (!existing.lastSeen || link.lastSeen > existing.lastSeen)) existing.lastSeen = link.lastSeen;
    existing.sourcePort = existing.ports[existing.source].port;
    existing.targetPort = existing.ports[existing.target].port;
    return;
  }

  const edge = {
    id: `edge:${a}:${na}~${b}:${nb}`,
    source: a,
    target: b,
    sourcePort: aPort,
    targetPort: bPort,
    ports: { [a]: { port: aPort, reported: true }, [b]: { port: bPort, reported: false } },
    protocols: [link.source],
    bidirectional: false,
    reporters: new Set([a]),
    lastSeen: link.lastSeen || null,
  };
  edges.set(edge.id, edge);
  candidates.push(edge);
  byPair.set(pair, candidates);
}

/** JSON-safe edge (drops internal merge bookkeeping). */
function serializeEdge(e) {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourcePort: e.sourcePort,
    targetPort: e.targetPort,
    protocols: e.protocols,
    bidirectional: e.bidirectional,
    lastSeen: e.lastSeen,
  };
}

function buildGraphJson(input) {
  const graph = buildGraph(input);
  return { ...graph, edges: graph.edges.map(serializeEdge) };
}

module.exports = {
  buildGraph: buildGraphJson, buildResolver, guessType, discoveredSummary,
};
