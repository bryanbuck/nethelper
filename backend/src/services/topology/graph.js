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
 *
 * VLAN overlay (vlan-analysis.js): each edge gets `vlans` (carried, pruned,
 * native mismatch, which ends we have data for), each device node a
 * `vlans` summary, and the graph a per-VLAN list for the map's picker.
 *
 * VXLAN overlay (vxlan-analysis.js): device nodes get a `vxlan` summary, and
 * the graph `vxlan` = { tunnels, vnis, unresolved }. Tunnels are not edges:
 * they follow the routed underlay, not cables, and are drawn only while the
 * overlay is on.
 */

const { normalizeMac } = require('../../utils/device-key');
const { normalizePortName } = require('./neighbor');
const { applyVlanOverlay } = require('./vlan-analysis');
const { analyzeVxlan } = require('./vxlan-analysis');

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
      vlans: vlanSummary(state),
      vxlan: vxlanSummary(state),
      ...extra,
    },
  };
}

/** A device node's VLAN summary, or null when nothing was ever read. */
function vlanSummary(state) {
  if (!state?.vlans && !state?.vlanError) return null;
  return {
    ids: (state.vlans?.vlans || []).map((v) => v.id),
    routed: state.vlans?.routed || [],
    source: state.vlanSource || null,
    collectedAt: state.vlanCollectedAt || null,
    error: state.vlanError || null,
  };
}

/** A device node's VXLAN summary, or null for a device with no VXLAN read. */
function vxlanSummary(state) {
  if (!state?.vxlan && !state?.vxlanError) return null;
  return {
    sourceIps: (state.vxlan?.vteps || []).map((v) => v.sourceIp).filter(Boolean),
    vnis: (state.vxlan?.vnis || []).map(({
      vni, kind, vlan, vrf, up,
    }) => ({
      vni, kind, vlan, vrf, up,
    })),
    peerCount: state.vxlan?.peers?.length || 0,
    source: state.vxlanSource || null,
    collectedAt: state.vxlanCollectedAt || null,
    error: state.vxlanError || null,
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
    vlans: e.vlans || null,
  };
}

/**
 * Keep the VXLAN overlay to this map: tunnels with an end on it, whose far end
 * (another site's VTEP) joins as an out-of-scope node marked `tunnelOnly`,
 * shown only with the overlay. VTEPs are matched over every device, so a
 * site map still names a far VTEP. Mutates graph.nodes.
 */
function scopeVxlan(graph, vxlan, deviceById, states) {
  const onMap = new Set(graph.nodes.map((n) => n.id));
  const tunnels = vxlan.tunnels.filter((t) => onMap.has(t.source) || onMap.has(t.target));
  const stateById = new Map(states.map((s) => [s.deviceId, s]));
  for (const t of tunnels) {
    for (const id of [t.source, t.target]) {
      if (onMap.has(id)) continue;
      const deviceId = id.slice('device:'.length);
      graph.nodes.push(deviceNode(deviceById.get(deviceId), stateById.get(deviceId), { outOfScope: true, tunnelOnly: true }));
      onMap.add(id);
    }
  }
  const kept = (node) => onMap.has(node);
  return {
    tunnels,
    vnis: vxlan.vnis
      .map((entry) => ({
        ...entry,
        vteps: entry.vteps.filter((v) => kept(v.node)),
        tunnels: entry.tunnels.filter((id) => tunnels.some((t) => t.id === id)),
        isolated: entry.isolated.filter(kept),
        unresolved: entry.unresolved.filter((u) => kept(u.node)),
      }))
      .filter((entry) => entry.vteps.length),
    unresolved: vxlan.unresolved.filter((u) => kept(u.node)),
    bridges: vxlan.bridges,
    open: vxlan.open,
  };
}

function buildGraphJson(input) {
  const graph = buildGraph(input);
  const snapshots = new Map();
  const vxlanSnapshots = new Map();
  const deviceById = new Map(input.devices.map((d) => [d.id, d]));
  for (const state of input.states || []) {
    const id = `device:${state.deviceId}`;
    if (state.vlans) snapshots.set(id, state.vlans);
    if (state.vxlan && deviceById.has(state.deviceId)) vxlanSnapshots.set(id, state.vxlan);
  }
  const vxlan = scopeVxlan(graph, analyzeVxlan({
    nodes: input.devices.map((d) => ({ id: `device:${d.id}`, kind: 'device', data: { ipAddress: d.ipAddress } })),
  }, vxlanSnapshots), deviceById, input.states || []);
  const {
    tunnels, vnis, unresolved, bridges, open,
  } = vxlan;
  const vniByVlan = new Map();
  for (const entry of vnis) {
    for (const vtep of entry.vteps) {
      if (vtep.vlan === null) continue;
      if (!vniByVlan.has(vtep.vlan)) vniByVlan.set(vtep.vlan, new Set());
      vniByVlan.get(vtep.vlan).add(entry.vni);
    }
  }
  const vlans = applyVlanOverlay(graph, snapshots, { bridges, open, vniByVlan });
  return {
    ...graph,
    edges: graph.edges.map(serializeEdge),
    vlans,
    vxlan: { tunnels, vnis, unresolved },
  };
}

module.exports = {
  buildGraph: buildGraphJson, buildResolver, guessType, discoveredSummary,
};
