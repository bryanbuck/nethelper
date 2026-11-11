#!/usr/bin/env node
/**
 * READ-ONLY probe of a cloud integration's API, for checking response shapes
 * against what the providers read (first live contact, new parsers).
 *
 * SAFETY:
 *  - Sends GET requests only. Any other method is refused before it is sent.
 *  - --stream (Mist) opens the org's WebSocket and sends `subscribe` messages
 *    only, then closes after --seconds.
 *  - Secrets in replies (PSKs, passwords, tokens) are always replaced by
 *    fingerprints (utils/config-redact.js), even in the "raw" files.
 *  - Output goes to --out, which must be outside the repository.
 *
 * Usage (from backend/):
 *   node scripts/probe-cloud.js --integration <id|name> --out <dir> [--get <path>]... [--no-builtin]
 *   node scripts/probe-cloud.js --integration <id|name> --out <dir> --no-builtin \
 *     --stream '/sites/{site}/stats/devices' [--stream …] [--seconds 120]
 *
 * `{site}` in a stream channel expands to every site of the org. The stream's
 * messages are written as stream.json / stream.anon.json, each with the
 * milliseconds since the subscribe and `data` parsed when Mist sent a string.
 *
 * For Juniper Mist the built-in set covers every endpoint mist.provider.js
 * reads plus candidates for neighbors and events. For Cisco Meraki it covers
 * every endpoint meraki.provider.js reads: the organization, up to three
 * networks, and one switch, access point and appliance (paths are relative to
 * the API base, e.g. --get /organizations). For Aruba Central there is no
 * built-in set; pass --get paths. Each reply is written twice:
 *   <name>.json       secrets redacted, identifiers kept (for comparing by eye)
 *   <name>.anon.json  identifiers anonymised too (serials, MACs, ids, names,
 *                     emails, public IPs, locations), ready to become a fixture
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const { connectDatabase, disconnectDatabase, getPrisma } = require('../src/config/database');
const { connectRedis, disconnectRedis } = require('../src/config/redis');
const CloudProviderFactory = require('../src/services/cloud-providers/cloud-provider-factory');
const { redactConfigSecrets } = require('../src/utils/config-redact');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { gets: [], streams: [], seconds: 120, builtin: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--integration') args.integration = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--get') args.gets.push(argv[++i]);
    else if (arg === '--no-builtin') args.builtin = false;
    else if (arg === '--stream') args.streams.push(argv[++i]);
    else if (arg === '--seconds') args.seconds = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.integration || !args.out) {
    throw new Error('Usage: probe-cloud.js --integration <id|name> --out <dir> [--get <path>]... [--no-builtin]');
  }
  const out = path.resolve(args.out);
  if (out === REPO_ROOT || out.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`--out must be outside the repository (${REPO_ROOT})`);
  }
  args.out = out;
  return args;
}

// ---------------------------------------------------------------------------
// Anonymisation: consistent replacements, so relations between replies
// (inventory mac ↔ stats mac, site_id ↔ sites[].id) survive.
// ---------------------------------------------------------------------------
const SERIAL_KEY = /serial(number|_number)?$/;

class Anonymiser {
  constructor() {
    this.maps = new Map();
    this.literals = new Map();
  }

  /** Replace this exact string wherever it appears as a value (org or tenant names). */
  addLiteral(value, replacement) {
    if (value) this.literals.set(value, replacement);
  }

  replace(kind, value, make) {
    if (!this.maps.has(kind)) this.maps.set(kind, new Map());
    const map = this.maps.get(kind);
    if (!map.has(value)) map.set(value, make(map.size + 1));
    return map.get(value);
  }

  mac(value) {
    const bare = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
    const fake = this.replace('mac', bare, (n) => `5c5b35${n.toString(16).padStart(6, '0')}`);
    if (value.includes(':')) return fake.match(/../g).join(':');
    if (value.includes('-')) return fake.match(/../g).join('-');
    return value === value.toUpperCase() ? fake.toUpperCase() : fake;
  }

  uuid(value) {
    // Mist device ids embed the MAC (00000000-0000-0000-1000-<mac>); keep that link.
    const deviceId = value.match(/^00000000-0000-0000-1000-([0-9a-f]{12})$/i);
    if (deviceId) return `00000000-0000-0000-1000-${this.mac(deviceId[1])}`;
    return this.replace('uuid', value.toLowerCase(), (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`);
  }

  ip(value) {
    const private_ = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(value);
    return private_ ? value : this.replace('ip', value, (n) => `203.0.113.${n}`);
  }

  serial(value) {
    if (!value) return value; // an empty serial is no identifier (and "" is also a map key)
    return this.replace('serial', value, (n) => `SN${String(n).padStart(6, '0')}`);
  }

  /**
   * First pass over every reply: learn the serials, so a serial referenced
   * under another key (Central topology links' `from`/`to`) maps the same way.
   */
  learn(node, key = '') {
    if (Array.isArray(node)) node.forEach((item) => this.learn(item, key));
    else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => this.learn(v, k));
    else if (typeof node === 'string' && SERIAL_KEY.test(key.toLowerCase())) this.serial(node);
  }

  /** A learnt serial, a derived id (`<serial>_<n>`, Central WAN uplinks) or Central's `tpd_<mac>`. */
  knownSerial(value) {
    const serials = this.maps.get('serial');
    if (!value) return null;
    if (serials?.has(value)) return serials.get(value);
    const derived = value.match(/^(.+)_(\d+)$/);
    if (derived && serials?.has(derived[1])) return `${serials.get(derived[1])}_${derived[2]}`;
    const tpd = value.match(/^tpd_([0-9a-f]{12})$/i);
    return tpd ? `tpd_${this.mac(tpd[1])}` : null;
  }

  string(key, value) {
    const k = key.toLowerCase();
    if (this.literals.has(value)) return this.literals.get(value);
    if (SERIAL_KEY.test(k)) return this.serial(value);
    const known = this.knownSerial(value);
    if (known) return known;
    if (/email/.test(k)) return this.replace('email', value, (n) => `user${n}@example.com`);
    if (/^(address|latlng|lat|lng|street|city|zip|postal)/.test(k)) return '[anonymised]';
    if (/^(org_name|orgname)$/.test(k)) return this.replace('org', value, (n) => `Org ${n}`);
    // Meraki: dashboard links name the org's shard and ids; enrollment strings are per network.
    if (/^(url|networkurl|enrollmentstring)$/.test(k)) return '[anonymised]';
    if (/^(first_name|last_name|magic)$/.test(k) || /uid_(namespace|instance)$/.test(k)) return '[anonymised]';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return this.uuid(value);
    // Bare 12-hex strings are MACs in these APIs (Mist even keys stats `_id` by one).
    if (/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value) || /^[0-9a-f]{12}$/i.test(value)) return this.mac(value);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return this.ip(value);
    // IPv6 link-local addresses embed the MAC (EUI-64), also inside lists like "a/24,fe80::.../64",
    // and ids are embedded in paths (stream channels: /sites/<site id>/stats/devices).
    return value
      .replace(/fe80:[0-9a-f:]+/gi, 'fe80::1')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => this.uuid(id));
  }

  walk(node, key = '') {
    if (Array.isArray(node)) return node.map((item) => this.walk(item, key));
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        // Keys can be ids or MACs too (e.g. maps keyed by device MAC).
        const newKey = typeof k === 'string' ? this.string('', k) : k;
        out[newKey] = this.walk(v, k);
      }
      return out;
    }
    if (typeof node === 'string') return this.string(key, node);
    if (typeof node === 'number' && /^(lat|lng|latitude|longitude)$/i.test(key)) return 0;
    return node;
  }
}

// ---------------------------------------------------------------------------
// GET-only transport over the provider's own authenticated request helper.
// ---------------------------------------------------------------------------
async function get(provider, endpoint, params = {}) {
  if (typeof provider.request === 'function') return provider.request('GET', endpoint, { params, context: 'probe' });
  if (typeof provider.makeRequest === 'function') return provider.makeRequest('GET', endpoint, { params, context: 'probe' });
  throw new Error(`${provider.label} has no request helper`);
}

/** The Mist calls the provider makes, plus candidates for later features. */
async function mistPlan(provider, probe, anonymiser) {
  const org = provider.orgId;
  const self = await probe('self', '/api/v1/self');
  for (const privilege of self?.privileges || []) anonymiser.addLiteral(privilege.name, 'Org 1');
  const orgRecord = await probe('org', `/api/v1/orgs/${org}`);
  anonymiser.addLiteral(orgRecord?.name, 'Org 1');
  await probe('org-setting', `/api/v1/orgs/${org}/setting`);
  const sites = await probe('sites', `/api/v1/orgs/${org}/sites`, { limit: 1000, page: 1 });
  const inventory = await probe('inventory', `/api/v1/orgs/${org}/inventory`, { limit: 1000, page: 1 });
  await probe('inventory-vc', `/api/v1/orgs/${org}/inventory`, { limit: 1000, page: 1, vc: true });
  await probe('stats-devices', `/api/v1/orgs/${org}/stats/devices`, { type: 'all', limit: 1000, page: 1 });
  await probe('stats-devices-allfields', `/api/v1/orgs/${org}/stats/devices`, { type: 'all', fields: '*', limit: 1000, page: 1 });
  await probe('stats-ports-search', `/api/v1/orgs/${org}/stats/ports/search`, { limit: 100 });
  await probe('devices-search', `/api/v1/orgs/${org}/devices/search`, { limit: 100 });
  await probe('device-events-search', `/api/v1/orgs/${org}/devices/events/search`, { limit: 50, duration: '7d' });
  for (const section of ['wlans', 'templates', 'rftemplates', 'deviceprofiles', 'networktemplates', 'sitetemplates', 'gatewaytemplates']) {
    await probe(`org-${section}`, `/api/v1/orgs/${org}/${section}`, { limit: 1000, page: 1 });
  }

  for (const site of Array.isArray(sites) ? sites : []) {
    const s = site.id;
    await probe(`site-${s}`, `/api/v1/sites/${s}`);
    await probe(`site-${s}-setting`, `/api/v1/sites/${s}/setting`);
    await probe(`site-${s}-wlans`, `/api/v1/sites/${s}/wlans`, { limit: 1000, page: 1 });
    await probe(`site-${s}-stats-devices`, `/api/v1/sites/${s}/stats/devices`, { type: 'all' });
  }

  const items = Array.isArray(inventory) ? inventory : (inventory?.results || []);
  for (const item of items) {
    if (!item.site_id || !item.id) continue;
    await probe(`device-${item.serial}-config`, `/api/v1/sites/${item.site_id}/devices/${item.id}`);
    await probe(`device-${item.serial}-stats`, `/api/v1/sites/${item.site_id}/stats/devices/${item.id}`);
  }
}

/** Subscribe to Mist stream channels for `seconds`; resolves with every message received. */
/**
 * The Meraki calls the provider makes: first page of each list, the scope
 * sections of the organization and up to three networks, and the settings of
 * one device per product type. Names people typed (organization, networks,
 * devices, clients, SSIDs) are replaced in the .anon.json copies.
 */
async function merakiPlan(provider, probe, anonymiser) {
  const { SECTIONS } = require('../src/services/cloud-providers/meraki.provider');
  const org = provider.orgPath;
  const list = (data) => (Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []));

  const orgs = list(await probe('organizations', '/organizations'));
  orgs.forEach((o, i) => anonymiser.addLiteral(o?.name, `Org ${i + 1}`));
  const identity = await probe('identity', '/administered/identities/me');
  anonymiser.addLiteral(identity?.name, 'Admin 1');
  await probe('org', org);
  const networks = list(await probe('networks', `${org}/networks`, { perPage: 1000 }));
  networks.forEach((n, i) => anonymiser.addLiteral(n?.name, `Network ${i + 1}`));
  await probe('inventory-devices', `${org}/inventory/devices`, { perPage: 1000 });
  const devices = list(await probe('devices', `${org}/devices`, { perPage: 1000 }));
  devices.forEach((d, i) => {
    anonymiser.addLiteral(d?.name, `Device ${i + 1}`);
    anonymiser.addLiteral(d?.address, 'Address');
    anonymiser.addLiteral(d?.notes, 'Notes');
  });
  await probe('devices-availabilities', `${org}/devices/availabilities`, { perPage: 1000 });
  await probe('switch-ports-discovery', `${org}/switch/ports/topology/discovery/byDevice`, { perPage: 20 });
  await probe('switch-ports-bySwitch', `${org}/switch/ports/bySwitch`, { perPage: 50 });
  await probe('switch-ports-statuses', `${org}/switch/ports/statuses/bySwitch`, { perPage: 20 });
  await probe('alerts-active', `${org}/assurance/alerts`, { active: true, perPage: 300 });
  await probe('alerts-resolved', `${org}/assurance/alerts`, {
    active: false, resolved: true, perPage: 300, tsStart: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
  });
  await probe('alert-types', `${org}/assurance/alerts/taxonomy/types`);
  for (const [key, { path: section }] of Object.entries(SECTIONS.ORG_SECTIONS)) await probe(`org-${key}`, `${org}/${section}`);

  for (const network of networks.slice(0, 3)) {
    const base = `/networks/${network.id}`;
    const name = `network-${network.id}`;
    await probe(name, base);
    const sections = { ...SECTIONS.NETWORK_SECTIONS.all };
    for (const type of network.productTypes || []) Object.assign(sections, SECTIONS.NETWORK_SECTIONS[type] || {});
    let ssids = [];
    for (const [key, section] of Object.entries(sections)) {
      const data = await probe(`${name}-${key}`, `${base}/${section}`);
      if (key === 'wirelessSsids') ssids = list(data);
    }
    ssids.forEach((ssid) => anonymiser.addLiteral(ssid?.name, `SSID ${ssid.number}`));
    const enabled = ssids.find((ssid) => ssid?.enabled);
    if (enabled) {
      for (const [key, section] of Object.entries(SECTIONS.SSID_SECTIONS)) {
        await probe(`${name}-ssid${enabled.number}-${key}`, `${base}/wireless/ssids/${enabled.number}/${section}`);
      }
    }
    await probe(`${name}-linkLayer`, `${base}/topology/linkLayer`);
    const clients = list(await probe(`${name}-clients`, `${base}/clients`, { perPage: 10, timespan: 86400 }));
    clients.forEach((c, i) => {
      anonymiser.addLiteral(c?.description, `Client ${i + 1}`);
      anonymiser.addLiteral(c?.user, `user${i + 1}`);
    });
  }

  for (const productType of ['switch', 'wireless', 'appliance']) {
    const device = devices.find((d) => d.productType === productType);
    if (!device) continue;
    const base = `/devices/${device.serial}`;
    await probe(`device-${productType}`, base);
    for (const [key, section] of Object.entries({ ...SECTIONS.DEVICE_SECTIONS.all, ...SECTIONS.DEVICE_SECTIONS[productType] })) {
      await probe(`device-${productType}-${key}`, `${base}/${section}`);
    }
    await probe(`device-${productType}-lldpCdp`, `${base}/lldpCdp`);
  }
}

async function mistStream(provider, channels, seconds) {
  const WebSocket = require('ws');
  if (!provider.streamUrl) throw new Error(`${provider.label} has no stream URL (base URL ${provider.integration.baseUrl})`);
  console.log(`Streaming ${provider.streamUrl} for ${seconds}s:`);
  const messages = [];
  const started = Date.now();
  const ws = new WebSocket(provider.streamUrl, { headers: provider.streamHeaders(), handshakeTimeout: 15000 });
  await new Promise((resolve, reject) => {
    ws.on('unexpected-response', (_req, res) => reject(new Error(`stream upgrade refused (${res.statusCode})`)));
    ws.on('error', reject);
    ws.on('open', () => {
      for (const channel of channels) {
        console.log(`  subscribe ${channel}`);
        ws.send(JSON.stringify({ subscribe: channel }));
      }
      setTimeout(() => ws.close(1000), seconds * 1000);
    });
    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        message = { unparsed: raw.toString().slice(0, 2000) };
      }
      if (typeof message.data === 'string') {
        try {
          message = { ...message, data: JSON.parse(message.data), dataWasString: true };
        } catch { /* keep the string */ }
      }
      messages.push({ ms: Date.now() - started, ...message });
      console.log(`  +${Date.now() - started}ms ${message.event || '?'} ${message.channel || ''}`);
    });
    ws.on('close', (code, reason) => {
      console.log(`  closed ${code} ${reason || ''}`);
      resolve();
    });
  });
  return messages;
}

async function findIntegration(ref) {
  const prisma = getPrisma();
  const byId = await prisma.cloudIntegration.findUnique({ where: { id: ref } }).catch(() => null);
  if (byId) return byId;
  const byName = await prisma.cloudIntegration.findMany({ where: { name: ref } });
  if (byName.length === 1) return byName[0];
  throw new Error(byName.length ? `Several integrations are named "${ref}"; pass the id` : `No integration "${ref}"`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await connectDatabase();
  await connectRedis().catch(() => {}); // Central's token cache; Mist doesn't need it

  const integration = await findIntegration(args.integration);
  const provider = CloudProviderFactory.instantiate(integration);
  fs.mkdirSync(args.out, { recursive: true });
  const anonymiser = new Anonymiser();
  anonymiser.addLiteral(integration.name, 'Integration 1');
  const summary = [];
  const captured = [];

  const probe = async (name, endpoint, params = {}) => {
    const file = name.replace(/[^A-Za-z0-9._-]/g, '_');
    try {
      const data = redactConfigSecrets(await get(provider, endpoint, params));
      fs.writeFileSync(path.join(args.out, `${file}.json`), `${JSON.stringify(data, null, 2)}\n`);
      captured.push({ file, data }); // anonymised at the end, once every literal is known
      const size = Array.isArray(data) ? `${data.length} items` : (Array.isArray(data?.results) ? `${data.results.length} results` : 'object');
      summary.push({ name, endpoint, ok: true, size });
      console.log(`  ok    ${endpoint}  (${size})`);
      return data;
    } catch (error) {
      summary.push({ name, endpoint, ok: false, status: error.statusCode || null, error: error.message });
      console.log(`  FAIL  ${endpoint}  ${error.statusCode || ''} ${error.message}`);
      return null;
    }
  };

  console.log(`Probing ${provider.label} at ${integration.baseUrl} (GET only)`);
  if (args.builtin && integration.provider === 'juniper_mist') await mistPlan(provider, probe, anonymiser);
  if (args.builtin && integration.provider === 'cisco_meraki') await merakiPlan(provider, probe, anonymiser);
  for (const endpoint of args.gets) {
    const [pathname, query] = endpoint.split('?');
    await probe(`get-${pathname}`, pathname, Object.fromEntries(new URLSearchParams(query || '')));
  }
  if (args.streams.length) {
    if (integration.provider !== 'juniper_mist') throw new Error('--stream is only for Juniper Mist');
    const sites = await get(provider, `/api/v1/orgs/${provider.orgId}/sites`, { limit: 1000, page: 1 });
    captured.push({ file: 'stream-sites', data: redactConfigSecrets(sites) });
    const channels = args.streams.flatMap((channel) => (channel.includes('{site}')
      ? sites.map((site) => channel.replace('{site}', site.id))
      : [channel]));
    try {
      const messages = redactConfigSecrets(await mistStream(provider, channels, args.seconds));
      fs.writeFileSync(path.join(args.out, 'stream.json'), `${JSON.stringify(messages, null, 2)}\n`);
      captured.push({ file: 'stream', data: messages });
      summary.push({ name: 'stream', endpoint: provider.streamUrl, channels, ok: true, size: `${messages.length} messages` });
    } catch (error) {
      summary.push({ name: 'stream', endpoint: provider.streamUrl, channels, ok: false, error: error.message });
      console.log(`  FAIL  stream  ${error.message}`);
    }
  }

  for (const { data } of captured) anonymiser.learn(data);
  for (const { file, data } of captured) {
    fs.writeFileSync(path.join(args.out, `${file}.anon.json`), `${JSON.stringify(anonymiser.walk(data), null, 2)}\n`);
  }
  fs.writeFileSync(path.join(args.out, '_summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\n${summary.filter((s) => s.ok).length}/${summary.length} succeeded. Output: ${args.out}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => {});
    await disconnectRedis().catch(() => {});
  });
