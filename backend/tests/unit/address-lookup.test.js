/**
 * "Who has this address?" (services/address-lookup.service.js): each source
 * answers or says why not, and the MAC holding the address (neighbor table,
 * else a cloud client) is compared with the device's own.
 */
const mockPrisma = {
  device: { findUnique: jest.fn(), findMany: jest.fn() },
  deviceLink: { findMany: jest.fn() },
  discoveredDevice: { findFirst: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/config/redis', () => ({ getRedis: jest.fn() }));
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ activeProviders: jest.fn() }));
jest.mock('child_process', () => ({ execFile: jest.fn() }));

const { execFile } = require('child_process');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const { lookup } = require('../../src/services/address-lookup.service');

const THIS = { id: 'd1', name: 'Sw-Agg', serial: 'SN1', ipAddress: '192.168.252.4', macAddress: 'AA:BB:CC:00:00:01' };
const neighbor = (stdout) => execFile.mockImplementation((cmd, args, opts, cb) => cb(null, { stdout, stderr: '' }));
const source = (result, key) => result.sources.find((s) => s.key === key);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.device.findUnique.mockResolvedValue(THIS);
  mockPrisma.device.findMany.mockResolvedValue([]);
  mockPrisma.deviceLink.findMany.mockResolvedValue([]);
  mockPrisma.discoveredDevice.findFirst.mockResolvedValue(null);
  CloudProviderFactory.activeProviders.mockResolvedValue([]);
  neighbor('');
});

