/**
 * Junos LLDP, over NETCONF (preferred) or the CLI (fallback when NETCONF is off).
 *
 * Spec-derived (Junos XML API reference and CLI docs), not yet checked against
 * a live device. Element names differ by release: ELS switches report
 * <lldp-local-port-id>, older releases <lldp-local-interface>; both are read.
 */

const { makeNeighbor } = require('../neighbor');
const { normalizeMac } = require('../../../utils/mac');

function decode(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(xml, name) {
  const m = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`).exec(xml);
  return m ? decode(m[1]) : null;
}

function blocks(xml, name) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/** <get-lldp-neighbors-information/> rpc-reply. */
function parseLldpNeighborsXml(xml) {
  return blocks(xml || '', 'lldp-neighbor-information')
    .map((block) => makeNeighbor({
      localPort: tag(block, 'lldp-local-port-id') || tag(block, 'lldp-local-interface'),
      chassisId: tag(block, 'lldp-remote-chassis-id'),
      portId: tag(block, 'lldp-remote-port-id'),
      portDesc: tag(block, 'lldp-remote-port-description'),
      sysName: tag(block, 'lldp-remote-system-name'),
      sysDesc: tag(block, 'lldp-remote-system-description'),
      mgmtIp: tag(block, 'lldp-remote-management-address'),
      capabilities: tag(block, 'lldp-remote-system-capabilities-enabled'),
      protocol: 'lldp',
    }))
    .filter(Boolean);
}

/** <get-lldp-local-info/> rpc-reply. */
function parseLocalInfoXml(xml) {
  return {
    chassisId: normalizeMac(tag(xml || '', 'lldp-local-chassis-id')),
    sysName: tag(xml || '', 'lldp-local-system-name'),
  };
}

/**
 * `show lldp neighbors` table:
 *
 *   Local Interface    Parent Interface    Chassis Id          Port info          System Name
 *   ge-0/0/1           -                   00:11:22:33:44:55   ge-0/0/2           sw2
 *
 * Port info can be a description with spaces, so columns are found by shape:
 * the chassis id is the token after the local (and parent) interface, the
 * system name is the last token, and port info is what lies between.
 */
function parseLldpNeighborsCli(text) {
  const lines = String(text || '').split('\n');
  const header = lines.findIndex((l) => /Local Interface/i.test(l) && /Chassis Id/i.test(l));
  if (header === -1) return [];
  const hasParent = /Parent Interface/i.test(lines[header]);
  const neighbors = [];
  for (const line of lines.slice(header + 1)) {
    const tokens = line.trim().split(/\s+/);
    const min = hasParent ? 5 : 4;
    if (tokens.length < min) continue;
    const local = tokens[0];
    const chassisIdx = hasParent ? 2 : 1;
    const neighbor = makeNeighbor({
      localPort: local,
      chassisId: tokens[chassisIdx],
      portId: tokens.slice(chassisIdx + 1, -1).join(' '),
      sysName: tokens[tokens.length - 1],
      protocol: 'lldp',
    });
    if (neighbor) neighbors.push(neighbor);
  }
  return neighbors;
}

/** `show lldp local-information`: "Chassis ID : ..." / "System name : ...". */
function parseLocalInfoCli(text) {
  const field = (re) => (re.exec(String(text || '')) || [])[1]?.trim() || null;
  return {
    chassisId: normalizeMac(field(/^\s*Chassis ID\s*:\s*(.+)$/im)),
    sysName: field(/^\s*System name\s*:\s*(.+)$/im),
  };
}

module.exports = {
  parseLldpNeighborsXml, parseLocalInfoXml, parseLldpNeighborsCli, parseLocalInfoCli,
};
