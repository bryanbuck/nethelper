/**
 * AOS-S (ProCurve/AOS-Switch) CLI. Written from the AOS-S management guide;
 * checked against a live 2930F (WC.16.11) on 2026-10-20, which prints MACs
 * as e4de40-008080 rather than the guide's spaced form (normalizeMac handles
 * both). See docs/hardware/AOS_S_NOTES.md.
 *
 * `show lldp info remote-device detail` prints one block per neighbor:
 *
 *   Local Port   : 1
 *   ChassisType  : mac-address
 *   ChassisId    : 00 1a 1e 00 00 00
 *   PortType     : local
 *   PortId       : 1
 *   SysName      : sw1
 *   System Descr : HP J9727A 2920-24G-PoE+ Switch, revision WB.16.10.0009
 *   PortDescr    : 1
 *   System Capabilities Enabled    : bridge
 *   Remote Management Address
 *      Type    : ipv4
 *      Address : 10.0.0.1
 */

const { makeNeighbor } = require('../neighbor');
const { normalizeMac } = require('../../../utils/device-key');

function fields(block) {
  const out = {};
  let inMgmt = false;
  for (const line of block.split('\n')) {
    if (/Remote Management Address/i.test(line)) {
      inMgmt = true;
      continue;
    }
    const m = /^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    // Only the first IPv4 management address.
    if (inMgmt && key === 'address') {
      if (!out.mgmtIp && /^\d+\.\d+\.\d+\.\d+$/.test(m[2])) out.mgmtIp = m[2];
      continue;
    }
    if (!(key in out)) out[key] = m[2];
  }
  return out;
}

function parseRemoteDetail(text) {
  const parts = String(text || '').split(/^(?=\s*Local Port\s*:)/m).slice(1);
  return parts
    .map((block) => {
      const f = fields(block);
      return makeNeighbor({
        localPort: f['local port'],
        chassisId: f.chassisid,
        portId: f.portid,
        portDesc: f.portdescr,
        sysName: f.sysname,
        sysDesc: f['system descr'],
        mgmtIp: f.mgmtIp,
        capabilities: f['system capabilities enabled'] || f['system capabilities supported'],
        protocol: 'lldp',
      });
    })
    .filter(Boolean);
}

/** `show lldp info local-device`: "Chassis Id : ..." / "System Name : ...". */
function parseLocalDevice(text) {
  const f = fields(String(text || ''));
  return { chassisId: normalizeMac(f['chassis id']), sysName: f['system name'] || null };
}

module.exports = { parseRemoteDetail, parseLocalDevice };
