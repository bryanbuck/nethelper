/**
 * Cloud neighbors (Network Map): the Mist and Central parsers over live
 * captures (2026-10-19, anonymised), the providers' bulk reads, the map they
 * produce, and topology.service's one-read-per-run cloud path.
 */
jest.mock('axios');
jest.mock('../../src/config/redis', () => ({ getRedis: jest.fn() }));
jest.mock('../../src/services/settings.service', () => ({ getDeviceCredentialsForUse: jest.fn(async () => null) }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ forDevice: jest.fn() }));

const axios = require('axios');
const MistProvider = require('../../src/services/cloud-providers/mist.provider');
const ArubaCentralProvider = require('../../src/services/cloud-providers/aruba-central.provider');
const BaseCloudProvider = require('../../src/services/cloud-providers/base-cloud-provider');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const topology = require('../../src/services/topology/topology.service');
const { parseMistNeighbors } = require('../../src/services/topology/parsers/mist');
const { parseCentralTopology } = require('../../src/services/topology/parsers/central');
const { reconcileLinks } = require('../../src/services/topology/link-diff');
const { buildGraph } = require('../../src/services/topology/graph');

// One Mist org (an AP33 on an EX4000's mge-0/0/0, the EX uplinked to an
// unmanaged core) and one Central tenant (three sites), each captured in one run.
const mist = {
  inventory: require('../fixtures/mist-live/neighbors-inventory.json'),
  stats: require('../fixtures/mist-live/neighbors-stats-devices.json'),
  ports: require('../fixtures/mist-live/neighbors-stats-ports-search.json'),
};
const central = {
  devices: require('../fixtures/central-live/devices.json'),
  hq: require('../fixtures/central-live/topology-hq.json'),
  branch: require('../fixtures/central-live/topology-branch.json'),
  teleworker: require('../fixtures/central-live/topology-teleworker.json'),
};

const serialOf = (items, name, key = 'serial') => items.find((d) => (d.name || d.deviceName) === name)[key];
const ports = (entry) => entry.neighbors.map((n) => `${n.localPort}>${n.sysName || n.chassisId}:${n.portId}`).sort();

describe('Mist parser (live capture)', () => {
  const table = parseMistNeighbors({ stats: mist.stats, ports: mist.ports.results });
  const ap = table.get(serialOf(mist.inventory, 'JNAP-01'));
  const ex = table.get(serialOf(mist.inventory, 'JNEX-01'));

  test("an AP reports its uplink from its own LLDP; a single-port AP's port is eth0", () => {
    expect(ap).toMatchObject({ online: true, identity: { sysName: 'JNAP-01' } });
    expect(ap.neighbors).toEqual([expect.objectContaining({
      localPort: 'eth0', sysName: 'JNEX-01', portId: 'mge-0/0/0', protocol: 'lldp', mgmtIp: null,
    })]);
    // The chassis id it hears is the switch's own MAC, which is how the map finds the switch.
    expect(ap.neighbors[0].mac).toBe(ex.identity.chassisId);
  });

  test('a switch reports one neighbor per port that has one, from port stats', () => {
    expect(ports(ex)).toEqual(['ge-0/0/11>Lab-Core:5', 'mge-0/0/0>JNAP-01:ETH0']);
    expect(ex.neighbors.find((n) => n.localPort === 'mge-0/0/0').mac).toBe(ap.identity.chassisId);
  });

  test('a device Mist reports disconnected is marked offline', () => {
    const stats = mist.stats.map((s) => ({ ...s, status: 'disconnected' }));
    expect(parseMistNeighbors({ stats, ports: [] }).get(serialOf(mist.inventory, 'JNAP-01')).online).toBe(false);
  });
});

