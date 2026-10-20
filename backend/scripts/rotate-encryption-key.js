#!/usr/bin/env node
/**
 * Re-encrypt every stored secret from an old ENCRYPTION_KEY to the current one.
 *
 * Covers ApiCredential.password/apiKey/apiSecret, the secret fields inside
 * CloudIntegration.credentials (per constants/vendors.js), and the secret
 * fields inside GitBackupConfig.credentials (per git-backup.service.js).
 *
 * Usage (from backend/, with the NEW key already in .env as ENCRYPTION_KEY):
 *   OLD_ENCRYPTION_KEY='<old key>' node scripts/rotate-encryption-key.js [--dry-run]
 *   node scripts/rotate-encryption-key.js --from-legacy-default [--dry-run]
 *
 * --from-legacy-default migrates data written while ENCRYPTION_KEY was unset,
 * when utils/encryption.js silently used a hardcoded fallback key.
 *
 * All-or-nothing: every value is decrypted first. If any value can't be
 * decrypted with either key, nothing is written. Values that already decrypt
 * under the new key are counted as already rotated and left alone, so re-running
 * the script is safe.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const encryption = require('../src/utils/encryption');
const { CLOUD_PROVIDERS } = require('../src/constants/vendors');

// The fallback utils/encryption.js used before 2026-09 when ENCRYPTION_KEY was unset.
const LEGACY_DEFAULT_KEY = 'default-key-change-this-in-production-for-security';
const API_CREDENTIAL_FIELDS = ['password', 'apiKey', 'apiSecret'];
// Mirrors GIT_CREDENTIAL_FIELDS in git-backup.service.js. Kept literal so this
// script doesn't need the service (and its Prisma/Redis wiring) loaded.
const GIT_SECRET_FIELDS = ['token'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const oldKey = args.includes('--from-legacy-default') ? LEGACY_DEFAULT_KEY : process.env.OLD_ENCRYPTION_KEY;
const newKey = process.env.ENCRYPTION_KEY;

function withKey(key, fn) {
  const saved = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = key;
  try {
    return fn();
  } finally {
    process.env.ENCRYPTION_KEY = saved;
  }
}

function tryDecrypt(key, value) {
  try {
    return withKey(key, () => encryption.decrypt(value));
  } catch {
    return undefined;
  }
}

/**
 * Plan the rotation of one ciphertext. Returns { status, value } where status is
 * 'rotate' (value = new ciphertext), 'current' (already under new key), or 'fail'.
 */
function planValue(ciphertext) {
  const plain = tryDecrypt(oldKey, ciphertext);
  if (plain !== undefined) {
    return { status: 'rotate', value: withKey(newKey, () => encryption.encrypt(plain)) };
  }
  if (tryDecrypt(newKey, ciphertext) !== undefined) return { status: 'current' };
  return { status: 'fail' };
}

async function main() {
  if (!oldKey) {
    console.error('Set OLD_ENCRYPTION_KEY, or pass --from-legacy-default.');
    process.exit(2);
  }
  if (!newKey) {
    console.error('ENCRYPTION_KEY (the new key) is not set in the environment/.env.');
    process.exit(2);
  }
  if (oldKey === newKey) {
    console.error('The old and new keys are identical; nothing to do.');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const updates = []; // [{ label, run: (tx) => Promise }]
  const counts = { rotate: 0, current: 0, fail: 0 };
  const failures = [];

  const record = (label, result) => {
    counts[result.status] += 1;
    if (result.status === 'fail') failures.push(label);
  };

  try {
    // ApiCredential columns
    for (const cred of await prisma.apiCredential.findMany()) {
      const data = {};
      for (const field of API_CREDENTIAL_FIELDS) {
        if (!cred[field]) continue;
        const result = planValue(cred[field]);
        record(`ApiCredential ${cred.id} (${cred.name}).${field}`, result);
        if (result.status === 'rotate') data[field] = result.value;
      }
      if (Object.keys(data).length) {
        updates.push((tx) => tx.apiCredential.update({ where: { id: cred.id }, data }));
      }
    }

    // CloudIntegration.credentials JSON
    for (const integration of await prisma.cloudIntegration.findMany()) {
      const credentials = integration.credentials || {};
      if (credentials._plaintext) continue; // env-sourced, never encrypted
      const secretKeys = (CLOUD_PROVIDERS[integration.provider]?.credentialFields || [])
        .filter((f) => f.secret)
        .map((f) => f.key);
      const next = { ...credentials };
      let changed = false;
      for (const key of secretKeys) {
        if (!credentials[key]) continue;
        const result = planValue(credentials[key]);
        record(`CloudIntegration ${integration.id} (${integration.name}).${key}`, result);
        if (result.status === 'rotate') {
          next[key] = result.value;
          changed = true;
        }
      }
      if (changed) {
        updates.push((tx) => tx.cloudIntegration.update({ where: { id: integration.id }, data: { credentials: next } }));
      }
    }

    // GitBackupConfig.credentials JSON
    for (const config of await prisma.gitBackupConfig.findMany()) {
      const credentials = config.credentials || {};
      const next = { ...credentials };
      let changed = false;
      for (const key of GIT_SECRET_FIELDS) {
        if (!credentials[key]) continue;
        const result = planValue(credentials[key]);
        record(`GitBackupConfig ${config.id}.${key}`, result);
        if (result.status === 'rotate') {
          next[key] = result.value;
          changed = true;
        }
      }
      if (changed) {
        updates.push((tx) => tx.gitBackupConfig.update({ where: { id: config.id }, data: { credentials: next } }));
      }
    }

    console.log(`To rotate: ${counts.rotate}  already current: ${counts.current}  undecryptable: ${counts.fail}`);

    if (failures.length) {
      console.error('\nThese values decrypt with neither key. Nothing was written:');
      for (const label of failures) console.error(`  - ${label}`);
      process.exitCode = 1;
      return;
    }
    if (dryRun) {
      console.log('Dry run: no changes written.');
      return;
    }
    if (updates.length) {
      await prisma.$transaction((tx) => Promise.all(updates.map((run) => run(tx))));
    }
    console.log(`Done. Updated ${updates.length} row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Rotation failed:', error.message);
  process.exit(1);
});
