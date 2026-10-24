/**
 * The Network Map's VLAN overlay, computed from the built graph and each
 * device's VLAN snapshot (vlan-membership.js). Pure: no database access.
 *
 * Per edge (`edge.vlans`):
 *   carried   VLANs both ends' ports pass
 *   pruned    [{ vlan, side }]: both devices carry the VLAN, but `side`'s
 *             port doesn't pass it (the classic broken hop). A VLAN only one
 *             of the two devices has is simply absent, not pruned: a trunk
 *             "allowed all" towards a switch without it is normal.
 *   native    { [nodeId]: vlan|null } when both ends' untagged VLANs are
 *             known and differ, else null
 *   known     { [nodeId]: boolean } which ends we have port data for
 *
 * Per VLAN (`graph.vlans`): the devices that carry it and route it, and
 * islands: groups of carrying devices joined by links that pass it, with no
 * device routing it, when another group does. A group that touches a link
 * we can't see across is never called an island; the path may go on.
 */

const {
  findPort, deviceCarries, portCarries, portVlans,
} = require('./vlan-membership');

const UNKNOWN_NATIVE = Symbol('unknown');

function untaggedOf(entry) {
  if (!entry || entry.mode === 'routed') return UNKNOWN_NATIVE;
  return entry.untaggedKnown ? entry.untagged : UNKNOWN_NATIVE;
}

/** Overlay data for one edge. `snapshots` maps node id -> snapshot. */
function analyzeEdge(edge, snapshots) {
  const ends = [edge.source, edge.target];
  const snap = ends.map((id) => snapshots.get(id) || null);
  const entry = ends.map((id, i) => findPort(snap[i], edge.ports?.[id]?.port));
  const known = Object.fromEntries(ends.map((id, i) => [id, Boolean(entry[i])]));

  const result = {
    carried: [], pruned: [], native: null, known,
  };
  if (!entry[0] && !entry[1]) return result;

  const candidates = new Set([...portVlans(snap[0], entry[0]), ...portVlans(snap[1], entry[1])]);
  for (const vlan of [...candidates].sort((a, b) => a - b)) {
    const pass = [0, 1].map((i) => portCarries(snap[i], entry[i], vlan));
    if (pass[0] && pass[1]) {
      result.carried.push(vlan);
      continue;
    }
    if (pass[0] === null || pass[1] === null) continue; // one end unseen
    if (deviceCarries(snap[0], vlan) && deviceCarries(snap[1], vlan)) {
      result.pruned.push({ vlan, side: pass[0] ? ends[1] : ends[0] });
    }
  }

  const natives = entry.map(untaggedOf);
  if (natives.every((n) => n !== UNKNOWN_NATIVE) && natives[0] !== natives[1]) {
    result.native = { [ends[0]]: natives[0], [ends[1]]: natives[1] };
  }
  return result;
}

/**
 * Status of `vlan` on an analyzed edge, for the UI and the island search:
 * carried | pruned | absent | unknown.
 */
function edgeStatus(edge, vlan, snapshots) {
  const v = edge.vlans;
  if (!v) return 'unknown';
  if (v.carried.includes(vlan)) return 'carried';
  if (v.pruned.some((p) => p.vlan === vlan)) return 'pruned';
  const ends = [edge.source, edge.target];
  // An end whose device doesn't carry the VLAN at all ends it here.
  if (ends.some((id) => deviceCarries(snapshots.get(id), vlan) === false)) return 'absent';
  if (ends.every((id) => v.known[id])) return 'absent';
  return 'unknown';
}

/**
 * Fleet VLAN summary over the graph's nodes.
 * @returns {{ id, names: string[], devices: string[], routedOn: string[], islands: string[][] }[]}
 */
function analyzeVlans(nodes, edges, snapshots) {
  const byVlan = new Map();
  for (const node of nodes) {
    const snap = snapshots.get(node.id);
    if (!snap) continue;
    for (const v of snap.vlans) {
      if (!byVlan.has(v.id)) byVlan.set(v.id, { id: v.id, names: new Set(), devices: [], routedOn: [] });
      const entry = byVlan.get(v.id);
      if (v.name) entry.names.add(v.name);
      entry.devices.push(node.id);
    }
    for (const r of snap.routed) byVlan.get(r.vlan)?.routedOn.push(node.id);
  }

  const out = [];
  for (const entry of [...byVlan.values()].sort((a, b) => a.id - b.id)) {
    out.push({
      id: entry.id,
      names: [...entry.names].sort(),
      devices: entry.devices,
      routedOn: entry.routedOn,
      islands: entry.routedOn.length ? findIslands(entry, edges, snapshots) : [],
    });
  }
  return out;
}

function findIslands(entry, edges, snapshots) {
  const members = new Set(entry.devices);
  const parent = new Map(entry.devices.map((id) => [id, id]));
  const find = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const open = new Set(); // members touching a link we can't see across

  for (const edge of edges) {
    const status = edgeStatus(edge, entry.id, snapshots);
    const inA = members.has(edge.source);
    const inB = members.has(edge.target);
    if (status === 'carried' && inA && inB) {
      parent.set(find(edge.source), find(edge.target));
    } else if (status === 'unknown') {
      if (inA) open.add(edge.source);
      if (inB) open.add(edge.target);
    }
  }

  const groups = new Map();
  for (const id of entry.devices) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  const routed = new Set(entry.routedOn);
  return [...groups.values()].filter((group) => !group.some((id) => routed.has(id) || open.has(id)));
}

/** Attach `edge.vlans` and the fleet summary. Mutates the edges. */
function applyVlanOverlay(graph, snapshots) {
  for (const edge of graph.edges) edge.vlans = analyzeEdge(edge, snapshots);
  return analyzeVlans(graph.nodes, graph.edges, snapshots);
}

module.exports = {
  analyzeEdge, edgeStatus, analyzeVlans, applyVlanOverlay,
};
