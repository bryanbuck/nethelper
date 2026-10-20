/**
 * Cloud integrations act system-wide (sync, status refresh, event streams),
 * so every admin manages all of them. They used to be filtered by the admin
 * who created them: a second admin saw an empty list and could not edit,
 * test, or delete an integration that was driving the whole system.
 */
const rows = [{
  id: 'mist-1', provider: 'juniper_mist', name: 'My Mist', userId: 'admin-a', isActive: true,
  baseUrl: 'https://api.ac2.mist.com', credentials: {}, _count: { devices: 2 },
}];
const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
const mockPrisma = {
  cloudIntegration: {
    findMany: jest.fn(async ({ where } = {}) => rows.filter((r) => matches(r, where))),
    findFirst: jest.fn(async ({ where } = {}) => rows.find((r) => matches(r, where)) || null),
    update: jest.fn(async ({ where, data }) => ({ ...rows.find((r) => matches(r, where)), ...data })),
    delete: jest.fn(async ({ where }) => rows.find((r) => matches(r, where))),
  },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({
  forIntegration: jest.fn(async () => ({ testConnection: async () => ({ success: true, message: 'ok' }) })),
  invalidate: jest.fn(),
}));

const settingsService = require('../../src/services/settings.service');

test('every admin sees an integration another admin created', async () => {
  const list = await settingsService.getCloudIntegrations();
  expect(list.map((i) => i.id)).toEqual(['mist-1']);
  expect(mockPrisma.cloudIntegration.findMany.mock.calls[0][0].where).toBeUndefined();
});

test('testing an integration finds it by id alone', async () => {
  const result = await settingsService.testCloudIntegration('mist-1');
  expect(result.success).toBe(true);
  expect(mockPrisma.cloudIntegration.findFirst.mock.calls[0][0].where).toEqual({ id: 'mist-1' });
});