describe('address lookup', () => {
  test('an unknown device is null; a device without an IPv4 address has nothing to look up', async () => {
    mockPrisma.device.findUnique.mockResolvedValueOnce(null);
    expect(await lookup('nope')).toBeNull();
    mockPrisma.device.findUnique.mockResolvedValueOnce({ ...THIS, ipAddress: null });
    expect((await lookup('d1')).sources).toEqual([]);
  });

  test('the neighbor table is queried for the IP only, without a shell', async () => {
    await lookup('d1');
    expect(execFile.mock.calls[0].slice(0, 2)).toEqual(['ip', ['neigh', 'show', 'to', '192.168.252.4']]);
  });

  test('another MAC answering is reported with its vendor and the device that owns it', async () => {
    neighbor('192.168.252.4 dev eth0 lladdr 4c:4a:b4:11:22:33 REACHABLE\n');
    mockPrisma.device.findMany.mockImplementation(async ({ where }) => (where.macAddress
      ? [{ id: 'd2', name: 'Sw-CoreA' }]
      : []));

    const result = await lookup('d1');

    expect(result).toMatchObject({ mac: '4c:4a:b4:11:22:33', sameMac: false });
    expect(source(result, 'neighbor').items).toEqual([
      { title: '4c:4a:b4:11:22:33', detail: "Juniper Networks, not this device's MAC" },
      { title: 'Sw-CoreA', detail: 'has this MAC address', deviceId: 'd2' },
    ]);
  });

  test("the device's own MAC answering is flagged", async () => {
    neighbor('192.168.252.4 dev eth0 lladdr aa:bb:cc:00:00:01 STALE\n');
    expect(await lookup('d1')).toMatchObject({ sameMac: true });
  });

  test("an address off the host's segment says why there is no MAC", async () => {
    const neigh = source(await lookup('d1'), 'neighbor');
    expect(neigh.status).toBe('none');
    expect(neigh.reason).toMatch(/own network segment/);
  });

  test('a missing ip binary skips only that source', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(Object.assign(new Error('spawn ip ENOENT'), { code: 'ENOENT' })));
    const result = await lookup('d1');
    expect(source(result, 'neighbor')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/not installed/) });
    expect(source(result, 'devices').status).toBe('none');
  });

  const provider = (name, findByAddress) => ({
    label: name, integration: { name }, supports: (c) => c === 'address-lookup' && Boolean(findByAddress), findByAddress,
  });
  const client = (over) => ({
    kind: 'client', name: null, mac: '00:50:56:86:eb:83', serial: null, model: null, status: 'connected', lastSeen: new Date(),
    manufacturer: 'VMware, Inc.', connectedTo: { name: 'Sw-CoreB', serial: null, mac: null, port: '1/1/27', vlan: '99', ssid: null }, ...over,
  });

  test('cloud devices and clients holding the IP are listed, the device itself left out, and failures named', async () => {
    CloudProviderFactory.activeProviders.mockResolvedValue([
      provider('Home Central', async () => [
        { kind: 'device', name: 'Sw-Agg', serial: 'SN1', mac: 'aa:bb:cc:00:00:01', status: 'offline' },
        { kind: 'device', name: 'Sw-New', serial: 'SN9', mac: null, model: '6200F', status: 'online' },
        client({ status: 'disconnected', lastSeen: new Date('2026-10-22T10:00:00Z'), mac: '00:00:5e:00:01:01', manufacturer: null }),
        client({ connectedTo: { serial: 'SN5', port: '1/1/27', vlan: '99' }, name: 'vm-1' }),
      ]),
      provider('Lab Mist', async () => { throw new Error('401'); }),
      provider('Meraki', null),
    ]);
    // NetHelper knows the client's switch by serial, and none of the holders.
    mockPrisma.device.findMany.mockImplementation(async ({ where }) => (where.OR ? [{ id: 'd5', name: 'Sw-CoreB', serial: 'SN5' }] : []));

    const result = await lookup('d1');
    const cloud = source(result, 'cloud');

    expect(cloud.items.map((i) => [i.title, i.detail])).toEqual([
      ['Sw-New', 'Home Central device (6200F), reports it online, not in NetHelper'],
      ['vm-1', 'Home Central client on Sw-CoreB port 1/1/27, VLAN 99; MAC 00:50:56:86:eb:83, VMware, Inc.; connected now'],
      ['00:00:5e:00:01:01', 'Home Central client on Sw-CoreB port 1/1/27, VLAN 99; MAC 00:00:5e:00:01:01; disconnected'],
    ]);
    expect(cloud.reason).toBe("Couldn't read: Lab Mist. Can't search by address: Meraki.");
    expect(cloud).not.toHaveProperty('macHolder');
    // No neighbor entry: the connected client's MAC is the one compared.
    expect(result).toMatchObject({ mac: '00:50:56:86:eb:83', macFrom: 'Home Central', sameMac: false });
  });

  test("a cloud client with the device's own MAC says the device holds the address", async () => {
    CloudProviderFactory.activeProviders.mockResolvedValue([
      provider('Lab Mist', async () => [client({ mac: 'aa:bb:cc:00:00:01', connectedTo: { mac: '4c:4a:b4:00:00:01', port: 'ge-0/0/1' } })]),
    ]);
    mockPrisma.device.findMany.mockImplementation(async ({ where }) => (where.OR
      ? [{ id: 'd1', name: 'Sw-Agg', macAddress: 'aabbcc000001' }, { id: 'd7', name: 'JNEX-01', macAddress: '4c4ab4000001' }]
      : []));

    const result = await lookup('d1');

    expect(result).toMatchObject({ macFrom: 'Lab Mist', sameMac: true });
    // Bare-hex MACs (Mist) resolve to devices too.
    expect(source(result, 'cloud').items[0]).toMatchObject({
      deviceId: 'd1', detail: expect.stringMatching(/^Lab Mist client on JNEX-01 port ge-0\/0\/1; MAC aa:bb:cc:00:00:01 \(this device's own\)/),
    });
  });

  test("the host's neighbor table wins over a cloud's client record", async () => {
    neighbor('192.168.252.4 dev eth0 lladdr aa:bb:cc:00:00:01 STALE\n');
    CloudProviderFactory.activeProviders.mockResolvedValue([provider('Home Central', async () => [client()])]);
    expect(await lookup('d1')).toMatchObject({ mac: 'aa:bb:cc:00:00:01', macFrom: 'neighbor', sameMac: true });
  });

  test('LLDP neighbors are grouped, link to the neighbor itself, and the latest discovery entry is listed', async () => {
    const link = (device, port) => ({
      localPort: port, remoteChassisId: 'x', remoteMac: '4c:4a:b4:11:22:33', remoteSysName: 'Sw-CoreA', remoteSysDesc: 'ArubaOS-CX',
      source: 'lldp', lastSeen: new Date(), device: { name: device },
    });
    mockPrisma.deviceLink.findMany.mockResolvedValue([link('Sw-Edge', '1/1/5'), link('Sw-Mgmt', '1')]);
    mockPrisma.device.findMany.mockImplementation(async ({ where }) => (where.macAddress?.in
      ? [{ id: 'd2', macAddress: '4C:4A:B4:11:22:33' }]
      : []));
    mockPrisma.discoveredDevice.findFirst.mockResolvedValue({
      hostname: 'core-a', macAddress: '4c:4a:b4:11:22:33', vendor: 'Juniper Networks', openPorts: [22, 443], createdAt: new Date(),
    });

    const result = await lookup('d1');

    expect(source(result, 'lldp').items).toEqual([expect.objectContaining({
      title: 'Sw-CoreA', deviceId: 'd2', detail: 'LLDP via Sw-Edge port 1/1/5, Sw-Mgmt port 1: ArubaOS-CX',
    })]);
    expect(source(result, 'discovery').items[0]).toMatchObject({ title: 'core-a', detail: expect.stringContaining('open ports 22, 443') });
  });

  test('one source failing does not stop the rest', async () => {
    mockPrisma.deviceLink.findMany.mockRejectedValue(new Error('db'));
    const result = await lookup('d1');
    expect(source(result, 'lldp')).toMatchObject({ status: 'skipped' });
    expect(source(result, 'discovery').status).toBe('none');
  });
});
