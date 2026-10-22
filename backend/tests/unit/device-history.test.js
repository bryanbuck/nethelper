/**
 * The device History tab's data (services/device-history.service.js): status
 * lanes from ping./cloud. events, the combined lane, and backup markers.
 */
const mockPrisma = {
  device: { findUnique: jest.fn() },
  deviceEvent: { findFirst: jest.fn(), findMany: jest.fn() },
  configBackup: { findMany: jest.fn(), findFirst: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const {
  getHistory, resolveWindow, buildSegments, combineSegments,
} = require('../../src/services/device-history.service');

const t = (hhmm) => new Date(`2026-10-22T${hhmm}:00Z`);
const from = t('00:00');
const to = t('12:00');

describe('resolveWindow', () => {
  const now = t('12:00');
  test('a range ends now', () => {
    expect(resolveWindow({ range: '7d' }, now)).toEqual({ from: new Date(now - 7 * 24 * 3600e3), to: now });
  });
  test('bad input is refused', () => {
    expect(() => resolveWindow({ range: '1y' }, now)).toThrow(/range must be/);
    expect(() => resolveWindow({ from: 'nope' }, now)).toThrow(/ISO/);
    expect(() => resolveWindow({ from: t('11:00').toISOString(), to: t('10:00').toISOString() }, now)).toThrow(/before/);
    expect(() => resolveWindow({ from: '2026-01-01T00:00:00Z', to: now.toISOString() }, now)).toThrow(/90 days/);
  });
});

describe('buildSegments', () => {
  test('time before the first known state is unknown', () => {
    expect(buildSegments([{ occurredAt: t('03:00'), type: 'ping.online' }], null, 'ping.', from, to)).toEqual([
      { from, to: t('03:00'), state: 'unknown' },
      { from: t('03:00'), to, state: 'online' },
    ]);
  });

  test('the event before the window gives the starting state; repeats merge', () => {
    const events = [
      { occurredAt: t('02:00'), type: 'cloud.offline' },
      { occurredAt: t('02:30'), type: 'cloud.offline' },
      { occurredAt: t('04:00'), type: 'cloud.online' },
    ];
    expect(buildSegments(events, { type: 'cloud.online' }, 'cloud.', from, to)).toEqual([
      { from, to: t('02:00'), state: 'online' },
      { from: t('02:00'), to: t('04:00'), state: 'offline' },
      { from: t('04:00'), to, state: 'online' },
    ]);
  });
});

describe('combineSegments', () => {
  test('marks where only ping or only the cloud sees the device', () => {
    const ping = [
      { from, to: t('02:00'), state: 'unknown' },
      { from: t('02:00'), to: t('06:00'), state: 'online' },
      { from: t('06:00'), to, state: 'offline' },
    ];
    const cloud = [
      { from, to: t('04:00'), state: 'online' },
      { from: t('04:00'), to: t('08:00'), state: 'offline' },
      { from: t('08:00'), to, state: 'online' },
    ];
    expect(combineSegments(ping, cloud, from, to)).toEqual([
      { from, to: t('04:00'), state: 'online' },
      { from: t('04:00'), to: t('06:00'), state: 'warning', reason: 'ping-only' },
      { from: t('06:00'), to: t('08:00'), state: 'offline' },
      { from: t('08:00'), to, state: 'warning', reason: 'cloud-only' },
    ]);
  });
});

describe('getHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.deviceEvent.findFirst.mockResolvedValue(null);
    mockPrisma.deviceEvent.findMany.mockResolvedValue([]);
    mockPrisma.configBackup.findMany.mockResolvedValue([]);
    mockPrisma.configBackup.findFirst.mockResolvedValue(null);
  });

  test('an unknown device is null', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(null);
    expect(await getHistory('nope', { from: from.toISOString(), to: to.toISOString() })).toBeNull();
  });

  test('a direct device has only the ping lane', async () => {
    mockPrisma.device.findUnique.mockResolvedValue({ id: 'd1', managementMode: 'direct', cloudIntegrationId: null });
    const history = await getHistory('d1', { from: from.toISOString(), to: to.toISOString() });
    expect(history.lanes.map((l) => l.key)).toEqual(['ping']);
  });

  test('a cloud device gets ping, cloud and combined lanes; a changed backup says since when', async () => {
    mockPrisma.device.findUnique.mockResolvedValue({
      id: 'd1', managementMode: 'cloud', cloudIntegrationId: 'i1', cloudIntegration: { name: 'Lab Mist', provider: 'juniper_mist' },
    });
    mockPrisma.configBackup.findFirst.mockResolvedValue({ createdAt: t('00:00') });
    mockPrisma.configBackup.findMany.mockResolvedValue([
      { id: 'b1', createdAt: t('01:00'), status: 'success', trigger: 'scheduled', hasChanges: false },
      { id: 'b2', createdAt: t('05:00'), status: 'failed', trigger: 'scheduled', hasChanges: null, error: 'timeout' },
      { id: 'b3', createdAt: t('09:00'), status: 'success', trigger: 'manual', hasChanges: true },
    ]);

    const history = await getHistory('d1', { from: from.toISOString(), to: to.toISOString() });

    expect(history.lanes.map((l) => l.key)).toEqual(['ping', 'cloud', 'combined']);
    expect(history.lanes[1]).toMatchObject({ label: 'Lab Mist', provider: 'juniper_mist' });
    expect(history.markers).toEqual([
      expect.objectContaining({ id: 'b1', changed: false }),
      expect.objectContaining({ id: 'b2', status: 'failed', error: 'timeout', changed: false }),
      expect.objectContaining({ id: 'b3', changed: true, changedSince: t('01:00') }),
    ]);
  });
});
