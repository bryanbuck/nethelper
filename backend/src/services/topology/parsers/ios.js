/**
 * Cisco IOS / IOS-XE CLI: `show cdp neighbors detail` and
 * `show lldp neighbors detail` (+ the LLDP summary table). LLDP is checked
 * against a 3560E on IOS 15.0(1)SE2 (tests/fixtures/ios-live/); CDP detail is
 * still from Cisco's command reference (that switch had no CDP neighbor). A
 * disabled protocol prints a "% ... not enabled" line, and CDP with no
 * neighbors prints nothing: both parse to no neighbors.
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
 * `show lldp neighbors`: the summary table. Columns are fixed-width and a
 * long Device ID is cut at 20 characters, so cells are read at the header's
 * column offsets.
 *
 *   Device ID           Local Intf     Hold-time  Capability      Port ID
 *   Sw-CoreA            Te0/1          120        B,R             1/1/25
 */
function parseLldpSummary(text) {
  const lines = String(text || '').split('\n');
  const at = lines.findIndex((line) => /^Device ID\s+Local Intf\s/.test(line));
  if (at < 0) return [];
  const header = lines[at];
  const cols = ['Device ID', 'Local Intf', 'Hold-time', 'Capability', 'Port ID'].map((name) => header.indexOf(name));
  if (cols.some((c) => c < 0)) return [];
  const rows = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || /^Total entries/i.test(line)) break;
    const cell = (i) => line.slice(cols[i], cols[i + 1] ?? undefined).trim();
    const row = { deviceId: cell(0), localPort: cell(1), portId: cell(4) };
    if (row.deviceId && row.localPort) rows.push(row);
  }
  return rows;
}

/**
 * The local port of a detail block that doesn't name it: the one summary row
 * with the same remote port and device (the summary's Device ID is the system
 * name, cut at 20 characters, or the chassis id when no name is advertised).
 */
function localPortFromSummary(summary, { portId, sysName, chassisId }) {
  const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const names = (row) => [sysName, chassisId].some((id) => id && (same(row.deviceId, id)
    || (row.deviceId.length >= 20 && id.toLowerCase().startsWith(row.deviceId.toLowerCase()))));
  const matches = summary.filter((row) => same(row.portId, portId) && names(row));
  return matches.length === 1 ? matches[0].localPort : null;
}

/*
 * `show lldp neighbors detail`. Newer releases start each block with the
 * local port:
 *
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
 *
 * IOS 15.0(1)SE2 (3560E) has no "Local Intf" line at all, so the local port
 * comes from the summary table (`summaryText`, `show lldp neighbors`). A
 * block that still has no local port is dropped: a neighbor on an unknown
 * port can't be drawn.
 */
function parseLldpDetail(text, summaryText = '') {
  const summary = parseLldpSummary(summaryText);
  return splitBlocks(text)
    .map((block) => {
      const fields = {
        chassisId: first(/^\s*Chassis id:\s*(.+)$/m, block),
        portId: first(/^\s*Port id:\s*(.+)$/m, block),
        portDesc: first(/^\s*Port Description:\s*(.+)$/m, block),
        sysName: first(/^\s*System Name:\s*(.+)$/m, block),
        sysDesc: first(/^\s*System Description:\s*\n\s*(.+)$/m, block),
        mgmtIp: first(/^\s*IP:\s*(\d+\.\d+\.\d+\.\d+)/m, block),
        capabilities: first(/^\s*Enabled Capabilities:\s*(.+)$/m, block),
        protocol: 'lldp',
      };
      const localPort = first(/^\s*Local Intf:\s*(.+)$/m, block) || localPortFromSummary(summary, fields);
      return makeNeighbor({ localPort, ...fields });
    })
    .filter(Boolean);
}

module.exports = { parseCdpDetail, parseLldpDetail, parseLldpSummary };
