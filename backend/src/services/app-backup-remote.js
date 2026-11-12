/**
 * Off-host copies of application backups over SFTP (Settings -> App Backup).
 *
 * One connection per use (a run's sync, or a connection test). The server's
 * host key is pinned on first use: its SHA256 fingerprint (the OpenSSH
 * format, "SHA256:<base64>") is returned to the caller to store, and a later
 * connection that presents another key is refused before authenticating.
 *
 * An upload is written to "<name>.partial", its size checked, then renamed,
 * so the remote never holds a cut archive under a real name. Only names that
 * match the archive pattern (and their .json sidecars) are ever listed or
 * deleted, so the remote folder may hold other files.
 *
 * ssh2 (already a dependency for the SSH device transport) has the SFTP
 * client; nothing new is installed.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client, utils: sshUtils } = require('ssh2');

const READY_TIMEOUT_MS = 20000;

class RemoteError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** OpenSSH-style fingerprint of a raw public key blob. */
function fingerprint(keyBlob) {
  return `SHA256:${crypto.createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`;
}

/** Remote paths are POSIX; a relative one starts at the login's home folder. */
function remoteJoin(dir, name) {
  return dir ? path.posix.join(dir, name) : name;
}

/** Returns an error message, or null when the key parses (with its passphrase). */
function checkPrivateKey(key, passphrase) {
  const parsed = sshUtils.parseKey(key, passphrase || undefined);
  if (parsed instanceof Error) {
    return /encrypted|passphrase/i.test(parsed.message)
      ? 'The private key is protected by a passphrase: enter it, or check the one entered'
      : `The private key could not be read: ${parsed.message}`;
  }
  return null;
}

function promisify(fn, ctx) {
  return (...args) => new Promise((resolve, reject) => {
    fn.call(ctx, ...args, (error, result) => (error ? reject(error) : resolve(result)));
  });
}

function describe(error) {
  if (error instanceof RemoteError) return error.message;
  const msg = error?.message || String(error);
  if (error?.level === 'client-authentication') return 'The SFTP server refused the login (check the user name and password or key)';
  if (error?.code === 'ENOTFOUND') return 'The SFTP host name could not be resolved';
  if (error?.code === 'ECONNREFUSED') return 'The SFTP server refused the connection (check the host and port)';
  if (/Timed out while waiting for handshake/i.test(msg)) return 'The SFTP server did not answer in time';
  // SFTP status codes: 2 no such file, 3 permission denied
  if (error?.code === 2) return `No such file or folder on the SFTP server${error.path ? `: ${error.path}` : ''}`;
  if (error?.code === 3) return `Permission denied on the SFTP server${error.path ? `: ${error.path}` : ''}`;
  return msg;
}

class SftpDestination {
  /**
   * @param {object} settings  { host, port, username, password, privateKey, keyPassphrase, path, hostKey }
   *   with secrets decrypted. hostKey is the pinned fingerprint, or null to learn it.
   */
  constructor(settings) {
    this.settings = settings;
    this.client = null;
    this.sftp = null;
    this.hostKey = null; // the fingerprint the server presented
  }

  get dir() {
    return this.settings.path || '';
  }

