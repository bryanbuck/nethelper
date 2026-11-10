/**
 * Port Identity: wired clients as the clouds report them (live shapes,
 * 2026-11-10; fixtures central-live/clients.json, mist-live/wired-clients-search.json).
 *
 * Both return the same observation shape, keyed to their switch:
 *   { switch: { serial?, mac? }, port, mac, ip, hostname, username, vendor,
 *     vlan, profile, sources, present, seenAt, firstSeen }
 *
 * `present` is the cloud's own view: Central `status` Connected; Mist a
 * `when` inside the read window. A cloud listing is not proof the client is
 * there now (Mist kept listing an offline switch's client for days; Central
 * called clients "Disconnected" that were still in the switch's MAC table),
 * so the collector prefers the switch's own table when it can read it.
 */

const { normalizeMac } = require('../../../utils/device-key');

/** Strip NUL padding and blanks; a hostname that is just a MAC is no hostname. */
function cleanName(value) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/\u0000/g, '').trim();
  if (!s || normalizeMac(s)) return null;
  return s;
}

function date(value) {
  if (value === null || value === undefined || value === '' || value === '0' || value === 0) return null;
  const d = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function vlanNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 4095 ? n : null;
}

/** Locally administered bit set: a randomised/private MAC, its OUI names nobody. */
function isRandomMac(mac) {
  const m = normalizeMac(mac);
  return !!m && (parseInt(m.slice(0, 2), 16) & 0x02) === 0x02;
}

/**
 * Central `GET /network-monitoring/v1alpha1/clients` items -> wired observations.
 * @param items  the `items` of every page
 * @param now    the read time (a connected client is seen now)
 */
function parseCentralWiredClients(items, now = new Date()) {
  const out = [];
  for (const item of items || []) {
    if (String(item?.type).toLowerCase() !== 'wired') continue;
    const mac = normalizeMac(item.mac);
    const port = item.port ? String(item.port) : null;
    if (!mac || !port || !item.connectedDeviceSerial) continue;
    const present = String(item.status).toLowerCase() === 'connected';
    const profile = {
      category: item.category || null,
      function: item.function || null,
      os: item.modelOs || null,
      vendor: item.vendor || null,
      source: 'Aruba Central',
    };
    out.push({
      switch: { serial: item.connectedDeviceSerial, name: item.connectedTo || null },
      port,
      mac,
      ip: /^\d{1,3}(\.\d{1,3}){3}$/.test(item.ipv4 || '') ? item.ipv4 : null,
      hostname: cleanName(item.hostName),
      username: cleanName(item.userName),
      vendor: item.manufacturer || null,
      vlan: vlanNumber(item.vlanId),
      profile: Object.values(profile).filter(Boolean).length > 1 ? profile : null,
      sources: ['cloud-wired'],
      present,
      seenAt: present ? now : date(item.lastSeenAt),
      firstSeen: present ? date(item.connectedSince) : null,
    });
  }
  return out;
}

/**
 * Mist `GET /orgs/:org/wired_clients/search` results -> wired observations,
 * one per switch port the client was seen on.
 * @param results  every page's `results`
 * @param since    start of the read window: a later `when` counts as present
 */
function parseMistWiredClients(results, since) {
  const out = [];
  const sinceMs = since ? new Date(since).getTime() : 0;
  for (const r of results || []) {
    const mac = normalizeMac(r?.mac);
    if (!mac) continue;
    const hostname = cleanName(r.last_hostname) || cleanName((r.hostname || [])[0]);
    const random = r.random_mac === true || isRandomMac(mac);
    for (const p of r.device_mac_port || []) {
      const switchMac = normalizeMac(p.device_mac);
      if (!switchMac || !p.port_id) continue;
      const seenAt = date(p.when) || date(r.timestamp);
      out.push({
        switch: { mac: switchMac },
        port: p.port_id,
        mac,
        ip: p.ip || null,
        hostname,
        username: cleanName((r.username || [])[0]),
        vendor: random ? null : (r.manufacture || null),
        vlan: vlanNumber(p.vlan),
        profile: { vendor: r.manufacture || null, randomMac: random, source: 'Juniper Mist' },
        sources: p.source === 'lldp' ? ['cloud-wired', 'lldp'] : ['cloud-wired'],
        present: !!seenAt && seenAt.getTime() >= sinceMs,
        seenAt,
        firstSeen: date(p.start),
      });
    }
  }
  return out;
}

module.exports = {
  parseCentralWiredClients, parseMistWiredClients, cleanName, isRandomMac,
};
