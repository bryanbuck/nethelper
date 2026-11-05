/**
 * Shared by the application backup service and the restore CLI
 * (scripts/app-restore.js): paths, the key fingerprint, the restore preflight
 * and the SQL that wraps a restore. No database, queue or socket wiring here,
 * so the CLI can load it with the service stopped.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT_VERSION = 1;
const BACKEND_ROOT = path.resolve(__dirname, '../..');

function backupDir() {
  return process.env.APP_BACKUP_PATH
    ? path.resolve(process.env.APP_BACKUP_PATH)
    : path.join(BACKEND_ROOT, 'storage/app-backups');
}

function configBackupDir() {
  return process.env.BACKUP_STORAGE_PATH
    ? path.resolve(process.env.BACKUP_STORAGE_PATH)
    : path.join(BACKEND_ROOT, 'storage/config-backups');
}

// Same defaults as git-backup.service.js (DEFAULT_REPO_PATH, KNOWN_HOSTS_PATH).
function defaultGitRepoDir() {
  return process.env.BACKUP_GIT_REPO_PATH
    ? path.resolve(process.env.BACKUP_GIT_REPO_PATH)
    : path.join(BACKEND_ROOT, 'storage/config-repo');
}

function knownHostsPath() {
  return process.env.BACKUP_GIT_KNOWN_HOSTS
    ? path.resolve(process.env.BACKUP_GIT_KNOWN_HOSTS)
    : path.join(path.dirname(defaultGitRepoDir()), 'git-known_hosts');
}

/** HMAC of a constant under the key: tells whether two installs share a key without revealing it. */
function keyFingerprint(key = process.env.ENCRYPTION_KEY) {
  if (!key) return null;
  return crypto.createHmac('sha256', String(key).trim()).update('nethelper-app-backup-key-check').digest('hex').slice(0, 16);
}

/** Newest migration this code ships (prisma/migrations/<timestamp>_<name>). */
function codeMigration(dir = path.join(BACKEND_ROOT, 'prisma/migrations')) {
  try {
    return fs.readdirSync(dir).filter((name) => /^\d{14}_/.test(name)).sort().pop() || null;
  } catch {
    return null;
  }
}

/**
 * Decide whether an archive can be restored here.
 *
 * errors: never overridable. blockers: refused unless --force. warnings: said
 * and carried on.
 */
function planRestore({
  manifest, dumpSha256, currentKeyFingerprint, archivedKeyFingerprint,
  currentMigration, restoreMajor, targets,
}) {
  const errors = [];
  const blockers = [];
  const warnings = [];

  if (!manifest || manifest.app !== 'nethelper') errors.push('Not a NetHelper application backup (no manifest)');
  else if (manifest.format !== FORMAT_VERSION) errors.push(`Unknown backup format ${manifest.format}; this NetHelper reads format ${FORMAT_VERSION}`);
  if (errors.length) return { errors, blockers, warnings, rewrites: [], copies: [] };

  if (!manifest.database?.sha256 || dumpSha256 !== manifest.database.sha256) {
    errors.push('The database dump does not match its checksum: the archive is damaged');
  }
  if (manifest.migration && currentMigration && manifest.migration > currentMigration) {
    errors.push(`The backup comes from a newer NetHelper (${manifest.appVersion}, migration ${manifest.migration}); install that version or newer, then restore`);
  }
  const dumpMajor = Number(String(manifest.pgDumpVersion || '').split('.')[0]);
  if (restoreMajor && dumpMajor && restoreMajor < dumpMajor) {
    errors.push(`pg_restore ${restoreMajor} can't read a dump made by pg_dump ${manifest.pgDumpVersion}; install postgresql-client ${dumpMajor} or newer`);
  }

  if (!currentKeyFingerprint) {
    blockers.push('ENCRYPTION_KEY is not set here');
  } else if (manifest.keyFingerprint && manifest.keyFingerprint !== currentKeyFingerprint) {
    blockers.push(archivedKeyFingerprint === manifest.keyFingerprint
      ? 'This install\'s ENCRYPTION_KEY differs from the backup\'s. The archive holds the original key: write it out with --key-out <file>, set ENCRYPTION_KEY to it, and run the restore again'
      : 'This install\'s ENCRYPTION_KEY differs from the backup\'s: stored credentials would not decrypt. Set ENCRYPTION_KEY to the original key and run the restore again (or --force to restore with unreadable credentials)');
  }

  // Data folders: where they go here, and the stored paths that move with them.
  const rewrites = [];
  const copies = [];
  for (const dir of manifest.dirs || []) {
    const target = targets[dir.role];
    if (!target) {
      warnings.push(`Skipping ${dir.member}/: unknown folder role "${dir.role}"`);
      continue;
    }
    copies.push({ member: dir.member, role: dir.role, target });
    if (dir.source && path.resolve(dir.source) !== path.resolve(target)) {
      rewrites.push({ role: dir.role, from: path.resolve(dir.source), to: path.resolve(target) });
    }
  }
  if (manifest.migration && currentMigration && manifest.migration < currentMigration) {
    warnings.push(`The backup is from an older NetHelper (${manifest.appVersion}); its database is upgraded when NetHelper next starts`);
  }
  return { errors, blockers, warnings, rewrites, copies };
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * SQL sent around pg_restore's script in one psql --single-transaction:
 * before it, drop the schema (the dump recreates it, so tables a newer
 * migration added don't survive); after it, move stored absolute paths to
 * where the files were restored.
 */
function restoreSql(schema, rewrites) {
  const s = sqlIdent(schema);
  const before = `DROP SCHEMA IF EXISTS ${s} CASCADE;\n`;
  const lines = [];
  // pg_restore's script empties search_path: qualify every name.
  const movePrefix = (table, column, from, to) => {
    const col = sqlIdent(column);
    lines.push(`UPDATE ${s}.${sqlIdent(table)} SET ${col} = ${sqlLiteral(to)} || substr(${col}, ${from.length + 1}) `
      + `WHERE left(${col}, ${from.length + 1}) = ${sqlLiteral(`${from}/`)};`);
  };
  for (const { role, from, to } of rewrites) {
    if (role === 'config-backups') {
      movePrefix('ConfigBackup', 'filePath', from, to);
      movePrefix('ConfigBackupArtifact', 'filePath', from, to);
      movePrefix('ScopeBackup', 'filePath', from, to);
    } else if (role === 'config-repo') {
      lines.push(`UPDATE ${s}.${sqlIdent('GitBackupConfig')} SET ${sqlIdent('repoPath')} = ${sqlLiteral(to)} `
        + `WHERE ${sqlIdent('repoPath')} = ${sqlLiteral(from)};`);
    }
  }
  return { before, after: lines.length ? `${lines.join('\n')}\n` : '' };
}

module.exports = {
  FORMAT_VERSION,
  backupDir,
  configBackupDir,
  defaultGitRepoDir,
  knownHostsPath,
  keyFingerprint,
  codeMigration,
  planRestore,
  restoreSql,
};