  async connect() {
    const s = this.settings;
    const client = new Client();
    this.client = client;
    let refusedKey = null;
    await new Promise((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', (error) => reject(refusedKey
        ? new RemoteError(`The SFTP server's host key changed (now ${refusedKey}, pinned ${s.hostKey}). If the server was rebuilt, forget the pinned key in the settings and connect again.`, 'HOST_KEY_MISMATCH')
        : error));
      client.connect({
        host: s.host,
        port: s.port || 22,
        username: s.username,
        password: s.privateKey ? undefined : (s.password || undefined),
        privateKey: s.privateKey || undefined,
        passphrase: s.privateKey ? (s.keyPassphrase || undefined) : undefined,
        readyTimeout: READY_TIMEOUT_MS,
        keepaliveInterval: 15000,
        hostVerifier: (key) => {
          this.hostKey = fingerprint(key);
          if (s.hostKey && s.hostKey !== this.hostKey) {
            refusedKey = this.hostKey;
            return false;
          }
          return true;
        },
      });
    });
    // SFTP is request/reply: without this, Nagle's algorithm holds small
    // requests back (about 40-90 ms per round trip, even on loopback).
    client.setNoDelay(true);
    this.sftp = await promisify(client.sftp, client)();
    return this;
  }

  close() {
    try {
      this.client?.end();
    } catch {
      // already closed
    }
    this.client = null;
    this.sftp = null;
  }

  call(method, ...args) {
    return promisify(this.sftp[method], this.sftp)(...args);
  }

  async stat(remotePath) {
    try {
      return await this.call('stat', remotePath);
    } catch (error) {
      if (error?.code === 2) return null;
      throw error;
    }
  }

  /** The folder must exist and be a folder; NetHelper doesn't create it. */
  async checkFolder() {
    const target = this.dir || '.';
    const stat = await this.stat(target);
    if (!stat) throw new RemoteError(`The folder ${target} does not exist on the SFTP server`, 'NO_FOLDER');
    if (!stat.isDirectory()) throw new RemoteError(`${target} on the SFTP server is not a folder`, 'NOT_FOLDER');
  }

  /** Names in the folder that `isArchiveName` accepts. */
  async listArchives(isArchiveName) {
    const entries = await this.call('readdir', this.dir || '.');
    return entries.map((e) => ({ name: e.filename, size: e.attrs?.size ?? null }))
      .filter((e) => isArchiveName(e.name));
  }

  /** Write a local file under `name`, through a .partial, and check its size. */
  async upload(localFile, name) {
    const finalPath = remoteJoin(this.dir, name);
    const partial = `${finalPath}.partial`;
    const { size } = await fs.promises.stat(localFile);
    await this.call('unlink', partial).catch(() => {});
    // fastPut keeps many writes in flight; a write stream waits for each
    // 32 KB chunk's reply, which is slow on any link with latency.
    await this.call('fastPut', localFile, partial, { mode: 0o600, concurrency: 32 });
    const written = await this.stat(partial);
    if (!written || written.size !== size) {
      await this.call('unlink', partial).catch(() => {});
      throw new RemoteError(`The upload of ${name} came out at ${written?.size ?? 0} bytes, not ${size}`, 'SIZE_MISMATCH');
    }
    // SFTP v3 rename refuses an existing target; a same-named file is a
    // leftover of an earlier, interrupted try of this same archive.
    await this.call('unlink', finalPath).catch(() => {});
    await this.call('rename', partial, finalPath);
    return size;
  }

  async remove(name) {
    await this.call('unlink', remoteJoin(this.dir, name));
  }

  /** Connection test: the folder exists and takes a file. */
  async test() {
    await this.checkFolder();
    const probe = remoteJoin(this.dir, `.nethelper-write-test-${crypto.randomBytes(4).toString('hex')}`);
    await new Promise((resolve, reject) => {
      const stream = this.sftp.createWriteStream(probe, { mode: 0o600 });
      stream.on('error', reject);
      stream.on('close', resolve);
      stream.end('nethelper\n');
    });
    await this.call('unlink', probe).catch(() => {});
  }
}

/** Open, run `fn(destination)`, always close. */
async function withSftp(settings, fn) {
  const dest = new SftpDestination(settings);
  try {
    await dest.connect();
    return await fn(dest);
  } catch (error) {
    const wrapped = new RemoteError(describe(error), error?.code);
    wrapped.hostKey = dest.hostKey;
    throw wrapped;
  } finally {
    dest.close();
  }
}

module.exports = {
  SftpDestination, withSftp, fingerprint, checkPrivateKey, describe, RemoteError,
};
