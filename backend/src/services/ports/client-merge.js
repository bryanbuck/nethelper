/**
 * Port Identity: turn one switch's reads into the observations client-aging
 * applies (pure, no I/O).
 *
 * Presence: the switch's own MAC table when it was read (authoritative: a
 * switch keeps only MACs active in the last ~5 minutes), else the cloud's
 * view (Central "Connected", Mist `when` in the window). Identity (hostname,
 * user, profile, IP) comes from the clouds and from ARP tables anywhere in
 * the fleet, whichever source has it.
 *
 * Port classes, from what the switch hears on the port:
 *   ap      LLDP neighbor advertising wlan-ap, or an inventory AP's MAC;
 *           only the AP is kept, what is bridged behind it is counted
 *   uplink  LLDP neighbor that bridges or routes and isn't a phone (any
 *           switch or gateway, managed or not), an inventory switch/gateway
 *           MAC, or a port AOS-CX flags `network_infra_mac`
 *   edge    everything else, including a phone (bridge + telephone) with a
 *           PC behind it
 */

const { normalizePortName } = require('../topology/neighbor');
const { normalizeMac } = require('../../utils/device-key');
const { isRandomMac } = require('./parsers/cloud-clients');

const INFRA_TYPES = new Set(['switch', 'gateway', 'controller', 'router', 'firewall']);

function caps(link) {
  return Array.isArray(link?.remoteCapabilities) ? link.remoteCapabilities : [];
}

/**
 * @param links          the switch's active DeviceLink rows
 * @param infraPorts     ports AOS-CX flagged network_infra_mac (port keys)
 * @param observations   the read's observations (any port spelling)
 * @param inventoryByMac Map normalized MAC -> { id, type } of inventory devices
 * @returns {{ uplinkPorts: Set<string>, apPorts: Map<string, string>, lldp: Map<string, Object> }}
 *   port keys are normalizePortName(); lldp is keyed "<port>|<mac>"
 */
function classifyPorts({ links = [], infraPorts = new Set(), observations = [], inventoryByMac = new Map() } = {}) {
  const uplinkPorts = new Set();
  const apPorts = new Map();
  const lldp = new Map();
  for (const link of links) {
    const port = normalizePortName(link.localPort);
    const c = caps(link);
    const remoteMac = normalizeMac(link.remoteMac);
    const known = remoteMac ? inventoryByMac.get(remoteMac) : null;
    if (c.includes('telephone')) {
      // fall through to edge
    } else if (c.includes('wlan-ap') || known?.type === 'access_point') {
      if (remoteMac) apPorts.set(port, remoteMac);
      continue;
    } else if (c.includes('bridge') || c.includes('router') || INFRA_TYPES.has(known?.type)) {
      uplinkPorts.add(port);
      continue;
    }
    if (remoteMac) {
      lldp.set(`${port}|${remoteMac}`, {
        sysName: link.remoteSysName || null, capabilities: c, portDesc: link.remotePortDesc || null,
      });
    }
  }
  for (const port of infraPorts) if (!apPorts.has(port)) uplinkPorts.add(port);
  for (const o of observations) {
    const known = inventoryByMac.get(normalizeMac(o.mac));
    if (!known) continue;
    const port = normalizePortName(o.port);
    if (known.type === 'access_point') {
      if (!apPorts.has(port)) apPorts.set(port, normalizeMac(o.mac));
    } else if (INFRA_TYPES.has(known.type)) {
      uplinkPorts.add(port);
    }
  }
  for (const port of apPorts.keys()) uplinkPorts.delete(port);
  return { uplinkPorts, apPorts, lldp };
}

/**
 * The observations whose presence counts for this read.
 * @param direct  { observations } from the switch's MAC table, or null
 * @param cloud   the cloud's observations for this switch, or null
 */
function presenceObservations({ direct = null, cloud = null } = {}) {
  if (!direct) return (cloud || []).filter((o) => o.present).map((o) => ({ ...o }));
  const cloudByMac = new Map();
  for (const c of cloud || []) {
    if (!cloudByMac.has(c.mac)) cloudByMac.set(c.mac, []);
    cloudByMac.get(c.mac).push(c);
  }
  const newest = (a, b) => ((b.seenAt?.getTime?.() || 0) - (a.seenAt?.getTime?.() || 0));
  return direct.observations.map((o) => {
    const entries = cloudByMac.get(o.mac);
    if (!entries) return { ...o };
    // The cloud's entry for the port the switch sees, else its newest.
    const port = normalizePortName(o.port);
    const c = entries.filter((e) => normalizePortName(e.port) === port).sort(newest)[0] || [...entries].sort(newest)[0];
    const samePort = normalizePortName(c.port) === port;
    return {
      ...o,
      ip: o.ip || c.ip || null,
      hostname: c.hostname || null,
      username: c.username || null,
      vendor: o.vendor || c.vendor || null,
      profile: c.profile || null,
      vlan: o.vlan ?? c.vlan ?? null,
      // The cloud's "connected since" can predate NetHelper's first read.
      firstSeen: samePort ? c.firstSeen || null : null,
      sources: samePort ? [...new Set([...(o.sources || []), ...c.sources])] : o.sources,
    };
  });
}

/**
 * Fill IP (fleet-wide ARP) and LLDP identity where still missing, and set the
 * vendor from the MAC's registered prefix (curated, then IEEE), falling back
 * to the cloud's manufacturer only when the prefix is unknown.
 * @param arpByMac     Map MAC -> ip (every routing switch's ARP, cloud IPs)
 * @param lldp         classifyPorts().lldp
 * @param vendorOf     (mac) => vendor name or null
 */
function enrich(observations, { arpByMac = new Map(), lldp = new Map(), vendorOf = () => null } = {}) {
  return observations.map((o) => {
    const out = { ...o, sources: [...(o.sources || [])] };
    if (!out.ip && arpByMac.has(o.mac)) {
      out.ip = arpByMac.get(o.mac);
      out.sources.push('arp');
    }
    const l = lldp.get(`${normalizePortName(o.port)}|${o.mac}`);
    if (l) {
      out.lldp = l;
      if (!out.sources.includes('lldp')) out.sources.push('lldp');
    }
    // The registry names who made the network chip (a fact); a cloud's
    // manufacturer is its guess and stays in `profile`. A random MAC has none.
    out.vendor = isRandomMac(o.mac) ? null : (vendorOf(o.mac) || out.vendor || null);
    if (isRandomMac(o.mac)) out.profile = { ...(out.profile || {}), randomMac: true };
    out.sources = [...new Set(out.sources)].sort();
    return out;
  });
}

/** Link state per port key from parseCxInterfaces(), for ports with a known state. */
function linkStates(ifaces) {
  const map = new Map();
  for (const [key, p] of ifaces?.ports || []) {
    if (p.type === 'system' && typeof p.linkUp === 'boolean') map.set(key, p.linkUp);
  }
  return map;
}

module.exports = {
  classifyPorts, presenceObservations, enrich, linkStates,
};
