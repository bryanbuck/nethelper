/**
 * services/live: the state monitor's lifecycle (holders, push stream,
 * resync, reconnect) and the live view's watcher/polling lifecycle. The
 * device API is a fake; nothing here opens a socket.
 */
const { CapabilityError } = require('../../src/services/cloud-providers/errors');

const mockEvents = [];
const mockDevices = new Map();
const mockPrisma = {
  device: {
    findUnique: jest.fn(async ({ where }) => mockDevices.get(where.id) || null),
    findMany: jest.fn(async () => [...mockDevices.values()].filter((d) => d.liveMonitoring)),
  },
  deviceEvent: {
    create: jest.fn(async ({ data }) => {
      const row = { id: `e${mockEvents.length + 1}`, occurredAt: new Date(), ...data };
      mockEvents.push(row);
      return row;
    }),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  },
};
const mockEmit = jest.fn();

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/websocket/socket.handler', () => ({
  getIO: () => ({ emit: mockEmit, to: () => ({ emit: mockEmit }) }),
}));
jest.mock('../../src/services/settings.service', () => ({
  getDeviceCredentialsForUse: jest.fn(async () => ({ username: 'u', password: 'p' })),
}));
jest.mock('../../src/services/device-api/device-api-factory', () => ({ createDeviceAPI: jest.fn() }));

const DeviceAPIFactory = require('../../src/services/device-api/device-api-factory');
const settingsService = require('../../src/services/settings.service');
const { StateMonitorService, unsupportedReason } = require('../../src/services/live/state-monitor.service');

const port = (name, over = {}) => ({
  port: name, description: null, adminUp: true, linkUp: true, speedMbps: 1000, duplex: 'full',
  poe: { status: 'delivering', pdType: 'Type1', pdClass: 'Class2', powerW: 4 }, ...over,
});

function fakeApi(initialPorts) {
  const api = {
    ports: initialPorts,
    handlers: null,
    closed: 0,
    getPortState: jest.fn(async () => api.ports.map((p) => ({ ...p }))),
    openNotificationStream: jest.fn(async (_ports, handlers) => {
      api.handlers = handlers;
      return { close: () => { api.closed += 1; } };
    }),
    getInterfaceCounters: jest.fn(async () => ({ '1/1/1': { rxBytes: 1000, txBytes: 1000, rxPackets: 1, txPackets: 1, errors: 0 } })),
    getPoePower: jest.fn(async () => ({ '1/1/1': 4 })),
    getResourceUtilization: jest.fn(async () => ({ cpu: 7, memory: 25 })),
    logout: jest.fn(async () => {}),
  };
  return api;
}

const cx = (over = {}) => ({
  id: 'd1', name: 'sw1', type: 'switch', vendor: 'aruba', platform: 'aos-cx',
  managementMode: 'direct', ipAddress: '10.0.0.2', apiCredentialId: 'c1', liveMonitoring: true, ...over,
});

const linkFrame = (seq, linkUp) => ({
  updates: [{ port: '1/1/1', operation: 'modified', link: { linkUp, speedMbps: linkUp ? 1000 : null } }],
  sequences: [{ topic: 't-1/1/1', seq }],
});

beforeEach(() => {
  mockEvents.length = 0;
  mockDevices.clear();
});

describe('unsupportedReason', () => {
  test('AOS-CX with an IP can be watched, direct or cloud-managed', () => {
    expect(unsupportedReason(cx())).toBeNull();
    expect(unsupportedReason(cx({ managementMode: 'cloud' }))).toBeNull();
  });

  test('no IP, or a platform without live state, is refused with a reason', () => {
    expect(unsupportedReason(cx({ ipAddress: null }))).toMatch(/IP address/);
    expect(unsupportedReason(cx({ platform: 'aos-s' }))).toMatch(/AOS-S/);
    expect(unsupportedReason(cx({ vendor: 'cisco', platform: 'meraki', managementMode: 'cloud' }))).toMatch(/Meraki/);
  });
});

