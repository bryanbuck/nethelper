/**
 * One device's VLAN membership as the Network Map's VLAN overlay uses it,
 * read in the same topology pass as its links so the two never disagree in
 * time. Stored whole on DeviceTopologyState.vlans:
 *
 *   {
 *     vlans:  [{ id, name }]           VLANs the device carries, ascending
 *     ports:  { <normalized port>: { port, mode, untagged, untaggedKnown, tagged, allTagged } }
 *     routed: [{ vlan, ip }]           VLANs it has an address on (SVI / irb)
 *   }
 *
 * Port `mode` is access | trunk | routed. `untagged` is the VLAN untagged
 * frames land in (null: none, e.g. AOS-CX native-tagged); `untaggedKnown`
 * is false where the source doesn't say (a Mist trunk lists its VLANs
 * without naming the native one). `allTagged` is "vlan trunk allowed all":
 * every VLAN the device itself carries.
 */

const { normalizePortName } = require('./neighbor');

const isVlanId = (n) => Number.isInteger(n) && n >= 1 && n <= 4094;

/**
 * VLAN ids out of whatever shape a source used: a number, a numeric string,
 * a REST reference URI (".../vlans/10"), an object with an `id`, an object
 * keyed by id (AOS-CX reference maps), or an array of any of these.
 */
function vlanIds(value) {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'number') return isVlanId(value) ? [value] : [];
  if (typeof value === 'string') {
    const match = value.match(/(?:^|\/)(\d{1,4})\/?$/);
    const n = match ? parseInt(match[1], 10) : NaN;
    return isVlanId(n) ? [n] : [];
  }
  if (Array.isArray(value)) return [...new Set(value.flatMap(vlanIds))];
  if (typeof value === 'object') {
    if (value.id !== undefined) return vlanIds(Number(value.id));
    const keys = Object.keys(value);
    if (keys.length && keys.every((k) => /^\d{1,4}$/.test(k))) return vlanIds(keys.map(Number));
    return [...new Set(Object.values(value).flatMap(vlanIds))];
  }
  return [];
}

const sortNum = (list) => [...new Set(list)].sort((a, b) => a - b);

/**
 * Normalize a parser's output into the stored snapshot.
 * @param {{ vlans?: {id, name}[], ports?: Object[], routed?: {vlan, ip}[] }} input
 * @returns {Object|null} null when the source gave nothing to go on
 */
function makeVlanSnapshot({ vlans = [], ports = [], routed = [] } = {}) {
  const names = new Map();
  for (const v of vlans) {
    if (isVlanId(v?.id) && !names.has(v.id)) names.set(v.id, v.name ? String(v.name) : null);
  }

  const portMap = {};
  for (const p of ports) {
    const key = normalizePortName(p?.port);
    if (!key || !['access', 'trunk', 'routed'].includes(p.mode)) continue;
    const untagged = isVlanId(p.untagged) ? p.untagged : null;
    portMap[key] = {
      port: String(p.port),
      mode: p.mode,
      untagged: p.mode === 'routed' ? null : untagged,
      untaggedKnown: p.mode === 'routed' ? true : p.untaggedKnown !== false,
      tagged: p.mode === 'trunk' ? sortNum((p.tagged || []).filter(isVlanId)) : [],
      allTagged: p.mode === 'trunk' && Boolean(p.allTagged),
    };
  }

  const routedList = [];
  const seenRouted = new Set();
  for (const r of routed) {
    if (!isVlanId(r?.vlan) || seenRouted.has(r.vlan)) continue;
    seenRouted.add(r.vlan);
    routedList.push({ vlan: r.vlan, ip: r.ip || null });
  }
  routedList.sort((a, b) => a.vlan - b.vlan);

  // Where a source lists no VLAN table (Mist), the ports and SVIs are it.
  for (const p of Object.values(portMap)) {
    for (const id of [p.untagged, ...p.tagged]) if (isVlanId(id) && !names.has(id)) names.set(id, null);
  }
  for (const r of routedList) if (!names.has(r.vlan)) names.set(r.vlan, null);

  if (!names.size && !Object.keys(portMap).length) return null;
  return {
    vlans: sortNum([...names.keys()]).map((id) => ({ id, name: names.get(id) })),
    ports: portMap,
    routed: routedList,
  };
}

/** The snapshot's entry for a port as some report named it, or null. */
function findPort(snapshot, port) {
  if (!snapshot?.ports || !port) return null;
  return snapshot.ports[normalizePortName(port)] || null;
}

/** Does the device carry `vlan` at all? true | false | null (no data). */
function deviceCarries(snapshot, vlan) {
  if (!snapshot) return null;
  return snapshot.vlans.some((v) => v.id === vlan);
}

/** Does this port pass `vlan`? true | false | null (no data for the port). */
function portCarries(snapshot, entry, vlan) {
  if (!entry) return null;
  if (entry.mode === 'routed') return false;
  if (entry.untagged === vlan || entry.tagged.includes(vlan)) return true;
  // "allowed all" passes only the VLANs that exist on the switch.
  if (entry.allTagged) return deviceCarries(snapshot, vlan) === true;
  return false;
}

/** Every VLAN the port passes (expanding "allowed all"). */
function portVlans(snapshot, entry) {
  if (!entry || entry.mode === 'routed') return [];
  const ids = [entry.untagged, ...entry.tagged];
  if (entry.allTagged) ids.push(...snapshot.vlans.map((v) => v.id));
  return sortNum(ids.filter(isVlanId));
}

module.exports = {
  vlanIds, isVlanId, makeVlanSnapshot, findPort, deviceCarries, portCarries, portVlans,
};
