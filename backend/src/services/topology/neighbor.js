/**
 * The normalized neighbor every topology collector returns, whatever the
 * transport (AOS-CX REST, Junos NETCONF, SSH CLI, cloud):
 *
 *   {
 *     localPort,     // this device's port, as the device names it
 *     chassisId,     // as advertised: a MAC, an IP, or (CDP) a hostname
 *     portId,        // the neighbor's port, as advertised
 *     portDesc, sysName, sysDesc, mgmtIp,
 *     mac,           // normalized MAC: the chassis id when it is one, else the port MAC
 *     capabilities,  // normalized, enabled ones: bridge | router | wlan-ap | telephone | station | repeater | docsis | other
 *     protocol,      // lldp | cdp | cloud
 *   }
 */

const { normalizeMac } = require('../../utils/mac');

const CAPABILITY_WORDS = {
  bridge: 'bridge',
  switch: 'bridge',
  'trans-bridge': 'bridge',
  'source-route-bridge': 'bridge',
  router: 'router',
  wlan: 'wlan-ap',
  'wlan-ap': 'wlan-ap',
  'wlan-access-point': 'wlan-ap',
  'wlan access point': 'wlan-ap',
  'access-point': 'wlan-ap',
  'access point': 'wlan-ap',
  ap: 'wlan-ap',
  telephone: 'telephone',
  phone: 'telephone',
  station: 'station',
  'station-only': 'station',
  'station only': 'station',
  host: 'station',
  repeater: 'repeater',
  docsis: 'docsis',
  'docsis-cable-device': 'docsis',
  'cable device': 'docsis',
  other: 'other',
};

// IOS `show lldp neighbors detail` single-letter codes.
const CAPABILITY_LETTERS = {
  B: 'bridge', R: 'router', W: 'wlan-ap', T: 'telephone', S: 'station', P: 'repeater', C: 'docsis', O: 'other',
};

/**
 * Normalize a capability list from any dialect: "Bridge, Router" (AOS-CX),
 * "bridge, router" (AOS-S), "B,R" (IOS LLDP), "Router Switch IGMP" (CDP),
 * or an array.
 */
function normalizeCapabilities(input) {
  if (!input) return [];
  const raw = Array.isArray(input) ? input.map(String) : String(input).split(/[,;]/);
  const out = new Set();
  for (let part of raw) {
    part = part.trim();
    if (!part) continue;
    if (/^[A-Z](,[A-Z])*$/.test(part) || /^[A-Z]$/.test(part)) {
      for (const letter of part.split(',')) if (CAPABILITY_LETTERS[letter]) out.add(CAPABILITY_LETTERS[letter]);
      continue;
    }
    const lower = part.toLowerCase();
    if (CAPABILITY_WORDS[lower]) {
      out.add(CAPABILITY_WORDS[lower]);
      continue;
    }
    // CDP separates with spaces ("Router Switch IGMP"); IGMP/CVTA aren't roles.
    for (const word of lower.split(/\s+/)) {
      if (CAPABILITY_WORDS[word]) out.add(CAPABILITY_WORDS[word]);
    }
  }
  return [...out].sort();
}

const blank = (v) => (v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '-');
const clean = (v) => (blank(v) ? null : String(v).trim());

/** Build a normalized neighbor, or null when it lacks a local port or any remote identity. */
function makeNeighbor(fields) {
  const localPort = clean(fields.localPort);
  const chassisId = clean(fields.chassisId) || clean(fields.sysName);
  if (!localPort || !chassisId) return null;
  const firstIp = clean(fields.mgmtIp)?.split(/[,\s]+/).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || null;
  return {
    localPort,
    chassisId,
    portId: clean(fields.portId) || clean(fields.portDesc) || '',
    portDesc: clean(fields.portDesc),
    sysName: clean(fields.sysName),
    sysDesc: clean(fields.sysDesc),
    mgmtIp: firstIp,
    mac: normalizeMac(clean(fields.chassisId)) || normalizeMac(clean(fields.mac)),
    capabilities: normalizeCapabilities(fields.capabilities),
    protocol: fields.protocol || 'lldp',
  };
}

// Long interface names to the short forms Cisco also prints, so both ends of
// a link compare equal ("GigabitEthernet1/0/1" vs "Gi1/0/1").
const IFACE_ABBREVIATIONS = [
  [/^hundredgig(?:abitethernet|e)?/, 'hu'],
  [/^fortygig(?:abitethernet|e)?/, 'fo'],
  [/^twentyfivegig(?:abitethernet|e)?/, 'twe'],
  [/^tengig(?:abitethernet|e)?/, 'te'],
  [/^twogig(?:abitethernet|e)?/, 'tw'],
  [/^fivegig(?:abitethernet|e)?/, 'fi'],
  [/^gigabitethernet/, 'gi'],
  [/^fastethernet/, 'fa'],
  [/^ethernet/, 'eth'],
  [/^port-channel/, 'po'],
];

/** Comparable form of a port name: lower-case, no spaces, Cisco long names shortened. */
function normalizePortName(port) {
  if (!port) return '';
  let p = String(port).trim().toLowerCase().replace(/\s+/g, '');
  for (const [re, short] of IFACE_ABBREVIATIONS) {
    if (re.test(p)) {
      p = p.replace(re, short);
      break;
    }
  }
  return p;
}

module.exports = { normalizeCapabilities, makeNeighbor, normalizePortName };
