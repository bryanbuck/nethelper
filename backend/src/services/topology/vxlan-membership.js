/**
 * One device's VXLAN state as the Network Map's VXLAN overlay uses it, read in
 * the same topology pass as its links and VLANs. Stored whole on
 * DeviceTopologyState.vxlan:
 *
 *   {
 *     vteps: [{ iface, sourceIp, admin }]          its VXLAN interfaces (VTEPs)
 *     vnis:  [{ vni, kind, vlan, vrf, state, up }] VNIs, ascending
 *     peers: [{ iface, remoteIp, origin, vrf, state, up, vnis }]
 *   }
 *
 * `kind` is l2 (bridged to `vlan`) or l3 (a VRF's routed VNI). A peer is a
 * remote VTEP: `origin` static (configured `vtep-peer`) or evpn (learned),
 * `vnis` the VNIs it is flooded for. `up` is the switch's own operational
 * state, never inferred.
 */

const { isVlanId } = require('./vlan-membership');

const isVni = (n) => Number.isInteger(n) && n >= 1 && n <= 16777215;
const OPERATIONAL = 'operational';

/** A bare IPv4 address out of "10.0.0.1" or "10.0.0.1/32", else null. */
function bareIp(value) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/\d+)?$/.exec(String(value ?? '').trim());
  return match ? match[1] : null;
}

const sortNum = (list) => [...new Set(list)].sort((a, b) => a - b);

/**
 * Normalize a parser's output into the stored snapshot.
 * @param {{ vteps?: Object[], vnis?: Object[], peers?: Object[] }} input
 * @returns {Object|null} null when the device has no VTEP and no VNI
 */
function makeVxlanSnapshot({ vteps = [], vnis = [], peers = [] } = {}) {
  const vtepList = vteps
    .filter((v) => v?.iface)
    .map((v) => ({ iface: String(v.iface), sourceIp: bareIp(v.sourceIp), admin: v.admin || null }));

  const seen = new Set();
  const vniList = [];
  for (const v of vnis) {
    if (!isVni(v?.vni) || seen.has(v.vni)) continue;
    seen.add(v.vni);
    vniList.push({
      vni: v.vni,
      kind: v.vrf ? 'l3' : 'l2',
      vlan: isVlanId(v.vlan) ? v.vlan : null,
      vrf: v.vrf || null,
      state: v.state || null,
      up: v.state ? v.state === OPERATIONAL : null,
    });
  }
  vniList.sort((a, b) => a.vni - b.vni);

  const peerList = [];
  const peerKeys = new Set();
  for (const p of peers) {
    const remoteIp = bareIp(p?.remoteIp);
    const key = `${p?.iface}|${p?.vrf}|${p?.origin}|${remoteIp}`;
    if (!remoteIp || peerKeys.has(key)) continue;
    peerKeys.add(key);
    peerList.push({
      iface: p.iface || null,
      remoteIp,
      origin: p.origin || null,
      vrf: p.vrf || null,
      state: p.state || null,
      up: p.state ? p.state === OPERATIONAL : null,
      vnis: sortNum((p.vnis || []).filter(isVni)),
    });
  }
  peerList.sort((a, b) => a.remoteIp.localeCompare(b.remoteIp, undefined, { numeric: true }));

  if (!vtepList.length && !vniList.length) return null;
  return { vteps: vtepList, vnis: vniList, peers: peerList };
}

module.exports = {
  makeVxlanSnapshot, bareIp, isVni, OPERATIONAL,
};
