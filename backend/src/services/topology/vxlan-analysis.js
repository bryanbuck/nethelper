/**
 * The Network Map's VXLAN overlay, computed from the built graph and each
 * device's VXLAN snapshot (vxlan-membership.js). Pure: no database access.
 *
 * VXLAN tunnels run VTEP to VTEP over the routed underlay, not along LLDP
 * links, so they are their own edges. A peer's remote IP is matched to a
 * device by the VTEP source addresses the other snapshots report, then by
 * management IP; one nothing matches is `unresolved`.
 *
 * Per tunnel (`vxlan.tunnels`, one per VTEP pair):
 *   ends       { [nodeId]: { localIp, remoteIp, origins, up, vnis } | null }
 *              null: that end lists no peer for the other one
 *   known      { [nodeId]: boolean } which ends we have a snapshot for
 *   vnis       VNIs either end floods over it
 *   vniStatus  { [vni]: carried | one-sided | down | unknown }
 *   status     the worst of those (down > one-sided > unknown > carried)
 *
 * Per VNI (`vxlan.vnis`): the VTEPs with their local VLAN/VRF, the tunnels
 * that carry it, VTEPs with no peer for it (`isolated`), peers nothing
 * matched (`unresolved`), and `vlanDiffers` when an L2 VNI maps to different
 * VLANs on different VTEPs (legal, but worth seeing).
 *
 * For the VLAN overlay, `bridges` are tunnels that carry a VNI mapped to the
 * same VLAN at both ends (an L2 path), and `open` the VTEPs whose path for a
 * VLAN goes on to a VTEP we can't see.
 */

const TUNNEL_STATUSES = ['carried', 'one-sided', 'down', 'unknown'];
const SEVERITY = { down: 3, 'one-sided': 2, unknown: 1, carried: 0 };

/** remote IP -> node id: VTEP source addresses first, then management IPs. Ambiguous IPs match nothing. */
function buildVtepResolver(nodes, snapshots) {
  const add = (map, ip, id) => {
    if (!ip) return;
    map.set(ip, map.has(ip) && map.get(ip) !== id ? null : id);
  };
  const bySource = new Map();
  for (const [id, snap] of snapshots) for (const vtep of snap.vteps) add(bySource, vtep.sourceIp, id);
  const byMgmt = new Map();
  for (const node of nodes) if (node.kind === 'device') add(byMgmt, node.data.ipAddress, node.id);
  return (ip) => (bySource.has(ip) ? bySource.get(ip) : byMgmt.get(ip) ?? null);
}

const vniEntry = (snap, vni) => snap?.vnis.find((v) => v.vni === vni) || null;

function vniStatus(tunnel, vni, snapshots) {
  const [a, b] = [tunnel.source, tunnel.target];
  const lists = [a, b].map((id) => Boolean(tunnel.ends[id]?.vnis.includes(vni)));
  if ([a, b].some((id, i) => lists[i] && tunnel.ends[id].up === false)) return 'down';
  if (lists[0] && lists[1]) return 'carried';
  // The end that doesn't list it: seen (one-sided) or not read (unknown).
  const silent = lists[0] ? b : a;
  return snapshots.has(silent) ? 'one-sided' : 'unknown';
}

/**
 * @param {{ nodes: Object[] }} graph
 * @param {Map<string, Object>} snapshots - node id -> VXLAN snapshot
 * @returns {{ tunnels: Object[], vnis: Object[], unresolved: Object[], bridges: Object[], open: Object[] }}
 */
