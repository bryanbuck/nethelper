const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { getPrisma } = require('../config/database');
const encryption = require('../utils/encryption');
const logger = require('../utils/logger');

// Secret values inside GitBackupConfig.credentials. Drives encryption on write
// and masking on read, the same way CLOUD_PROVIDERS[x].credentialFields does
// for cloud integrations (see settings.service.encryptCredentials).
const GIT_CREDENTIAL_FIELDS = [
  { key: 'sshKeyPath', label: 'SSH private key path', secret: false },
  { key: 'token', label: 'HTTPS access token', secret: true },
];

const DEFAULT_REPO_PATH = path.resolve(__dirname, '../../storage/config-repo');
const GIT_TIMEOUT_MS = Number(process.env.BACKUP_GIT_TIMEOUT_MS || 60000);

// Transports git may use for the mirror. Excludes ext:: and fd::, which run
// arbitrary commands, and anything else exotic.
const GIT_ALLOWED_PROTOCOLS = 'https:http:ssh:git:file';

/** Quote a value for the POSIX shell that git runs GIT_SSH_COMMAND through. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Validate admin-supplied mirror settings before they reach git's argv or
 * environment. Each value lands in an argv slot, so a leading "-" would be
 * parsed as a git option (e.g. a branch of "--receive-pack=...").
 * Throws an Error with statusCode 400 on the first problem.
 */
function validateMirrorSettings({ repoPath, remoteUrl, branch, sshKeyPath }) {
  const fail = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  };

  if (repoPath && !path.isAbsolute(repoPath)) fail('Repository path must be absolute');

  // Simplified git check-ref-format: no leading "-" or "/", no "..", "@{", "//",
  // control characters, spaces, or ~^:?*[\ characters, and no ".lock" / "/" / "." ending.
  if (branch && (
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    /^[-/.]|\.\.|\/\/|\/\.|@\{|\.lock$|[/.]$/.test(branch)
  )) {
    fail(`Invalid branch name: ${branch}`);
  }

  if (remoteUrl) {
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(remoteUrl);
    const scpLike = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(remoteUrl);
    const allowedScheme = scheme && GIT_ALLOWED_PROTOCOLS.split(':').includes(scheme[1].toLowerCase());
    if (remoteUrl.startsWith('-') || /\s/.test(remoteUrl) || remoteUrl.includes('::') || !(allowedScheme || scpLike)) {
      fail('Remote URL must be an https://, ssh://, git://, file:// or user@host:path URL');
    }
  }

  if (sshKeyPath && (!path.isAbsolute(sshKeyPath) || /[\0\n\r]/.test(sshKeyPath))) {
    fail('SSH key path must be an absolute path');
  }
}

// `* -text` stops git normalising line endings: a device config must round-trip
// byte-for-byte or the checksum in ConfigBackup stops matching the committed file.
const GITATTRIBUTES = '* -text\n';

const README = `# NetHelper configuration backups

Machine-generated. Every commit is one device configuration captured by
NetHelper; do not hand-edit — changes here are overwritten on the next backup.

Layout: one directory per device serial, containing the configuration file and
a meta.json describing the device and the transport the config came from.

History is never rewritten. Backup retention prunes NetHelper's own database
rows and flat files, but leaves this repository's history intact.
`;

/**
 * Git mirror for configuration backups.
 *
 * The flat-file store (BACKUP_STORAGE_PATH / ConfigBackup.filePath) stays
 * authoritative; this service is an additive write-side mirror. Everything here
 * is best-effort by design: a git failure must never fail a backup, because the
 * config bytes are already safely on disk by the time we are called.
 *
 * Shells out to the system `git` binary rather than taking a library
 * dependency, matching how discovery.service shells out to nmap.
 */
class GitBackupService {
  constructor() {
    // Every git invocation goes through this promise chain. runBackupBatch is
    // sequential, but manual and scheduled Bull jobs can interleave, and two
    // concurrent commits in one repo race on .git/index.lock.
    this.queue = Promise.resolve();
  }

  get credentialFields() {
    return GIT_CREDENTIAL_FIELDS;
  }

  get defaultRepoPath() {
    return DEFAULT_REPO_PATH;
  }

