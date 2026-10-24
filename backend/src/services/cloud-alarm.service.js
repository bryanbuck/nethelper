/**
 * Cloud alarm mirror: the alarms each cloud raises (Mist org alarms, Central
 * alerts), copied read-only into CloudAlarm rows for the Activity feed.
 * Polled every CLOUD_ALARM_INTERVAL (5 min, jobs/device-sync.job.js) per
 * active integration whose provider supports('alarms'). Never writes an ack
 * or a clear to the cloud, and never creates Alert rows: the alarm is owned
 * by the cloud.
 *
 * - Each poll asks the provider for alarms since the last poll (minus an
 *   overlap); after a restart, since the newest stored alarm, at most
 *   BACKFILL_DAYS back.
 * - New alarms are inserted; known ones are written only when they changed.
 * - Stateful alarms (Central, Mist marvis) clear when the cloud says so, or
 *   when they drop out of the provider's active list (clearedReason null:
 *   the cloud didn't say why). A failed read clears nothing.
 * - An alarm is linked to a device of its integration only when exactly one
 *   matches, by serial (also inside the summary), MAC, hostname, then device
 *   name as a whole word in the summary. Otherwise it stays site-level.
 *
 * Emits `cloud:alarms` ({ integrationId, raised, cleared }) when a poll
 * stores something new. Rows are pruned after CLOUD_ALARM_RETENTION_DAYS,
 * except stateful alarms still active.
 */

const { getPrisma } = require('../config/database');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { ENV_ARUBA_INTEGRATION_ID } = require('./cloud-providers/cloud-provider-factory');
const { normalizeMac } = require('../utils/device-key');
const logger = require('../utils/logger');

