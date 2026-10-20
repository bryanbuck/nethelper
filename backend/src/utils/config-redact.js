/**
 * Secret redaction for cloud scope backups. Cloud planes return some secrets
 * in clear (New Central sends RADIUS shared secrets as `plaintext-value`, Mist
 * sends WLAN PSKs), and a backup is written to disk and possibly pushed to a
 * Git remote, whose history can't be cleaned. So each secret is replaced by a
 * fingerprint: an HMAC keyed with ENCRYPTION_KEY. A rotated secret still shows
 * up in a diff, but the fingerprint can't be brute-forced without the key.
 *
 * Keys are matched on the leaf name, normalized across kebab, snake and camel
 * case (`shared-secret`, `plaintext-value`, `psk`, `password`, ...). Keys that
 * only describe a secret (`secret-type`) don't match.
 *
 * Presigned URLs are a secret too, whatever their key: Mist hands out each
 * WLAN's `portal_template_url` as an S3 link signed with a temporary AWS
 * session token, newly signed on every read. Their query string is dropped,
 * which also keeps the backup from changing on every run.
 */
const crypto = require('crypto');

const SECRET_LEAF = /(password|passphrase|psk|secret|plaintextvalue|community|privatekey|apikey|token)$/;
const MASK = '[REDACTED]';
// AWS SigV4/SigV2, Azure SAS and GCS signed-URL query markers.
const SIGNED_QUERY = /[?&](X-Amz-Signature|X-Amz-Security-Token|Signature|sig|X-Goog-Signature)=/i;

/** A URL carrying a signature in its query, with the query replaced by a marker. */
function stripSignedUrl(value) {
  if (!/^https?:\/\//i.test(value) || !SIGNED_QUERY.test(value)) return value;
  return `${value.split('?')[0]}?[signed query removed]`;
}

function isConfigSecretKey(key) {
  return SECRET_LEAF.test(String(key).toLowerCase().replace(/[-_]/g, ''));
}

function fingerprint(value) {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return MASK;
  const digest = crypto.createHmac('sha256', key).update(String(value)).digest('hex').slice(0, 16);
  return `[REDACTED hmac:${digest}]`;
}

function redactSecretValue(value) {
  if (typeof value === 'string') return value === '' ? value : fingerprint(value);
  if (Array.isArray(value)) return value.map(redactSecretValue);
  if (value && typeof value === 'object') return redactConfigSecrets(value);
  return value; // a boolean or number is a flag, not the secret
}

/** A redacted deep copy of a config object. */
function redactConfigSecrets(node) {
  if (Array.isArray(node)) return node.map(redactConfigSecrets);
  if (typeof node === 'string') return stripSignedUrl(node);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = isConfigSecretKey(key) ? redactSecretValue(value) : redactConfigSecrets(value);
  }
  return out;
}

module.exports = { redactConfigSecrets, isConfigSecretKey };
