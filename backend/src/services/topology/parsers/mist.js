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
 */

const { makeNeighbor } = require('../neighbor');
const { normalizeMac } = require('../../../utils/device-key');

/** The AP's LLDP entries by local port: `lldp_stats` when present, else `lldp_stat`. */
function apLldpEntries(stat) {
  if (stat.lldp_stats && typeof stat.lldp_stats === 'object' && Object.keys(stat.lldp_stats).length) {
    return Object.entries(stat.lldp_stats);
  }
  return stat.lldp_stat ? [['', stat.lldp_stat]] : [];
}

/**
 * @param {{ stats: Object[], ports: Object[] }} input - org device stats and port search results
 * @returns {Map<string, {neighbors: Object[], identity: {chassisId, sysName}, online: boolean}>} by serial
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
    });
  }

  for (const port of ports) {
    if (!port?.neighbor_mac && !port?.neighbor_system_name) continue;
    const entry = bySerial.get(serialByMac.get(normalizeMac(port.mac)));
    if (!entry) continue;
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

  return bySerial;
}

module.exports = { parseMistNeighbors };
