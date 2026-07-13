#!/usr/bin/env node
/**
 * READ-ONLY triage script for Aruba Central API endpoints.
 *
 * Purpose: determine which endpoints used (or considered) by
 * src/services/aruba-central.service.js actually work against this tenant.
 * See docs/CENTRAL_MANAGEMENT_MODE_PLAN.md section 2.3.
 *
 * SAFETY:
 *  - Issues GET requests ONLY. No PUT/POST/PATCH/DELETE is ever sent.
 *  - Never prints or persists access tokens, client secrets, or customer IDs.
 *
 * Usage: cd backend && node scripts/triage-central-endpoints.js
 */

const axios = require('axios');

const { connectDatabase, disconnectDatabase, getPrisma } = require('../src/config/database');
const { connectRedis, disconnectRedis, getRedis } = require('../src/config/redis');

const RESULTS = [];
const TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Redaction helpers — never let a token/secret/customerId reach stdout/report
// ---------------------------------------------------------------------------
function redact(str) {
  if (!str) return str;
  let out = String(str);
  // Long opaque-looking tokens (JWT-ish or long hex/base64 blobs)
  out = out.replace(/[A-Za-z0-9\-_]{40,}/g, '[REDACTED]');
  // customer_id query param values
  out = out.replace(/(customer_id["=:]\s*)([A-Za-z0-9]+)/gi, '$1[REDACTED]');
  // Bearer tokens
  out = out.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  return out;
}

function snippet(data) {
  let text;
  try {
    text = typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    text = String(data);
  }
  if (!text) return '';
  const redacted = redact(text);
  return redacted.length > 200 ? redacted.slice(0, 200) + '...' : redacted;
}

function hostnameOnly(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '[unparseable]';
  }
}

// ---------------------------------------------------------------------------
// Bootstrapping: DB + Redis connections, then the service singleton
// ---------------------------------------------------------------------------
async function bootstrap() {
  const state = { dbOk: false, redisOk: false };
  try {
    await connectDatabase();
    state.dbOk = true;
    console.log('[bootstrap] Postgres connected.');
  } catch (err) {
    console.log(`[bootstrap] Postgres connection FAILED: ${err.message}`);
  }

  try {
    await connectRedis();
    state.redisOk = true;
    console.log('[bootstrap] Redis connected.');
  } catch (err) {
    console.log(`[bootstrap] Redis connection FAILED: ${err.message}`);
  }

  return state;
}

// node-redis v4 client uses setEx (camelCase); aruba-central.service.js calls
// the older `.setex`. Patch a lowercase alias onto the client if missing so
// getAccessToken() doesn't throw when there's no cached token yet. This does
// not modify any file in src/ — it's a runtime shim local to this script.
function shimRedisIfNeeded() {
  try {
    const redis = getRedis();
    if (redis && typeof redis.setex !== 'function' && typeof redis.setEx === 'function') {
      redis.setex = (...args) => redis.setEx(...args);
      console.log('[bootstrap] Applied redis.setex -> setEx compatibility shim (script-local only).');
    }
  } catch {
    // Redis not initialized; nothing to shim.
  }
}

// ---------------------------------------------------------------------------
// Pick a test switch serial
// ---------------------------------------------------------------------------
async function pickSerial(dbOk) {
  if (dbOk) {
    try {
      const prisma = getPrisma();
      const centralSwitch = await prisma.device.findFirst({
        where: { type: 'switch', managementMode: 'central' },
        select: { serial: true, name: true },
      });
      if (centralSwitch) {
        return { serial: centralSwitch.serial, source: "DB: switch, managementMode='central'" };
      }

      const anySwitch = await prisma.device.findFirst({
        where: { type: 'switch' },
        select: { serial: true, name: true },
      });
      if (anySwitch) {
        return { serial: anySwitch.serial, source: 'DB: any switch (fallback)' };
      }

      const anyDevice = await prisma.device.findFirst({
        select: { serial: true, name: true },
      });
      if (anyDevice) {
        return { serial: anyDevice.serial, source: 'DB: any device (fallback)' };
      }
      console.log('[pickSerial] No devices found in DB.');
    } catch (err) {
      console.log(`[pickSerial] DB query failed: ${err.message}`);
    }
  }
  return { serial: null, source: 'none (DB unavailable or empty)' };
}

// ---------------------------------------------------------------------------
// Generic GET probe
// ---------------------------------------------------------------------------
async function probe({ label, path, params, baseURL, accessToken }) {
  const url = `${baseURL}${path}`;
  const start = Date.now();
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
      timeout: TIMEOUT_MS,
      validateStatus: () => true, // we classify status ourselves
    });
    const elapsed = Date.now() - start;
    const status = response.status;
    let verdict;
    if (status >= 200 && status < 300) verdict = 'works';
    else if (status === 404) verdict = '404 not on tenant';
    else if (status === 401 || status === 403) verdict = `${status} permission`;
    else if (status === 429) verdict = '429 rate-limited';
    else verdict = `error (HTTP ${status})`;

    const result = {
      label,
      path,
      status,
      verdict,
      elapsedMs: elapsed,
      snippet: snippet(response.data),
    };
    RESULTS.push(result);
    console.log(`[probe] ${label} -> HTTP ${status} (${verdict}) in ${elapsed}ms`);
    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    let verdict = 'error';
    let status = 'N/A';
    if (err.code === 'ECONNABORTED') {
      verdict = 'timeout';
    } else if (err.response) {
      status = err.response.status;
      verdict = status === 404 ? '404 not on tenant' : `error (HTTP ${status})`;
    } else {
      verdict = `error (${err.code || err.message})`;
    }
    const result = {
      label,
      path,
      status,
      verdict,
      elapsedMs: elapsed,
      snippet: snippet(err.response?.data || err.message),
    };
    RESULTS.push(result);
    console.log(`[probe] ${label} -> ${verdict} in ${elapsed}ms`);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Aruba Central endpoint triage (READ-ONLY) ===');
  console.log(`Start: ${new Date().toISOString()}\n`);

  const { dbOk, redisOk } = await bootstrap();
  shimRedisIfNeeded();

  // Load the service AFTER bootstrap so getPrisma()/getRedis() succeed inside it.
  const arubaCentralService = require('../src/services/aruba-central.service');

  let config;
  let accessToken;
  try {
    config = await arubaCentralService.getConfig();
    console.log(`[auth] Config source: ${config.source}`);
    console.log(`[auth] Tenant base URL host: ${hostnameOnly(config.baseURL)}`);
  } catch (err) {
    console.log(`[auth] FAILED to load config: ${err.message}`);
    await cleanup(dbOk, redisOk);
    process.exit(1);
  }

  try {
    accessToken = await arubaCentralService.getAccessToken();
    console.log('[auth] Access token acquired (redacted).');
  } catch (err) {
    console.log(`[auth] FAILED to get access token: ${err.message}`);
    await cleanup(dbOk, redisOk);
    process.exit(1);
  }

  const baseURL = config.baseURL;
  const customerId = config.customerId;
  const baseParams = { customer_id: customerId };

  // ---- pick serial ----
  let { serial, source: serialSource } = await pickSerial(dbOk);

  // ---- baseline device list (also used to backfill serial if DB had none) ----
  console.log('\n--- Baseline: device list ---');
  const baselineResult = await probe({
    label: 'network-monitoring/v1alpha1/devices (baseline)',
    path: '/network-monitoring/v1alpha1/devices',
    params: { ...baseParams, limit: 5 },
    baseURL,
    accessToken,
  });

  if (!serial) {
    // Try to pull a serial out of the baseline response body if we stored it
    try {
      const raw = await axios.get(`${baseURL}/network-monitoring/v1alpha1/devices`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ...baseParams, limit: 5 },
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
      });
      const items = raw.data?.items || [];
      const sw = items.find((d) => (d.deviceType || '').toLowerCase().includes('switch')) || items[0];
      if (sw && (sw.serialNumber || sw.serial)) {
        serial = sw.serialNumber || sw.serial;
        serialSource = 'live device list (DB had none)';
      }
    } catch (err) {
      console.log(`[pickSerial] Live fallback fetch failed: ${err.message}`);
    }
  }

  console.log(`\nTest serial: ${serial ? '[present, redacted from report]' : 'NONE AVAILABLE'} (source: ${serialSource})`);
  // Note: serial numbers are device identifiers, not secrets, but we still
  // avoid printing the literal value to keep the console/report generic.

  if (!serial) {
    console.log('No serial available anywhere (DB empty/unreachable and live device list empty). Serial-dependent probes will be skipped.');
  }

  // ---- serial-dependent probes ----
  console.log('\n--- Serial-dependent probes ---');
  if (serial) {
    await probe({
      label: 'network-monitoring/v1alpha1/switch/{serial}',
      path: `/network-monitoring/v1alpha1/switch/${serial}`,
      params: baseParams,
      baseURL,
      accessToken,
    });

    await probe({
      label: 'configuration/v2/devices/{serial}/configuration (getDeviceConfiguration)',
      path: `/configuration/v2/devices/${serial}/configuration`,
      params: baseParams,
      baseURL,
      accessToken,
    });

    await probe({
      label: 'configuration/v1/devices/{serial}/configuration',
      path: `/configuration/v1/devices/${serial}/configuration`,
      params: baseParams,
      baseURL,
      accessToken,
    });

    await probe({
      label: 'configuration/v1/devices/{serial}/group',
      path: `/configuration/v1/devices/${serial}/group`,
      params: baseParams,
      baseURL,
      accessToken,
    });
  } else {
    for (const label of [
      'network-monitoring/v1alpha1/switch/{serial}',
      'configuration/v2/devices/{serial}/configuration (getDeviceConfiguration)',
      'configuration/v1/devices/{serial}/configuration',
      'configuration/v1/devices/{serial}/group',
    ]) {
      RESULTS.push({ label, path: '(skipped - no serial)', status: 'N/A', verdict: 'skipped (no serial available)', elapsedMs: 0, snippet: '' });
      console.log(`[probe] ${label} -> skipped (no serial available)`);
    }
  }

  // ---- groups ----
  console.log('\n--- Groups ---');
  const groupsResult = await probe({
    label: 'configuration/v2/groups',
    path: '/configuration/v2/groups',
    params: { ...baseParams, limit: 20, offset: 0 },
    baseURL,
    accessToken,
  });

  let firstGroupName = null;
  if (groupsResult.status >= 200 && groupsResult.status < 300) {
    try {
      const raw = await axios.get(`${baseURL}/configuration/v2/groups`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { ...baseParams, limit: 20, offset: 0 },
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
      });
      const list = raw.data?.data || raw.data?.groups || raw.data?.items || [];
      const first = list[0];
      firstGroupName = typeof first === 'string' ? first : (first?.group || first?.name || null);
    } catch (err) {
      console.log(`[groups] Could not extract first group name: ${err.message}`);
    }
  }

  if (firstGroupName) {
    await probe({
      label: 'configuration/v1/groups/properties?groups={first group}',
      path: '/configuration/v1/groups/properties',
      params: { ...baseParams, groups: firstGroupName },
      baseURL,
      accessToken,
    });
  } else {
    RESULTS.push({
      label: 'configuration/v1/groups/properties?groups={first group}',
      path: '(skipped - groups call did not return a usable group name)',
      status: 'N/A',
      verdict: 'skipped (no group name available)',
      elapsedMs: 0,
      snippet: '',
    });
    console.log('[probe] configuration/v1/groups/properties -> skipped (no group name available)');
  }

  // ---- monitoring ----
  console.log('\n--- Monitoring ---');
  await probe({
    label: 'monitoring/v1/switches',
    path: '/monitoring/v1/switches',
    params: { ...baseParams, limit: 5 },
    baseURL,
    accessToken,
  });

  await probe({
    label: 'monitoring/v2/networks/health (getNetworkHealth)',
    path: '/monitoring/v2/networks/health',
    params: baseParams,
    baseURL,
    accessToken,
  });

  // ---- firmware ----
  console.log('\n--- Firmware ---');
  await probe({
    label: 'firmware/v1/versions/HP (getFirmwareVersions)',
    path: '/firmware/v1/versions/HP',
    params: baseParams,
    baseURL,
    accessToken,
  });

  // ---- summary ----
  console.log('\n=== SUMMARY ===');
  const colWidths = { label: 62, status: 8, verdict: 26 };
  const pad = (s, w) => String(s).padEnd(w).slice(0, w);
  console.log(pad('Endpoint', colWidths.label) + pad('Status', colWidths.status) + 'Verdict');
  console.log('-'.repeat(colWidths.label + colWidths.status + colWidths.verdict));
  for (const r of RESULTS) {
    console.log(pad(r.label, colWidths.label) + pad(r.status, colWidths.status) + r.verdict);
  }

  console.log(`\nTenant host: ${hostnameOnly(baseURL)}`);
  console.log(`Config source: ${config.source}`);
  console.log(`DB reachable: ${dbOk}, Redis reachable: ${redisOk}`);

  await cleanup(dbOk, redisOk);
}

async function cleanup(dbOk, redisOk) {
  try {
    if (dbOk) await disconnectDatabase();
  } catch {
    /* ignore */
  }
  try {
    if (redisOk) await disconnectRedis();
  } catch {
    /* ignore */
  }
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`[fatal] ${err.message}`);
    process.exit(1);
  });

module.exports = { RESULTS };
