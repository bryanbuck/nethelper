'use strict';

/**
 * MAC vendor names from the IEEE Registration Authority's public listings
 * (MA-L 24-bit, MA-M 28-bit, MA-S 36-bit prefixes), bundled as
 * src/data/oui.tsv and refreshed with `npm run oui:update`
 * (scripts/update-oui.js). IEEE does not assert copyright in the listing or
 * restrict its distribution; it asks users to fetch it from IEEE and refresh
 * it regularly, which the update script does.
 *
 * `lookup(mac)` matches the longest prefix (36, then 28, then 24 bits). A
 * locally administered (random/private) MAC has no vendor. The table is
 * loaded on first use; a missing or unreadable file logs once and every
 * lookup returns null.
 *
 * The builders (parseCsv, shortenName, buildEntries, formatTable) are pure and
 * shared with the update script and the tests.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'oui.tsv');
const PREFIX_LENGTHS = [9, 7, 6]; // hex digits: MA-S, MA-M, MA-L

let file = DEFAULT_FILE;
let table = null; // Map prefix -> name
let info = null;
let failed = false;

/** Parse RFC 4180 CSV (quoted fields, doubled quotes, newlines in quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// Well-known organizations, matched at the start of the registered name, get
// the name people use. Anything else is shortened by the rules below.
const OVERRIDES = [
  [/^apple\b/i, 'Apple'],
  [/^cisco systems\b/i, 'Cisco'],
  [/^cisco meraki\b/i, 'Cisco Meraki'],
  [/^aruba\b/i, 'Aruba Networks (HPE)'],
  [/^hewlett packard enterprise\b/i, 'Hewlett Packard Enterprise'],
  [/^hewlett[- ]packard\b/i, 'HP'],
  [/^juniper networks\b/i, 'Juniper Networks'],
  [/^dell\b/i, 'Dell'],
  [/^intel corporat/i, 'Intel'],
  [/^samsung electronics\b/i, 'Samsung'],
  [/^raspberry pi\b/i, 'Raspberry Pi'],
  [/^tp-link\b/i, 'TP-Link'],
  [/^huawei\b/i, 'Huawei'],
  [/^icann, iana\b/i, 'IANA'],
  [/^beijing xiaomi\b|^xiaomi\b/i, 'Xiaomi'],
  [/^guangdong oppo\b/i, 'OPPO'],
  [/^amazon technologies\b/i, 'Amazon'],
  [/^google\b/i, 'Google'],
  [/^microsoft\b/i, 'Microsoft'],
  [/^vmware\b/i, 'VMware'],
  [/^american power conversion\b/i, 'APC'],
  [/^ubiquiti\b/i, 'Ubiquiti'],
  [/^super micro computer\b/i, 'Supermicro'],
  [/^lenovo\b/i, 'Lenovo'],
  [/^brother industries\b/i, 'Brother'],
  [/^xerox\b/i, 'Xerox'],
  [/^lexmark\b/i, 'Lexmark'],
  [/^espressif\b/i, 'Espressif'],
  [/^synology\b/i, 'Synology'],
  [/^yealink\b/i, 'Yealink'],
  [/^polycom\b/i, 'Polycom'],
  [/^sonos\b/i, 'Sonos'],
  [/^ruckus\b/i, 'Ruckus'],
  [/^fortinet\b/i, 'Fortinet'],
  [/^palo alto networks\b/i, 'Palo Alto Networks'],
  [/^extreme networks\b/i, 'Extreme Networks'],
  [/^arista networks\b/i, 'Arista'],
  [/^netgear\b/i, 'Netgear'],
  [/^d-link\b/i, 'D-Link'],
  [/^zte corporation\b/i, 'ZTE'],
  [/^lg electronics\b/i, 'LG'],
  [/^sony\b/i, 'Sony'],
  [/^canon\b/i, 'Canon'],
  [/^seiko epson\b/i, 'Epson'],
  [/^ricoh\b/i, 'Ricoh'],
  [/^hikvision\b|^hangzhou hikvision\b/i, 'Hikvision'],
  [/^zhejiang dahua\b/i, 'Dahua'],
  [/^axis communications\b/i, 'Axis'],
];

// Names that identify nobody: blocks IEEE re-divided into MA-M/MA-S, and
// private registrations.
const NOBODY = [/^ieee registration authority\b/i, /^private$/i];

// Legal-form suffixes, removed from the end one at a time.
const SUFFIX = new RegExp(
  '(?:[\\s,]+|(?<=\\)))(?:'
  + [
    'co\\.?\\s*,?\\s*ltd', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited',
    'llc', 'l\\.l\\.c', 'gmbh(?:\\s*&\\s*co\\.?\\s*kg)?', 'kg', 'ag', 's\\.?a\\.?s', 's\\.?a', 's\\.?p\\.?a',
    's\\.?r\\.?l', 'b\\.?v', 'n\\.?v', 'ab', 'oy', 'a/s', 'as', 'pty', 'plc', 'k\\.?k', 'sdn\\.?\\s*bhd',
  ].join('|')
  + ')\\.?$',
  'i',
);

/** A registered organization name as people would say it; null for nobody. */
function shortenName(raw) {
  let name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name || NOBODY.some((re) => re.test(name))) return null;
  for (const [re, short] of OVERRIDES) if (re.test(name)) return short;
  for (let i = 0; i < 4; i += 1) {
    const next = name.replace(SUFFIX, '').replace(/[\s,.&]+$/, '');
    if (next === name || !next) break;
    name = next;
  }
  // ALL-CAPS names (no lowercase letters at all) are title-cased; short words
  // stay as acronyms (ZTE, LG, TCL).
  if (!/[a-z]/.test(name) && /[A-Z]{4}/.test(name)) {
    name = name.replace(/[A-Z]+/g, (w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()));
  }
  return name || null;
}

