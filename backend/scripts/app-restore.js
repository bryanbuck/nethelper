#!/usr/bin/env node
/**
 * Restore a NetHelper application backup (Settings -> App Backup archives).
 *
 * Usage (from backend/, with NetHelper STOPPED):
 *   node scripts/app-restore.js --file <archive> [--dry-run] [--yes] [--force]
 *                               [--passphrase-file <file>] [--key-out <file>]
 *
 *   --dry-run          check the archive and say what would happen; change nothing
 *   --yes              don't ask for confirmation (needed without a terminal)
 *   --force            restore despite a different ENCRYPTION_KEY or other
 *                      open database connections
 *   --passphrase-file  passphrase of an encrypted (.enc) archive; else
 *                      NETHELPER_BACKUP_PASSPHRASE, else a prompt
 *   --key-out <file>   write the ENCRYPTION_KEY stored in the archive (if any)
 *                      to <file> (mode 0600), then stop
 *
 * What it does: checks the archive (checksums, format, NetHelper and
 * PostgreSQL versions, the ENCRYPTION_KEY fingerprint), then in ONE database
 * transaction drops the app's schema, loads the dump and moves stored file
 * paths to this install's folders; then copies the config-backup files (and
 * the Git mirror repo, when the archive has it) into place. A failure inside
 * the transaction leaves the database as it was. Migrations newer than the
 * backup run when NetHelper next starts.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { decryptStream, isEncryptedHeader } = require('../src/utils/archive-crypto');
const { pgEnvFromUrl, parseToolMajor } = require('../src/utils/pg-env');
const {
  configBackupDir, defaultGitRepoDir, knownHostsPath, keyFingerprint, codeMigration,
  planRestore, restoreSql, restoreScriptFilter,
} = require('../src/utils/app-backup-common');

function parseArgs(argv) {
  const opts = { dryRun: false, yes: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--file') opts.file = argv[++i];
    else if (arg === '--passphrase-file') opts.passphraseFile = argv[++i];
    else if (arg === '--key-out') opts.keyOut = argv[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (!opts.file && !arg.startsWith('-')) opts.file = arg;
    else throw new Error(`Unknown option ${arg}`);
  }
  return opts;
}

const say = (msg = '') => process.stdout.write(`${msg}\n`);

function run(cmd, args, { env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(error.code === 'ENOENT'
          ? `${cmd} is not installed (package postgresql-client / tar)`
          : `${cmd} failed: ${String(stderr || error.message).trim().split('\n').slice(-3).join(' ')}`));
      }
      return resolve(String(stdout));
    });
  });
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

function ask(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (silent) {
      // eslint-disable-next-line no-underscore-dangle
      rl._writeToOutput = (text) => { if (text.includes(question)) process.stdout.write(text); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (silent) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassphrase(opts) {
  if (opts.passphraseFile) return (await fsp.readFile(opts.passphraseFile, 'utf8')).replace(/\r?\n$/, '');
  if (process.env.NETHELPER_BACKUP_PASSPHRASE) return process.env.NETHELPER_BACKUP_PASSPHRASE;
  if (!process.stdin.isTTY) throw new Error('The archive is encrypted: pass --passphrase-file or set NETHELPER_BACKUP_PASSPHRASE');
  return ask('Backup passphrase: ', { silent: true });
}

async function unpack(file, work, opts) {
  const head = Buffer.alloc(4);
  const fd = await fsp.open(file, 'r');
  try {
    await fd.read(head, 0, 4, 0);
  } finally {
    await fd.close();
  }
  let tarball = file;
  const encrypted = isEncryptedHeader(head);
  if (encrypted) {
    const passphrase = await readPassphrase(opts);
    tarball = path.join(work, 'archive.tar.gz');
    // Decrypt fully first: GCM proves the file intact only at the end, and
    // nothing is extracted from an archive that hasn't been proven.
    await pipeline(fs.createReadStream(file), decryptStream(passphrase), fs.createWriteStream(tarball, { mode: 0o600 }));
  }
  const out = path.join(work, 'x');
  await fsp.mkdir(out, { mode: 0o700 });
  await run('tar', ['-xzf', tarball, '-C', out, '--no-same-owner', '--no-same-permissions']);
  if (encrypted) await fsp.rm(tarball, { force: true });
  return { dir: out, encrypted };
}

async function otherConnections(env) {
  const sql = 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()';
  const out = await run('psql', ['-X', '-A', '-t', '-c', sql], { env });
  return Number(out.trim()) || 0;
}

async function serverMajor(env) {
  const out = await run('psql', ['-X', '-A', '-t', '-c', 'SHOW server_version_num'], { env });
  const num = Number(out.trim());
  return Number.isFinite(num) && num > 0 ? Math.floor(num / 10000) : null;
}

/** pg_restore's script, between our before/after SQL, into one psql transaction.
 * The script is filtered for settings the server doesn't know (restoreScriptFilter). */
