/**
 * topology.service: transport dispatch and persistence, with every transport
 * and the database mocked.
 */
const crypto = require('crypto');

function createStore() {
  const links = [];
  const states = new Map();
  const changes = [];
  const prisma = {
    links,
    states,
    changes,
    deviceTopologyState: {
      async findUnique({ where }) { return states.get(where.deviceId) || null; },
      upsert({ where, create, update }) {
        return { run: () => states.set(where.deviceId, { ...(states.get(where.deviceId) || create), ...update }) };
      },
    },
    deviceLink: {
      async findMany({ where }) { return links.filter((l) => l.deviceId === where.deviceId).map((l) => ({ ...l })); },
      create({ data }) { return { run: () => links.push({ id: crypto.randomUUID(), ...data }) }; },
      update({ where, data }) { return { run: () => Object.assign(links.find((l) => l.id === where.id), data) }; },
    },
    topologyChange: {
      createMany({ data }) { return { run: () => changes.push(...data) }; },
    },
    async $transaction(ops) { for (const op of ops) op.run(); },
  };
  // upsert outside a transaction (failure path) must apply immediately
  const upsert = prisma.deviceTopologyState.upsert;
  prisma.deviceTopologyState.upsert = (args) => {
    const op = upsert(args);
    const promise = Promise.resolve().then(() => op.run());
    promise.run = op.run;
    return promise;
  };
  return prisma;
}

let mockStore;
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockStore }));
jest.mock('../../src/services/settings.service', () => ({ getDeviceCredentialsForUse: jest.fn() }));
jest.mock('../../src/services/device-poller.service', () => ({ withCxSession: jest.fn() }));
jest.mock('../../src/services/ssh-device.service', () => ({ getNeighbors: jest.fn() }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ forDevice: jest.fn() }));
jest.mock('../../src/services/device-api/junos-api', () => {
  const getLldpTopology = jest.fn();
  const JunosAPI = jest.fn(() => ({ getLldpTopology }));
  JunosAPI.getLldpTopology = getLldpTopology;
  return JunosAPI;
});

const settingsService = require('../../src/services/settings.service');
const devicePoller = require('../../src/services/device-poller.service');
const sshDevice = require('../../src/services/ssh-device.service');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const BaseCloudProvider = require('../../src/services/cloud-providers/base-cloud-provider');
const JunosAPI = require('../../src/services/device-api/junos-api');
const topology = require('../../src/services/topology/topology.service');
const { makeVlanSnapshot } = require('../../src/services/topology/vlan-membership');

const cx = {
  id: 'd-cx', name: 'Sw-Studio', type: 'switch', vendor: 'aruba', platform: 'aos-cx', ipAddress: '10.0.0.14', managementMode: 'cloud',
};
const neighbor = (localPort, chassisId, portId, sysName) => ({
  localPort, chassisId, portId, sysName, mac: chassisId, capabilities: ['bridge'], protocol: 'lldp',
});

function stubCx(neighbors, extra = {}) {
  devicePoller.withCxSession.mockImplementation(async (_device, _creds, fn) => fn({
    getLldpNeighbors: async () => neighbors,
    getLldpIdentity: async () => ({ chassisId: 'ec:67:94:00:20:00', sysName: 'Sw-Studio' }),
    getVlanMembership: async () => null,
    ...extra,
  }));
}

beforeEach(() => {
  mockStore = createStore();
  jest.clearAllMocks();
  settingsService.getDeviceCredentialsForUse.mockResolvedValue({ username: 'u', password: 'p' });
});

test('a platform without a neighbor source is unsupported, and nothing is contacted', async () => {
  const result = await topology.collectDevice({ id: 'd-x', name: 'mystery', type: 'access_point', vendor: 'other' });
  expect(result.status).toBe('unsupported');
  expect(mockStore.states.get('d-x')).toMatchObject({ status: 'unsupported' });
  expect(settingsService.getDeviceCredentialsForUse).not.toHaveBeenCalled();
});

test('AOS-CX without a credential is skipped with a reason the user can act on', async () => {
  settingsService.getDeviceCredentialsForUse.mockResolvedValue(null);
  CloudProviderFactory.forDevice.mockResolvedValue(new BaseCloudProvider({ provider: 'aruba_central', name: 'Central', baseUrl: 'https://x', credentials: {} }));
  const result = await topology.collectDevice(cx);
  expect(result.status).toBe('skipped');
  expect(result.reason).toMatch(/linked credential/);
  expect(devicePoller.withCxSession).not.toHaveBeenCalled();
});

test('a Central-managed CX switch is read over local REST; first run records links, not changes', async () => {
  stubCx([neighbor('1/1/13', '14:ab:ec:00:10:00', '1/1/6', 'Sw-CoreB'), neighbor('1/1/4', '04:2a:e2:00:30:4e', 'P1', 'phone')]);
  const result = await topology.collectDevice(cx);
  expect(result).toMatchObject({ status: 'ok', source: 'AOS-CX REST', neighbors: 2, changes: 0 });
  expect(mockStore.links).toHaveLength(2);
  expect(mockStore.states.get('d-cx')).toMatchObject({ status: 'ok', chassisId: 'ec:67:94:00:20:00', neighborCount: 2 });
  expect(mockStore.changes).toEqual([]);
  expect(CloudProviderFactory.forDevice).not.toHaveBeenCalled();
});

