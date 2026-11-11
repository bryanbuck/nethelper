/**
 * Application self-backup: archive encryption, the restore preflight and SQL,
 * DATABASE_URL -> libpq settings, and the service's settings/retention logic.
 * No database, pg_dump or tar: those paths are exercised on a real install.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789abcdef';

const mockPrisma = {
  appBackupConfig: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  appBackupRun: { findMany: jest.fn(async () => []), deleteMany: jest.fn(), updateMany: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/config/bull', () => ({ getQueue: () => ({ getRepeatableJobs: async () => [], add: jest.fn() }) }));

const { encryptStream, decryptStream, isEncryptedHeader } = require('../../src/utils/archive-crypto');
const { pgEnvFromUrl, parseToolMajor } = require('../../src/utils/pg-env');
const {
  planRestore, restoreSql, keyFingerprint, codeMigration, restoreScriptFilter,
} = require('../../src/utils/app-backup-common');
const appBackup = require('../../src/services/app-backup.service');
const encryption = require('../../src/utils/encryption');

async function collect(input, ...transforms) {
  const chunks = [];
  await pipeline(Readable.from(input), ...transforms, new Writable({
    write(chunk, _enc, done) {
      chunks.push(chunk);
      done();
    },
  }));
  return Buffer.concat(chunks);
}

// Cheap scrypt cost so the suite stays fast; the format records it.
const FAST = { logN: 10, r: 8, p: 1 };

describe('archive-crypto', () => {
  const plain = Buffer.from('x'.repeat(100000) + 'end');

  test('round-trips, whatever the chunking', async () => {
    const sealed = await collect([plain.subarray(0, 7), plain.subarray(7)], encryptStream('a long passphrase', FAST));
    expect(isEncryptedHeader(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from('xxxxxxxx'))).toBe(false);
    const pieces = [];
    for (let i = 0; i < sealed.length; i += 5) pieces.push(sealed.subarray(i, i + 5));
    expect((await collect(pieces, decryptStream('a long passphrase'))).equals(plain)).toBe(true);
  });

  test('an empty input still makes a valid file', async () => {
    const sealed = await collect([], encryptStream('a long passphrase', FAST));
    expect((await collect([sealed], decryptStream('a long passphrase'))).length).toBe(0);
  });

  test('a wrong passphrase, a changed byte or a cut file fails', async () => {
    const sealed = await collect([plain], encryptStream('a long passphrase', FAST));
    await expect(collect([sealed], decryptStream('another passphrase'))).rejects.toThrow(/Wrong passphrase/);
    const tampered = Buffer.from(sealed);
    tampered[100] ^= 1;
    await expect(collect([tampered], decryptStream('a long passphrase'))).rejects.toThrow(/Wrong passphrase|damaged/);
    const header = Buffer.from(sealed);
    header[4] = 11; // the scrypt cost is authenticated too
    await expect(collect([header], decryptStream('a long passphrase'))).rejects.toThrow(/Wrong passphrase|damaged/);
    await expect(collect([sealed.subarray(0, 20)], decryptStream('a long passphrase'))).rejects.toThrow(/truncated/);
  });

  test('a plain file is refused', async () => {
    await expect(collect([Buffer.alloc(64)], decryptStream('a long passphrase'))).rejects.toThrow(/Not an encrypted/);
  });
});

describe('pg-env', () => {
  test('maps a Prisma URL to libpq variables, never argv', () => {
    const { env, schema, database } = pgEnvFromUrl('postgresql://neth%40x:p%40ss%3Aw@db.example:5433/nh?schema=app&sslmode=require&connection_limit=5');
    expect(env).toMatchObject({ PGHOST: 'db.example', PGPORT: '5433', PGUSER: 'neth@x', PGPASSWORD: 'p@ss:w', PGDATABASE: 'nh', PGSSLMODE: 'require' });
    expect(schema).toBe('app');
    expect(database).toBe('nh');
  });

  test('defaults the schema and accepts a socket host', () => {
    const { env, schema } = pgEnvFromUrl('postgres://u@localhost/nh?host=/var/run/postgresql');
    expect(env.PGHOST).toBe('/var/run/postgresql');
    expect(schema).toBe('public');
  });

  test('rejects other URLs', () => {
    expect(() => pgEnvFromUrl('mysql://u@h/db')).toThrow(/PostgreSQL/);
    expect(() => pgEnvFromUrl('not a url')).toThrow(/valid URL/);
  });

  test('reads tool versions', () => {
    expect(parseToolMajor('pg_dump (PostgreSQL) 17.2 (Debian 17.2-1.pgdg120+1)')).toEqual({ major: 17, version: '17.2' });
    expect(parseToolMajor('pg_restore (PostgreSQL) 15.13')).toEqual({ major: 15, version: '15.13' });
    expect(parseToolMajor('nope')).toBeNull();
  });
});

describe('restore preflight', () => {
  const fp = keyFingerprint('the-key');
  const manifest = {
    app: 'nethelper', format: 1, appVersion: '0.9.0', migration: '20261104180000_app_backup',
    pgDumpVersion: '17.2', keyFingerprint: fp, database: { sha256: 'abc' },
    dirs: [{ role: 'config-backups', member: 'config-backups', source: '/data/config-backups' }],
  };
  const base = {
    manifest, dumpSha256: 'abc', currentKeyFingerprint: fp, archivedKeyFingerprint: null,
    currentMigration: '20261104180000_app_backup', restoreMajor: 17,
    targets: { 'config-backups': '/var/lib/nethelper/config-backups', 'config-repo': '/var/lib/nethelper/config-repo' },
  };

  test('a matching archive passes and maps its folders', () => {
    const plan = planRestore(base);
    expect(plan.errors).toEqual([]);
    expect(plan.blockers).toEqual([]);
    expect(plan.copies).toEqual([{ member: 'config-backups', role: 'config-backups', target: '/var/lib/nethelper/config-backups' }]);
    expect(plan.rewrites).toEqual([{ role: 'config-backups', from: '/data/config-backups', to: '/var/lib/nethelper/config-backups' }]);
  });

  test('damage, a newer app and an older pg_restore are hard errors', () => {
    expect(planRestore({ ...base, dumpSha256: 'zzz' }).errors.join()).toMatch(/checksum/);
    expect(planRestore({ ...base, currentMigration: '20261001000000_x' }).errors.join()).toMatch(/newer NetHelper/);
    expect(planRestore({ ...base, restoreMajor: 15 }).errors.join()).toMatch(/pg_restore 15/);
    expect(planRestore({ ...base, manifest: { ...manifest, format: 2 } }).errors.join()).toMatch(/format 2/);
    expect(planRestore({ ...base, manifest: null }).errors.join()).toMatch(/Not a NetHelper/);
  });

  test('a different key blocks (overridable) and points at the archived key when there is one', () => {
    const other = { ...base, currentKeyFingerprint: keyFingerprint('another-key') };
    expect(planRestore(other).errors).toEqual([]);
    expect(planRestore(other).blockers.join()).toMatch(/Set ENCRYPTION_KEY/);
    expect(planRestore({ ...other, archivedKeyFingerprint: fp }).blockers.join()).toMatch(/--key-out/);
    expect(planRestore({ ...base, currentKeyFingerprint: null }).blockers.join()).toMatch(/not set/);
  });

  test('an older backup restores with a note', () => {
    const plan = planRestore({ ...base, currentMigration: '20261201000000_later' });
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join()).toMatch(/upgraded/);
  });

  test('the SQL drops the schema first and moves stored paths, quoted', () => {
    const sql = restoreSql('public', [
      { role: 'config-backups', from: "/data/it's", to: '/srv/b' },
      { role: 'config-repo', from: '/data/config-repo', to: '/srv/repo' },
    ]);
    expect(sql.before).toBe('DROP SCHEMA IF EXISTS "public" CASCADE;\n');
    expect(sql.after).toContain(`UPDATE "public"."ConfigBackup" SET "filePath" = '/srv/b' || substr("filePath", 11) WHERE left("filePath", 11) = '/data/it''s/';`);
    expect(sql.after).toContain('"public"."ConfigBackupArtifact"');
    expect(sql.after).toContain('"public"."ScopeBackup"');
    expect(sql.after).toContain(`UPDATE "public"."GitBackupConfig" SET "repoPath" = '/srv/repo' WHERE "repoPath" = '/data/config-repo';`);
    expect(restoreSql('public', []).after).toBe('');
  });

  test('fingerprints identify a key without revealing it', () => {
    expect(keyFingerprint('the-key')).toMatch(/^[0-9a-f]{16}$/);
    expect(keyFingerprint('the-key')).toBe(keyFingerprint('the-key\n'));
    expect(keyFingerprint('the-key')).not.toBe(keyFingerprint('other'));
    expect(keyFingerprint('')).toBeNull();
  });

  test('the code knows its newest migration', () => {
    expect(codeMigration()).toMatch(/^\d{14}_/);
  });
});

describe('app-backup.service', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-appbackup-'));
    process.env.APP_BACKUP_PATH = dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.APP_BACKUP_PATH;
  });

  test('archive names are ours or 404', async () => {
    const name = appBackup.archiveName(new Date('2026-11-04T18:30:05Z'), true);
    expect(name).toMatch(/^nethelper-.+-20261104T183005Z\.tar\.gz\.enc$/);
    expect(appBackup.isArchiveName(name)).toBe(true);
    for (const bad of ['../etc/passwd', 'nethelper-1-20261104T183005Z.tar.gz/../x', 'other.tar.gz', '']) {
      expect(appBackup.isArchiveName(bad)).toBe(false);
    }
    await expect(appBackup.resolveArchive('../../etc/passwd')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('settings: schedule and retention validated, the passphrase kept unless replaced', () => {
    expect(() => appBackup.validateSettings({ cronExpression: 'nope' }, null)).toThrow(/Invalid schedule/);
    expect(() => appBackup.validateSettings({ retainCount: 0 }, null)).toThrow(/between 1 and 1000/);
    expect(() => appBackup.validateSettings({ encrypt: true }, null)).toThrow(/Set a passphrase/);
    expect(() => appBackup.validateSettings({ encrypt: true, passphrase: 'short' }, null)).toThrow(/at least 12/);

    const set = appBackup.validateSettings({ encrypt: true, includeKey: true, passphrase: 'twelve chars!' }, null);
    expect(encryption.decrypt(set.passphrase)).toBe('twelve chars!');
    const stored = { encrypt: true, passphrase: set.passphrase };
    expect(appBackup.validateSettings({ passphrase: '***' }, stored).passphrase).toBeUndefined();
    expect(appBackup.validateSettings({ passphrase: '' }, stored).passphrase).toBeUndefined();
    // the key never goes into a plain archive
    expect(appBackup.validateSettings({ encrypt: false, includeKey: true }, stored).includeKey).toBe(false);
    expect(appBackup.validateSettings({ retainDays: '' }, null).retainDays).toBeNull();
  });

  test('the API never sees the passphrase', () => {
    const shown = appBackup.publicConfig({ encrypt: true, passphrase: 'ciphertext' });
    expect(shown.passphrase).toBe('***');
    expect(shown.hasPassphrase).toBe(true);
    expect(appBackup.publicConfig(null)).toMatchObject({ hasPassphrase: false, passphrase: null, retainCount: 14 });
  });

  function touch(date, { sidecar = true, enc = false } = {}) {
    const name = appBackup.archiveName(date, enc);
    fs.writeFileSync(path.join(dir, name), 'x');
    if (sidecar) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ createdAt: date.toISOString(), keyFingerprint: keyFingerprint() }));
    return name;
  }

  test('lists newest first and ignores stray files', async () => {
    const older = touch(new Date('2026-11-01T00:00:00Z'));
    const newer = touch(new Date('2026-11-03T00:00:00Z'), { sidecar: false, enc: true });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, `${older}.partial`), 'x');
    const list = await appBackup.list();
    expect(list.map((a) => a.name)).toEqual([newer, older]);
    expect(list[0]).toMatchObject({ encrypted: true, keyMatches: null, createdAt: '2026-11-03T00:00:00.000Z' });
    expect(list[1].keyMatches).toBe(true);
  });

  test('retention keeps the newest N, drops old ones by age, never the newest', async () => {
    const day = (n) => new Date(Date.now() - n * 86400000);
    const names = [0, 0.5, 2, 3, 10].map((n) => touch(day(n)));
    let removed = await appBackup.prune({ retainCount: 3, retainDays: null }, names[0]);
    expect(removed.sort()).toEqual([names[3], names[4]].sort());
    removed = await appBackup.prune({ retainCount: 10, retainDays: 1 }, names[0]);
    expect(removed).toEqual([names[2]]);
    expect(fs.existsSync(path.join(dir, `${names[2]}.json`))).toBe(false);
    // only one left over the age limit: the newest stays anyway
    fs.rmSync(path.join(dir, names[0]));
    fs.rmSync(path.join(dir, `${names[0]}.json`));
    expect(await appBackup.prune({ retainCount: 1, retainDays: 0.0001 }, null)).toEqual([]);
  });

  test('a second run is refused while one is running', async () => {
    appBackup.running = 'run-1';
    try {
      await expect(appBackup.requestRun('u1')).rejects.toMatchObject({ statusCode: 409 });
      await expect(appBackup.run({})).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      appBackup.running = null;
    }
  });
});

describe('restore script filter', () => {
  // pg_restore 17's script header, as `pg_restore -f -` writes it.
  const header = [
    '--',
    '-- PostgreSQL database dump',
    '--',
    "SET statement_timeout = 0;",
    "SET lock_timeout = 0;",
    "SET idle_in_transaction_session_timeout = 0;",
    "SET transaction_timeout = 0;",
    "SET client_encoding = 'UTF8';",
    "COPY public.\"Device\" (name) FROM stdin;",
    'SET transaction_timeout = 0; is only data here',
    '\\.',
    '',
  ].join('\n');

  async function filtered(major, chunks) {
    let out = '';
    await pipeline(Readable.from(chunks), restoreScriptFilter(major), new Writable({
      write(chunk, _enc, done) { out += chunk.toString('utf8'); done(); },
    }));
    return out;
  }

  test.each([15, 16])('drops SET transaction_timeout for a PostgreSQL %i server', async (major) => {
    const out = await filtered(major, [Buffer.from(header)]);
    expect(out).not.toMatch(/^SET transaction_timeout = 0;$/m);
    expect(out).toBe(header.replace('SET transaction_timeout = 0;\n', ''));
    expect(out).toContain('SET transaction_timeout = 0; is only data here'); // data, not a whole SET line
  });

  test.each([17, 18])('keeps the script unchanged for a PostgreSQL %i server', async (major) => {
    expect(await filtered(major, [Buffer.from(header)])).toBe(header);
  });

  test('an unknown server version is treated as too old for the setting', async () => {
    expect(await filtered(null, [Buffer.from(header)])).toBe(header.replace('SET transaction_timeout = 0;\n', ''));
  });

  test('a line split across chunks, and a character split across chunks, come through whole', async () => {
    const text = `SET transaction_timeout = 0;\nINSERT INTO t VALUES ('Café ✓');\n`;
    const bytes = Buffer.from(text);
    const cut1 = 10; // inside the SET line
    const cut2 = bytes.indexOf(Buffer.from('✓')) + 1; // inside the 3-byte check mark
    const out = await filtered(15, [bytes.subarray(0, cut1), bytes.subarray(cut1, cut2), bytes.subarray(cut2)]);
    expect(out).toBe("INSERT INTO t VALUES ('Café ✓');\n");
  });

  test('a last line without a newline is kept', async () => {
    expect(await filtered(15, [Buffer.from('SELECT 1;\nSELECT 2;')])).toBe('SELECT 1;\nSELECT 2;');
  });
});