function loadDump(dumpFile, sql, env, major) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    const psql = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-o', '/dev/null'], { env: childEnv, stdio: ['pipe', 'inherit', 'pipe'] });
    const restore = spawn('pg_restore', ['--no-owner', '--no-privileges', '-f', '-', dumpFile], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    psql.stderr.on('data', (chunk) => { errors += chunk; });
    restore.stderr.on('data', (chunk) => { errors += chunk; });
    psql.stdin.on('error', () => {}); // psql stopped early; its exit code says why
    psql.stdin.write(sql.before);
    const filter = restoreScriptFilter(major);
    restore.stdout.pipe(filter).pipe(psql.stdin, { end: false });
    // Finish only once pg_restore has exited AND the filter has passed on its
    // last line, so our closing SQL (the COMMIT side) never overtakes the script.
    let restoreCode = null;
    let drained = false;
    const finish = () => {
      if (restoreCode === null || !drained) return;
      if (restoreCode === 0) psql.stdin.end(sql.after);
      else psql.stdin.destroy(); // no COMMIT reaches psql: the transaction rolls back
    };
    filter.on('end', () => { drained = true; finish(); });
    restore.on('close', (code) => { restoreCode = code; finish(); });
    restore.on('error', reject);
    psql.on('error', reject);
    psql.on('close', (code) => {
      if (code === 0 && restoreCode === 0) return resolve();
      const detail = errors.trim().split('\n').filter(Boolean).slice(-4).join('\n');
      return reject(new Error(`Database restore failed; the database was left as it was.\n${detail}`));
    });
  });
}

async function copyDir(from, to) {
  await fsp.mkdir(to, { recursive: true });
  await fsp.cp(from, to, { recursive: true, force: true });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.file) {
    say(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
    process.exit(opts.help ? 0 : 1);
  }
  const file = path.resolve(opts.file);
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'nethelper-restore-'));
  try {
    say(`Reading ${file}`);
    const { dir, encrypted } = await unpack(file, work, opts);
    let manifest = null;
    try {
      manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      // planRestore reports it
    }
    const dumpFile = path.join(dir, 'db.dump');
    const archivedKeyFile = path.join(dir, 'encryption-key');
    const archivedKey = fs.existsSync(archivedKeyFile) ? (await fsp.readFile(archivedKeyFile, 'utf8')).trim() : null;

    if (opts.keyOut) {
      if (!archivedKey) throw new Error('This archive does not contain an ENCRYPTION_KEY');
      await fsp.writeFile(path.resolve(opts.keyOut), `${archivedKey}\n`, { mode: 0o600, flag: 'wx' });
      say(`Wrote the archived ENCRYPTION_KEY to ${path.resolve(opts.keyOut)} (mode 0600).`);
      say('Put it in this install\'s environment as ENCRYPTION_KEY, then run the restore again.');
      return 0;
    }

    const restoreVersion = parseToolMajor(await run('pg_restore', ['--version']));
    await run('psql', ['--version']);
    const { env, schema } = pgEnvFromUrl();
    const plan = planRestore({
      manifest,
      dumpSha256: fs.existsSync(dumpFile) ? await sha256File(dumpFile) : null,
      currentKeyFingerprint: keyFingerprint(),
      archivedKeyFingerprint: archivedKey ? keyFingerprint(archivedKey) : null,
      currentMigration: codeMigration(),
      restoreMajor: restoreVersion?.major,
      targets: { 'config-backups': configBackupDir(), 'config-repo': defaultGitRepoDir() },
    });

    if (manifest) {
      say(`Backup:    NetHelper ${manifest.appVersion}, taken ${manifest.createdAt} (${manifest.trigger})${encrypted ? ', encrypted' : ''}`);
      say(`Database:  ${manifest.database?.sizeBytes ?? '?'} bytes, migration ${manifest.migration || 'unknown'}${manifest.includeHistory === false ? ', history tables empty' : ''}`);
      say(`Restore to database "${env.PGDATABASE}" on ${env.PGHOST || 'localhost'}${env.PGPORT ? `:${env.PGPORT}` : ''}, schema "${schema}"`);
      for (const copy of plan.copies) say(`Files:     ${copy.member}/ -> ${copy.target}`);
      for (const rw of plan.rewrites) say(`Paths:     stored ${rw.from}/... become ${rw.to}/...`);
    }
    for (const w of plan.warnings) say(`Note:      ${w}`);
    for (const b of plan.blockers) say(`${opts.force ? 'Forced:   ' : 'Blocked:  '} ${b}`);
    for (const e of plan.errors) say(`Error:     ${e}`);
    if (plan.errors.length || (plan.blockers.length && !opts.force)) return 1;

    await run('pg_restore', ['--list', dumpFile]); // the dump itself reads
    const major = await serverMajor(env);
    say(`Server:    PostgreSQL ${major ?? 'version unknown'}`);
    const others = await otherConnections(env);
    if (others > 0) {
      const msg = `${others} other connection(s) to the database are open: stop NetHelper first`;
      if (!opts.force) {
        say(`Blocked:   ${msg}`);
        return 1;
      }
      say(`Forced:    ${msg}`);
    }
    if (opts.dryRun) {
      say('Dry run: the archive checks out. Nothing was changed.');
      return 0;
    }
    if (!opts.yes) {
      if (!process.stdin.isTTY) throw new Error('Pass --yes to restore without a terminal');
      const answer = await ask(`This REPLACES everything in database "${env.PGDATABASE}". Type "restore" to continue: `);
      if (answer.trim() !== 'restore') {
        say('Cancelled.');
        return 1;
      }
    }

    say('Restoring the database (one transaction)...');
    await loadDump(dumpFile, restoreSql(schema, plan.rewrites), env, major);
    for (const copy of plan.copies) {
      say(`Copying ${copy.member}/ to ${copy.target}`);
      await copyDir(path.join(dir, copy.member), copy.target);
    }
    if (manifest.knownHosts && fs.existsSync(path.join(dir, 'git-known_hosts'))) {
      const target = knownHostsPath();
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(path.join(dir, 'git-known_hosts'), target);
      say(`Restored SSH known hosts to ${target}`);
    }
    say('Done. Start NetHelper; it applies any newer migrations as it starts.');
    if (plan.blockers.length) say('Restored with --force: check Settings for credentials that no longer decrypt.');
    return 0;
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code), (error) => {
    process.stderr.write(`Restore failed: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadDump, serverMajor };
