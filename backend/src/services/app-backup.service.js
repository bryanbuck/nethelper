/**
 * Application self-backup: one archive per run holding everything needed to
 * rebuild this NetHelper instance.
 *
 *   manifest.json     what the archive holds, versions, the key fingerprint
 *   db.dump           pg_dump -Fc of the app's schema
 *   <dir>/...         the flat config-backup store, under its own folder name
 *   <dir>/...         the config Git mirror repo (optional)
 *   git-known_hosts   the mirror's pinned SSH host keys, when present
 *   encryption-key    ENCRYPTION_KEY, only in a passphrase-encrypted archive
 *                     and only when the admin opted in
 *
 * The archive is a gzipped tar made by the system `tar` (like git/nmap, a host
 * tool), optionally encrypted with a passphrase (utils/archive-crypto.js).
 * Each archive gets a <name>.json sidecar so listing works without the
 * database. Archives live in APP_BACKUP_PATH; the files are authoritative and
 * AppBackupRun only records runs for the UI. Restore is the CLI
 * scripts/app-restore.js, with the service stopped.
 *
 * Order: the database is dumped first, then the files are read. A config
 * backup taken in between leaves an orphan file (harmless); the other order
 * could leave rows pointing at files the archive doesn't have.
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { PassThrough } = require('stream');
const { CronExpressionParser } = require('cron-parser');
const { getPrisma } = require('../config/database');
const { getQueue } = require('../config/bull');
const { getIO } = require('../websocket/socket.handler');
const encryption = require('../utils/encryption');
const { encryptStream, decryptStream } = require('../utils/archive-crypto');
const { pgEnvFromUrl, parseToolMajor } = require('../utils/pg-env');
const alertService = require('./alert.service');
const logger = require('../utils/logger');
const {
  FORMAT_VERSION, backupDir, configBackupDir, knownHostsPath, keyFingerprint,
} = require('../utils/app-backup-common');
const { version: APP_VERSION } = require('../../package.json');

const NAME_PATTERN = /^nethelper-[0-9A-Za-z.+_-]+-(\d{8}T\d{6}Z)\.tar\.gz(\.enc)?$/;
const SCHEDULE_JOB_ID = 'app-backup-schedule';
const SCHEDULE_JOB_NAME = 'scheduled';
const ALERT_SUBJECT = 'app-backup';
const RUN_HISTORY_KEEP = 200;
const TOOL_TIMEOUT_MS = Number(process.env.APP_BACKUP_TIMEOUT_MS || 30 * 60 * 1000);
const MIN_PASSPHRASE_LENGTH = 12;
const MASK = '***';
// Row data skipped when includeHistory is off: event/alarm/audit/run history
// that can be large and that the instance rebuilds over time. The tables
// themselves are kept (schema), only their rows are left out.
const HISTORY_TABLES = ['DeviceEvent', 'CloudAlarm', 'AuditLog', 'Execution', 'TopologyChange', 'AppBackupRun'];
// Members written into the staging dir; a data folder may not use these names.
const RESERVED_MEMBERS = ['manifest.json', 'db.dump', 'encryption-key', 'git-known_hosts'];

const DEFAULTS = {
  enabled: false,
  cronExpression: '0 2 * * *',
  timezone: 'UTC',
  retainCount: 14,
  retainDays: null,
  includeHistory: true,
  includeGitRepo: false,
  encrypt: false,
  includeKey: false,
};

function timestampName(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function archiveName(date, encrypted) {
  const safeVersion = String(APP_VERSION).replace(/[^0-9A-Za-z.+_-]/g, '_');
  return `nethelper-${safeVersion}-${timestampName(date)}.tar.gz${encrypted ? '.enc' : ''}`;
}

function isArchiveName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name) && path.basename(name) === name;
}

function stampToDate(name) {
  const match = NAME_PATTERN.exec(name);
  if (!match) return null;
  const s = match[1];
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function runTool(cmd, args, { env, timeout = TOOL_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || '').trim().split('\n').slice(-3).join(' ').trim();
        const err = new Error(error.code === 'ENOENT'
          ? `${cmd} is not installed on the NetHelper host`
          : `${cmd} failed: ${detail || error.message}`);
        err.code = error.code;
        return reject(err);
      }
      return resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function isDir(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(file) {
  try {
    return (await fsp.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Counts bytes and hashes them on the way past. */