describe('Central parser (live capture)', () => {
  const table = parseCentralTopology([central.hq, central.branch, central.teleworker]);
  const bySerial = (name) => table.get(serialOf(central.devices.items, name, 'serialNumber'));

  test('a cloud-only AOS-S switch gets its uplink, with both ends\' ports', () => {
    expect(ports(bySerial('Sw-Mgmt'))).toEqual(['1>Sw-CoreA:1/1/3']);
    expect(bySerial('Sw-Mgmt').neighbors[0]).toMatchObject({ capabilities: ['bridge'], protocol: 'cloud' });
  });

  test('each link is listed once and becomes a neighbor on both ends', () => {
    expect(ports(bySerial('AP01'))).toEqual(['eth0>Sw-CoreA:1/1/22']);
    expect(ports(bySerial('Sw-CoreA'))).toEqual(expect.arrayContaining(['1/1/22>AP01:eth0', '1/1/3>Sw-Mgmt:1']));
    expect(bySerial('Sw-CoreA').neighbors.find((n) => n.localPort === '1/1/22').capabilities).toEqual(['wlan-ap']);
  });

  test('an unmanaged neighbor named by its MAC keeps the MAC as chassis id, not as a name', () => {
    const unmanaged = bySerial('Sw-Studio').neighbors.find((n) => n.localPort === '1/1/14');
    expect(unmanaged).toMatchObject({ sysName: null, capabilities: [] });
    expect(unmanaged.mac).toBe(unmanaged.chassisId.toLowerCase());
  });

  test("a gateway's WAN uplinks are not neighbors; an offline switch is marked offline", () => {
    expect(bySerial('MLab-GW')).toMatchObject({ online: true, neighbors: [] });
    expect(bySerial('MLab-6200F').online).toBe(false);
  });

  test('a device in no topology is absent', () => {
    expect(bySerial('Teleworker_605H')).toBeUndefined();
    expect(bySerial('Sw-Agg')).toBeUndefined();
  });
});

describe('the map from cloud neighbors', () => {
  const linksFor = (deviceId, neighbors) => reconcileLinks([], neighbors, { initial: true })
    .creates.map((data, i) => ({ id: `${deviceId}-${i}`, deviceId, active: true, ...data }));

  test("Mist: the AP's and the switch's reports merge into one confirmed edge", () => {
    const table = parseMistNeighbors({ stats: mist.stats, ports: mist.ports.results });
    const devices = mist.inventory.map((item) => ({
      id: item.name, name: item.name, type: item.type === 'ap' ? 'access_point' : 'switch', macAddress: item.mac,
    }));
    const links = devices.flatMap((d) => linksFor(d.id, table.get(serialOf(mist.inventory, d.name)).neighbors));

    const graph = buildGraph({ devices, links });
    const edge = graph.edges.find((e) => [e.source, e.target].sort().join() === 'device:JNAP-01,device:JNEX-01');

    expect(edge).toMatchObject({ bidirectional: true, protocols: ['lldp'] });
    expect([edge.sourcePort, edge.targetPort].sort()).toEqual(['eth0', 'mge-0/0/0']);
    expect(graph.stats).toMatchObject({ devices: 2, links: 2, ghosts: 1 }); // Lab-Core is not managed here
  });
});

