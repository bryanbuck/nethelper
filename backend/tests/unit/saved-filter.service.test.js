/**
 * Saved Devices-page filters (services/saved-filter.service.js): every query
 * is scoped to its user, a view keeps only what the table understands, the
 * per-user limit, duplicate names as a 409 that names it, and a filter that
 * isn't the caller's as a 404.
 */
const mockPrisma = {
  savedDeviceFilter: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn(async ({ data }) => ({ id: 'f1', ...data })),
    update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    delete: jest.fn(async () => ({})),
  },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const savedFilters = require('../../src/services/saved-filter.service');
const { normalizeView } = savedFilters;
const { SORT_KEYS, MAX_SAVED_FILTERS } = require('../../src/constants/device-view');

beforeEach(() => jest.clearAllMocks());

test('SORT_KEYS match the device list\'s sortable fields', () => {
  const deviceService = require('../../src/services/device.service');
  expect([...SORT_KEYS].sort()).toEqual([...deviceService.SORT_KEYS].sort());
});

describe('normalizeView', () => {
  test('keeps known filters, trims, drops blanks and unknown keys', () => {
    expect(normalizeView({
      filters: { status: ' offline ', type: '', group: 'g1', bogus: 'x', platform: 7 },
      search: '  core ',
      sortBy: [{ key: 'name', order: 'desc' }, { key: 'type', order: 'asc' }],
      page: 4,
      itemsPerPage: 50,
    })).toEqual({ filters: { status: 'offline', group: 'g1' }, search: 'core', sortBy: [{ key: 'name', order: 'desc' }] });
  });

  test('an unknown sort key is dropped, an odd order becomes asc', () => {
    expect(normalizeView({ sortBy: [{ key: 'constructor' }] }).sortBy).toEqual([]);
    expect(normalizeView({ sortBy: [{ key: 'ipAddress', order: 'sideways' }] }).sortBy).toEqual([{ key: 'ipAddress', order: 'asc' }]);
  });

  test('garbage becomes an empty view', () => {
    for (const view of [null, 'x', [], { filters: 'x', sortBy: 'name' }]) {
      expect(normalizeView(view)).toEqual({ filters: {}, search: '', sortBy: [] });
    }
  });

  test('long values are cut', () => {
    expect(normalizeView({ search: 'a'.repeat(500) }).search).toHaveLength(200);
  });
});

test('list is scoped to the user', async () => {
  await savedFilters.list('u1');
  expect(mockPrisma.savedDeviceFilter.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
});

test('create stores the trimmed name and normalized view for the user', async () => {
  const row = await savedFilters.create('u1', { name: '  Offline APs ', view: { filters: { status: 'offline', type: 'access_point' } } });
  expect(mockPrisma.savedDeviceFilter.create.mock.calls[0][0].data).toEqual({
    userId: 'u1',
    name: 'Offline APs',
    view: { filters: { status: 'offline', type: 'access_point' }, search: '', sortBy: [] },
  });
  expect(row.id).toBe('f1');
});

test('create refuses a blank name and the limit', async () => {
  await expect(savedFilters.create('u1', { name: '  ', view: {} })).rejects.toMatchObject({ statusCode: 400 });
  mockPrisma.savedDeviceFilter.count.mockResolvedValueOnce(MAX_SAVED_FILTERS);
  await expect(savedFilters.create('u1', { name: 'One more', view: {} })).rejects.toMatchObject({ statusCode: 400 });
  expect(mockPrisma.savedDeviceFilter.create).not.toHaveBeenCalled();
});

test('a duplicate name is a 409 that names it', async () => {
  mockPrisma.savedDeviceFilter.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
  await expect(savedFilters.create('u1', { name: 'Core', view: {} }))
    .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('"Core"') });
});

test('another user\'s filter is not found, and is left alone', async () => {
  await expect(savedFilters.update('u2', 'f1', { name: 'Mine now' })).rejects.toMatchObject({ statusCode: 404 });
  await expect(savedFilters.remove('u2', 'f1')).rejects.toMatchObject({ statusCode: 404 });
  expect(mockPrisma.savedDeviceFilter.findFirst.mock.calls[0][0].where).toEqual({ id: 'f1', userId: 'u2' });
  expect(mockPrisma.savedDeviceFilter.update).not.toHaveBeenCalled();
  expect(mockPrisma.savedDeviceFilter.delete).not.toHaveBeenCalled();
});

test('update changes only what is given', async () => {
  mockPrisma.savedDeviceFilter.findFirst.mockResolvedValue({ id: 'f1' });
  await savedFilters.update('u1', 'f1', { view: { search: 'edge' } });
  expect(mockPrisma.savedDeviceFilter.update.mock.calls[0][0].data).toEqual({ view: { filters: {}, search: 'edge', sortBy: [] } });
  await expect(savedFilters.update('u1', 'f1', {})).rejects.toMatchObject({ statusCode: 400 });
  await savedFilters.remove('u1', 'f1');
  expect(mockPrisma.savedDeviceFilter.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
});