describe('StateMonitorService', () => {
  let service;
  let api;

  beforeEach(() => {
    service = new StateMonitorService();
    api = fakeApi([port('1/1/1'), port('1/1/2', { linkUp: false, speedMbps: null, poe: null })]);
    DeviceAPIFactory.createDeviceAPI.mockReturnValue(api);
  });

  afterEach(() => service.stop());

  test('first holder connects: snapshot, then a stream over the snapshot ports', async () => {
    const monitor = await service.hold(cx(), 'always');
    expect(monitor.connected).toBe(true);
    expect(api.openNotificationStream).toHaveBeenCalledWith(['1/1/1', '1/1/2'], expect.any(Object));
    expect(service.getSnapshot('d1').ports).toHaveLength(2);
    expect(mockEvents).toHaveLength(0); // a baseline is not a change
  });

  test('notifications become persisted, broadcast events', async () => {
    await service.hold(cx(), 'always');
    await api.handlers.onUpdate({ ...linkFrame(1, true), initial: true });
    await api.handlers.onUpdate(linkFrame(2, false));

    expect(mockEvents.map((e) => [e.type, e.port, e.source])).toEqual([['port.link.down', '1/1/1', 'push']]);
    expect(mockEmit).toHaveBeenCalledWith('device:event', expect.objectContaining({ type: 'port.link.down', deviceName: 'sw1' }));
  });

  test('a skipped sequence number forces a resync, which catches the missed change', async () => {
    await service.hold(cx(), 'always');
    await api.handlers.onUpdate({ ...linkFrame(1, true), initial: true });
    api.ports = [port('1/1/1', { poe: { status: 'searching', pdType: null, pdClass: null, powerW: 0 } }), port('1/1/2', { linkUp: false, speedMbps: null, poe: null })];

    await api.handlers.onUpdate(linkFrame(3, true)); // 2 never arrived

    expect(api.getPortState).toHaveBeenCalledTimes(2);
    expect(mockEvents.map((e) => [e.type, e.source])).toEqual([['port.poe.down', 'resync']]);
  });

  test('stream close: one disconnected event, reconnect, then missed changes and connected', async () => {
    jest.useFakeTimers();
    try {
      await service.hold(cx(), 'always');
      const firstHandlers = api.handlers;
      api.ports = [port('1/1/1', { linkUp: false, speedMbps: null }), port('1/1/2', { linkUp: false, speedMbps: null, poe: null })];

      await firstHandlers.onClose(1006);
      await firstHandlers.onClose(1006); // a stale duplicate must not schedule a second retry
      expect(mockEvents.map((e) => e.type)).toEqual(['monitor.disconnected']);

      await jest.advanceTimersByTimeAsync(6000);
      expect(api.openNotificationStream).toHaveBeenCalledTimes(2);
      expect(mockEvents.map((e) => e.type)).toEqual(['monitor.disconnected', 'port.link.down', 'monitor.connected']);
      expect(service.getMonitor('d1').connected).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('recycles onto a fresh session before the absolute timeout, without disconnect events', async () => {
    jest.useFakeTimers();
    try {
      await service.hold(cx(), 'always');
      await jest.advanceTimersByTimeAsync(6 * 3600000 + 1000);
      expect(api.closed).toBeGreaterThanOrEqual(1);
      expect(api.logout).toHaveBeenCalled();
      expect(api.openNotificationStream.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockEvents.filter((e) => e.type.startsWith('monitor.'))).toEqual([]);
      expect(service.getMonitor('d1').connected).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a resync that had to log in again recycles the stream', async () => {
    api.session = { loginTime: 1 };
    await service.hold(cx(), 'always');
    expect(api.openNotificationStream).toHaveBeenCalledTimes(1);
    api.session = { loginTime: 2 }; // makeAuthenticatedRequest re-logged in after a 401
    await service.getMonitor('d1').safeResync('periodic');
    expect(api.openNotificationStream).toHaveBeenCalledTimes(2);
    expect(api.closed).toBe(1);
  });

  test('no credential is a CapabilityError: reported once, never retried', async () => {
    jest.useFakeTimers();
    try {
      settingsService.getDeviceCredentialsForUse.mockResolvedValueOnce(null);
      const monitor = await service.hold(cx(), 'always');
      expect(monitor.connected).toBe(false);
      expect(monitor.lastError).toMatch(/credential/);
      await jest.advanceTimersByTimeAsync(600000);
      expect(DeviceAPIFactory.createDeviceAPI).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('the monitor runs until its last holder releases, then closes and logs out', async () => {
    await service.hold(cx(), 'always');
    await service.hold(cx(), 'view:s1');
    await service.release('d1', 'always');
    expect(service.getMonitor('d1')).not.toBeNull();
    await service.release('d1', 'view:s1');
    expect(service.getMonitor('d1')).toBeNull();
    expect(api.closed).toBe(1);
    expect(api.logout).toHaveBeenCalled();
  });

  test('refuses unsupported devices and enforces LIVE_MAX_CONNECTIONS', async () => {
    await expect(service.hold(cx({ platform: 'aos-s' }), 'always')).rejects.toBeInstanceOf(CapabilityError);
    process.env.LIVE_MAX_CONNECTIONS = '1';
    try {
      await service.hold(cx(), 'always');
      await expect(service.hold(cx({ id: 'd2' }), 'always')).rejects.toThrow(/limit of 1/);
    } finally {
      delete process.env.LIVE_MAX_CONNECTIONS;
    }
  });

  test('boot watches devices with liveMonitoring on', async () => {
    mockDevices.set('d1', cx());
    mockDevices.set('d2', cx({ id: 'd2', liveMonitoring: false }));
    await service.start();
    expect(service.getMonitor('d1')).not.toBeNull();
    expect(service.getMonitor('d2')).toBeNull();
  });
});

describe('LiveViewService', () => {
  let liveView;
  let stateMonitor;
  let api;

  beforeEach(() => {
    jest.isolateModules(() => {
      stateMonitor = require('../../src/services/live/state-monitor.service');
      liveView = require('../../src/services/live/live-view.service');
    });
    api = fakeApi([port('1/1/1')]);
    DeviceAPIFactory.createDeviceAPI.mockReturnValue(api);
    mockDevices.set('d1', cx({ liveMonitoring: false }));
  });

  afterEach(async () => {
    await liveView.stop();
    await stateMonitor.stop();
  });

  test('first viewer starts the monitor and returns its snapshot; last viewer stops both', async () => {
    const snapshot = await liveView.watch('d1', 'sock1');
    expect(snapshot.ports.map((p) => p.port)).toEqual(['1/1/1']);
    await liveView.watch('d1', 'sock2');
    expect(liveView.pollers.has('d1')).toBe(true);

    await liveView.unwatch('d1', 'sock1');
    expect(stateMonitor.getMonitor('d1')).not.toBeNull();
    await liveView.unwatchAll('sock2');
    expect(liveView.pollers.has('d1')).toBe(false);
    expect(stateMonitor.getMonitor('d1')).toBeNull();
  });

  test('samples reuse the monitor session; rates appear from the second sample', async () => {
    await liveView.watch('d1', 'sock1');
    const state = liveView.pollers.get('d1');
    // watch() takes the first sample immediately; let it finish.
    while (state.busy || !state.previous) await new Promise((resolve) => setImmediate(resolve));
    api.getInterfaceCounters.mockResolvedValueOnce({ '1/1/1': { rxBytes: 11000, txBytes: 1000, rxPackets: 11, txPackets: 1, errors: 0 } });
    const now = jest.spyOn(Date, 'now').mockReturnValue(state.previousAt + 10000);
    await liveView.sample('d1', state);
    now.mockRestore();

    const metrics = mockEmit.mock.calls.filter(([event]) => event === 'device:live:metrics').map(([, payload]) => payload);
    expect(metrics[metrics.length - 2].hasRates).toBe(false);
    const last = metrics[metrics.length - 1];
    expect(last.hasRates).toBe(true);
    expect(last.ports['1/1/1']).toMatchObject({ rxBps: 8000, txBps: 0, poeW: 4 });
    expect(last.cpu).toBe(7);
    expect(DeviceAPIFactory.createDeviceAPI).toHaveBeenCalledTimes(1);
  });

  test('unknown device is a 404', async () => {
    await expect(liveView.watch('nope', 'sock1')).rejects.toMatchObject({ statusCode: 404 });
  });
});
