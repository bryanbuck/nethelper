/**
 * Application backup: the SFTP off-host copy (against a real in-process SFTP
 * server), its settings, and the overdue check.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { utils: sshUtils } = require('ssh2');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789abcdef';

const mockPrisma = {
  appBackupConfig: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
  appBackupRun: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []), deleteMany: jest.fn(), updateMany: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/config/bull', () => ({ getQueue: () => ({ getRepeatableJobs: async () => [], add: jest.fn() }) }));
const mockAlerts = { raise: jest.fn(), clear: jest.fn() };
jest.mock('../../src/services/alert.service', () => mockAlerts);

const appBackup = require('../../src/services/app-backup.service');
const { withSftp, fingerprint, checkPrivateKey } = require('../../src/services/app-backup-remote');
const encryption = require('../../src/utils/encryption');
const { startSftpServer } = require('../helpers/sftp-server');

const enc = (v) => encryption.encrypt(v);

describe('SFTP destination', () => {
  jest.setTimeout(20000);
  let localDir;
  let remoteRoot;
  let server;

  beforeEach(async () => {
    jest.clearAllMocks();
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-ab-local-'));
    remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-ab-remote-'));
    fs.mkdirSync(path.join(remoteRoot, 'backups'));
    process.env.APP_BACKUP_PATH = localDir;
    server = await startSftpServer({ root: remoteRoot });
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(remoteRoot, { recursive: true, force: true });
    delete process.env.APP_BACKUP_PATH;
  });

  function touch(date, body = 'archive-bytes') {
    const name = appBackup.archiveName(date, true);
    fs.writeFileSync(path.join(localDir, name), body);
    fs.writeFileSync(path.join(localDir, `${name}.json`), JSON.stringify({ createdAt: date.toISOString() }));
    return name;
  }

  function config(extra = {}) {
    return {
      id: 'cfg', remoteType: 'sftp', sftpHost: '127.0.0.1', sftpPort: server.port, sftpUsername: 'backup',
      sftpPassword: 'secret-pass', sftpPath: 'backups', sftpHostKey: null, retainCount: 14, retainDays: null, ...extra,
    };
  }

  const remoteFiles = () => fs.readdirSync(path.join(remoteRoot, 'backups')).sort();

  test('copies every local archive the remote lacks, with its sidecar, and pins the host key', async () => {
    const a = touch(new Date('2026-11-01T02:00:00Z'));
    const b = touch(new Date('2026-11-02T02:00:00Z'), 'x'.repeat(200000));
    const result = await appBackup.syncRemote(config());
    expect(result.uploaded).toEqual([b, a]); // newest first
    expect(remoteFiles()).toEqual([a, `${a}.json`, b, `${b}.json`].sort());
    expect(fs.readFileSync(path.join(remoteRoot, 'backups', b), 'utf8')).toHaveLength(200000);
    expect(mockPrisma.appBackupConfig.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sftpHostKey: null, sftpHost: '127.0.0.1' }),
      data: { sftpHostKey: server.fingerprint },
    }));

    // Nothing new: nothing sent; a stray file in the folder is left alone.
    fs.writeFileSync(path.join(remoteRoot, 'backups', 'notes.txt'), 'keep me');
    const again = await appBackup.syncRemote(config({ sftpHostKey: server.fingerprint }));
    expect(again.uploaded).toEqual([]);
    expect(remoteFiles()).toContain('notes.txt');
  });

  test('applies the retention settings to the remote too', async () => {
    const names = [1, 2, 3, 4].map((d) => touch(new Date(`2026-11-0${d}T02:00:00Z`)));
    await appBackup.syncRemote(config());
    const result = await appBackup.syncRemote(config({ retainCount: 2, sftpHostKey: server.fingerprint }));
    expect(result.pruned.sort()).toEqual([names[0], names[1]].sort());
    expect(remoteFiles()).toEqual([names[2], `${names[2]}.json`, names[3], `${names[3]}.json`].sort());
  });

  test('refuses a server whose host key changed, before logging in', async () => {
    touch(new Date('2026-11-01T02:00:00Z'));
    await expect(appBackup.syncRemote(config({ sftpHostKey: 'SHA256:somethingelse' })))
      .rejects.toMatchObject({ code: 'HOST_KEY_MISMATCH', hostKey: server.fingerprint });
    expect(server.stats.logins).toBe(0);
    expect(remoteFiles()).toEqual([]);
  });

  test('a wrong password, a missing folder and a dead port are named', async () => {
    await expect(appBackup.syncRemote(config({ sftpPassword: 'wrong' }))).rejects.toThrow(/refused the login/);
    await expect(appBackup.syncRemote(config({ sftpPath: 'nope' }))).rejects.toThrow(/folder nope does not exist/);
    await expect(appBackup.syncRemote(config({ sftpPort: 1 }))).rejects.toThrow(/refused the connection/);
  });

  test('a public key login works', async () => {
    await server.close();
    const pair = sshUtils.generateKeyPairSync('ed25519');
    server = await startSftpServer({ root: remoteRoot, password: null, publicKey: pair.public });
    touch(new Date('2026-11-01T02:00:00Z'));
    const result = await appBackup.syncRemote(config({ sftpPassword: null, sftpPrivateKey: pair.private }));
    expect(result.uploaded).toHaveLength(1);
  });

  test('a run copies off-host and records it; a failed copy is an alert, not a failed backup', async () => {
    touch(new Date('2026-11-01T02:00:00Z'));
    const ok = await appBackup.copyOffHost(config());
    expect(ok).toMatchObject({ status: 'uploaded', error: null });
    expect(mockAlerts.clear).toHaveBeenCalledWith('app-backup.upload-failed', { subjectKey: 'app-backup:sftp' });

    const bad = await appBackup.copyOffHost(config({ sftpPassword: 'wrong' }));
    expect(bad).toMatchObject({ status: 'failed', error: expect.stringMatching(/refused the login/) });
    expect(mockAlerts.raise).toHaveBeenCalledWith('app-backup.upload-failed', expect.objectContaining({ subjectKey: 'app-backup:sftp' }));
    expect(await appBackup.copyOffHost(config({ remoteType: 'none' }))).toBeNull();
  });

  test('the connection test writes and removes a probe file and reports the key', async () => {
    mockPrisma.appBackupConfig.findFirst.mockResolvedValueOnce({
      ...config(), sftpPassword: enc('secret-pass'), encrypt: true,
    });
    const result = await appBackup.testRemote();
    expect(result).toMatchObject({ ok: true, hostKey: server.fingerprint, newlyPinned: true, archives: 0 });
    expect(remoteFiles()).toEqual([]);
  });

  test('withSftp reports the fingerprint even on failure', async () => {
    await expect(withSftp({ host: '127.0.0.1', port: server.port, username: 'backup', password: 'wrong' }, async () => {}))
      .rejects.toMatchObject({ hostKey: server.fingerprint });
  });
});

describe('SFTP settings', () => {
  const base = { encrypt: true, passphrase: enc('twelve chars!') };

  test('need a host, a user, a password or key, and encryption', () => {
    expect(() => appBackup.validateSettings({ remoteType: 'sftp' }, base)).toThrow(/SFTP host/);
    expect(() => appBackup.validateSettings({ remoteType: 'sftp', sftpHost: 'nas' }, base)).toThrow(/user name/);
    expect(() => appBackup.validateSettings({ remoteType: 'sftp', sftpHost: 'nas', sftpUsername: 'u' }, base)).toThrow(/password or a private key/);
    expect(() => appBackup.validateSettings({ remoteType: 'sftp', sftpHost: 'nas', sftpUsername: 'u', sftpPassword: 'p' }, { encrypt: false }))
      .toThrow(/Turn on encryption/);
    expect(() => appBackup.validateSettings({ remoteType: 'ftp' }, base)).toThrow(/Unknown/);
    expect(() => appBackup.validateSettings({ sftpHost: 'nas; rm -rf /' }, base)).toThrow(/host name/);
    expect(() => appBackup.validateSettings({ sftpPort: 70000 }, base)).toThrow(/port/);
    // turning encryption off with a destination set is refused too
    const stored = { ...base, remoteType: 'sftp', sftpHost: 'nas', sftpUsername: 'u', sftpPassword: enc('p') };
    expect(() => appBackup.validateSettings({ encrypt: false }, stored)).toThrow(/Turn on encryption/);
  });

  test('secrets are stored encrypted, kept when masked, and the API sees only masks', () => {
    const out = appBackup.validateSettings({
      remoteType: 'sftp', sftpHost: 'nas.local', sftpUsername: 'backup', sftpPassword: 'pw', sftpPath: '/srv/nh',
    }, base);
    expect(encryption.decrypt(out.sftpPassword)).toBe('pw');
    const stored = { ...base, ...out, sftpHostKey: 'SHA256:x', sftpPort: 22 };
    expect(appBackup.validateSettings({ sftpPassword: '***' }, stored).sftpPassword).toBeUndefined();
    expect(appBackup.validateSettings({ sftpPassword: '' }, stored).sftpPassword).toBeUndefined();
    const shown = appBackup.publicConfig(stored);
    expect(shown).toMatchObject({ sftpPassword: '***', sftpPrivateKey: null, sftpAuth: 'password', sftpHostKey: 'SHA256:x' });
    expect(JSON.stringify(shown)).not.toContain(out.sftpPassword);
  });

  test('a new host or port, or forgetting it, drops the pinned key', () => {
    const stored = {
      ...base, remoteType: 'sftp', sftpHost: 'nas', sftpPort: 22, sftpUsername: 'u', sftpPassword: enc('p'), sftpHostKey: 'SHA256:x',
    };
    expect(appBackup.validateSettings({ sftpHost: 'nas' }, stored).sftpHostKey).toBeUndefined();
    expect(appBackup.validateSettings({ sftpHost: 'nas2' }, stored).sftpHostKey).toBeNull();
    expect(appBackup.validateSettings({ sftpPort: 2222 }, stored).sftpHostKey).toBeNull();
    expect(appBackup.validateSettings({ forgetHostKey: true }, stored).sftpHostKey).toBeNull();
  });

  test('a private key is checked, with its passphrase; choosing key auth drops the password', () => {
    const plainKey = sshUtils.generateKeyPairSync('ed25519').private;
    const lockedKey = sshUtils.generateKeyPairSync('ed25519', { passphrase: 'kp', cipher: 'aes256-cbc' }).private;
    expect(checkPrivateKey(plainKey)).toBeNull();
    expect(checkPrivateKey('not a key')).toMatch(/could not be read/);
    expect(checkPrivateKey(lockedKey)).toMatch(/passphrase/);
    expect(checkPrivateKey(lockedKey, 'kp')).toBeNull();

    const input = { remoteType: 'sftp', sftpHost: 'nas', sftpUsername: 'u', sftpAuth: 'key', sftpPrivateKey: lockedKey };
    expect(() => appBackup.validateSettings(input, base)).toThrow(/passphrase/);
    const out = appBackup.validateSettings({ ...input, sftpKeyPassphrase: 'kp' }, { ...base, sftpPassword: enc('old') });
    expect(out.sftpPassword).toBeNull();
    expect(encryption.decrypt(out.sftpPrivateKey)).toBe(lockedKey);
  });

  test('fingerprints look like OpenSSH\'s', () => {
    expect(fingerprint(Buffer.from('abc'))).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });
});

describe('overdue check', () => {
  const daily = { enabled: true, cronExpression: '0 2 * * *', timezone: 'UTC' };
  const now = new Date('2026-11-11T10:00:00Z'); // last fire 11-11 02:00, the one before 11-10 02:00

  test('one missed run is not overdue yet; two are', () => {
    const { overdueSince } = appBackup;
    expect(overdueSince({ ...daily, lastSuccessAt: new Date('2026-11-11T02:00:30Z'), now })).toBeNull();
    expect(overdueSince({ ...daily, lastSuccessAt: new Date('2026-11-10T02:00:30Z'), now })).toBeNull();
    expect(overdueSince({ ...daily, lastSuccessAt: new Date('2026-11-09T02:00:30Z'), now }))
      .toEqual(new Date('2026-11-10T02:00:00Z'));
    expect(overdueSince({ ...daily, lastSuccessAt: null, now })).toEqual(new Date('2026-11-10T02:00:00Z'));
  });

  test('off, freshly scheduled, or a broken cron is never overdue', () => {
    const { overdueSince } = appBackup;
    expect(overdueSince({ ...daily, enabled: false, now })).toBeNull();
    expect(overdueSince({ ...daily, scheduleChangedAt: new Date('2026-11-10T09:00:00Z'), now })).toBeNull();
    expect(overdueSince({ ...daily, scheduleChangedAt: new Date('2026-11-01T00:00:00Z'), now })).not.toBeNull();
    expect(overdueSince({ ...daily, cronExpression: 'nope', now })).toBeNull();
  });

  test('raises (without bumping) and clears the alert', async () => {
    jest.clearAllMocks();
    mockPrisma.appBackupConfig.findFirst.mockResolvedValueOnce({ ...daily, scheduleChangedAt: new Date('2020-01-01') });
    mockPrisma.appBackupRun.findFirst.mockResolvedValueOnce({ startedAt: new Date('2020-01-02') });
    expect(await appBackup.checkOverdue()).toBe(true);
    expect(mockAlerts.raise).toHaveBeenCalledWith('app-backup.overdue', expect.objectContaining({ subjectKey: 'app-backup:schedule' }), { bump: false });

    mockPrisma.appBackupConfig.findFirst.mockResolvedValueOnce({ ...daily, enabled: false });
    expect(await appBackup.checkOverdue()).toBe(false);
    expect(mockAlerts.clear).toHaveBeenCalledWith('app-backup.overdue', { subjectKey: 'app-backup:schedule' });
  });

  test('turning the schedule on, or changing it, restarts the clock', () => {
    expect(appBackup.validateSettings({ enabled: true }, { enabled: false }).scheduleChangedAt).toBeInstanceOf(Date);
    expect(appBackup.validateSettings({ cronExpression: '0 3 * * *' }, { enabled: true }).scheduleChangedAt).toBeInstanceOf(Date);
    expect(appBackup.validateSettings({ retainCount: 5 }, { enabled: true }).scheduleChangedAt).toBeUndefined();
    expect(appBackup.validateSettings({ cronExpression: '0 3 * * *' }, { enabled: false }).scheduleChangedAt).toBeUndefined();
  });
});
