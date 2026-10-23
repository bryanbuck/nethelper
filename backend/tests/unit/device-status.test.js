/**
 * The displayed device status (utils/device-status.js) and the ping monitor's
 * alert for a device its cloud still reports online.
 */
const mockPrisma = {
  device: {
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

const { effectiveStatus, statusWhere } = require('../../src/utils/device-status');
const alertService = require('../../src/services/alert.service');
const socket = require('../../src/websocket/socket.handler');
const pingMonitor = require('../../src/services/ping-monitor.service');

const cloud = (over) => ({ managementMode: 'cloud', cloudStatus: 'online', pingStatus: 'offline', ...over });

describe('effectiveStatus', () => {
  test('a cloud device up in the cloud but not answering ping is a warning', () => {
    expect(effectiveStatus(cloud())).toBe('warning');
  });

  test('a cloud device down in the cloud whose address answers ping is a warning', () => {
    // Central kept an offline switch's old IP, which another switch now uses.
    expect(effectiveStatus(cloud({ pingStatus: 'online', cloudStatus: 'offline' }))).toBe('warning');
    expect(effectiveStatus(cloud({ pingStatus: 'online', cloudStatus: 'offline', managementMode: 'direct' }))).toBe('online');
  });

  test('otherwise ping wins, then the cloud', () => {
    expect(effectiveStatus(cloud({ cloudStatus: 'offline' }))).toBe('offline');
    expect(effectiveStatus(cloud({ managementMode: 'direct' }))).toBe('offline');
    expect(effectiveStatus(cloud({ pingStatus: 'online', cloudStatus: 'online' }))).toBe('online');
    expect(effectiveStatus(cloud({ pingStatus: null, cloudStatus: 'offline' }))).toBe('offline');
    expect(effectiveStatus({})).toBe('offline');
  });
});

describe('statusWhere matches effectiveStatus', () => {
  // A tiny evaluator for the Prisma where shapes statusWhere builds.
  const matches = (where, row) => {
    if (where.OR) return where.OR.some((w) => matches(w, row));
    if (where.AND) return where.AND.every((w) => matches(w, row));
    if (where.NOT) return !matches(where.NOT, row);
    return Object.entries(where).every(([key, value]) => (row[key] ?? null) === value);
  };
  const rows = [];
  for (const pingStatus of [null, 'online', 'warning', 'offline']) {
    for (const cloudStatus of ['online', 'offline', 'warning']) {
      for (const managementMode of ['cloud', 'direct']) rows.push({ pingStatus, cloudStatus, managementMode });
    }
  }

  test.each(['online', 'offline', 'warning'])('%s', (status) => {
    for (const row of rows) {
      expect([row, matches(statusWhere(status), row)]).toEqual([row, effectiveStatus(row) === status]);
    }
  });
});

describe('ping monitor', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a device its cloud reports online "is not answering ping", and the event carries warning', async () => {
    await pingMonitor.updateDeviceStatus('d1', 'JNEX-01', false, null, 5, 'warning', {
      managementMode: 'cloud', cloudStatus: 'online', cloudIntegration: { name: 'My Mist' },
    });

    expect(alertService.raise).toHaveBeenCalledWith('device.offline', expect.objectContaining({
      title: 'JNEX-01 is not answering ping',
      message: expect.stringMatching(/My Mist reports it online/),
    }), expect.anything());
    expect(socket.emit).toHaveBeenCalledWith('device:status:update', expect.objectContaining({
      status: 'warning', pingStatus: 'offline',
    }));
  });

  test('a direct device is plainly offline', async () => {
    await pingMonitor.updateDeviceStatus('d2', 'sw', false, null, 5, 'warning', { managementMode: 'direct' });

    expect(alertService.raise).toHaveBeenCalledWith('device.offline', expect.objectContaining({ title: 'sw is offline' }), expect.anything());
    expect(socket.emit).toHaveBeenCalledWith('device:status:update', expect.objectContaining({ status: 'offline' }));
  });

  test('a device that starts answering sends its pingLastSeen with the transition', async () => {
    await pingMonitor.updateDeviceStatus('d2', 'sw', true, 3, 0, 'offline', { managementMode: 'direct' });

    expect(socket.emit).toHaveBeenCalledWith('device:status:update', expect.objectContaining({
      pingStatus: 'online', pingLastSeen: expect.any(Date),
    }));
  });

  test('a successful ping stamps pingLastSeen', async () => {
    await pingMonitor.updateDeviceStatus('d2', 'sw', true, 3, 0, 'online', { managementMode: 'direct' });

    const { data } = mockPrisma.device.update.mock.calls[0][0];
    expect(data.pingLastSeen).toBeInstanceOf(Date);
    expect(data.lastSeen).toBe(data.pingLastSeen);
  });

  test('a settled transition is recorded once as a ping event, with the last reply', async () => {
    const lastReply = new Date('2026-10-22T10:00:00Z');
    mockPrisma.device.findUnique.mockResolvedValueOnce({ pingSuccessRate: 50, pingLastSeen: lastReply });
    mockPrisma.deviceEvent.findFirst.mockResolvedValueOnce({ type: 'ping.online' });

    await pingMonitor.updateDeviceStatus('d2', 'sw', false, null, 2, 'warning', { managementMode: 'direct' });

    expect(mockPrisma.deviceEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      deviceId: 'd2', type: 'ping.offline', source: 'ping', data: { previous: 'online', lastReply },
    }) });
  });

  test('a blip (warning) records nothing, and a repeat of the last recorded state records nothing', async () => {
    await pingMonitor.updateDeviceStatus('d2', 'sw', false, null, 0, 'online', { managementMode: 'direct' });
    expect(mockPrisma.deviceEvent.findFirst).not.toHaveBeenCalled();

    mockPrisma.deviceEvent.findFirst.mockResolvedValueOnce({ type: 'ping.online' });
    await pingMonitor.updateDeviceStatus('d2', 'sw', true, 3, 1, 'warning', { managementMode: 'direct' });
    expect(mockPrisma.deviceEvent.create).not.toHaveBeenCalled();
  });
});
