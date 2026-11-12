/**
 * Port Identity: AOS-CX REST client tables (live shapes, ML/FL.10.16 on a
 * 6200F and 6300Fs; fixtures in tests/fixtures/aos-cx-live/port-clients/).
 *
 *   GET system/interfaces?depth=2&attributes=...   ports: type, link, LAG members, description
 *   GET system/vlans/*\/macs?depth=2               { <vlan>: { "<from>,<mac>": { mac_addr, from, port: { <port>: ref }, network_infra_mac } } }
 *   GET system/vrfs/*\/neighbors?depth=2           { <vrf>: { "<ip>,<l3 port>": { ip_address, mac, phy_port: { <port>: ref }, state } } }
 *
 * The same MAC is listed once per VLAN it was learned in. MACs learned on a
 * tunnel (vxlan1) or any non-physical, non-LAG interface are not port clients.
 */

const { normalizeMac } = require('../../../utils/device-key');
const { normalizePortName } = require('../../topology/neighbor');

const CLIENT_PORT_TYPES = new Set(['system', 'lag']);

/** A CX reference: { "1/1/13": "/rest/v10.10/system/interfaces/1%2F1%2F13" } or the path itself. */
function refName(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') {
    const last = ref.split('/').pop();
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  if (typeof ref === 'object') {
    const [name] = Object.keys(ref);
    return name || null;
  }
  return null;
}

function vlanRefIds(ref) {
  if (!ref || typeof ref !== 'object') return [];
  return Object.keys(ref).map(Number).filter(Number.isInteger);
}

/**
 * @returns {{ ports: Map<string, {port, type, linkUp, adminUp, description, native}>, lagOf: Map<string, string> }}
 *   keyed by normalizePortName(); lagOf maps a member port to its LAG's name.
 */
function parseCxInterfaces(raw) {
  const ports = new Map();
  const lagOf = new Map();
  for (const [name, i] of Object.entries(raw || {})) {
    if (!i || typeof i !== 'object') continue;
    const port = i.name || name;
    const admin = i.admin_state ?? i.user_config?.admin;
    ports.set(normalizePortName(port), {
      port,
      type: i.type || null,
      linkUp: i.link_state ? i.link_state === 'up' : null,
      adminUp: admin ? admin === 'up' : null,
      description: i.description || null,
      native: vlanRefIds(i.applied_vlan_tag)[0] ?? null,
    });
    if (i.type === 'lag') {
      for (const member of Object.keys(i.interfaces || {})) lagOf.set(normalizePortName(member), port);
    }
  }
  return { ports, lagOf };
}

/**
 * MAC table -> observations, one per (port, MAC). When a MAC was learned in
 * several VLANs, the port's untagged VLAN wins, else the lowest.
 * @param raw    the macs reply
 * @param ifaces parseCxInterfaces() result, or null (then every port counts)
 * @returns {{ observations: Object[], infraPorts: Set<string>, skipped: number }}
 */
function parseCxMacTable(raw, ifaces = null) {
  const byKey = new Map();
  const infraPorts = new Set();
  let skipped = 0;
  for (const [vlanKey, entries] of Object.entries(raw || {})) {
    for (const [entryKey, e] of Object.entries(entries || {})) {
      const mac = normalizeMac(e?.mac_addr || entryKey.split(',').pop());
      const portName = refName(e?.port);
      if (!mac || !portName) {
        skipped++;
        continue;
      }
      const key = normalizePortName(portName);
      const iface = ifaces?.ports.get(key);
      if (ifaces && (!iface || !CLIENT_PORT_TYPES.has(iface.type))) {
        skipped++;
        continue;
      }
      if (e.network_infra_mac) infraPorts.add(key);
      const vlan = Number(vlanKey);
      const k = `${key}|${mac}`;
      const prev = byKey.get(k);
      if (!prev) {
        byKey.set(k, {
          port: portName, mac, vlans: [vlan], from: e.from || null, sources: ['mac-table'],
        });
      } else {
        prev.vlans.push(vlan);
      }
    }
  }
  const observations = [...byKey.values()].map((o) => {
    const native = ifaces?.ports.get(normalizePortName(o.port))?.native;
    const vlans = o.vlans.filter(Number.isInteger).sort((a, b) => a - b);
    return {
      port: o.port, mac: o.mac, vlan: vlans.includes(native) ? native : (vlans[0] ?? null), from: o.from, sources: o.sources,
    };
  });
  return { observations, infraPorts, skipped };
}

/** ARP/ND table -> [{ ip, mac, port }] (IPv4 only; port = the physical port when known). */
function parseCxArp(raw) {
  const out = [];
  for (const entries of Object.values(raw || {})) {
    for (const [key, e] of Object.entries(entries || {})) {
      if (e?.address_family && e.address_family !== 'ipv4') continue;
      const ip = e?.ip_address || key.split(',')[0];
      const mac = normalizeMac(e?.mac);
      if (!mac || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip || '')) continue;
      out.push({ ip, mac, port: refName(e.phy_port) || refName(e.port) });
    }
  }
  return out;
}

module.exports = {
  parseCxInterfaces, parseCxMacTable, parseCxArp, refName, CLIENT_PORT_TYPES,
};
