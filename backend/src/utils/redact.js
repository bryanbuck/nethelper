/**
 * Log redaction. Masks string values under secret-looking keys anywhere in a
 * log entry's metadata. It works on a copy, so the objects the application
 * passed in are never mutated. Used as a winston format by utils/logger.js and
 * utils/debug-logger.js.
 */
const winston = require('winston');

const SECRET_KEY_PATTERN = /pass(word|phrase)?|secret|token|api_?key|authorization|private_?key|client_?secret|credential/i;
// Keys that match the pattern but only describe a secret, never contain one.
const SAFE_KEY_PATTERN = /^(has|is)[A-Z]|Length$|Type$|Count$|Id$|^tokenPrefix$/;
const MASK = '[REDACTED]';
const MAX_DEPTH = 8;

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key) && !SAFE_KEY_PATTERN.test(key);
}

function redactValue(value, depth, seen) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH || seen.has(value)) return '[Truncated]';
  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = value.map((v) => redactValue(v, depth + 1, seen));
  } else if (value instanceof Error) {
    out = { name: value.name, message: value.message, stack: value.stack };
  } else {
    out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSecretKey(k) && v != null && typeof v !== 'boolean' && typeof v !== 'number'
        ? MASK
        : redactValue(v, depth + 1, seen);
    }
  }
  seen.delete(value);
  return out;
}

/** Return a redacted deep copy of `obj`. */
function redact(obj) {
  return redactValue(obj, 0, new WeakSet());
}

// Winston format: redact every enumerable metadata key except the core fields.
// Symbol-keyed internals (level/splat) are untouched because Object.keys skips them.
const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message' || key === 'timestamp' || key === 'stack') continue;
    const v = info[key];
    info[key] = isSecretKey(key) && v != null && typeof v !== 'boolean' && typeof v !== 'number'
      ? MASK
      : redactValue(v, 1, new WeakSet());
  }
  return info;
});

module.exports = { redact, redactFormat, isSecretKey, MASK };
