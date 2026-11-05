/**
 * Passphrase encryption for application backup archives (app-backup.service.js,
 * scripts/app-restore.js). Node crypto only, no dependency.
 *
 * File format (version 1):
 *   magic   "NHB1"              4 bytes
 *   logN    scrypt cost, N=2^logN  1 byte
 *   r, p    scrypt params        1 byte each
 *   salt                         16 bytes
 *   iv      AES-GCM nonce        12 bytes
 *   ...     AES-256-GCM ciphertext
 *   tag     GCM auth tag         16 bytes (last 16 bytes of the file)
 *
 * The 35-byte header is the GCM additional data, so its parameters are
 * authenticated too. GCM emits plaintext before it can check the tag: a reader
 * must not trust (or extract) the output until the stream ended without error.
 */
const crypto = require('crypto');
const { Transform } = require('stream');

const MAGIC = Buffer.from('NHB1');
const HEADER_LENGTH = 4 + 3 + 16 + 12;
const TAG_LENGTH = 16;
const DEFAULT_PARAMS = { logN: 15, r: 8, p: 1 };

function deriveKey(passphrase, salt, { logN, r, p }) {
  if (!passphrase) throw new Error('A backup passphrase is required');
  if (logN < 10 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 16) {
    throw new Error('Unsupported backup encryption parameters');
  }
  const N = 2 ** logN;
  return crypto.scryptSync(String(passphrase), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
}

function isEncryptedHeader(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.subarray(0, 4).equals(MAGIC);
}

/** A Transform that encrypts what passes through it. */
function encryptStream(passphrase, params = DEFAULT_PARAMS) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, Buffer.from([params.logN, params.r, params.p]), salt, iv]);
  const key = deriveKey(passphrase, salt, params);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  let headerSent = false;

  return new Transform({
    transform(chunk, _enc, done) {
      if (!headerSent) {
        this.push(header);
        headerSent = true;
      }
      done(null, cipher.update(chunk));
    },
    flush(done) {
      if (!headerSent) this.push(header);
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
}

/**
 * A Transform that decrypts. It errors (on the last chunk) when the passphrase
 * is wrong or the file was changed, so callers must wait for 'finish' before
 * using the output.
 */
function decryptStream(passphrase) {
  let header = Buffer.alloc(0);
  let decipher = null;
  let tail = Buffer.alloc(0); // held back: the last 16 bytes are the tag

  const take = (buffer) => {
    const all = Buffer.concat([tail, buffer]);
    if (all.length <= TAG_LENGTH) {
      tail = all;
      return Buffer.alloc(0);
    }
    tail = all.subarray(all.length - TAG_LENGTH);
    return decipher.update(all.subarray(0, all.length - TAG_LENGTH));
  };

  return new Transform({
    transform(chunk, _enc, done) {
      try {
        if (!decipher) {
          header = Buffer.concat([header, chunk]);
          if (header.length < HEADER_LENGTH) return done();
          if (!isEncryptedHeader(header)) throw new Error('Not an encrypted NetHelper backup');
          const params = { logN: header[4], r: header[5], p: header[6] };
          const salt = header.subarray(7, 23);
          const iv = header.subarray(23, HEADER_LENGTH);
          decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt, params), iv);
          decipher.setAAD(header.subarray(0, HEADER_LENGTH));
          const rest = header.subarray(HEADER_LENGTH);
          header = null;
          return done(null, take(rest));
        }
        return done(null, take(chunk));
      } catch (error) {
        return done(error);
      }
    },
    flush(done) {
      try {
        if (!decipher || tail.length < TAG_LENGTH) throw new Error('Encrypted backup is truncated');
        decipher.setAuthTag(tail);
        done(null, decipher.final());
      } catch (error) {
        done(/auth/i.test(error.message)
          ? new Error('Wrong passphrase, or the backup file was changed or damaged')
          : error);
      }
    },
  });
}

module.exports = { encryptStream, decryptStream, isEncryptedHeader, HEADER_LENGTH, TAG_LENGTH };