describe('provider bulk reads', () => {
  beforeEach(() => axios.mockReset());

  const mistProvider = () => new MistProvider({
    id: 'int-mist', provider: 'juniper_mist', name: 'Buck Home', baseUrl: 'https://api.ac2.mist.com', credentials: { apiToken: 't', orgId: 'o' },
  });

  test('Mist: two org-wide reads, following the search `next` link', async () => {
    const [first, ...rest] = mist.ports.results.filter((p) => p.neighbor_mac);
    axios.mockImplementation(async ({ url, params }) => {
      if (url.endsWith('/orgs/o/stats/devices')) return { data: mist.stats };
      if (url.endsWith('/orgs/o/stats/ports/search')) return { data: { results: [first], next: '/api/v1/orgs/o/stats/ports/search?limit=1&search_after=x' } };
      if (url.includes('search_after=x')) return { data: { results: rest } };
      throw new Error(`unexpected ${url} ${JSON.stringify(params)}`);
    });

    const table = await mistProvider().listNeighbors();

    expect(axios).toHaveBeenCalledTimes(3);
    expect(axios.mock.calls[0][0].params).toMatchObject({ type: 'all', fields: expect.stringContaining('lldp_stats') });
    expect(axios.mock.calls[1][0].params).toMatchObject({ neighbor_mac: '*', limit: 1000 });
    expect(ports(table.get(serialOf(mist.inventory, 'JNEX-01')))).toHaveLength(2);
  });

  test('Mist: a `next` that is not a path on the same API is not followed', async () => {
    axios.mockImplementation(async ({ url }) => (url.endsWith('/stats/devices')
      ? { data: [] }
      : { data: { results: [], next: 'https://elsewhere.example/api/v1/x' } }));

    await mistProvider().listNeighbors();

    expect(axios).toHaveBeenCalledTimes(2);
  });

  test('Central: the inventory names the sites, then one v1 topology read per site', async () => {
    const provider = new ArubaCentralProvider({
      id: 'int-c', provider: 'aruba_central', name: 'Home Network', baseUrl: 'https://us4.api.central.arubanetworks.com', credentials: { clientId: 'c', clientSecret: 's' },
    });
    const bySite = { 66470128290: central.hq, 66470128371: central.branch, 74710080672: central.teleworker };
    provider.makeRequest = jest.fn(async (_method, endpoint) => {
      if (endpoint === '/network-monitoring/v1alpha1/devices') return central.devices;
      const site = endpoint.match(/^\/network-monitoring\/v1\/topology\/(\d+)$/)?.[1];
      if (site) return bySite[site];
      throw new Error(`unexpected ${endpoint}`);
    });

    const table = await provider.listNeighbors();

    expect(provider.makeRequest).toHaveBeenCalledTimes(4);
    expect(ports(table.get(serialOf(central.devices.items, 'Sw-Mgmt', 'serialNumber')))).toEqual(['1>Sw-CoreA:1/1/3']);
  });
});

describe('topology.service cloud path', () => {
  const ap = { id: 'd-ap', name: 'JNAP-01', serial: 'SN1', type: 'access_point', vendor: 'juniper', managementMode: 'cloud' };
  const ex = { id: 'd-ex', name: 'JNEX-01', serial: 'SN2', type: 'switch', vendor: 'juniper', platform: 'junos', managementMode: 'cloud' };
  const entry = (online) => ({ neighbors: [{ localPort: 'eth0', chassisId: 'x' }], identity: { chassisId: 'aa', sysName: 'n' }, online });

  function cloud(table) {
    const provider = new BaseCloudProvider({ id: 'int-mist', provider: 'juniper_mist', name: 'Buck Home', baseUrl: 'https://x', credentials: {} });
    provider.listNeighbors = jest.fn(async () => table);
    CloudProviderFactory.forDevice.mockResolvedValue(provider);
    return provider;
  }

  beforeEach(() => jest.clearAllMocks());

  test('one read per integration per run, shared by its devices', async () => {
    const provider = cloud(new Map([['SN1', entry(true)], ['SN2', entry(true)]]));
    const run = { cloudNeighbors: new Map() };

    const results = await Promise.all([ap, ex].map((d) => topology.collectNeighbors(d, run)));

    expect(provider.listNeighbors).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.source)).toEqual([provider.label, provider.label]);
  });

  test('an offline device or one the cloud has no data for is skipped, not emptied', async () => {
    cloud(new Map([['SN1', entry(false)]]));
    const run = { cloudNeighbors: new Map() };

    await expect(topology.collectNeighbors(ap, run)).rejects.toMatchObject({ status: 'skipped', message: expect.stringMatching(/reports the device offline/) });
    await expect(topology.collectNeighbors(ex, run)).rejects.toMatchObject({ status: 'skipped', message: expect.stringMatching(/no neighbor data/) });
  });

  test('a cloud read failure is a real failure for its devices', async () => {
    const provider = cloud(null);
    provider.listNeighbors.mockRejectedValue(new Error('Juniper Mist API error (503)'));

    await expect(topology.collectNeighbors(ap, { cloudNeighbors: new Map() })).rejects.toThrow('503');
  });
});
