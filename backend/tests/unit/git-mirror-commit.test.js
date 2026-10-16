/**
 * git-backup.service commit path against a real `git` in a temp repo (git is a
 * runtime dependency of the backend host). Only Prisma is mocked.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let mockRepoPath;
jest.mock('../../src/config/database', () => ({
  getPrisma: () => ({
    gitBackupConfig: {
      findFirst: async () => ({ id: 'g1', isActive: true, repoPath: mockRepoPath, branch: 'main', credentials: {} }),
    },
  }),
}));

const gitBackupService = require('../../src/services/git-backup.service');

const device = { serial: 'CX123', name: 'sw1', vendor: 'aruba', platform: 'aos-cx', managementMode: 'cloud' };
const git = (...args) => execFileSync('git', args, { cwd: mockRepoPath, encoding: 'utf8' });
const commitCount = () => Number(git('rev-list', '--count', 'HEAD').trim());

beforeEach(() => {
  mockRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nethelper-repo-'));
});
afterEach(() => fs.rmSync(mockRepoPath, { recursive: true, force: true }));

test('commits CLI and JSON side by side, and skips an unchanged run', async () => {
  const artifacts = [{ format: 'cli-text', text: 'hostname sw1' }, { format: 'aoscx-json', text: '{}' }];
  const first = await gitBackupService.commitDeviceConfig({ device, artifacts, source: 'AOS-CX REST', backupId: 'b1' });

  expect(first.changed).toBe(true);
  expect(fs.readFileSync(path.join(mockRepoPath, 'CX123', 'running-config.cfg'), 'utf8')).toBe('hostname sw1\n');
  expect(fs.readFileSync(path.join(mockRepoPath, 'CX123', 'settings.json'), 'utf8')).toBe('{}\n');
  const meta = JSON.parse(fs.readFileSync(path.join(mockRepoPath, 'CX123', 'meta.json'), 'utf8'));
  expect(meta.formats).toEqual(['cli-text', 'aoscx-json']);

  const before = commitCount();
  const second = await gitBackupService.commitDeviceConfig({ device, artifacts, source: 'AOS-CX REST', backupId: 'b2' });
  expect(second).toEqual({ changed: false, commitSha: null });
  expect(commitCount()).toBe(before);
  expect(git('status', '--porcelain').trim()).toBe('');
});

test('a change in only the JSON is a commit', async () => {
  await gitBackupService.commitDeviceConfig({ device, artifacts: [{ format: 'cli-text', text: 'a' }, { format: 'aoscx-json', text: '{}' }] });
  const result = await gitBackupService.commitDeviceConfig({ device, artifacts: [{ format: 'cli-text', text: 'a' }, { format: 'aoscx-json', text: '{"x":1}' }] });
  expect(result.changed).toBe(true);
});

test('a format no longer captured is removed', async () => {
  await gitBackupService.commitDeviceConfig({ device, artifacts: [{ format: 'aoscx-json', text: '{}' }] });
  await gitBackupService.commitDeviceConfig({ device, artifacts: [{ format: 'cli-text', text: 'a' }] });
  expect(fs.existsSync(path.join(mockRepoPath, 'CX123', 'settings.json'))).toBe(false);
  expect(fs.existsSync(path.join(mockRepoPath, 'CX123', 'running-config.cfg'))).toBe(true);
});

test('scope configs live under _scopes/<integration>/<type>-<id>', async () => {
  const scope = {
    integrationId: 'int-1', integrationName: 'Mist', provider: 'juniper_mist',
    scopeType: 'site', scopeId: 'site-a', scopeName: 'HQ',
  };
  const result = await gitBackupService.commitScopeConfig({ scope, artifacts: [{ format: 'mist-scope-json', text: '{}' }], backupId: 's1' });

  expect(result.changed).toBe(true);
  expect(fs.existsSync(path.join(mockRepoPath, '_scopes', 'int-1', 'site-site-a', 'settings.json'))).toBe(true);
  expect(git('log', '-1', '--format=%B')).toMatch(/Scope:\s+site HQ/);
});
