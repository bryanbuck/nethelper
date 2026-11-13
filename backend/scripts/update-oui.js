#!/usr/bin/env node
/**
 * Regenerate src/data/oui.tsv, the MAC vendor table, from the IEEE
 * Registration Authority's public listings (MA-L, MA-M, MA-S). Only the
 * prefix and a shortened organization name are kept, never the address.
 * Run it before a release (CONTRIBUTING.md "Releasing") and commit the result.
 *
 * IEEE does not assert copyright in the listing or restrict its distribution;
 * it asks users to obtain it from IEEE and update it regularly, so this
 * downloads from IEEE directly.
 *
 * Usage (from backend/):
 *   node scripts/update-oui.js [--from <dir>] [--out <file>]
 *     --from  read oui.csv, mam.csv and oui36.csv from a directory instead of
 *             downloading them (offline hosts, tests)
 *     --out   where to write (default src/data/oui.tsv)
 */
const fs = require('fs');
const path = require('path');
const { buildEntries, formatTable, DEFAULT_FILE } = require('../src/utils/oui');

const LISTS = [
  { key: 'MA-L', file: 'oui.csv', url: 'https://standards-oui.ieee.org/oui/oui.csv', min: 30000 },
  { key: 'MA-M', file: 'mam.csv', url: 'https://standards-oui.ieee.org/oui28/mam.csv', min: 4000 },
  { key: 'MA-S', file: 'oui36.csv', url: 'https://standards-oui.ieee.org/oui36/oui36.csv', min: 4000 },
];
// IEEE's server refuses some non-browser clients; this identifies the tool
// without anything about the install.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; NetHelper-oui-update; +https://github.com/bryanbuck/nethelper)',
  Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8',
};

function parseArgs(argv) {
  const opts = { out: DEFAULT_FILE, from: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') opts.from = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return opts;
}

async function download(list) {
  const res = await fetch(list.url, { headers: HEADERS, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${list.url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Build the table text from the three lists' CSV text.
 * @param texts  { 'MA-L': csv, 'MA-M': csv, 'MA-S': csv }
 * @param opts.minimums  per list, fewer rows than this is refused (a cut download)
 */
function build(texts, { downloadedAt, minimums = {} } = {}) {
  const all = [];
  const counts = {};
  for (const list of LISTS) {
    const entries = buildEntries(texts[list.key] || '');
    const min = minimums[list.key] ?? 0;
    if (entries.length < min) throw new Error(`${list.key}: only ${entries.length} entries (expected at least ${min}); not writing`);
    counts[list.key] = entries.length;
    all.push(...entries);
  }
  return { text: formatTable(all, { downloadedAt, counts }), counts };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/update-oui.js [--from <dir>] [--out <file>]');
    return;
  }
  const texts = {};
  for (const [i, list] of LISTS.entries()) {
    if (opts.from) texts[list.key] = fs.readFileSync(path.join(opts.from, list.file), 'utf8');
    else {
      if (i) await new Promise((r) => { setTimeout(r, 2000); }); // be polite to IEEE's server
      console.log(`Downloading ${list.key} (${list.url})`);
      texts[list.key] = await download(list);
    }
  }
  const downloadedAt = new Date().toISOString().slice(0, 10);
  const minimums = Object.fromEntries(LISTS.map((l) => [l.key, l.min]));
  const { text, counts } = build(texts, { downloadedAt, minimums });
  const tmp = `${opts.out}.partial`;
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, opts.out);
  console.log(`Wrote ${opts.out}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`update-oui: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { build, parseArgs, LISTS };
