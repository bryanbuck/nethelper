/**
 * Juniper Mist neighbors, from two org-wide reads (shapes checked against a
 * live org on 2026-10-19, tests/fixtures/mist-live/neighbors-*.json):
 *
 * - device stats (`fields=…,lldp_stat,lldp_stats`): an AP's own LLDP view of
 *   its uplink. `lldp_stats` is keyed by AP port ("" on a single-port AP);
 *   `lldp_stat` is the same for the primary port.
 * - port stats search: a switch's (or gateway's) LLDP neighbor per port, as
 *   `neighbor_mac` / `neighbor_system_name` / `neighbor_port_desc`. Mist sends
 *   no remote port id, only its description.
 *
 * Both are the devices' own LLDP tables relayed by the cloud, so the protocol
 * is `lldp`.
 *
 * The same port rows carry each switch port's VLANs (`port_mode`, `vlan_ids`:
 * Mist's effective membership, already resolved from the org/site templates),
 * and device stats `if_stat` carries the irb interfaces (`vlan`, `ips`). They
 * become the entry's `vlans` snapshot (topology/vlan-membership.js). A trunk's
 * `vlan_ids` don't say which VLAN is native, so its untagged VLAN is unknown.
 */

const { makeNeighbor } = require('../neighbor');
const { normalizeMac } = require('../../../utils/device-key');
const { makeVlanSnapshot, vlanIds } = require('../vlan-membership');

/** The AP's LLDP entries by local port: `lldp_stats` when present, else `lldp_stat`. */
function apLldpEntries(stat) {
  if (stat.lldp_stats && typeof stat.lldp_stats === 'object' && Object.keys(stat.lldp_stats).length) {
    return Object.entries(stat.lldp_stats);
  }
  return stat.lldp_stat ? [['', stat.lldp_stat]] : [];
}

/** VLAN membership of one Mist port row, or null for a port without any. */
function mistPortVlans(port) {
  const ids = vlanIds(port.vlan_ids);
  if (!port.port_id || !ids.length) return null;
  if (port.port_mode === 'trunk') {
    return { port: port.port_id, mode: 'trunk', tagged: ids, untaggedKnown: false };
  }
  if (port.port_mode === 'access') return { port: port.port_id, mode: 'access', untagged: ids[0] };
  return null;
}

/** irb addresses from device stats `if_stat` ({ "irb.0": { vlan, ips } }). */
function mistRouted(stat) {
  return Object.values(stat.if_stat || {})
    .filter((entry) => entry?.port_id === 'irb' && entry.vlan !== undefined && entry.up !== false)
    .map((entry) => ({ vlan: Number(entry.vlan), ip: (entry.ips || [])[0] || null }));
}

/**
 * @param {{ stats: Object[], ports: Object[] }} input - org device stats and port search results
 * @returns {Map<string, {neighbors: Object[], identity: {chassisId, sysName}, online: boolean, vlans: Object|null}>} by serial
 */
function parseMistNeighbors({ stats = [], ports = [] }) {
  const bySerial = new Map();
  const serialByMac = new Map();

  for (const stat of stats) {
    if (!stat?.serial) continue;
    const mac = normalizeMac(stat.mac);
    if (mac) serialByMac.set(mac, stat.serial);
    const neighbors = [];
    for (const [port, entry] of apLldpEntries(stat)) {
      if (!entry || typeof entry !== 'object') continue;
      const neighbor = makeNeighbor({
        localPort: port || entry.ap_port_name || 'eth0',
        chassisId: entry.chassis_id,
        portId: entry.port_id,
        portDesc: entry.port_desc,
        sysName: entry.system_name,
        sysDesc: entry.system_desc,
        // Mist fills mgmt_addr with whatever the neighbor advertised; makeNeighbor keeps IPv4 only.
        mgmtIp: (entry.mgmt_addrs || []).join(',') || entry.mgmt_addr,
        protocol: 'lldp',
      });
      if (neighbor) neighbors.push(neighbor);
    }
    bySerial.set(stat.serial, {
      neighbors,
      identity: { chassisId: mac, sysName: stat.hostname || stat.name || null },
      online: stat.status === 'connected',
      vlans: null,
      vlanInput: { ports: [], routed: mistRouted(stat) },
    });
  }

  for (const port of ports) {
    const entry = port && bySerial.get(serialByMac.get(normalizeMac(port.mac)));
    if (!entry) continue;
    const membership = mistPortVlans(port);
    if (membership) entry.vlanInput.ports.push(membership);
    if (!port.neighbor_mac && !port.neighbor_system_name) continue;
    const neighbor = makeNeighbor({
      localPort: port.port_id,
      chassisId: port.neighbor_mac,
      portId: port.neighbor_port_desc,
      portDesc: port.neighbor_port_desc,
      sysName: port.neighbor_system_name,
      protocol: 'lldp',
    });
    if (neighbor) entry.neighbors.push(neighbor);
  }

  for (const entry of bySerial.values()) {
    entry.vlans = makeVlanSnapshot(entry.vlanInput);
    delete entry.vlanInput;
  }
  return bySerial;
}

module.exports = { parseMistNeighbors };
