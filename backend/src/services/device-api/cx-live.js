/**
 * AOS-CX live-state parsing (pure functions, no I/O).
 *
 * Shapes are taken from a 6200F on ML.10.16.1010, read at REST v10.10 and
 * v10.16 (identical for these resources). Fixtures in
 * tests/fixtures/aos-cx-live/ are trimmed real captures, not spec-derived.
 *
 * Things the captures showed that this module accounts for:
 * - `admin_state` follows the link (it reads "down" when a cable is pulled), so
 *   "administratively enabled" comes from `user_config.admin` instead.
 * - The wildcard `interfaces/{star}/poe_interface` GET nests each port's
 *   resource under an empty-string key: { "1/1/4": { "": {...} } }.
 * - Notification messages carry only the attributes that changed (pd_type and
 *   status arrive separately), keyed by resource URI, with a sequence number
 *   per topic. A collection-level topic reports which resource changed but
 *   with empty values, so per-port topics are what carry link values.
 * - Error counters are sparse: only keys the switch has incremented appear.
 *   No error key was present on the reference switch, so which keys count is
 *   matched by name (error/crc) rather than an exact list.
 */

const { vlanIds } = require('../topology/vlan-membership');
const { effective, portMembership, memberNames } = require('../topology/parsers/aos-cx-vlans');

function decodePort(uriOrName) {
  const match = /\/system\/interfaces\/([^/?]+)/.exec(uriOrName);
  return decodeURIComponent(match ? match[1] : uriOrName);
}

/** Physical Ethernet ports have type "system" on AOS-CX (lag/vlan/ubt excluded). */
function isPhysical(iface) {
  return iface && iface.type === 'system';
}

function normalizeLink(values = {}) {
  const out = {};
  if ('link_state' in values) out.linkUp = values.link_state === 'up';
  if ('link_speed' in values) out.speedMbps = values.link_speed ? Math.round(values.link_speed / 1e6) : null;
  if ('duplex' in values) out.duplex = values.duplex || null;
  if ('user_config' in values) out.adminUp = values.user_config?.admin !== 'down';
  if ('description' in values) out.description = values.description || null;
  return out;
}

function normalizePoe(values = {}) {
  const out = {};
  if ('status' in values) out.status = values.status?.port?.powering_status || null;
  if ('pd_type' in values) out.pdType = values.pd_type || null;
  if ('pse_assigned_class' in values) out.pdClass = values.pse_assigned_class || null;
  if (values.power_mgmt?.port?.pse_assigned_class) out.pdClass = values.power_mgmt.port.pse_assigned_class;
  if (values.measurements && typeof values.measurements.power_drawn === 'number') {
    out.powerW = Math.round(values.measurements.power_drawn * 100) / 100;
  }
  return out;
}

/** Unwrap the wildcard PoE GET's { port: { "": resource } } nesting. */
function unwrapPoe(entry) {
  if (entry && typeof entry === 'object' && Object.keys(entry).length === 1 && '' in entry) return entry[''];
  return entry;
}

// ---------------------------------------------------------------------------
// VLAN membership, live. The same attributes the topology pass reads
// (topology/parsers/aos-cx-vlans.js, whose applied-first rules are reused
// here), but kept current from the notification stream. A notification
// carries only the attributes that changed, so membership is recomputed from
// a per-device context of the last known raw values, not from the update.
//
// A LAG's member ports have no VLAN config of their own (checked on a 6300F,
// FL.10.16: the members' vlan_mode/applied_* are null); they carry the LAG's.
// ---------------------------------------------------------------------------

/** Interface attributes that decide VLAN membership. */
const VLAN_ATTRIBUTES = [
  'vlan_mode', 'vlan_tag', 'vlan_trunks',
  'applied_vlan_mode', 'applied_vlan_tag', 'applied_vlan_trunks',
  'routing',
];

const isLag = (iface) => iface && iface.type === 'lag';

function pickVlanAttributes(values = {}) {
  const out = {};
  for (const attribute of VLAN_ATTRIBUTES) {
    if (attribute in values) out[attribute] = values[attribute];
  }
  return out;
}

/**
 * The raw VLAN attributes of every physical port and LAG, and which LAG each
 * member port belongs to. Built from the interfaces GET; updated in place by
 * parseNotification.
 */
function makeVlanContext(interfaces = {}) {
  const attrs = new Map();
  const lagOf = new Map();
  const lagMembers = new Map();
  for (const [name, iface] of Object.entries(interfaces)) {
    if (!isPhysical(iface) && !isLag(iface)) continue;
    attrs.set(name, pickVlanAttributes(iface));
    if (isLag(iface)) {
      const members = memberNames(iface.interfaces);
      lagMembers.set(name, members);
      for (const member of members) lagOf.set(member, name);
    }
  }
  return { attrs, lagOf, lagMembers };
}

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => a - b);

/**
 * One interface's membership as the Live tab shows it:
 *   { mode: 'access', untagged }
 *   { mode: 'trunk', native, nativeTagged, allowed: [ids], allAllowed }
 *   { mode: 'routed' }
 * or null when the attributes say nothing (e.g. a LAG member's own).
 */
function liveMembership(attrs = {}) {
  const membership = portMembership(attrs);
  if (!membership || membership.mode !== 'trunk') return membership;
  const native = vlanIds(effective(attrs, 'vlan_tag'))[0] ?? null;
  return {
    mode: 'trunk',
    native,
    nativeTagged: native !== null && membership.untagged === null,
    allowed: sortIds(vlanIds(effective(attrs, 'vlan_trunks'))),
    allAllowed: membership.allTagged,
  };
}

