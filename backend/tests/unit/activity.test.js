/**
 * The fleet Activity feed (services/activity.service.js): merges device
 * events, config changes and device alerts, leaves out starting states and
 * first captures, folds flaps, and pages by `before`.
 */
const mockPrisma = {
  device: { findMany: jest.fn() },
  deviceEvent: { findMany: jest.fn() },
  configBackup: { findMany: jest.fn(), groupBy: jest.fn() },
  alert: { findMany: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const { list, collapse, parseOptions } = require('../../src/services/activity.service');

const t = (hhmm) => new Date(`2026-10-22T${hhmm}:00Z`);
const ev = (id, type, at, extra = {}) => ({
  id, deviceId: 'd1', type, port: null, data: { previous: 'x' }, source: 'ping', occurredAt: at, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.deviceEvent.findMany.mockResolvedValue([]);
  mockPrisma.configBackup.findMany.mockResolvedValue([]);
  mockPrisma.configBackup.groupBy.mockResolvedValue([]);
  mockPrisma.alert.findMany.mockResolvedValue([]);
  mockPrisma.device.findMany.mockResolvedValue([{ id: 'd1', name: 'SW1', type: 'switch', vendor: 'aruba', platform: 'aos-cx' }]);
});

describe('parseOptions', () => {
  test('defaults leave port changes out', () => {
    expect(parseOptions({}).categories).toEqual(['status', 'restart', 'config', 'alert']);
  });
  test('bad input is refused', () => {
    expect(() => parseOptions({ categories: ['nope'] })).toThrow(/Unknown categories/);
    expect(() => parseOptions({ before: 'soon' })).toThrow(/ISO/);
  });
  test('limit is clamped', () => {
    expect(parseOptions({ limit: 9999 }).limit).toBe(200);
  });
});

describe('collapse', () => {
  const item = (id, type, at, port = null) => ({
    id, kind: 'event', category: type.startsWith('port.') ? 'port' : 'status', type, at, deviceId: 'd1', port,
  });

  test('repeats on one device/port within the window fold into one item', () => {
    const out = collapse([
      item('a', 'port.link.up', t('10:09'), '1/1/5'),
      item('b', 'port.link.down', t('10:05'), '1/1/5'),
      item('c', 'port.link.up', t('10:01'), '1/1/5'),
      item('d', 'port.link.up', t('10:04'), '1/1/6'),
    ]);
    expect(out).toEqual([
      expect.objectContaining({ id: 'a', count: 3, since: t('10:01') }),
      expect.not.objectContaining({ count: expect.anything() }),
    ]);
    expect(out[1].id).toBe('d');
  });

  test('a gap longer than the window starts a new item', () => {
    const out = collapse([item('a', 'ping.online', t('11:00')), item('b', 'ping.offline', t('10:00'))]);
    expect(out.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('restarts, config changes and alerts never fold', () => {
    const out = collapse([
      { ...item('a', 'device.restarted', t('10:02')), category: 'restart' },
      { ...item('b', 'device.restarted', t('10:01')), category: 'restart' },
      { id: 'c', kind: 'config', category: 'config', type: 'config.changed', at: t('10:00'), deviceId: 'd1' },
    ]);
    expect(out).toHaveLength(3);
  });
});

describe('list', () => {
  test('merges sources newest first and attaches devices', async () => {
    mockPrisma.deviceEvent.findMany.mockResolvedValue([ev('e1', 'ping.offline', t('10:00'))]);
    mockPrisma.configBackup.findMany.mockResolvedValue([
      { id: 'b1', deviceId: 'd1', deviceName: 'SW1', trigger: 'scheduled', createdAt: t('11:00'), warning: null },
    ]);
    mockPrisma.configBackup.groupBy.mockResolvedValue([{ deviceId: 'd1', _min: { createdAt: t('01:00') } }]);
    mockPrisma.alert.findMany.mockImplementation(({ orderBy }) => Promise.resolve(orderBy.firstSeenAt ? [{
      id: 'a1', rule: 'device.cloud-config', severity: 'warning', status: 'open', deviceId: 'd1', port: null,
      title: 'Out of sync', message: 'm', firstSeenAt: t('12:00'), resolvedAt: null, resolvedBy: null,
    }] : []));

    const { items, nextBefore } = await list({});
    expect(items.map((i) => i.id)).toEqual(['alert:a1:opened', 'backup:b1', 'event:e1']);
    expect(items[0].device).toEqual(expect.objectContaining({ name: 'SW1', vendor: 'aruba' }));
    expect(nextBefore).toBeNull();
  });

  test('status events must carry a previous state; port changes only on request', async () => {
    await list({});
    const where = mockPrisma.deviceEvent.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('previous');
    expect(JSON.stringify(where)).not.toContain('port.');

    await list({ categories: ['port'] });
    expect(JSON.stringify(mockPrisma.deviceEvent.findMany.mock.calls[1][0].where)).toContain('port.');
  });

  test("a device's first successful backup is not a change", async () => {
    mockPrisma.configBackup.findMany.mockResolvedValue([
      { id: 'b2', deviceId: 'd1', deviceName: 'SW1', trigger: 'manual', createdAt: t('09:00') },
    ]);
    mockPrisma.configBackup.groupBy.mockResolvedValue([{ deviceId: 'd1', _min: { createdAt: t('09:00') } }]);
    const { items } = await list({ categories: ['config'] });
    expect(items).toEqual([]);
  });

  test('ping/cloud offline alerts and merge resolutions are left out', async () => {
    await list({ categories: ['alert'] });
    const [opened, resolved] = mockPrisma.alert.findMany.mock.calls.map((c) => c[0].where);
    expect(opened.rule).toEqual({ notIn: ['device.offline', 'device.cloud-offline'] });
    expect(resolved.resolvedBy).toEqual({ not: 'merge' });
  });

  test('a full page returns nextBefore and keeps same-time items together', async () => {
    mockPrisma.deviceEvent.findMany.mockResolvedValue([
      ev('e1', 'device.restarted', t('10:03'), { deviceId: 'd1' }),
      ev('e2', 'device.restarted', t('10:02'), { deviceId: 'd2' }),
    ]);
    mockPrisma.configBackup.findMany.mockResolvedValue([
      { id: 'b1', deviceId: 'd3', deviceName: 'Gone', trigger: 'manual', createdAt: t('10:02') },
    ]);
    mockPrisma.configBackup.groupBy.mockResolvedValue([{ deviceId: 'd3', _min: { createdAt: t('01:00') } }]);

    const { items, nextBefore } = await list({ limit: 2 });
    expect(items.map((i) => i.id)).toEqual(['event:e1', 'event:e2', 'backup:b1']);
    expect(nextBefore).toBe(t('10:02').toISOString());
    // A deleted device keeps the name its backup recorded.
    expect(items[2].device).toEqual({ id: 'd3', name: 'Gone', deleted: true });
  });

  test('before pages strictly older; vendor narrows to its devices', async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([{ id: 'd9' }]);
    await list({ vendor: 'juniper', before: t('10:00').toISOString() });
    const where = mockPrisma.deviceEvent.findMany.mock.calls[0][0].where;
    expect(where.deviceId).toEqual({ in: ['d9'] });
    expect(where.occurredAt).toEqual({ lt: t('10:00') });
  });
});
