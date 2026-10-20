/**
 * AOS-CX REST: `GET system/interfaces/*\/lldp_neighbors?depth=2`.
 *
 * Shape (verified on a 6200F, ML.10.16, 2026-10-16; tests/fixtures/aos-cx-live/
 * lldp-neighbors.json):
 *
 *   { "<local port>": { "<chassis_id>,<port_id>": {
 *       chassis_id, port_id, mac_addr,
 *       neighbor_info: { chassis_name, chassis_description, chassis_capability_enabled,
 *                        port_description, mgmt_ip_list, chassis_protocol, ... } } } }
 *
 * chassis_id is the neighbor's system MAC for switches, but endpoints may send
 * an IP (a Cisco phone does); mac_addr is then the only MAC.
 */

const { makeNeighbor } = require('../neighbor');
const { normalizeMac } = require('../../../utils/device-key');

function parseLldpNeighbors(response) {
  const neighbors = [];
  for (const [localPort, entries] of Object.entries(response || {})) {
    if (!entries || typeof entries !== 'object') continue;
    for (const entry of Object.values(entries)) {
      // depth too shallow gives URI strings instead of objects
      if (!entry || typeof entry !== 'object') continue;
      const info = entry.neighbor_info || {};
      const protocol = String(info.chassis_protocol || 'lldp').toLowerCase() === 'cdp' ? 'cdp' : 'lldp';
      const neighbor = makeNeighbor({
        localPort,
        chassisId: entry.chassis_id,
        portId: entry.port_id,
        portDesc: info.port_description,
        sysName: info.chassis_name,
        sysDesc: info.chassis_description,
        mgmtIp: info.mgmt_ip_list,
        mac: entry.mac_addr,
        capabilities: info.chassis_capability_enabled || info.chassis_capability_available,
        protocol,
      });
      if (neighbor) neighbors.push(neighbor);
    }
  }
  return neighbors;
}

/** This switch's own identity from `GET system?attributes=hostname,system_mac`. */
function parseIdentity(system) {
  return {
    chassisId: normalizeMac(system?.system_mac),
    sysName: system?.hostname || null,
  };
}

module.exports = { parseLldpNeighbors, parseIdentity };
