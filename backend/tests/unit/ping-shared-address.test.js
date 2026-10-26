/**
 * Shared addresses: a device its cloud reports offline, whose IP another
 * device now holds, is not pinged, so it shows its cloud's `offline` instead
 * of `warning` (the reply is the other device's).
 */
const mockPrisma = {
  device: {
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => ({ pingSuccessRate: 50 })),
    update: jest.fn(async () => ({})),
  },
  deviceEvent: {
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }) => ({ id: 'e1', occurredAt: new Date(), ...data })),
  },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/alert.service', () => ({ raise: jest.fn(), clear: jest.fn() }));
jest.mock('../../src/websocket/socket.handler', () => {
  const emit = jest.fn();
  return { getIO: () => ({ emit }), emit };
});

const alertService = require('../../src/services/alert.service');
const socket = require('../../src/websocket/socket.handler');
const pingMonitor = require('../../src/services/ping-monitor.service');
const { splitSharedAddresses } = pingMonitor;

const dev = (id, over) => ({
  id, name: id.toUpperCase(), ipAddress: '10.0.0.5', managementMode: 'cloud', cloudStatus: 'online',
  pingStatus: 'online', consecutiveFailures: 0, ...over,
});
const ids = (list) => list.map((d) => (d.device || d).id).sort();

describe('splitSharedAddresses', () => {
  test('a cloud-offline device steps aside for a cloud-online one with its IP', () => {
    const old = dev('old', { cloudStatus: 'offline' });
    const now = dev('now');
    const { toPing, stepAside } = splitSharedAddresses([old, now, dev('elsewhere', { ipAddress: '10.0.0.9', cloudStatus: 'offline' })]);
    expect(ids(toPing)).toEqual(['elsewhere', 'now']);
    expect(stepAside).toEqual([{ device: old, answeredBy: { id: 'now', name: 'NOW' } }]);
  });

  test('a directly managed device also explains the reply', () => {
    const { stepAside } = splitSharedAddresses([dev('old', { cloudStatus: 'offline' }), dev('fw', { managementMode: 'direct', cloudStatus: null })]);
    expect(stepAside.map((s) => [s.device.id, s.answeredBy.id])).toEqual([['old', 'fw']]);
  });

  test('otherwise every device is pinged, as before', () => {
    // Every holder offline in its cloud: nothing explains a reply
    expect(splitSharedAddresses([dev('a', { cloudStatus: 'offline' }), dev('b', { cloudStatus: 'offline' })]).stepAside).toEqual([]);
    // Duplicates of one device, both up
    expect(splitSharedAddresses([dev('a'), dev('b')]).stepAside).toEqual([]);
    // A cloud status other than offline (unknown, warning) is not enough
    expect(splitSharedAddresses([dev('a', { cloudStatus: null }), dev('b', { cloudStatus: 'warning' }), dev('c')]).stepAside).toEqual([]);
  });
});

describe('the sweep', () => {
  beforeEach(() => jest.clearAllMocks());

  test('clears the stepping-aside device\'s ping result once and pings the rest', async () => {
    const old = dev('old', { cloudStatus: 'offline', cloudIntegration: { name: 'Central' } });
    const now = dev('now');
    mockPrisma.device.findMany.mockResolvedValueOnce([old, now]);
    const pinged = jest.spyOn(pingMonitor, 'pingDeviceWithRetries').mockResolvedValue({ alive: true, time: 3 });

    await pingMonitor.checkAllDevices();

    expect(pinged).toHaveBeenCalledTimes(1);
    expect(mockPrisma.device.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: expect.objectContaining({ pingStatus: null, consecutiveFailures: 0, pingResponseTime: null }),
    });
    expect(socket.emit).toHaveBeenCalledWith('device:status:update', expect.objectContaining({
      deviceId: 'old', pingStatus: null, status: 'offline',
    }));
    expect(alertService.clear).toHaveBeenCalledWith('device.offline', { subjectKey: 'old', deviceId: 'old' });
    expect(mockPrisma.deviceEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      deviceId: 'old', type: 'ping.unknown', source: 'ping', data: expect.objectContaining({ answeredBy: { id: 'now', name: 'NOW' } }),
    }) });
    expect(pingMonitor.getStats().lastCheck).toMatchObject({ total: 1, successful: 1, notPinged: 1 });

    // Already cleared: the next sweep writes nothing for it
    jest.clearAllMocks();
    mockPrisma.device.findMany.mockResolvedValueOnce([{ ...old, pingStatus: null }, now]);
    await pingMonitor.checkAllDevices();
    expect(mockPrisma.device.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'old' } }));
    pinged.mockRestore();
  });
});