/** A port's row `vlan`; a LAG member gets the LAG's membership plus `lag`. */
function portVlan(context, port) {
  if (!context) return null;
  const lag = context.lagOf.get(port);
  if (lag) return { ...(liveMembership(context.attrs.get(lag)) || { mode: null }), lag };
  return liveMembership(context.attrs.get(port));
}

/**
 * Build the normalized port list from the interfaces collection GET and the
 * wildcard poe_interface GET.
 * @returns {Array<{port, description, adminUp, linkUp, speedMbps, duplex, vlan, poe}>}
 */
function normalizePortState(interfaces = {}, poeByPort = {}, vlanContext = makeVlanContext(interfaces)) {
  return Object.entries(interfaces)
    .filter(([, iface]) => isPhysical(iface))
    .map(([name, iface]) => {
      const poeRaw = unwrapPoe(poeByPort[name]);
      return {
        port: name,
        description: null,
        adminUp: true,
        linkUp: false,
        speedMbps: null,
        duplex: null,
        ...normalizeLink(iface),
        vlan: portVlan(vlanContext, name),
        poe: poeRaw ? { status: null, pdType: null, pdClass: null, powerW: null, ...normalizePoe(poeRaw) } : null,
      };
    })
    .sort((a, b) => comparePorts(a.port, b.port));
}

const sameMembers = (a = [], b = []) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Apply one interface resource's VLAN values to the context.
 * @returns {{ vlan: Object|null|undefined, fanOut: Array, resync: boolean }}
 *   `vlan` - this physical port's new row `vlan` (undefined: unchanged)
 *   `fanOut` - one update per member port when a LAG's VLANs changed
 *   `resync` - the LAG layout changed: take a fresh snapshot
 */
function applyVlanValues(context, port, values) {
  const result = { vlan: undefined, fanOut: [], resync: false };
  const lag = context.lagMembers.has(port);
  if (lag && 'interfaces' in values && !sameMembers(context.lagMembers.get(port), memberNames(values.interfaces))) {
    result.resync = true;
    return result;
  }
  const picked = pickVlanAttributes(values);
  if (!Object.keys(picked).length) return result;
  context.attrs.set(port, { ...(context.attrs.get(port) || {}), ...picked });

  if (lag) {
    result.fanOut = context.lagMembers.get(port).map((member) => ({
      port: member, operation: 'modified', link: { vlan: portVlan(context, member) },
    }));
    return result;
  }
  result.vlan = portVlan(context, port);
  // A port that stopped carrying VLANs without becoming routed most likely
  // joined a LAG created after the subscription: re-read the layout.
  if (!result.vlan && !context.lagOf.has(port)) result.resync = true;
  return result;
}

/** Natural sort for "1/1/10" vs "1/1/2". */
function comparePorts(a, b) {
  const pa = a.split(/[/:]/).map(Number);
  const pb = b.split(/[/:]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return a.localeCompare(b);
}

/**
 * Parse one notification frame into normalized partial updates.
 *
 * With a VLAN context (makeVlanContext, kept by the caller per device), VLAN
 * values update it and the affected rows get a recomputed `link.vlan`; a LAG
 * resource fans out to one update per member port. An update with
 * `resync: true` means the port/LAG layout changed and a snapshot is due.
 * @returns {{ type, updates: Array<{port, link?, poe?, operation, resync?}>, sequences: Array<{topic, seq}> }}
 */
function parseNotification(message, vlanContext = null) {
  const updates = [];
  const sequences = [];
  for (const topic of message?.data || []) {
    if (typeof topic.sequence_number === 'number') {
      sequences.push({ topic: topic.topicname, seq: topic.sequence_number });
    }
    for (const resource of topic.resources || []) {
      const port = decodePort(resource.uri || '');
      const values = resource.values || {};
      const update = { port, operation: resource.operation || '' };
      const fanOut = [];
      if (/\/poe_interface$/.test(resource.uri)) {
        const poe = normalizePoe(values);
        if (Object.keys(poe).length) update.poe = poe;
      } else {
        const link = normalizeLink(values);
        if (vlanContext) {
          const vlan = applyVlanValues(vlanContext, port, values);
          if (vlan.vlan !== undefined) link.vlan = vlan.vlan;
          if (vlan.resync) update.resync = true;
          fanOut.push(...vlan.fanOut);
        }
        if (Object.keys(link).length) update.link = link;
      }
      updates.push(update, ...fanOut);
    }
  }
  return { type: message?.type, updates, sequences };
}

/**
 * Sum the sparse error counters, ignoring the "no_errors" totals. Forwarding
 * engine discards (fe_if_in_discard_packets: e.g. frames for VLANs the port
 * doesn't carry) are not errors; `show interface` doesn't count them either,
 * and on a healthy trunk port they run into the hundreds of thousands.
 */
function errorCount(stats) {
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== 'number' || /no_errors/.test(key)) continue;
    if (/(error|crc)/.test(key)) total += value;
  }
  return total;
}

/** Cumulative counters per physical port from an interfaces GET with statistics. */
function normalizeCounters(interfaces = {}) {
  const out = {};
  for (const [name, iface] of Object.entries(interfaces)) {
    if (!isPhysical(iface) || !iface.statistics) continue;
    const s = iface.statistics;
    out[name] = {
      rxBytes: s.rx_bytes ?? s.if_hc_in_bytes ?? null,
      txBytes: s.tx_bytes ?? s.if_hc_out_bytes ?? null,
      rxPackets: s.rx_packets ?? null,
      txPackets: s.tx_packets ?? null,
      errors: errorCount(s),
    };
  }
  return out;
}

module.exports = {
  VLAN_ATTRIBUTES,
  decodePort,
  makeVlanContext,
  normalizePortState,
  normalizeCounters,
  normalizePoe,
  parseNotification,
  unwrapPoe,
  comparePorts,
};