const DAY_MS = 24 * 3600 * 1000;
const BACKFILL_DAYS = 7;
const OVERLAP_MS = 15 * 60 * 1000;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const retentionDays = () => {
  const days = Number(process.env.CLOUD_ALARM_RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 30;
};

// integrationId -> start time of its last successful poll (this process)
const lastPoll = new Map();
let lastPrune = 0;

function emit(event, payload) {
  try {
    // Lazy: the socket server isn't up in tests or CLI scripts.
    const { getIO } = require('../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch (error) {
    logger.debug(`cloud-alarm: could not emit ${event}: ${error.message}`);
  }
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (text, word) => new RegExp(`(?<![\\w-])${escapeRegex(word)}(?![\\w-])`, 'i').test(text);

/**
 * The one device an alarm is about, or null. Each rule runs in turn; a rule
 * matching several devices ends the search (the alarm is about more than
 * one, or it's ambiguous), so a weaker rule never overrides it.
 */
function matchDevice(alarm, devices) {
  const summary = alarm.summary || '';
  const serials = new Set((alarm.serials || []).map((s) => s.toUpperCase()));
  const macs = new Set((alarm.macs || []).map(normalizeMac).filter(Boolean));
  const hostnames = new Set((alarm.hostnames || []).map((h) => h.toLowerCase()));
  // A name that is an IP address or very short would match peer addresses
  // and fragments in the summary text.
  const nameUsable = (name) => name && name.length >= 3 && !IPV4.test(name);

  const rules = [
    (d) => d.serial && (serials.has(d.serial.toUpperCase()) || (summary && wholeWord(summary, d.serial))),
    (d) => macs.size && macs.has(normalizeMac(d.macAddress)),
    (d) => hostnames.size && d.name && hostnames.has(d.name.toLowerCase()),
    (d) => summary && nameUsable(d.name) && wholeWord(summary, d.name),
  ];
  for (const rule of rules) {
    const hits = devices.filter(rule);
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) return null;
  }
  return null;
}

const time = (value) => (value ? new Date(value).getTime() : null);

/** The columns to write for an alarm we already hold, or null if unchanged. */
function changes(row, alarm, deviceId) {
  const patch = {};
  if (row.status !== alarm.status) patch.status = alarm.status;
  if (time(row.lastSeenAt) !== time(alarm.lastSeenAt)) patch.lastSeenAt = alarm.lastSeenAt;
  if (time(row.clearedAt) !== time(alarm.clearedAt)) patch.clearedAt = alarm.clearedAt;
  if ((row.clearedReason || null) !== (alarm.clearedReason || null)) patch.clearedReason = alarm.clearedReason || null;
  if (row.count !== alarm.count) patch.count = alarm.count;
  if (row.severity !== alarm.severity) patch.severity = alarm.severity;
  if (!row.deviceId && deviceId) patch.deviceId = deviceId;
  return Object.keys(patch).length ? patch : null;
}

async function sinceFor(prisma, integrationId, now) {
  const floor = now - BACKFILL_DAYS * DAY_MS;
  if (lastPoll.has(integrationId)) return new Date(Math.max(lastPoll.get(integrationId) - OVERLAP_MS, floor));
  const newest = await prisma.cloudAlarm.findFirst({
    where: { integrationId },
    orderBy: { raisedAt: 'desc' },
    select: { raisedAt: true },
  });
  return new Date(Math.max(newest ? time(newest.raisedAt) - OVERLAP_MS : floor, floor));
}

/** Poll one provider. Throws on a failed read (nothing is changed then). */
async function pollProvider(provider, now = Date.now()) {
  const prisma = getPrisma();
  const integrationId = provider.id;
  const since = await sinceFor(prisma, integrationId, now);
  const { alarms, activeIds } = await provider.listAlarms({ since });

  // The env-var fallback integration has no row; its devices have no owner id.
  const ownerId = integrationId === ENV_ARUBA_INTEGRATION_ID ? null : integrationId;
  const devices = await prisma.device.findMany({
    where: { cloudIntegrationId: ownerId },
    select: { id: true, name: true, serial: true, macAddress: true },
  });
  const existing = alarms.length
    ? await prisma.cloudAlarm.findMany({
      where: { integrationId, externalId: { in: alarms.map((a) => a.externalId) } },
    })
    : [];
  const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

  let raised = 0;
  let cleared = 0;
  let updated = 0;
  for (const alarm of alarms) {
    const deviceId = matchDevice(alarm, devices);
    const row = byExternalId.get(alarm.externalId);
    if (!row) {
      await prisma.cloudAlarm.create({
        data: {
          integrationId,
          provider: provider.providerType,
          externalId: alarm.externalId,
          type: alarm.type,
          name: alarm.name,
          category: alarm.category,
          severity: alarm.severity,
          stateful: alarm.stateful,
          status: alarm.status,
          deviceId,
          siteName: alarm.siteName,
          summary: alarm.summary,
          count: alarm.count,
          raisedAt: alarm.raisedAt,
          lastSeenAt: alarm.lastSeenAt,
          clearedAt: alarm.clearedAt,
          clearedReason: alarm.clearedReason,
          data: alarm.data || {},
        },
      });
      raised += 1;
      if (alarm.status === 'cleared') cleared += 1;
      continue;
    }
    const patch = changes(row, alarm, deviceId);
    if (!patch) continue;
    await prisma.cloudAlarm.update({ where: { id: row.id }, data: patch });
    updated += 1;
    if (patch.status === 'cleared') cleared += 1;
  }

  // Stateful alarms the cloud no longer holds active have cleared.
  if (activeIds) {
    const stillOpen = new Set([...activeIds, ...alarms.filter((a) => a.status !== 'active').map((a) => a.externalId)]);
    const gone = await prisma.cloudAlarm.findMany({
      where: { integrationId, stateful: true, status: 'active' },
      select: { id: true, externalId: true },
    });
    const ids = gone.filter((row) => !stillOpen.has(row.externalId)).map((row) => row.id);
    if (ids.length) {
      await prisma.cloudAlarm.updateMany({
        where: { id: { in: ids } },
        data: { status: 'cleared', clearedAt: new Date(now), clearedReason: null },
      });
      cleared += ids.length;
    }
  }

  lastPoll.set(integrationId, now);
  if (raised || cleared) emit('cloud:alarms', { integrationId, raised, cleared });
  return { integrationId, name: provider.label, received: alarms.length, raised, cleared, updated };
}

async function prune(now = Date.now()) {
  const days = retentionDays();
  const { count } = await getPrisma().cloudAlarm.deleteMany({
    where: { raisedAt: { lt: new Date(now - days * DAY_MS) }, status: { not: 'active' } },
  });
  if (count) logger.info(`Pruned ${count} cloud alarm(s) older than ${days} days`);
  return count;
}

/** Poll every active integration that has alarms; one failing doesn't stop the rest. */
async function pollAll() {
  const providers = (await CloudProviderFactory.activeProviders()).filter((p) => p.supports('alarms'));
  const results = [];
  for (const provider of providers) {
    try {
      results.push(await pollProvider(provider));
    } catch (error) {
      logger.warn(`Cloud alarm poll failed for ${provider.label}: ${error.message}`);
      results.push({ integrationId: provider.id, name: provider.label, error: error.message });
    }
  }
  if (Date.now() - lastPrune > DAY_MS) {
    lastPrune = Date.now();
    await prune().catch((error) => logger.warn(`Cloud alarm prune failed: ${error.message}`));
  }
  return results;
}

module.exports = {
  pollAll, pollProvider, prune, matchDevice,
  _reset: () => { lastPoll.clear(); lastPrune = 0; },
};