function analyzeVxlan(graph, snapshots) {
  const resolve = buildVtepResolver(graph.nodes, snapshots);
  const tunnels = new Map();
  const unresolved = [];

  for (const [id, snap] of snapshots) {
    const sourceOf = (iface) => snap.vteps.find((v) => v.iface === iface)?.sourceIp || snap.vteps[0]?.sourceIp || null;
    for (const peer of snap.peers) {
      const remote = resolve(peer.remoteIp);
      if (!remote || remote === id) {
        unresolved.push({
          node: id, remoteIp: peer.remoteIp, origin: peer.origin, up: peer.up, vnis: peer.vnis,
        });
        continue;
      }
      const [a, b] = [id, remote].sort();
      const key = `tunnel:${a}~${b}`;
      if (!tunnels.has(key)) {
        tunnels.set(key, {
          id: key, source: a, target: b, ends: { [a]: null, [b]: null },
        });
      }
      const tunnel = tunnels.get(key);
      const end = tunnel.ends[id];
      if (!end) {
        tunnel.ends[id] = {
          localIp: sourceOf(peer.iface), remoteIp: peer.remoteIp, origins: [peer.origin].filter(Boolean), up: peer.up, vnis: [...peer.vnis],
        };
      } else {
        // A second peer entry for the same VTEP (another VRF or origin).
        end.origins = [...new Set([...end.origins, peer.origin].filter(Boolean))];
        end.vnis = [...new Set([...end.vnis, ...peer.vnis])].sort((x, y) => x - y);
        end.up = end.up === false || peer.up === false ? false : end.up ?? peer.up;
      }
    }
  }

  const tunnelList = [...tunnels.values()].map((t) => {
    const known = { [t.source]: snapshots.has(t.source), [t.target]: snapshots.has(t.target) };
    const vnis = [...new Set([t.source, t.target].flatMap((id) => t.ends[id]?.vnis || []))].sort((x, y) => x - y);
    const statusByVni = Object.fromEntries(vnis.map((vni) => [vni, vniStatus(t, vni, snapshots)]));
    const statuses = Object.values(statusByVni);
    // A tunnel listed by one end only is one-sided even when it floods no VNI.
    if (!statuses.length) statuses.push(known[t.source] && known[t.target] ? 'one-sided' : 'unknown');
    const status = statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst), 'carried');
    return {
      ...t, known, vnis, vniStatus: statusByVni, status,
    };
  });

  // Per VNI.
  const byVni = new Map();
  for (const [id, snap] of snapshots) {
    for (const v of snap.vnis) {
      if (!byVni.has(v.vni)) byVni.set(v.vni, { vni: v.vni, kinds: new Set(), vteps: [] });
      const entry = byVni.get(v.vni);
      entry.kinds.add(v.kind);
      entry.vteps.push({
        node: id, vlan: v.vlan, vrf: v.vrf, up: v.up,
      });
    }
  }
  const vniList = [...byVni.values()].sort((x, y) => x.vni - y.vni).map((entry) => {
    const carrying = tunnelList.filter((t) => t.vnis.includes(entry.vni));
    const lost = unresolved.filter((u) => u.vnis.includes(entry.vni));
    const hasPeer = (node) => carrying.some((t) => t.ends[node]?.vnis.includes(entry.vni))
      || lost.some((u) => u.node === node);
    const l2Vlans = new Set(entry.vteps.filter((v) => v.vlan !== null).map((v) => v.vlan));
    return {
      vni: entry.vni,
      kind: entry.kinds.has('l3') ? 'l3' : 'l2',
      vteps: entry.vteps,
      tunnels: carrying.map((t) => t.id),
      isolated: entry.vteps.filter((v) => !hasPeer(v.node)).map((v) => v.node),
      unresolved: lost.map((u) => ({ node: u.node, remoteIp: u.remoteIp })),
      vlanDiffers: l2Vlans.size > 1,
    };
  });

  // VLAN overlay inputs.
  const bridges = [];
  const open = [];
  for (const t of tunnelList) {
    for (const [vniKey, status] of Object.entries(t.vniStatus)) {
      const vni = Number(vniKey);
      const [va, vb] = [t.source, t.target].map((id) => vniEntry(snapshots.get(id), vni)?.vlan ?? null);
      if (status === 'carried' && va !== null && va === vb) bridges.push({ a: t.source, b: t.target, vlan: va });
      if (status === 'unknown') {
        const seen = onlyKnownEnd(t);
        const vlan = vniEntry(snapshots.get(seen), vni)?.vlan;
        if (seen && vlan) open.push({ node: seen, vlan });
      }
    }
  }
  for (const u of unresolved) {
    for (const vni of u.vnis) {
      const vlan = vniEntry(snapshots.get(u.node), vni)?.vlan;
      if (vlan) open.push({ node: u.node, vlan });
    }
  }

  return {
    tunnels: tunnelList, vnis: vniList, unresolved, bridges, open,
  };
}

/** The end of a tunnel we have a snapshot for, when only one is known. */
function onlyKnownEnd(tunnel) {
  if (tunnel.known[tunnel.source] && !tunnel.known[tunnel.target]) return tunnel.source;
  if (tunnel.known[tunnel.target] && !tunnel.known[tunnel.source]) return tunnel.target;
  return null;
}

module.exports = { analyzeVxlan, buildVtepResolver, TUNNEL_STATUSES };