/**
 * IEEE registry CSV text -> [prefix, name] pairs. The CSV's columns are
 * Registry, Assignment, Organization Name, Organization Address; the address
 * is never kept.
 */
function buildEntries(csvText) {
  const rows = parseCsv(csvText);
  const header = rows.shift() || [];
  const iAssign = header.findIndex((h) => /^assignment$/i.test(h.trim()));
  const iName = header.findIndex((h) => /^organization name$/i.test(h.trim()));
  if (iAssign < 0 || iName < 0) throw new Error(`Unexpected IEEE CSV header: ${header.join(',')}`);
  const out = [];
  for (const r of rows) {
    const prefix = String(r[iAssign] || '').trim().toUpperCase();
    if (!/^[0-9A-F]{6}$|^[0-9A-F]{7}$|^[0-9A-F]{9}$/.test(prefix)) continue;
    const name = shortenName(r[iName]);
    if (name) out.push([prefix, name.replace(/[\t\r\n]/g, ' ')]);
  }
  return out;
}

/** The bundled file's text: comment header, then sorted `prefix<TAB>name` lines. */
function formatTable(entries, { downloadedAt, counts = {} } = {}) {
  const unique = new Map(entries);
  const lines = [...unique].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, n]) => `${p}\t${n}`);
  const header = [
    '# MAC address prefixes -> organization names (shortened), from the IEEE Registration Authority',
    '# public listings MA-L (oui.csv), MA-M (mam.csv) and MA-S (oui36.csv): https://standards-oui.ieee.org/',
    '# IEEE does not assert copyright in the public listing or restrict its distribution; it asks users to',
    '# obtain it from IEEE and update it regularly. Regenerate with `npm run oui:update` (scripts/update-oui.js).',
    `# downloaded: ${downloadedAt || 'unknown'}`,
    `# entries: ${lines.length}${Object.keys(counts).length ? ` (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`,
  ];
  return `${header.join('\n')}\n${lines.join('\n')}\n`;
}

function load() {
  if (table || failed) return table;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const map = new Map();
    let downloadedAt = null;
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (line.startsWith('#')) {
        const m = /^# downloaded: (.+)$/.exec(line);
        if (m) downloadedAt = m[1].trim();
        continue;
      }
      const tab = line.indexOf('\t');
      if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
    }
    table = map;
    info = { downloadedAt, entries: map.size };
  } catch (error) {
    failed = true;
    // Required lazily so the builders stay usable without the app's config.
    try {
      require('./logger').warn(`MAC vendor table unavailable (${file}): ${error.message}`);
    } catch {
      // no logger outside the app
    }
  }
  return table;
}

/** Locally administered bit: a random/private MAC, which no registry assigns. */
function isLocallyAdministered(hex) {
  return (parseInt(hex.slice(0, 2), 16) & 0x02) === 0x02;
}

/** The organization a MAC's prefix is registered to, or null. Never throws. */
function lookup(mac) {
  const hex = String(mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length < 6 || isLocallyAdministered(hex)) return null;
  const map = load();
  if (!map) return null;
  for (const len of PREFIX_LENGTHS) {
    if (hex.length < len) continue;
    const name = map.get(hex.slice(0, len));
    if (name) return name;
  }
  return null;
}

/** { downloadedAt, entries } of the loaded table, or null. */
function tableInfo() {
  load();
  return info;
}

/** Tests: point at another file (null = the bundled one) and forget the loaded table. */
function _setFile(next) {
  file = next || DEFAULT_FILE;
  table = null;
  info = null;
  failed = false;
}

module.exports = {
  lookup, tableInfo, parseCsv, shortenName, buildEntries, formatTable, DEFAULT_FILE, _setFile,
};
