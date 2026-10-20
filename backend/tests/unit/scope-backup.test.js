/**
 * scope-backup.service: cloud-scope (Mist org/site) backups. Providers, Prisma,
 * Git and the socket are mocked; files go to a temp dir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockDb = { rows: [] };
const mockPrisma = {
  scopeBackup: {
    create: jest.fn(async ({ data }) => {
      const row = { id: `s${mockDb.rows.length + 1}`, createdAt: new Date(Date.now() + mockDb.rows.length), ...data };
      mockDb.rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(mockDb.rows.find((r) => r.id === where.id), data)),
    findFirst: jest.fn(async ({ where }) => mockDb.rows
      .filter((r) => r.integrationId === where.integrationId && r.scopeType === where.scopeType
        && r.scopeId === where.scopeId && r.status === 'success' && r.id !== where.id.not)
      .sort((a, b) => b.createdAt - a.createdAt)[0] || null),
    findMany: jest.fn(async () => mockDb.rows.filter((r) => r.status === 'success').sort((a, b) => b.createdAt - a.createdAt)),
    findUnique: jest.fn(async ({ where }) => mockDb.rows.find((r) => r.id === where.id) || null),
    delete: jest.fn(async ({ where }) => { mockDb.rows = mockDb.rows.filter((r) => r.id !== where.id); }),
  },
};

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ activeProviders: jest.fn() }));
jest.mock('../../src/services/git-backup.service', () => ({
  commitScopeConfig: jest.fn(async () => ({ commitSha: 'abc123' })),
  pushIfConfigured: jest.fn(async () => ({ pushed: false })),
}));

const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const gitBackupService = require('../../src/services/git-backup.service');
const { CapabilityError } = require('../../src/services/cloud-providers/errors');
const scopeBackupService = require('../../src/services/scope-backup.service');

function mistProvider({ configs = {}, scopes } = {}) {
  return {
    id: 'int-mist',
    label: 'Mist (juniper_mist)',
    providerType: 'juniper_mist',
    integration: { name: 'Mist' },
    supports: (c) => c === 'scope-backup',
    listConfigScopes: jest.fn(async () => scopes || [
      { scopeType: 'org', scopeId: 'org-1', name: 'Acme' },
      { scopeType: 'site', scopeId: 'site-a', name: 'HQ' },
    ]),
    getScopeConfiguration: jest.fn(async (scope) => {
      const text = configs[scope.scopeId];
      if (text instanceof Error) throw text;
      return { text: text ?? `{"id":"${scope.scopeId}"}`, format: 'mist-scope-json', source: 'Mist (juniper_mist)' };
    }),
  };
}

const central = {
  id: 'int-central', label: 'Central (aruba_central)', providerType: 'aruba_central',
  integration: { name: 'Central' }, supports: () => false,
};

let storageDir;
beforeEach(() => {
  mockDb.rows = [];
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nethelper-scopes-'));
  scopeBackupService.storageDir = storageDir;
  jest.clearAllMocks();
});
afterEach(() => fs.rmSync(storageDir, { recursive: true, force: true }));

test('backs up every scope of supporting providers and reports the rest', async () => {
  CloudProviderFactory.activeProviders.mockResolvedValue([mistProvider(), central]);

  const result = await scopeBackupService.runScopeBackups();

  expect(result).toMatchObject({ total: 2, succeeded: 2, failed: 0, unsupported: ['Central (aruba_central)'] });
  expect(mockDb.rows.map((r) => [r.scopeType, r.scopeName, r.status, r.integrationName])).toEqual([
    ['org', 'Acme', 'success', 'Mist'],
    ['site', 'HQ', 'success', 'Mist'],
  ]);
  const org = mockDb.rows[0];
  expect(org).toMatchObject({ format: 'mist-scope-json', hasChanges: true, commitSha: 'abc123', provider: 'juniper_mist' });
  expect(org.filePath.startsWith(path.join(storageDir, 'int-mist', 'org-org-1'))).toBe(true);
  expect(fs.readFileSync(org.filePath, 'utf8')).toBe('{"id":"org-1"}');
  expect(gitBackupService.commitScopeConfig).toHaveBeenCalledWith(expect.objectContaining({
    scope: expect.objectContaining({ scopeType: 'org', scopeId: 'org-1', integrationId: 'int-mist' }),
    artifacts: [{ format: 'mist-scope-json', text: '{"id":"org-1"}' }],
  }));
  expect(gitBackupService.pushIfConfigured).toHaveBeenCalledTimes(1);
});

test('limits to one integration when asked', async () => {
  const mist = mistProvider();
  CloudProviderFactory.activeProviders.mockResolvedValue([mist, central]);

  const result = await scopeBackupService.runScopeBackups({ integrationId: 'int-central' });

  expect(result).toMatchObject({ total: 0, unsupported: ['Central (aruba_central)'] });
  expect(mist.listConfigScopes).not.toHaveBeenCalled();
});

test('tracks changes per scope by checksum', async () => {
  const provider = mistProvider();
  CloudProviderFactory.activeProviders.mockResolvedValue([provider]);
  await scopeBackupService.runScopeBackups();
  await scopeBackupService.runScopeBackups();
  expect(mockDb.rows.slice(2).map((r) => r.hasChanges)).toEqual([false, false]);

  provider.getScopeConfiguration.mockImplementation(async (scope) => ({
    text: scope.scopeId === 'site-a' ? '{"changed":true}' : `{"id":"${scope.scopeId}"}`,
    format: 'mist-scope-json',
  }));
  await scopeBackupService.runScopeBackups();
  expect(mockDb.rows.slice(4).map((r) => [r.scopeId, r.hasChanges])).toEqual([['org-1', false], ['site-a', true]]);
});

test('a failing scope is recorded and does not stop the others', async () => {
  CloudProviderFactory.activeProviders.mockResolvedValue([
    mistProvider({ configs: { 'org-1': new CapabilityError('nope') } }),
  ]);

  const result = await scopeBackupService.runScopeBackups();

  expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
  expect(mockDb.rows[0]).toMatchObject({ status: 'failed', error: 'nope' });
  expect(mockDb.rows[1].status).toBe('success');
});

test('push:false leaves the push to the caller', async () => {
  CloudProviderFactory.activeProviders.mockResolvedValue([mistProvider()]);
  await scopeBackupService.runScopeBackups({ push: false });
  expect(gitBackupService.pushIfConfigured).not.toHaveBeenCalled();
});

test('content, diff and delete', async () => {
  const provider = mistProvider({ scopes: [{ scopeType: 'site', scopeId: 'site-a', name: 'HQ' }] });
  CloudProviderFactory.activeProviders.mockResolvedValue([provider]);
  await scopeBackupService.runScopeBackups();
  provider.getScopeConfiguration.mockResolvedValue({ text: '{\n  "a": 2\n}', format: 'mist-scope-json' });
  await scopeBackupService.runScopeBackups();
  const [a, b] = mockDb.rows;

  expect((await scopeBackupService.getScopeBackupContent(b.id)).content).toBe('{\n  "a": 2\n}');
  const diff = await scopeBackupService.diffScopeBackups(a.id, b.id);
  expect(diff).toMatchObject({ identical: false, from: { scopeName: 'HQ' } });
  expect(diff.patch).toContain('+  "a": 2');

  await scopeBackupService.deleteScopeBackup(a.id);
  expect(fs.existsSync(a.filePath)).toBe(false);
  await expect(scopeBackupService.getScopeBackup(a.id)).rejects.toMatchObject({ statusCode: 404 });
});

test('retention keeps the newest N per scope', async () => {
  CloudProviderFactory.activeProviders.mockResolvedValue([mistProvider()]);
  for (let i = 0; i < 3; i++) await scopeBackupService.runScopeBackups();

  await scopeBackupService.pruneRetention({ retentionMaxCount: 1, retentionDays: 0 });

  expect(mockDb.rows.map((r) => r.scopeId).sort()).toEqual(['org-1', 'site-a']);
  expect(mockDb.rows.every((r) => fs.existsSync(r.filePath))).toBe(true);
});
