/**
 * Editing an API credential: a secret field left out, or sent back as the
 * mask the list hands out, keeps the stored value. Saving a credential whose
 * name changed used to store the literal "***" as its API key.
 */
const mockPrisma = {
  apiCredential: {
    findUnique: jest.fn(async () => ({ id: 'c1', name: 'Old', apiKey: 'enc-key', password: 'enc-pw' })),
    update: jest.fn(async ({ data }) => ({ id: 'c1', name: 'Old', apiKey: 'enc-key', password: 'enc-pw', ...data })),
  },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const settingsService = require('../../src/services/settings.service');
const encryption = require('../../src/utils/encryption');

beforeEach(() => jest.clearAllMocks());

test('the mask or a missing field keeps every stored secret', async () => {
  const result = await settingsService.updateApiCredential('c1', { name: 'New', apiKey: '***', password: '***', notes: 'n' });
  const { data } = mockPrisma.apiCredential.update.mock.calls[0][0];
  expect(data).toEqual({ name: 'New', notes: 'n' });
  expect(result).toMatchObject({ name: 'New', apiKey: '***', password: '***', apiSecret: null });
});

test('a new value is encrypted and stored; an empty one clears it', async () => {
  await settingsService.updateApiCredential('c1', { apiKey: 'real-key', apiSecret: '' });
  const { data } = mockPrisma.apiCredential.update.mock.calls[0][0];
  expect(encryption.decrypt(data.apiKey)).toBe('real-key');
  expect(data.apiSecret).toBeNull();
  expect('password' in data).toBe(false);
});