  /** Serialize `fn` behind any git work already in flight. */
  serialize(fn) {
    const run = this.queue.then(fn, fn);
    // Keep the chain alive regardless of whether this link rejected.
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  /**
   * Run git with the given args. Uses execFile (no shell), so nothing derived
   * from device data or user config can be interpreted as a command.
   */
  exec(args, { cwd, config, timeout = GIT_TIMEOUT_MS } = {}) {
    const env = {
      ...process.env,
      // Never let git block a backup run waiting on a credential prompt.
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      LC_ALL: 'C',
      GIT_ALLOW_PROTOCOL: GIT_ALLOWED_PROTOCOLS,
    };

    const sshKeyPath = config?.credentials?.sshKeyPath;
    if (sshKeyPath) {
      env.GIT_SSH_COMMAND = `ssh -i ${shellQuote(sshKeyPath)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
    }

    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, env, timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const message = (stderr || error.message || '').trim();
          const err = new Error(`git ${args[0]} failed: ${message}`);
          err.stderr = stderr;
          err.code = error.code;
          return reject(err);
        }
        resolve({ stdout, stderr });
      });
    });
  }

  /** Identity args, passed per-invocation so no global git config is required. */
  identityArgs(config) {
    return [
      '-c', `user.name=${config.authorName || 'NetHelper'}`,
      '-c', `user.email=${config.authorEmail || 'nethelper@localhost'}`,
    ];
  }

  // ---------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------

  /**
   * The active Git mirror config with secrets decrypted, or null when the
   * mirror is disabled (no row, or isActive false). Callers treat null as
   * "do nothing" — the feature is opt-in.
   */
  async getActiveConfig() {
    const prisma = getPrisma();
    const row = await prisma.gitBackupConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!row) return null;
    return this.decryptConfig(row);
  }

  /** Decrypt secret credential fields on a config row. */
  decryptConfig(row) {
    const credentials = { ...(row.credentials || {}) };
    for (const field of GIT_CREDENTIAL_FIELDS) {
      if (field.secret && credentials[field.key]) {
        credentials[field.key] = encryption.decrypt(credentials[field.key]);
      }
    }
    return { ...row, credentials, repoPath: row.repoPath || DEFAULT_REPO_PATH };
  }

  async isEnabled() {
    return (await this.getActiveConfig()) !== null;
  }

  // ---------------------------------------------------------------------
  // Repository
  // ---------------------------------------------------------------------

  /**
   * Ensure the repo exists, is initialized, and has the configured remote.
   * Idempotent and cheap enough to call on every backup run.
   */
  async ensureRepo(config) {
    const repoPath = config.repoPath;
    await fs.mkdir(repoPath, { recursive: true });

    let initialized = true;
    try {
      await fs.access(path.join(repoPath, '.git'));
    } catch {
      initialized = false;
    }

    if (!initialized) {
      await this.exec(['init', '-b', config.branch || 'main'], { cwd: repoPath, config });
      await fs.writeFile(path.join(repoPath, '.gitattributes'), GITATTRIBUTES, 'utf8');
      await fs.writeFile(path.join(repoPath, 'README.md'), README, 'utf8');
      await this.exec(['add', '--', '.gitattributes', 'README.md'], { cwd: repoPath, config });
      await this.exec(
        [...this.identityArgs(config), 'commit', '-m', 'Initialize NetHelper configuration backup repository'],
        { cwd: repoPath, config }
      );
      logger.info(`Initialized config backup git repository at ${repoPath}`);
    }

    await this.syncRemote(config);
    return repoPath;
  }

  /** Add or update the `origin` remote to match the configured URL. */
  async syncRemote(config) {
    const { repoPath, remoteUrl } = config;
    let current = null;
    try {
      const { stdout } = await this.exec(['remote', 'get-url', 'origin'], { cwd: repoPath, config });
      current = stdout.trim();
    } catch {
      current = null;
    }

    if (!remoteUrl) {
      if (current) {
        await this.exec(['remote', 'remove', 'origin'], { cwd: repoPath, config }).catch(() => {});
      }
      return;
    }
    if (current === remoteUrl) return;

    const args = current ? ['remote', 'set-url', 'origin', remoteUrl] : ['remote', 'add', 'origin', remoteUrl];
    await this.exec(args, { cwd: repoPath, config });
  }

  /**
   * Resolve a repo-relative path and assert it stays inside the repo.
   * Device serials are sanitized before they get here, but this is the
   * backstop that makes traversal impossible regardless of input.
   */
  resolveInRepo(repoPath, ...segments) {
    const root = path.resolve(repoPath);
    const target = path.resolve(root, ...segments);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write outside the backup repository: ${target}`);
    }
    return target;
  }

  /**
   * Directory name for a device. Matches the flat-file store's sanitizer
   * (config-backup.service) so the two trees line up serial-for-serial.
   */
  deviceDirName(serial) {
    return String(serial).replace(/[^A-Za-z0-9_-]/g, '_');
  }

