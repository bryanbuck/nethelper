/**
 * AOS-CX VLAN membership from two REST reads (shapes from the AOS-CX 10.10
 * REST schema; not yet checked against a live switch):
 *
 * - /system/vlans: { "<id>": { id, name } } (or a list of the same)
 * - /system/interfaces?attributes=name,type,vlan_mode,vlan_tag,vlan_trunks,
 *   interfaces,routing,ip4_address: per interface,
 *     vlan_mode   access | native-untagged | native-tagged (absent when routed)
 *     vlan_tag    the access / native VLAN (a reference: URI, object or id map)
 *     vlan_trunks the allowed VLANs; empty on a trunk = "allowed all"
 *     interfaces  a LAG's member ports (LLDP reports the members, so they
 *                 inherit the LAG's membership)
 *     type vlan   an SVI ("vlan10"), routed when it has ip4_address
 */

const { vlanIds, makeVlanSnapshot } = require('../vlan-membership');

const asEntries = (collection) => (Array.isArray(collection)
  ? collection.map((item) => [item?.name ?? item?.id, item])
  : Object.entries(collection || {}));

/** Member port names of a LAG's `interfaces` reference map/list. */
function memberNames(value) {
  if (!value) return [];
  const names = Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v : v?.name))
    : Object.entries(value).map(([key, v]) => (v && typeof v === 'object' && v.name) || key);
  return names
    .filter(Boolean)
    .map((name) => decodeURIComponent(String(name).split('/interfaces/').pop()));
}

function portMembership(iface) {
  const mode = iface.vlan_mode;
  if (!mode) return iface.routing === true ? { mode: 'routed' } : null;
  const tag = vlanIds(iface.vlan_tag)[0] ?? null;
  if (mode === 'access') return { mode: 'access', untagged: tag };
  if (mode !== 'native-untagged' && mode !== 'native-tagged') return null;
  const trunks = vlanIds(iface.vlan_trunks);
  const tagged = mode === 'native-tagged' && tag ? [...trunks, tag] : trunks;
  return {
    mode: 'trunk',
    untagged: mode === 'native-untagged' ? tag : null,
    tagged,
    allTagged: trunks.length === 0,
  };
}

/**
 * @param {{ interfaces: Object, vlans: Object }} input - the two REST replies
 * @returns {Object|null} a VLAN snapshot (vlan-membership.js)
 */
function parseCxVlans({ interfaces = {}, vlans = {} } = {}) {
  const vlanList = asEntries(vlans).map(([key, v]) => ({
    id: Number(v?.id ?? key),
    name: v?.name || null,
  }));

  const ports = [];
  const routed = [];
  const lagMembers = [];
  for (const [key, iface] of asEntries(interfaces)) {
    if (!iface || typeof iface !== 'object') continue;
    const name = iface.name || key;
    if (iface.type === 'vlan') {
      const id = vlanIds(String(name).replace(/^vlan/i, ''))[0];
      const ip = Array.isArray(iface.ip4_address) ? iface.ip4_address[0] : iface.ip4_address;
      if (id && ip) routed.push({ vlan: id, ip });
      continue;
    }
    const membership = portMembership(iface);
    if (!membership) continue;
    ports.push({ port: name, ...membership });
    if (iface.type === 'lag') lagMembers.push([membership, memberNames(iface.interfaces)]);
  }
  for (const [membership, members] of lagMembers) {
    for (const member of members) ports.push({ port: member, ...membership, lag: true });
  }

  return makeVlanSnapshot({ vlans: vlanList, ports, routed });
}

module.exports = { parseCxVlans };