function meter() {
  const hash = crypto.createHash('sha256');
  const stats = { bytes: 0 };
  const stream = new PassThrough();
  stream.on('data', (chunk) => {
    hash.update(chunk);
    stats.bytes += chunk.length;
  });
  return { stream, stats, digest: () => hash.digest('hex') };
}

class AppBackupService {
  constructor() {
    this.running = null; // run id while a backup is in progress (single instance)
  }

  emit(event, data) {
    try {
      getIO().emit(event, data);
    } catch {
      // Socket not initialized (CLI, tests): runs are still recorded
    }
  }

  // ---------------------------------------------------------------- settings

  async getConfigRow() {
    return getPrisma().appBackupConfig.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  /** Settings with defaults, passphrase decrypted (internal use only). */
  async getConfig() {
    const row = await this.getConfigRow();
    const config = { ...DEFAULTS, ...(row || {}) };
    config.passphrase = row?.passphrase ? encryption.decrypt(row.passphrase) : null;
    return config;
  }

  /** Settings for the API: the passphrase is never returned. */
  publicConfig(row) {
    const config = { ...DEFAULTS, ...(row || {}) };
    const hasPassphrase = Boolean(row?.passphrase);
    delete config.passphrase;
    return { ...config, hasPassphrase, passphrase: hasPassphrase ? MASK : null };
  }

  validateSettings(input, existing) {
    const merged = { ...DEFAULTS, ...(existing || {}) };
    const out = {};
    for (const key of ['enabled', 'includeHistory', 'includeGitRepo', 'encrypt', 'includeKey']) {
      if (input[key] !== undefined) out[key] = Boolean(input[key]);
    }
    if (input.cronExpression !== undefined || input.timezone !== undefined) {
      const cronExpression = String(input.cronExpression ?? merged.cronExpression).trim();
      const timezone = String(input.timezone ?? merged.timezone).trim() || 'UTC';
      try {
        CronExpressionParser.parse(cronExpression, { tz: timezone });
      } catch (error) {
        throw httpError(`Invalid schedule: ${error.message}`);
      }
      out.cronExpression = cronExpression;
      out.timezone = timezone;
    }
    if (input.retainCount !== undefined) {
      const n = Number(input.retainCount);
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw httpError('Keep between 1 and 1000 archives');
      out.retainCount = n;
    }
    if (input.retainDays !== undefined) {
      if (input.retainDays === null || input.retainDays === '') {
        out.retainDays = null;
      } else {
        const n = Number(input.retainDays);
        if (!Number.isInteger(n) || n < 1 || n > 3650) throw httpError('Days to keep must be between 1 and 3650');
        out.retainDays = n;
      }
    }
    // A blank or masked passphrase keeps the stored one.
    const pass = input.passphrase;
    if (pass !== undefined && pass !== null && pass !== '' && pass !== MASK) {
      if (String(pass).length < MIN_PASSPHRASE_LENGTH) {
        throw httpError(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
      }
      out.passphrase = encryption.encrypt(String(pass));
    }
    const encrypt = out.encrypt ?? merged.encrypt;
    const hasPassphrase = Boolean(out.passphrase || existing?.passphrase);
    if (encrypt && !hasPassphrase) throw httpError('Set a passphrase to encrypt backups');
    if (!encrypt) out.includeKey = false; // the key only ever goes into an encrypted archive
    return out;
  }

  async saveConfig(input = {}, userId = null) {
    const prisma = getPrisma();
    const existing = await this.getConfigRow();
    const data = { ...this.validateSettings(input, existing), updatedById: userId };
    const row = existing
      ? await prisma.appBackupConfig.update({ where: { id: existing.id }, data })
      : await prisma.appBackupConfig.create({ data });
    await this.syncSchedule(row).catch((error) => {
      logger.error(`App backup schedule sync failed: ${error.message}`);
    });
    return this.publicConfig(row);
  }

  // ---------------------------------------------------------------- schedule

  /** Register (or drop) the repeatable job to match the settings. Called on save and at startup. */
  async syncSchedule(row) {
    const config = row === undefined ? await this.getConfigRow() : row;
    const queue = getQueue('appBackup');
    for (const job of await queue.getRepeatableJobs()) {
      if (job.id === SCHEDULE_JOB_ID) await queue.removeRepeatableByKey(job.key).catch(() => {});
    }
    if (config?.enabled) {
      await queue.add(SCHEDULE_JOB_NAME, {}, {
        repeat: { cron: config.cronExpression, tz: config.timezone || 'UTC' },
        jobId: SCHEDULE_JOB_ID,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 20,
      });
      logger.info(`App backup scheduled (${config.cronExpression} ${config.timezone || 'UTC'})`);
    }
  }

  /** Startup: forget runs a restart interrupted, remove their leftovers, register the schedule. */
  async startup() {
    const prisma = getPrisma();
    await prisma.appBackupRun.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', error: 'Interrupted by a restart', finishedAt: new Date() },
    }).catch(() => {});
    await this.removeLeftovers().catch(() => {});
    await this.syncSchedule();
  }

