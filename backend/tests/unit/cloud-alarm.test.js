/**
 * The cloud alarm mirror (services/cloud-alarm.service.js): inserts new
 * alarms, writes known ones only when they change, clears stateful alarms
 * that leave the active list, links a device only on a unique match, and
 * never changes anything on a failed read.
 */
const mockPrisma = {
  device: { findMany: jest.fn() },
  cloudAlarm: {
    findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(),
  },
};
const mockEmit = jest.fn();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => ({ emit: mockEmit }) }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({
  activeProviders: jest.fn(), ENV_ARUBA_INTEGRATION_ID: 'env-aruba-central',
}));

const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const service = require('../../src/services/cloud-alarm.service');

const NOW = new Date('2026-10-23T12:00:00Z').getTime();
const DEVICES = [
  { id: 'd-a', name: 'Sw-CoreA', serial: 'SG1', macAddress: 'aa:bb:cc:00:00:01' },
  { id: 'd-b', name: 'Sw-CoreB', serial: 'SG2', macAddress: 'aa:bb:cc:00:00:02' },
  { id: 'd-ip', name: '192.168.254.14', serial: null, macAddress: null },
];

const alarm = (id, extra = {}) => ({
  externalId: id, type: 'OSPF Peer Down', name: 'OSPF Peer Down', category: 'Routing', severity: 'warning',
  stateful: true, status: 'active', raisedAt: new Date(NOW - 3600e3), lastSeenAt: new Date(NOW - 3600e3),
  clearedAt: null, clearedReason: null, summary: null, siteName: 'HQ', count: 1, serials: [], macs: [], hostnames: [], data: {},
  ...extra,
});
const provider = (result, id = 'int-c') => ({
  id, label: 'Central', providerType: 'aruba_central', supports: (c) => c === 'alarms',
  listAlarms: jest.fn().mockImplementation(async () => (result instanceof Error ? Promise.reject(result) : result)),
});

beforeEach(() => {
  jest.clearAllMocks();
  service._reset();
  mockPrisma.device.findMany.mockResolvedValue(DEVICES);
  mockPrisma.cloudAlarm.findFirst.mockResolvedValue(null);
  mockPrisma.cloudAlarm.findMany.mockResolvedValue([]);
  mockPrisma.cloudAlarm.deleteMany.mockResolvedValue({ count: 0 });
});

describe('matchDevice', () => {
  test('a serial in the summary wins', () => {
    expect(service.matchDevice(alarm('x', { summary: 'Switch Sw-CoreA Serial: SG2 rebooted' }), DEVICES)).toBe('d-b');
  });
  test('a MAC, then a hostname', () => {
    expect(service.matchDevice(alarm('x', { macs: ['aabbcc000001'] }), DEVICES)).toBe('d-a');
    expect(service.matchDevice(alarm('x', { hostnames: ['sw-coreb'] }), DEVICES)).toBe('d-b');
  });
  test('a device name as a whole word in the summary, only when exactly one matches', () => {
    expect(service.matchDevice(alarm('x', { summary: 'Switch Sw-CoreB, OSPF peer 192.168.254.14 is down' }), DEVICES)).toBe('d-b');
    expect(service.matchDevice(alarm('x', { summary: 'IPsec SA between Sw-CoreA and Sw-CoreB is down' }), DEVICES)).toBeNull();
    expect(service.matchDevice(alarm('x', { summary: 'Sw-CoreAB went away' }), DEVICES)).toBeNull();
  });
  test('an alarm about several devices stays site-level', () => {
    expect(service.matchDevice(alarm('x', { macs: ['aa:bb:cc:00:00:01', 'aa:bb:cc:00:00:02'], summary: 'Sw-CoreA' }), DEVICES)).toBeNull();
  });
});

