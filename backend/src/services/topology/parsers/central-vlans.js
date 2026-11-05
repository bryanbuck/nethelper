/**
 * Aruba Central (New Central) VLAN membership of one switch, from two GA v1
 * reads (shapes checked against a live tenant on 2026-11-04, an AOS-S 2930F
 * and an AOS-CX 6300F: tests/fixtures/central-live/switch-*.json; v1alpha1
 * returns 404):
 *
 * - /network-monitoring/v1/switches/{serial}/interfaces: per port
 *     vlanMode       Access | Trunk | Routed
 *     nativeVlan     the untagged VLAN (null on a trunk: none untagged)
 *     allowedVlanIds the tagged VLANs of a trunk ([] or null otherwise),
 *                    without the native one
 * - /network-monitoring/v1/switches/{serial}/vlans: per VLAN
 *     id (a string), name, ipv4 (null or '' without an address), status
 *     Up | Down | Not used
 *
 * The ports come from the interfaces list; the VLAN list adds names, VLANs
 * no port carries, and the SVIs that route (an address on a VLAN that isn't
 * down).
 */

const { makeVlanSnapshot, isVlanId } = require('../vlan-membership');

const toId = (value) => (value === null || value === undefined || value === '' ? null : Number(value));

function portMembership(item) {
  const port = item?.name ?? item?.id;
  if (!port) return null;
  const mode = String(item.vlanMode || '').toLowerCase();
  if (mode === 'routed') return { port, mode: 'routed' };
  const untagged = toId(item.nativeVlan);
  if (mode === 'access') return { port, mode: 'access', untagged };
  if (mode !== 'trunk') return null;
  const tagged = (item.allowedVlanIds || []).map(Number).filter((id) => isVlanId(id) && id !== untagged);
  // No list on a trunk is read as "allowed all" (as AOS-CX REST says it), so
  // an unseen list never shows up as a pruned VLAN.
  return { port, mode: 'trunk', untagged, tagged, allTagged: !(item.allowedVlanIds || []).length };
}

/**
 * @param {{ interfaces: Object[], vlans: Object[] }} input - the two lists' items
 * @returns {Object|null} a VLAN snapshot (vlan-membership.js)
 */
function parseCentralVlans({ interfaces = [], vlans = [] } = {}) {
  const ports = interfaces.map(portMembership).filter(Boolean);
  const vlanList = vlans.map((v) => ({ id: toId(v?.id), name: v?.name || null }));
  const routed = vlans
    .filter((v) => v?.ipv4 && v.status !== 'Down')
    .map((v) => ({ vlan: toId(v.id), ip: v.ipv4 }));
  return makeVlanSnapshot({ vlans: vlanList, ports, routed });
}

module.exports = { parseCentralVlans };
