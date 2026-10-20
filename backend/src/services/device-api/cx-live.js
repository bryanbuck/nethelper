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

/**
 * Build the normalized port list from the interfaces collection GET and the
 * wildcard poe_interface GET.
 * @returns {Array<{port, description, adminUp, linkUp, speedMbps, duplex, poe}>}
 */
function normalizePortState(interfaces = {}, poeByPort = {}) {
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
        poe: poeRaw ? { status: null, pdType: null, pdClass: null, powerW: null, ...normalizePoe(poeRaw) } : null,
      };
    })
    .sort((a, b) => comparePorts(a.port, b.port));
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
 * @returns {{ type, updates: Array<{port, link?, poe?, operation}>, sequences: Array<{topic, seq}> }}
 */
function parseNotification(message) {
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
      if (/\/poe_interface$/.test(resource.uri)) {
        const poe = normalizePoe(values);
        if (Object.keys(poe).length) update.poe = poe;
      } else {
        const link = normalizeLink(values);
        if (Object.keys(link).length) update.link = link;
      }
      updates.push(update);
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
  decodePort,
  normalizePortState,
  normalizeCounters,
  normalizePoe,
  parseNotification,
  unwrapPoe,
  comparePorts,
};
