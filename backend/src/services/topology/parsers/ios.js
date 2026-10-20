/**
 * Cisco IOS / IOS-XE CLI: `show cdp neighbors detail` and
 * `show lldp neighbors detail`. Spec-derived from Cisco command references,
 * not yet checked against a live Catalyst. A disabled protocol prints a
 * "% ... not enabled" line, which parses to no neighbors.
 */

const { makeNeighbor } = require('../neighbor');

function splitBlocks(text) {
  return String(text || '').split(/^-{10,}\s*$/m).map((b) => b.trim()).filter(Boolean);
}

const first = (re, text) => (re.exec(text) || [])[1]?.trim() || null;

/*
 *   Device ID: sw2.example.com
 *   Entry address(es):
 *     IP address: 10.0.0.2
 *   Platform: cisco WS-C3850-24P,  Capabilities: Switch IGMP
 *   Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): GigabitEthernet1/0/24
 */
function parseCdpDetail(text) {
  return splitBlocks(text)
    .map((block) => {
      const deviceId = first(/^\s*Device ID:\s*(.+)$/m, block);
      if (!deviceId) return null;
      const platform = first(/^\s*Platform:\s*([^,]+)/m, block);
      return makeNeighbor({
        localPort: first(/^\s*Interface:\s*([^,]+),/m, block),
        chassisId: deviceId,
        portId: first(/Port ID \(outgoing port\):\s*(.+)$/m, block),
        sysName: deviceId,
        sysDesc: platform,
        mgmtIp: first(/^\s*IP(?:v4)? address:\s*(\d+\.\d+\.\d+\.\d+)/m, block),
        capabilities: first(/Capabilities:\s*(.+)$/m, block),
        protocol: 'cdp',
      });
    })
    .filter(Boolean);
}

/*
 *   Local Intf: Gi1/0/1
 *   Chassis id: 0011.2233.4455
 *   Port id: Gi1/0/24
 *   Port Description: GigabitEthernet1/0/24
 *   System Name: sw2
 *
 *   System Description:
 *   Cisco IOS Software, ...
 *
 *   Enabled Capabilities: B,R
 *   Management Addresses:
 *       IP: 10.0.0.2
 */
function parseLldpDetail(text) {
  return splitBlocks(text)
    .map((block) => makeNeighbor({
      localPort: first(/^\s*Local Intf:\s*(.+)$/m, block),
      chassisId: first(/^\s*Chassis id:\s*(.+)$/m, block),
      portId: first(/^\s*Port id:\s*(.+)$/m, block),
      portDesc: first(/^\s*Port Description:\s*(.+)$/m, block),
      sysName: first(/^\s*System Name:\s*(.+)$/m, block),
      sysDesc: first(/^\s*System Description:\s*\n\s*(.+)$/m, block),
      mgmtIp: first(/^\s*IP:\s*(\d+\.\d+\.\d+\.\d+)/m, block),
      capabilities: first(/^\s*Enabled Capabilities:\s*(.+)$/m, block),
      protocol: 'lldp',
    }))
    .filter(Boolean);
}

module.exports = { parseCdpDetail, parseLldpDetail };