describe('pollProvider', () => {
  test('a first poll backfills 7 days and inserts new alarms with their device', async () => {
    const p = provider({ alarms: [alarm('c1', { summary: 'Switch Sw-CoreA, OSPF peer down' })], activeIds: ['c1'] });
    const result = await service.pollProvider(p, NOW);

    expect(p.listAlarms.mock.calls[0][0].since).toEqual(new Date(NOW - 7 * 24 * 3600e3));
    expect(mockPrisma.device.findMany.mock.calls[0][0].where).toEqual({ cloudIntegrationId: 'int-c' });
    expect(mockPrisma.cloudAlarm.create.mock.calls[0][0].data).toMatchObject({
      integrationId: 'int-c', provider: 'aruba_central', externalId: 'c1', deviceId: 'd-a', status: 'active',
    });
    expect(result).toMatchObject({ raised: 1, cleared: 0 });
    expect(mockEmit).toHaveBeenCalledWith('cloud:alarms', { integrationId: 'int-c', raised: 1, cleared: 0 });
  });

  test('the next poll starts at the last one minus the overlap; unchanged rows are not written', async () => {
    const p = provider({ alarms: [alarm('c1')], activeIds: ['c1'] });
    await service.pollProvider(p, NOW);
    const stored = { id: 'r1', ...alarm('c1'), deviceId: null };
    mockPrisma.cloudAlarm.findMany.mockImplementation(async ({ where }) => (where.externalId ? [stored] : [stored]));
    jest.clearAllMocks();

    await service.pollProvider(p, NOW + 300e3);
    expect(p.listAlarms.mock.calls[0][0].since).toEqual(new Date(NOW - 15 * 60e3));
    expect(mockPrisma.cloudAlarm.create).not.toHaveBeenCalled();
    expect(mockPrisma.cloudAlarm.update).not.toHaveBeenCalled();
    expect(mockPrisma.cloudAlarm.updateMany).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('a cleared alarm is written with its reason; one missing from the active list clears without one', async () => {
    const c1 = { id: 'r1', ...alarm('c1'), deviceId: 'd-a' };
    const c2 = { id: 'r2', ...alarm('c2'), deviceId: null };
    mockPrisma.cloudAlarm.findMany.mockImplementation(async ({ where }) => (where.externalId ? [c1] : [c1, c2]));
    const p = provider({
      alarms: [alarm('c1', { status: 'cleared', clearedAt: new Date(NOW - 60e3), clearedReason: 'Due to clear alert timer configuration' })],
      activeIds: [],
    });

    const result = await service.pollProvider(p, NOW);
    expect(mockPrisma.cloudAlarm.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'cleared', clearedAt: new Date(NOW - 60e3), clearedReason: 'Due to clear alert timer configuration' },
    });
    expect(mockPrisma.cloudAlarm.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r2'] } },
      data: { status: 'cleared', clearedAt: new Date(NOW), clearedReason: null },
    });
    expect(result.cleared).toBe(2);
  });

  test('point events (no active list) never clear anything', async () => {
    const p = provider({ alarms: [alarm('m1', { stateful: false, status: 'event' })], activeIds: null });
    await service.pollProvider(p, NOW);
    expect(mockPrisma.cloudAlarm.updateMany).not.toHaveBeenCalled();
  });

  test('the env-var integration owns devices without an integration id', async () => {
    await service.pollProvider(provider({ alarms: [], activeIds: [] }, 'env-aruba-central'), NOW);
    expect(mockPrisma.device.findMany.mock.calls[0][0].where).toEqual({ cloudIntegrationId: null });
  });
});

describe('pollAll', () => {
  test('a failed read changes nothing and the other integrations still poll', async () => {
    const bad = provider(new Error('502 Bad Gateway'), 'int-bad');
    const good = provider({ alarms: [], activeIds: [] }, 'int-good');
    CloudProviderFactory.activeProviders.mockResolvedValue([bad, good, { id: 'x', supports: () => false }]);

    const results = await service.pollAll();
    expect(results).toEqual([
      { integrationId: 'int-bad', name: 'Central', error: '502 Bad Gateway' },
      expect.objectContaining({ integrationId: 'int-good', raised: 0 }),
    ]);
    expect(mockPrisma.cloudAlarm.updateMany).not.toHaveBeenCalled();
    // Prune keeps active stateful alarms.
    expect(mockPrisma.cloudAlarm.deleteMany.mock.calls[0][0].where.status).toEqual({ not: 'active' });
  });
});
