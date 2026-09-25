const { validateMirrorSettings } = require('../../src/services/git-backup.service');

const ok = (settings) => expect(() => validateMirrorSettings(settings)).not.toThrow();
const bad = (settings, pattern) => {
  let error;
  try {
    validateMirrorSettings(settings);
  } catch (e) {
    error = e;
  }
  expect(error).toBeDefined();
  expect(error.statusCode).toBe(400);
  expect(error.message).toMatch(pattern);
};

describe('git-backup validateMirrorSettings', () => {
  test.each([
    'https://git.example.com/net/configs.git',
    'ssh://git@git.example.com:2222/net/configs.git',
    'git@github.com:acme/configs.git',
    'file:///srv/git/configs.git',
  ])('accepts remote %s', (remoteUrl) => ok({ remoteUrl }));

  test.each([
    ['ext:: transport (runs a command)', 'ext::sh -c touch% /tmp/pwned'],
    ['fd:: transport', 'fd::17'],
    ['an option injection', '--upload-pack=touch /tmp/pwned'],
    ['an unlisted scheme', 'ftp://example.com/repo.git'],
    ['whitespace', 'https://example.com/repo.git --upload-pack=x'],
  ])('rejects %s', (_label, remoteUrl) => bad({ remoteUrl }, /Remote URL/));

  test.each(['main', 'backups/configs', 'release-1.0'])('accepts branch %s', (branch) => ok({ branch }));

  test.each(['-f', '--orphan', 'a..b', 'x.lock', 'trailing/', 'has space', 'a@{1}', '/lead'])(
    'rejects branch %s',
    (branch) => bad({ branch }, /Invalid branch name/)
  );

  test('paths must be absolute', () => {
    ok({ repoPath: '/srv/nethelper/config-repo', sshKeyPath: '/home/nethelper/.ssh/id_ed25519' });
    bad({ repoPath: 'storage/repo' }, /Repository path/);
    bad({ sshKeyPath: '~/.ssh/id_rsa' }, /SSH key path/);
    bad({ sshKeyPath: '/tmp/key\n-oProxyCommand=x' }, /SSH key path/);
  });

  test('empty settings are fine (mirror disabled)', () => ok({}));
});