  /** Config filename for a captured format. */
  configFileName(format) {
    switch (format) {
      case 'junos-set':
        return 'running-config.set';
      case 'aoscx-json':
      case 'mist-config-json':
      case 'meraki-settings-json':
        return 'settings.json';
      default:
        return 'running-config.cfg';
    }
  }

  // ---------------------------------------------------------------------
  // Commit / push
  // ---------------------------------------------------------------------

  /**
   * Write a device's config + metadata into the repo and commit it.
   *
   * Returns { changed, commitSha }. `changed: false` means the config was
   * byte-identical to what is already committed, so nothing was recorded —
   * this is the dedup that the flat-file store cannot do.
   *
   * @param {Object} params
   * @param {Object} params.device   - full device row (serial, name, vendor, platform, managementMode)
   * @param {string} params.text     - the captured configuration
   * @param {string} params.format   - 'cli-text' | 'junos-set' | 'aoscx-json' | ...
   * @param {string} params.source   - transport label, e.g. 'AOS-CX REST'
   * @param {string} params.backupId - ConfigBackup row id
   * @param {string} params.trigger  - 'manual' | 'scheduled'
   */
  async commitDeviceConfig({ device, text, format, source, backupId, trigger }) {
    const config = await this.getActiveConfig();
    if (!config) return { changed: false, skipped: true };

    return this.serialize(async () => {
      await this.ensureRepo(config);

      const dirName = this.deviceDirName(device.serial);
      const deviceDir = this.resolveInRepo(config.repoPath, dirName);
      await fs.mkdir(deviceDir, { recursive: true });

      const configName = this.configFileName(format);
      const configPath = this.resolveInRepo(config.repoPath, dirName, configName);
      const metaPath = this.resolveInRepo(config.repoPath, dirName, 'meta.json');

      // A device that changes transport (e.g. NETCONF -> SSH fallback) changes
      // filename too; drop the stale one so the tree shows one config per device.
      for (const stale of ['running-config.cfg', 'running-config.set', 'settings.json']) {
        if (stale === configName) continue;
        const stalePath = this.resolveInRepo(config.repoPath, dirName, stale);
        await fs.rm(stalePath, { force: true }).catch(() => {});
      }

      const body = text.endsWith('\n') ? text : `${text}\n`;
      await fs.writeFile(configPath, body, 'utf8');

      // Sorted keys + trailing newline keeps meta diffs minimal and stable.
      const meta = {
        deviceName: device.name,
        format: format || 'cli-text',
        lastBackupAt: new Date().toISOString(),
        managementMode: device.managementMode || null,
        platform: device.platform || null,
        serial: device.serial,
        source: source || null,
        vendor: device.vendor || null,
      };
      await fs.writeFile(metaPath, `${JSON.stringify(meta, Object.keys(meta).sort(), 2)}\n`, 'utf8');

      await this.exec(['add', '--all', '--', dirName], { cwd: config.repoPath, config });

      // meta.json always changes (lastBackupAt), so staging is never empty.
      // Ask specifically whether the *config* differs, and drop the whole
      // commit when it does not — otherwise every run makes a noise commit.
      const configChanged = await this.pathHasStagedChanges(config, path.posix.join(dirName, configName));
      if (!configChanged) {
        await this.exec(['restore', '--staged', '--worktree', '--', dirName], { cwd: config.repoPath, config })
          .catch(() => {});
        return { changed: false, commitSha: null };
      }

      const message = this.commitMessage({ device, source, backupId, trigger, dirName });
      await this.exec([...this.identityArgs(config), 'commit', '-m', message], {
        cwd: config.repoPath,
        config,
      });
      const { stdout } = await this.exec(['rev-parse', 'HEAD'], { cwd: config.repoPath, config });
      const commitSha = stdout.trim();

      logger.info(`Committed config for ${device.name} as ${commitSha.slice(0, 8)}`);
      return { changed: true, commitSha };
    });
  }

  /** True when the given repo-relative path has staged changes. */
  async pathHasStagedChanges(config, relPath) {
    try {
      await this.exec(['diff', '--cached', '--quiet', '--', relPath], { cwd: config.repoPath, config });
      return false;
    } catch (error) {
      // git diff --quiet exits 1 when there *are* differences; anything else is real.
      if (error.code === 1) return true;
      throw error;
    }
  }