test('the next run records what changed', async () => {
  stubCx([neighbor('1/1/13', '14:ab:ec:00:10:00', '1/1/6', 'Sw-CoreB'), neighbor('1/1/4', '04:2a:e2:00:30:4e', 'P1', 'phone')]);
  await topology.collectDevice(cx);
  stubCx([neighbor('1/1/13', '14:ab:ec:00:10:00', '1/1/6', 'Sw-CoreB')]);
  const result = await topology.collectDevice(cx);
  expect(result.changes).toBe(1);
  expect(mockStore.changes[0]).toMatchObject({ deviceId: 'd-cx', type: 'link.removed', localPort: '1/1/4' });
  expect(mockStore.links.find((l) => l.localPort === '1/1/4').active).toBe(false);
});

test('a failed read leaves existing links alone', async () => {
  stubCx([neighbor('1/1/13', '14:ab:ec:00:10:00', '1/1/6', 'Sw-CoreB')]);
  await topology.collectDevice(cx);
  devicePoller.withCxSession.mockRejectedValue(new Error('connect ETIMEDOUT'));
  const result = await topology.collectDevice(cx);
  expect(result).toMatchObject({ status: 'failed', reason: 'connect ETIMEDOUT' });
  expect(mockStore.links.every((l) => l.active)).toBe(true);
  expect(mockStore.states.get('d-cx')).toMatchObject({ status: 'failed', chassisId: 'ec:67:94:00:20:00' });
});

test('a cloud AP whose provider has no neighbor API is unsupported', async () => {
  CloudProviderFactory.forDevice.mockResolvedValue(new BaseCloudProvider({ provider: 'juniper_mist', name: 'Mist', baseUrl: 'https://x', credentials: {} }));
  const result = await topology.collectDevice({
    id: 'd-ap', name: 'ap1', type: 'access_point', vendor: 'juniper', managementMode: 'cloud',
  });
  expect(result.status).toBe('unsupported');
  expect(result.reason).toMatch(/does not support "topology"/);
});

test('a Mist-managed EX with an IP and a credential is read over NETCONF, not the cloud', async () => {
  settingsService.getDeviceCredentialsForUse.mockResolvedValue({ username: 'u', password: 'p' });
  JunosAPI.getLldpTopology.mockResolvedValue({
    neighbors: [neighbor('mge-0/0/0', 'a8:f7:d9:00:60:0b', 'eth0', 'JNAP-01')],
    identity: { chassisId: '4c:4a:b4:00:40:80', sysName: 'JNEX-01' },
  });
  const vlans = makeVlanSnapshot({ ports: [{ port: 'mge-0/0/0', mode: 'access', untagged: 1 }] });
  const listNeighbors = jest.fn(async () => new Map([['SN-EX', { neighbors: [], vlans }]]));
  CloudProviderFactory.forDevice.mockResolvedValue({
    integration: { id: 'mist-1' }, label: 'Juniper Mist', supports: () => true, listNeighbors,
  });
  const result = await topology.collectDevice({
    id: 'd-ex', name: 'JNEX-01', serial: 'SN-EX', type: 'switch', vendor: 'juniper', platform: 'junos', ipAddress: '172.16.10.102', managementMode: 'cloud',
  });
  // Links over NETCONF; the cloud is asked only for its port VLAN view.
  expect(result).toMatchObject({ status: 'ok', source: 'Junos NETCONF', neighbors: 1 });
  expect(sshDevice.getNeighbors).not.toHaveBeenCalled();
  expect(mockStore.states.get('d-ex')).toMatchObject({ vlans, vlanSource: 'Juniper Mist', vlanError: null });
});

test('AOS-CX VLANs are stored with the links; a failed VLAN read keeps the last ones', async () => {
  const vlans = makeVlanSnapshot({ vlans: [{ id: 10, name: 'users' }], ports: [{ port: '1/1/13', mode: 'trunk', untagged: 1, tagged: [10] }] });
  stubCx([neighbor('1/1/13', '14:ab:ec:00:10:00', '1/1/6', 'Sw-CoreB')], { getVlanMembership: async () => vlans });
  await topology.collectDevice(cx);
  expect(mockStore.states.get('d-cx')).toMatchObject({ vlans, vlanSource: 'AOS-CX REST', vlanError: null });

  stubCx([neighbor('1/1/13', '14:ab:ec:00:10:00', '1/1/6', 'Sw-CoreB')], {
    getVlanMembership: async () => { throw new Error('HTTP 403'); },
  });
  const result = await topology.collectDevice(cx);
  expect(result.status).toBe('ok');
  expect(mockStore.states.get('d-cx')).toMatchObject({ vlans, vlanSource: 'AOS-CX REST', vlanError: 'HTTP 403' });
});

test('AOS-S reads over SSH', async () => {
  sshDevice.getNeighbors.mockResolvedValue({ neighbors: [neighbor('1', '00:1a:1e:00:00:00', '24', 'sw-core')], identity: {} });
  const result = await topology.collectDevice({
    id: 'd-s', name: 'sw-access', type: 'switch', vendor: 'aruba', platform: 'aos-s', ipAddress: '10.0.0.5',
  });
  expect(result).toMatchObject({ status: 'ok', source: 'SSH', neighbors: 1 });
  // No VLAN source over SSH yet: nothing stored, nothing stale kept.
  expect(mockStore.states.get('d-s')).toMatchObject({ vlanSource: null, vlanError: null });
});

test('saveLayout keeps only finite positions', async () => {
  mockStore.mapLayout = { upsert: jest.fn(async (args) => args.create) };
  const saved = await topology.saveLayout('all', {
    'device:a': { x: 10.4, y: 20.6 }, 'device:b': { x: 'NaN', y: 1 }, 'device:c': null,
  }, 'u1');
  expect(saved.positions).toEqual({ 'device:a': { x: 10, y: 21 } });
  expect(topology.validScope('site:HQ')).toBe(true);
  expect(topology.validScope('bogus')).toBe(false);
});
