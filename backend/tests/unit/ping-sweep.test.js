/**
 * The ping sweep: a pool (one silent device holds one slot, not a batch), a
 * single attempt for a device already offline, and the live monitor told when
 * a device stops or starts answering.
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
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../../src/services/live/state-monitor.service', () => ({ reachabilityChanged: jest.fn(async () => {}) }));

const stateMonitor = require('../../src/services/live/state-monitor.service');
const pingMonitor = require('../../src/services/ping-monitor.service');

const dev = (n, over) => ({
  id: `d${n}`, name: `D${n}`, ipAddress: `10.0.0.${n}`, managementMode: 'direct', cloudStatus: null,
  pingStatus: 'online', consecutiveFailures: 0, ...over,
});

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('pingDeviceWithRetries', () => {
  test('stops at the first reply, and sends no more than the attempts it was given', async () => {
    const probe = jest.spyOn(pingMonitor, 'pingDevice').mockResolvedValue({ alive: false, time: null });
    await pingMonitor.pingDeviceWithRetries('10.0.0.1', { attempts: 1 });
    expect(probe).toHaveBeenCalledTimes(1);

    probe.mockClear();
    probe.mockResolvedValue({ alive: true, time: 2 });
    expect(await pingMonitor.pingDeviceWithRetries('10.0.0.1')).toEqual({ alive: true, time: 2 });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe('the sweep', () => {
  test('a device already offline is pinged once, the others get the retries', async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([
      dev(1, { pingStatus: 'offline', consecutiveFailures: 9 }), dev(2), dev(3, { pingStatus: 'warning', consecutiveFailures: 1 }), dev(4, { pingStatus: null }),
    ]);
    const pinged = jest.spyOn(pingMonitor, 'pingDeviceWithRetries').mockResolvedValue({ alive: true, time: 1 });

    await pingMonitor.checkAllDevices();

    const attempts = Object.fromEntries(pinged.mock.calls.map(([ip, options]) => [ip, options.attempts]));
    expect(attempts).toEqual({ '10.0.0.1': 1, '10.0.0.2': 3, '10.0.0.3': 3, '10.0.0.4': 3 });
  });

  test('one silent device holds one slot: the rest of the fleet is done before it gives up', async () => {
    const devices = Array.from({ length: 50 }, (_, i) => dev(i + 1));
    mockPrisma.device.findMany.mockResolvedValueOnce(devices);
    let release;
    const silent = new Promise((resolve) => { release = () => resolve({ alive: false, time: null }); });
    const pinged = jest.spyOn(pingMonitor, 'pingDeviceWithRetries')
      .mockImplementation((ip) => (ip === '10.0.0.1' ? silent : Promise.resolve({ alive: true, time: 1 })));

    const sweep = pingMonitor.checkAllDevices();
    // Let the 49 that answer run to completion while the first is still waiting
    for (let i = 0; i < 500 && pingMonitor.getStats().lastCheck.successful < 49; i += 1) await new Promise(setImmediate);

    expect(pingMonitor.getStats().lastCheck.successful).toBe(49);
    expect(pinged).toHaveBeenCalledTimes(50);
    release();
    await sweep;
    expect(pingMonitor.getStats().lastCheck).toMatchObject({ total: 50, successful: 49, failed: 1 });
  });

  test('never more pings at once than the configured concurrency', async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce(Array.from({ length: 60 }, (_, i) => dev(i + 1)));
    let running = 0;
    let peak = 0;
    jest.spyOn(pingMonitor, 'pingDeviceWithRetries').mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(setImmediate);
      running -= 1;
      return { alive: true, time: 1 };
    });

    await pingMonitor.checkAllDevices();
    expect(peak).toBe(pingMonitor.getStats().config.concurrency);
  });
});

describe('telling the live monitor', () => {
  test('on reaching offline and on coming back, not on a missed check', async () => {
    await pingMonitor.updateDeviceStatus('d1', 'D1', false, null, 0, 'online'); // online -> warning
    expect(stateMonitor.reachabilityChanged).not.toHaveBeenCalled();

    await pingMonitor.updateDeviceStatus('d1', 'D1', false, null, 2, 'warning'); // -> offline
    expect(stateMonitor.reachabilityChanged).toHaveBeenLastCalledWith('d1', false);

    await pingMonitor.updateDeviceStatus('d1', 'D1', true, 3, 3, 'offline'); // -> online
    expect(stateMonitor.reachabilityChanged).toHaveBeenLastCalledWith('d1', true);

    await pingMonitor.updateDeviceStatus('d1', 'D1', true, 3, 0, 'online'); // unchanged
    expect(stateMonitor.reachabilityChanged).toHaveBeenCalledTimes(2);
  });
});
