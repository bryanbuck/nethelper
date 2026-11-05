/**
 * AOS-CX VXLAN state from three REST reads (shapes checked live on two
 * 6300Fs, FL.10.16, joined by a static VXLAN, 2026-11-04:
 * tests/fixtures/aos-cx-live/vxlan-edge*.json):
 *
 * - /system/interfaces?attributes=name,type,admin,options: the `type: vxlan`
 *   interfaces (VTEPs); `options.local_ip` is the source address (usually a
 *   loopback, not the management IP).
 * - /system/virtual_network_ids: { "vxlan_vni,<vni>": { id, type, state,
 *   vlan: { "<id>": uri }, vrf: { "<name>": uri } | null, interface } }.
 * - /system/interfaces/<vxlan>/tunnel_endpoints: { "<vrf>,<origin>,<ip>":
 *   { destination, origin (static | evpn), state, network_id: {
 *   "vxlan_vni,<vni>": uri }, vrf } }, one per remote VTEP. Learned EVPN
 *   VTEPs are expected in the same table (origin evpn), from the schema;
 *   only static peers have been seen live.
 */

const { vlanIds } = require('../vlan-membership');
const { makeVxlanSnapshot } = require('../vxlan-membership');

const entries = (collection) => (Array.isArray(collection)
  ? collection.map((item) => [item?.name ?? item?.id, item])
  : Object.entries(collection || {}));

/** The VNI out of a "vxlan_vni,110" key or reference URI. */
function vniFromKey(key) {
  const match = /(?:^|[,/])(\d{1,8})$/.exec(decodeURIComponent(String(key)));
  return match ? Number(match[1]) : null;
}

/** The single key of a reference map ({ "default": uri }), or null. */
const refName = (ref) => (ref && typeof ref === 'object' ? Object.keys(ref)[0] ?? null : ref || null);

/** Names of the VXLAN interfaces in an interfaces reply. */
function vxlanInterfaceNames(interfaces) {
  return entries(interfaces)
    .filter(([, iface]) => iface?.type === 'vxlan')
    .map(([key, iface]) => iface.name || key);
}

/**
 * @param {{ interfaces: Object, vnis: Object, tunnelEndpoints: Object }} input -
 *   the replies; tunnelEndpoints is keyed by VXLAN interface name
 * @returns {Object|null} a VXLAN snapshot (vxlan-membership.js)
 */
function parseCxVxlan({ interfaces = {}, vnis = {}, tunnelEndpoints = {} } = {}) {
  const vteps = entries(interfaces)
    .filter(([, iface]) => iface?.type === 'vxlan')
    .map(([key, iface]) => ({ iface: iface.name || key, sourceIp: iface.options?.local_ip, admin: iface.admin }));

  const vniList = entries(vnis)
    .filter(([, v]) => v && (!v.type || v.type === 'vxlan_vni'))
    .map(([key, v]) => ({
      vni: Number(v.id ?? vniFromKey(key)),
      vlan: vlanIds(v.vlan)[0] ?? null,
      vrf: refName(v.vrf),
      state: v.state,
    }));

  const peers = [];
  for (const [iface, endpoints] of Object.entries(tunnelEndpoints || {})) {
    for (const [key, ep] of entries(endpoints)) {
      if (!ep || typeof ep !== 'object') continue;
      const [vrfKey, originKey, ipKey] = decodeURIComponent(String(key)).split(',');
      peers.push({
        iface,
        remoteIp: ep.destination ?? ipKey,
        origin: ep.origin ?? originKey ?? null,
        vrf: refName(ep.vrf) ?? vrfKey ?? null,
        state: ep.state,
        vnis: Object.keys(ep.network_id || {}).map(vniFromKey),
      });
    }
  }

  return makeVxlanSnapshot({ vteps, vnis: vniList, peers });
}

module.exports = { parseCxVxlan, vxlanInterfaceNames };
