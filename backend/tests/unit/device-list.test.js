/**
 * GET /devices listing: the unpaged list stays an array, a page uses
 * skip/take with a whitelisted orderBy, and carries the filtered total plus a
 * fleet-wide status summary. Prisma is mocked.
 */
const mockPrisma = {
  device: {
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  },
};

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/alert.service', () => ({ raise: jest.fn(), clear: jest.fn() }));

const deviceService = require('../../src/services/device.service');
const { statusWhere } = require('../../src/utils/device-status');

const row = (over = {}) => ({
  id: 'd1', name: 'sw-1', managementMode: 'direct', pingStatus: 'online', cloudStatus: 'offline', ...over,
});

describe('deviceService.getDevices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.device.findMany.mockResolvedValue([row()]);
    mockPrisma.device.count.mockResolvedValue(0);
  });

  test('without a limit, returns every matching row as an array', async () => {
    const result = await deviceService.getDevices({});

    expect(Array.isArray(result)).toBe(true);
    expect(result[0].status).toBe('online');
    const args = mockPrisma.device.findMany.mock.calls[0][0];
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect(args.orderBy).toEqual([{ pingStatus: 'asc' }, { name: 'asc' }, { id: 'asc' }]);
    expect(mockPrisma.device.count).not.toHaveBeenCalled();
  });

  test('a page skips the earlier pages and takes one page', async () => {
    await deviceService.getDevices({}, { page: 3, limit: 25 });

    const args = mockPrisma.device.findMany.mock.calls[0][0];
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
  });

  test('sorts by a whitelisted column, with id as the tie-break', async () => {
    await deviceService.getDevices({}, { limit: 10, sortBy: 'name', sortOrder: 'desc' });

    expect(mockPrisma.device.findMany.mock.calls[0][0].orderBy)
      .toEqual([{ name: 'desc' }, { id: 'asc' }]);
  });

  test('status sorts by ping, then cloud status', async () => {
    await deviceService.getDevices({}, { limit: 10, sortBy: 'status', sortOrder: 'asc' });

    expect(mockPrisma.device.findMany.mock.calls[0][0].orderBy).toEqual([
      { pingStatus: { sort: 'asc', nulls: 'last' } },
      { cloudStatus: 'asc' },
      { id: 'asc' },
    ]);
  });

  test('an unknown sort key falls back to the default order', async () => {
    await deviceService.getDevices({}, { limit: 10, sortBy: 'password', sortOrder: 'desc' });

    expect(mockPrisma.device.findMany.mock.calls[0][0].orderBy)
      .toEqual([{ pingStatus: 'asc' }, { name: 'asc' }, { id: 'asc' }]);
  });

  test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('a built-in name as sort key (%s) falls back too', async (sortBy) => {
    await deviceService.getDevices({}, { limit: 10, sortBy, sortOrder: 'desc' });

    expect(mockPrisma.device.findMany.mock.calls[0][0].orderBy)
      .toEqual([{ pingStatus: 'asc' }, { name: 'asc' }, { id: 'asc' }]);
  });

  test('a page returns the filtered total and a fleet-wide summary', async () => {
    mockPrisma.device.count.mockImplementation(async (args = {}) => {
      if (args.where === undefined) return 40;
      if (args.where.type === 'switch') return 12;
      if (JSON.stringify(args.where) === JSON.stringify(statusWhere('online'))) return 30;
      if (JSON.stringify(args.where) === JSON.stringify(statusWhere('offline'))) return 7;
      if (JSON.stringify(args.where) === JSON.stringify(statusWhere('warning'))) return 3;
      return -1;
    });

    const result = await deviceService.getDevices({ type: 'switch' }, { page: 1, limit: 10 });

    expect(result.devices).toHaveLength(1);
    expect(result.total).toBe(12);
    expect(result.summary).toEqual({ total: 40, online: 30, offline: 7, warning: 3 });
  });

  test('search also matches model, location and MAC', async () => {
    await deviceService.getDevices({ search: '6200' });

    const fields = mockPrisma.device.findMany.mock.calls[0][0].where.OR.map((c) => Object.keys(c)[0]);
    expect(fields).toEqual(expect.arrayContaining(['name', 'serial', 'ipAddress', 'model', 'location', 'macAddress']));
  });
});

describe('deviceService.findSameIpDevices', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists other devices with the IP, with their displayed status', async () => {
    mockPrisma.device.findMany.mockResolvedValue([
      row({ id: 'd2', name: 'Sw-CoreA', managementMode: 'cloud', pingStatus: 'online', cloudStatus: 'online' }),
    ]);

    const others = await deviceService.findSameIpDevices({ id: 'd1', ipAddress: '192.168.252.4' });

    expect(mockPrisma.device.findMany.mock.calls[0][0].where).toEqual({ ipAddress: '192.168.252.4', id: { not: 'd1' } });
    expect(others).toEqual([expect.objectContaining({ id: 'd2', name: 'Sw-CoreA', status: 'online' })]);
  });

  test('a device without an IP has none, without a query', async () => {
    expect(await deviceService.findSameIpDevices({ id: 'd1', ipAddress: null })).toEqual([]);
    expect(mockPrisma.device.findMany).not.toHaveBeenCalled();
  });
});