  async removeLeftovers() {
    const dir = backupDir();
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.staging-') || entry.endsWith('.partial')) {
        await fsp.rm(path.join(dir, entry), { recursive: true, force: true });
      }
    }
  }

  /** Queue a manual run. */
  async requestRun(userId) {
    if (this.running) throw httpError('A backup is already running', 409);
    const job = await getQueue('appBackup').add('run', { triggeredBy: userId || null }, {
      attempts: 1,
      removeOnComplete: 20,
      removeOnFail: 20,
    });
    return { queued: true, jobId: job.id };
  }

  // ------------------------------------------------------------------- tools

  /** pg_dump's version against the server's: pg_dump refuses a newer server. */
  async toolStatus() {
    const status = { pgDump: null, serverVersion: null, tar: false, ok: false, error: null };
    try {
      const { stdout } = await runTool('pg_dump', ['--version'], { timeout: 10000 });
      status.pgDump = parseToolMajor(stdout);
    } catch (error) {
      status.error = error.code === 'ENOENT'
        ? 'pg_dump is not installed on the NetHelper host (package postgresql-client)'
        : error.message;
    }
    try {
      await runTool('tar', ['--version'], { timeout: 10000 });
      status.tar = true;
    } catch {
      status.error = status.error || 'tar is not installed on the NetHelper host';
    }
    try {
      const rows = await getPrisma().$queryRawUnsafe('SHOW server_version_num');
      const num = Number(rows?.[0]?.server_version_num);
      if (num) status.serverVersion = { major: Math.floor(num / 10000), num };
    } catch (error) {
      status.error = status.error || `Database unreachable: ${error.message}`;
    }
    if (!status.error && status.pgDump && status.serverVersion && status.pgDump.major < status.serverVersion.major) {
      status.error = `pg_dump ${status.pgDump.version} can't dump a PostgreSQL ${status.serverVersion.major} server; install postgresql-client ${status.serverVersion.major} or newer`;
    }
    if (!status.error && !status.pgDump) status.error = 'Could not read the pg_dump version';
    status.ok = !status.error;
    return status;
  }

  // --------------------------------------------------------------------- run

  /**
   * Take one backup. Throws on failure, after recording it (run row, alert,
   * socket event).
   */
  async run({ trigger = 'manual', triggeredBy = null } = {}) {
    if (this.running) throw httpError('A backup is already running', 409);
    const prisma = getPrisma();
    const started = Date.now();
    const runRow = await prisma.appBackupRun.create({ data: { status: 'running', trigger, triggeredBy } });
    this.running = runRow.id;
    const dir = backupDir();
    const staging = path.join(dir, `.staging-${runRow.id}`);
    let partial = null;

    try {
      const config = await this.getConfig();
      if (config.encrypt && !config.passphrase) throw new Error('Encryption is on but no passphrase is set');

      const tools = await this.toolStatus();
      if (!tools.ok) throw new Error(tools.error);

      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      await fsp.mkdir(staging, { mode: 0o700 });

      const createdAt = new Date();
      const name = archiveName(createdAt, config.encrypt);
      const finalPath = path.join(dir, name);
      partial = `${finalPath}.partial`;

      // 1. Database
      const { env, schema } = pgEnvFromUrl();
      const dumpFile = path.join(staging, 'db.dump');
      const dumpArgs = ['--format=custom', '--no-owner', '--no-privileges', `--schema=${schema}`, `--file=${dumpFile}`];
      if (!config.includeHistory) {
        for (const table of HISTORY_TABLES) dumpArgs.push(`--exclude-table-data=${schema}."${table}"`);
      }
      await runTool('pg_dump', dumpArgs, { env });
      const migration = await this.latestMigration();

      // 2. Files
      const members = ['manifest.json', 'db.dump'];
      const dataDirs = await this.dataDirs(config);
      const knownHosts = await this.knownHostsPath();
      if (knownHosts) {
        await fsp.copyFile(knownHosts, path.join(staging, 'git-known_hosts'));
        members.push('git-known_hosts');
      }
      const includesKey = Boolean(config.encrypt && config.includeKey && process.env.ENCRYPTION_KEY);
      if (includesKey) {
        await fsp.writeFile(path.join(staging, 'encryption-key'), `${process.env.ENCRYPTION_KEY}\n`, { mode: 0o600 });
        members.push('encryption-key');
      }

      const dumpStat = await fsp.stat(dumpFile);
      const manifest = {
        format: FORMAT_VERSION,
        app: 'nethelper',
        appVersion: APP_VERSION,
        createdAt: createdAt.toISOString(),
        trigger,
        migration,
        schema,
        pgDumpVersion: tools.pgDump.version,
        serverVersion: tools.serverVersion?.major ?? null,
        keyFingerprint: keyFingerprint(),
        includesKey,
        includeHistory: config.includeHistory,
        database: { member: 'db.dump', sha256: await sha256File(dumpFile), sizeBytes: dumpStat.size },
        dirs: dataDirs.map(({ role, member, source }) => ({ role, member, source })),
        gitRepoPath: await this.gitRepoPath().catch(() => null),
        knownHosts: knownHosts ? { member: 'git-known_hosts', source: knownHosts } : null,
      };
      await fsp.writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

      // 3. Archive: tar -> (encrypt) -> hash -> file
      const tarArgs = ['-czf', '-', '-C', staging, ...members];
      for (const d of dataDirs) tarArgs.push('-C', path.dirname(d.source), d.member);
      const out = meter();
      await this.streamTar(tarArgs, config.encrypt ? [encryptStream(config.passphrase), out.stream] : [out.stream], partial);
      const sha256 = out.digest();
      const sizeBytes = out.stats.bytes;

      // 4. Check what landed on disk before calling it a backup
      if ((await sha256File(partial)) !== sha256) throw new Error('The archive on disk does not match what was written');
      await this.verifyArchive(partial, config.encrypt ? config.passphrase : null);
      await fsp.rename(partial, finalPath);
      partial = null;
      await fsp.chmod(finalPath, 0o600);

      const sidecar = {
        format: FORMAT_VERSION,
        name,
        createdAt: manifest.createdAt,
        appVersion: APP_VERSION,
        migration,
        trigger,
        encrypted: Boolean(config.encrypt),
        includesKey,
        includeHistory: config.includeHistory,
        includeGitRepo: dataDirs.some((d) => d.role === 'config-repo'),
        sizeBytes,
        sha256,
        keyFingerprint: manifest.keyFingerprint,
        pgDumpVersion: manifest.pgDumpVersion,
        serverVersion: manifest.serverVersion,
      };
      await fsp.writeFile(`${finalPath}.json`, `${JSON.stringify(sidecar, null, 2)}\n`, { mode: 0o600 });

      const pruned = await this.prune(config, name).catch((error) => {
        logger.warn(`App backup retention failed: ${error.message}`);
        return [];
      });

      const finished = await prisma.appBackupRun.update({
        where: { id: runRow.id },
        data: {
          status: 'success', fileName: name, sizeBytes: BigInt(sizeBytes), sha256,
          encrypted: Boolean(config.encrypt), durationMs: Date.now() - started, finishedAt: new Date(),
        },
      });
      await this.pruneRuns();
      alertService.clear('app-backup.failed', { subjectKey: ALERT_SUBJECT });
      logger.info(`App backup written: ${name} (${sizeBytes} bytes${pruned.length ? `, pruned ${pruned.length}` : ''})`);
      const result = { run: this.formatRun(finished), archive: sidecar, pruned };
      this.emit('app-backup:completed', result);
      return result;
    } catch (error) {
      logger.error(`App backup failed: ${error.message}`);
      if (partial) await fsp.rm(partial, { force: true }).catch(() => {});
      const failed = await prisma.appBackupRun.update({
        where: { id: runRow.id },
        data: { status: 'failed', error: error.message.slice(0, 2000), durationMs: Date.now() - started, finishedAt: new Date() },
      }).catch(() => null);
      await this.pruneRuns().catch(() => {});
      alertService.raise('app-backup.failed', {
        subjectKey: ALERT_SUBJECT,
        title: 'Application backup failed',
        message: error.message,
        data: { runId: runRow.id, trigger },
      });
      this.emit('app-backup:failed', { run: failed ? this.formatRun(failed) : { id: runRow.id, trigger }, error: error.message });
      throw error;
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      this.running = null;
    }
  }

  async latestMigration() {
    try {
      const rows = await getPrisma().$queryRawUnsafe(
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1'
      );
      return rows?.[0]?.migration_name || null;
    } catch {
      return null;
    }
  }

  /** The data folders to archive, each under its own folder name (the manifest maps them back). */
  async dataDirs(config) {
    const dirs = [];
    const storage = configBackupDir();
    if (await isDir(storage)) dirs.push({ role: 'config-backups', source: storage });
    if (config.includeGitRepo) {
      const repo = await this.gitRepoPath();
      if (repo && await isDir(repo)) dirs.push({ role: 'config-repo', source: repo });
    }
    const seen = new Set(RESERVED_MEMBERS);
    for (const d of dirs) {
      d.member = path.basename(d.source);
      if (!d.member || d.member === '.' || seen.has(d.member)) {
        throw new Error(`Can't archive ${d.source}: its folder name "${d.member}" clashes with another member; rename the folder`);
      }
      seen.add(d.member);
    }
    return dirs;
  }

  async gitRepoPath() {
    // Required lazily: git-backup.service pulls in the database at load.
    const gitBackup = require('./git-backup.service');
    const active = await gitBackup.getActiveConfig().catch(() => null);
    return active?.repoPath || gitBackup.DEFAULT_REPO_PATH;
  }

  async knownHostsPath() {
    const file = knownHostsPath();
    return await isFile(file) ? file : null;
  }

  /** Run tar, piping its stdout through `transforms` into `file`. */
  async streamTar(args, transforms, file) {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk;
    });
    const exited = new Promise((resolve, reject) => {
      child.on('error', (error) => reject(error.code === 'ENOENT' ? new Error('tar is not installed on the NetHelper host') : error));
      child.on('close', (code) => resolve(code));
    });
    const output = fs.createWriteStream(file, { mode: 0o600 });
    const written = pipeline(child.stdout, ...transforms, output);
    const [code] = await Promise.all([exited, written]);
    // GNU tar exits 1 when a file changed while it was read (a config backup
    // landing mid-run): the archive is still complete and readable.
    if (code !== 0 && code !== 1) {
      throw new Error(`tar failed (exit ${code}): ${stderr.trim().split('\n').slice(-2).join(' ')}`);
    }
    if (code === 1 && stderr.trim()) logger.warn(`App backup: tar warned: ${stderr.trim().split('\n')[0]}`);
    const handle = await fsp.open(file, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /** Read the whole archive back (decrypting it if needed) and list it with tar. */
  async verifyArchive(file, passphrase) {
    const child = spawn('tar', ['-tzf', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let listing = '';
    child.stdout.on('data', (chunk) => {
      if (listing.length < 64 * 1024) listing += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk;
    });
    const exited = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    const stages = [fs.createReadStream(file)];
    if (passphrase) stages.push(decryptStream(passphrase));
    const fed = pipeline(...stages, child.stdin).catch((error) => {
      child.kill();
      throw error;
    });
    const [code] = await Promise.all([exited, fed]);
    if (code !== 0) throw new Error(`The archive did not read back cleanly: ${stderr.trim().split('\n')[0] || `tar exit ${code}`}`);
    const names = listing.split('\n').map((line) => line.replace(/^\.\//, ''));
    if (!names.includes('manifest.json') || !names.includes('db.dump')) {
      throw new Error('The archive read back without its manifest or database dump');
    }
  }

  // ---------------------------------------------------------------- archives

  async readSidecar(name) {
    try {
      return JSON.parse(await fsp.readFile(path.join(backupDir(), `${name}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Archives on disk, newest first. */
  async list() {
    const dir = backupDir();
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const archives = [];
    for (const name of entries.filter(isArchiveName)) {
      let stat;
      try {
        stat = await fsp.stat(path.join(dir, name));
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const sidecar = await this.readSidecar(name);
      archives.push({
        name,
        createdAt: sidecar?.createdAt || stampToDate(name)?.toISOString() || stat.mtime.toISOString(),
        sizeBytes: stat.size,
        encrypted: name.endsWith('.enc'),
        appVersion: sidecar?.appVersion || null,
        migration: sidecar?.migration || null,
        trigger: sidecar?.trigger || null,
        includesKey: Boolean(sidecar?.includesKey),
        includeHistory: sidecar ? sidecar.includeHistory !== false : null,
        includeGitRepo: Boolean(sidecar?.includeGitRepo),
        sha256: sidecar?.sha256 || null,
        keyMatches: sidecar?.keyFingerprint ? sidecar.keyFingerprint === keyFingerprint() : null,
      });
    }
    return archives.sort((a, b) => (stampToDate(b.name) - stampToDate(a.name)) || b.name.localeCompare(a.name));
  }

  /** Absolute path of an archive by name; 404 unless it is one of ours. */
  async resolveArchive(name) {
    if (!isArchiveName(name)) throw httpError('Backup not found', 404);
    const file = path.join(backupDir(), name);
    if (!(await isFile(file))) throw httpError('Backup not found', 404);
    return file;
  }

  async deleteArchive(name) {
    const file = await this.resolveArchive(name);
    await fsp.rm(file, { force: true });
    await fsp.rm(`${file}.json`, { force: true });
  }

  /** Apply retention; never removes `keepName` (the run that just finished) or the newest archive. */
  async prune(config, keepName) {
    const archives = await this.list();
    const cutoff = config.retainDays ? Date.now() - config.retainDays * 86400000 : null;
    const removed = [];
    archives.forEach((archive, index) => {
      if (index === 0 || archive.name === keepName) return;
      const tooMany = index >= (config.retainCount || DEFAULTS.retainCount);
      const tooOld = cutoff && new Date(archive.createdAt).getTime() < cutoff;
      if (tooMany || tooOld) removed.push(archive.name);
    });
    for (const name of removed) await this.deleteArchive(name).catch(() => {});
    return removed;
  }

  // -------------------------------------------------------------------- runs

  formatRun(run) {
    return { ...run, sizeBytes: run.sizeBytes == null ? null : Number(run.sizeBytes) };
  }

  async runs(limit = 20) {
    const rows = await getPrisma().appBackupRun.findMany({ orderBy: { startedAt: 'desc' }, take: Math.min(Number(limit) || 20, 100) });
    return rows.map((row) => this.formatRun(row));
  }

  async pruneRuns() {
    const prisma = getPrisma();
    const old = await prisma.appBackupRun.findMany({
      orderBy: { startedAt: 'desc' }, skip: RUN_HISTORY_KEEP, select: { id: true },
    });
    if (old.length) await prisma.appBackupRun.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  }

  /** Settings, tool check, archives and recent runs for the settings page. */
  async overview() {
    const [row, tools, archives, runs] = await Promise.all([
      this.getConfigRow(), this.toolStatus(), this.list(), this.runs(10),
    ]);
    return {
      config: this.publicConfig(row),
      tools,
      path: backupDir(),
      running: Boolean(this.running),
      archives,
      runs,
      keyFingerprint: keyFingerprint(),
    };
  }
}

module.exports = new AppBackupService();
module.exports.isArchiveName = isArchiveName;
module.exports.keyFingerprint = keyFingerprint;
module.exports.archiveName = archiveName;
module.exports.HISTORY_TABLES = HISTORY_TABLES;