  commitMessage({ device, source, backupId, trigger, dirName }) {
    const platform = device.platform || 'unknown';
    const vendor = device.vendor || 'unknown';
    const mode = device.managementMode || 'unknown';
    return [
      `backup(${dirName}): configuration changed`,
      '',
      `Device:   ${device.name}`,
      `Platform: ${platform} (${vendor}, ${mode})`,
      `Source:   ${source || 'unknown'}`,
      `Backup:   ${backupId}`,
      `Trigger:  ${trigger || 'manual'}`,
    ].join('\n');
  }

  /**
   * Push to the configured remote, once per batch. A push failure is recorded
   * and logged but never thrown: the commits are safe locally and the next run
   * pushes them. Returns { pushed, error }.
   */
  async pushIfConfigured(config = null) {
    const active = config || (await this.getActiveConfig());
    if (!active || !active.remoteUrl) return { pushed: false };

    return this.serialize(async () => {
      const branch = active.branch || 'main';
      try {
        await this.exec(['push', '--set-upstream', 'origin', branch], {
          cwd: active.repoPath,
          config: active,
        });
        await this.recordPush(active.id, null);
        logger.info(`Pushed config backup repository to ${active.remoteUrl} (${branch})`);
        return { pushed: true };
      } catch (error) {
        // Never fail a backup run over a remote problem.
        logger.warn(`Config backup git push failed: ${error.message}`);
        await this.recordPush(active.id, error.message);
        return { pushed: false, error: error.message };
      }
    });
  }

  async recordPush(id, errorMessage) {
    const prisma = getPrisma();
    await prisma.gitBackupConfig.update({
      where: { id },
      data: { lastPush: new Date(), lastPushError: errorMessage },
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------
  // Diagnostics / history
  // ---------------------------------------------------------------------

  /**
   * Validate a configuration: git present, repo path usable, and (when a
   * remote is set) the remote reachable. Drives the Settings "Test" button.
   * Returns { success, message } rather than throwing.
   */
  async testConnection(config) {
    try {
      const { stdout } = await this.exec(['--version'], { timeout: 10000 });
      const version = stdout.trim();

      await this.serialize(() => this.ensureRepo(config));

      if (!config.remoteUrl) {
        return { success: true, message: `${version} — local repository ready at ${config.repoPath} (no remote configured)` };
      }

      await this.exec(['ls-remote', '--heads', config.remoteUrl], {
        cwd: config.repoPath,
        config,
        timeout: 30000,
      });
      return { success: true, message: `${version} — repository ready, remote ${config.remoteUrl} reachable` };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Commit history for one device, newest first.
   * Returns [{ sha, shortSha, date, subject, backupId }].
   */
  async getDeviceHistory(serial, limit = 50) {
    const config = await this.getActiveConfig();
    if (!config) return [];

    const dirName = this.deviceDirName(serial);
    // Unit separator between fields, record separator between commits: neither
    // appears in a commit subject, so parsing stays unambiguous.
    const format = '%H\x1f%cI\x1f%s\x1f%b\x1e';
    try {
      const { stdout } = await this.exec(
        ['log', `--max-count=${Number(limit) || 50}`, `--format=${format}`, '--', dirName],
        { cwd: config.repoPath, config }
      );
      return stdout
        .split('\x1e')
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
          const [sha, date, subject, body = ''] = record.split('\x1f');
          const backupId = (body.match(/^Backup:\s+(\S+)/m) || [])[1] || null;
          return { sha, shortSha: sha.slice(0, 8), date, subject, backupId };
        });
    } catch (error) {
      logger.warn(`Could not read git history for ${serial}: ${error.message}`);
      return [];
    }
  }

  /** File content at a specific commit. */
  async getCommitContent(sha, relPath) {
    const config = await this.getActiveConfig();
    if (!config) throw new Error('The Git backup mirror is not enabled');
    const { stdout } = await this.exec(['show', `${sha}:${relPath}`], {
      cwd: config.repoPath,
      config,
    });
    return stdout;
  }

  /** Unified diff of one path between two commits. */
  async diffCommits(shaA, shaB, relPath) {
    const config = await this.getActiveConfig();
    if (!config) throw new Error('The Git backup mirror is not enabled');
    const { stdout } = await this.exec(['diff', shaA, shaB, '--', relPath], {
      cwd: config.repoPath,
      config,
    });
    return stdout;
  }
}

module.exports = new GitBackupService();
module.exports.GIT_CREDENTIAL_FIELDS = GIT_CREDENTIAL_FIELDS;
module.exports.DEFAULT_REPO_PATH = DEFAULT_REPO_PATH;
module.exports.validateMirrorSettings = validateMirrorSettings;
