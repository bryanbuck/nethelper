/**
 * The displayed device status (utils/device-status.js) and the ping monitor's
 * alert for a device its cloud still reports online.
 */
const mockPrisma = {
  device: {
    findUnique: jest.fn(async () => ({ pingSuccessRate: 50 })),
    update: jest.fn(async () => ({})),
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

  test('otherwise ping wins, then the cloud', () => {
    expect(effectiveStatus(cloud({ cloudStatus: 'offline' }))).toBe('offline');
    expect(effectiveStatus(cloud({ managementMode: 'direct' }))).toBe('offline');
    expect(effectiveStatus(cloud({ pingStatus: 'online', cloudStatus: 'offline' }))).toBe('online');
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
      managementMode: 'cloud', cloudStatus: 'online', cloudIntegration: { name: 'Buck Home' },
    });

    expect(alertService.raise).toHaveBeenCalledWith('device.offline', expect.objectContaining({
      title: 'JNEX-01 is not answering ping',
      message: expect.stringMatching(/Buck Home reports it online/),
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
});
