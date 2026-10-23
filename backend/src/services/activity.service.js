/**
 * The Activity feed: what happened to the managed devices lately, newest
 * first, across the whole fleet. Read-only; built from rows other services
 * already write:
 *
 * - DeviceEvent: status changes (ping./cloud.), restarts, and, only when
 *   asked for, port/PoE/live-monitor changes (raw and chatty).
 * - ConfigBackup: successful backups that found a change. A device's first
 *   capture also has hasChanges set and is left out (nothing changed).
 * - Alert: opened and resolved, for rules about one device. The ping and
 *   cloud offline rules are left out: their status events already say it.
 *
 * Noise control: a device's first ping/cloud state (data.previous unset) is
 * a starting point for its History lanes, not news, and is left out. Changes
 * of one kind on one device/port within FLAP_WINDOW_MS of each other are
 * folded into one item with a count.
 *
 * Paging: `before` (ISO) returns items strictly older; the response's
 * `nextBefore` continues it.
 */

const { Prisma } = require('@prisma/client');
const { getPrisma } = require('../config/database');
const {
  ACTIVITY_CATEGORIES: CATEGORIES, DEFAULT_ACTIVITY_CATEGORIES: DEFAULT_CATEGORIES,
} = require('../constants/activity');
const FEED_EXCLUDED_ALERT_RULES = ['device.offline', 'device.cloud-offline'];
const FLAP_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

class ActivityError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

const STATUS_WHERE = {
  AND: [
    { OR: [{ type: { startsWith: 'ping.' } }, { type: { startsWith: 'cloud.' } }] },
    { NOT: { data: { path: ['previous'], equals: Prisma.AnyNull } } },
  ],
};

const EVENT_WHERE = {
  status: STATUS_WHERE,
  restart: { type: 'device.restarted' },
  port: { OR: [{ type: { startsWith: 'port.' } }, { type: { startsWith: 'monitor.' } }] },
};

function categoryOf(type) {
  if (type === 'device.restarted') return 'restart';
  if (type.startsWith('ping.') || type.startsWith('cloud.')) return 'status';
  return 'port';
}

// Changes that fold into one item when they repeat: same device, port, and
// family (ping, cloud, monitor, port.link, port.poe, port.admin).
function flapKey(item) {
  if (item.kind !== 'event' || item.category === 'restart') return null;
  const parts = item.type.split('.');
  const family = parts[0] === 'port' ? `${parts[0]}.${parts[1]}` : parts[0];
  return `${item.deviceId}|${item.port || ''}|${family}`;
}

/**
 * Fold repeats (items sorted newest first). A folded item keeps its newest
 * member's fields and adds `count` and `since` (the oldest member's time).
 */
function collapse(items, windowMs = FLAP_WINDOW_MS) {
  const open = new Map();
  const out = [];
  for (const item of items) {
    const key = flapKey(item);
    const group = key && open.get(key);
    if (group && new Date(group.since) - new Date(item.at) <= windowMs) {
      group.count += 1;
      group.since = item.at;
      continue;
    }
    const entry = { ...item };
    if (key) {
      entry.count = 1;
      entry.since = item.at;
      open.set(key, entry);
    }
    out.push(entry);
  }
  for (const entry of out) {
    if (entry.count === 1) {
      delete entry.count;
      delete entry.since;
    }
  }
  return out;
}

function parseOptions({ categories, deviceId, vendor, before, limit } = {}) {
  const cats = categories?.length ? categories : DEFAULT_CATEGORIES;
  const unknown = cats.filter((c) => !CATEGORIES.includes(c));
  if (unknown.length) throw new ActivityError(`Unknown categories: ${unknown.join(', ')}`);
  let beforeDate = null;
  if (before) {
    beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) throw new ActivityError('before must be an ISO timestamp');
  }
  const n = Number(limit) || DEFAULT_LIMIT;
  return {
    categories: cats,
    deviceId: deviceId || null,
    vendor: vendor || null,
    before: beforeDate,
    limit: Math.min(Math.max(n, 1), MAX_LIMIT),
  };
}

async function eventItems(prisma, opts, deviceWhere, timeWhere) {
  const kinds = opts.categories.filter((c) => EVENT_WHERE[c]);
  if (!kinds.length) return { rows: [], full: false };
  const rows = await prisma.deviceEvent.findMany({
    where: {
      ...deviceWhere,
      ...(timeWhere && { occurredAt: timeWhere }),
      OR: kinds.map((c) => EVENT_WHERE[c]),
    },
    orderBy: { occurredAt: 'desc' },
    take: opts.limit,
    select: { id: true, deviceId: true, type: true, port: true, data: true, source: true, occurredAt: true },
  });
  return {
    full: rows.length === opts.limit,
    rows: rows.map((e) => ({
      id: `event:${e.id}`,
      kind: 'event',
      category: categoryOf(e.type),
      type: e.type,
      at: e.occurredAt,
      deviceId: e.deviceId,
      port: e.port,
      source: e.source,
      data: e.data || {},
    })),
  };
}

async function configItems(prisma, opts, deviceWhere, timeWhere) {
  if (!opts.categories.includes('config')) return { rows: [], full: false };
  const rows = await prisma.configBackup.findMany({
    where: {
      ...deviceWhere,
      status: 'success',
      hasChanges: true,
      ...(timeWhere && { createdAt: timeWhere }),
    },
    orderBy: { createdAt: 'desc' },
    take: opts.limit,
    select: { id: true, deviceId: true, deviceName: true, trigger: true, createdAt: true, warning: true },
  });
  if (!rows.length) return { rows: [], full: false };

  // Each device's first successful backup is a first capture, not a change.
  const firsts = await prisma.configBackup.groupBy({
    by: ['deviceId'],
    where: { deviceId: { in: [...new Set(rows.map((r) => r.deviceId))] }, status: 'success' },
    _min: { createdAt: true },
  });
  const firstAt = new Map(firsts.map((f) => [f.deviceId, new Date(f._min.createdAt).getTime()]));

  return {
    full: rows.length === opts.limit,
    rows: rows
      .filter((b) => firstAt.get(b.deviceId) !== new Date(b.createdAt).getTime())
      .map((b) => ({
        id: `backup:${b.id}`,
        kind: 'config',
        category: 'config',
        type: 'config.changed',
        at: b.createdAt,
        deviceId: b.deviceId,
        deviceName: b.deviceName,
        backupId: b.id,
        trigger: b.trigger,
        ...(b.warning && { warning: b.warning }),
      })),
  };
}

async function alertItems(prisma, opts, deviceWhere, timeWhere) {
  if (!opts.categories.includes('alert')) return { rows: [], full: false };
  const base = {
    ...(deviceWhere.deviceId ? deviceWhere : { deviceId: { not: null } }),
    rule: { notIn: FEED_EXCLUDED_ALERT_RULES },
  };
  const select = {
    id: true, rule: true, severity: true, status: true, deviceId: true, port: true,
    title: true, message: true, firstSeenAt: true, resolvedAt: true, resolvedBy: true,
  };
  const [opened, resolved] = await Promise.all([
    prisma.alert.findMany({
      where: { ...base, ...(timeWhere && { firstSeenAt: timeWhere }) },
      orderBy: { firstSeenAt: 'desc' },
      take: opts.limit,
      select,
    }),
    prisma.alert.findMany({
      // A merge resolves the duplicate's alerts as bookkeeping, not news.
      where: { ...base, resolvedAt: timeWhere || { not: null }, resolvedBy: { not: 'merge' } },
      orderBy: { resolvedAt: 'desc' },
      take: opts.limit,
      select,
    }),
  ]);
  const item = (a, phase) => ({
    id: `alert:${a.id}:${phase}`,
    kind: 'alert',
    category: 'alert',
    type: `alert.${phase}`,
    at: phase === 'opened' ? a.firstSeenAt : a.resolvedAt,
    deviceId: a.deviceId,
    port: a.port,
    alertId: a.id,
    rule: a.rule,
    severity: a.severity,
    title: a.title,
    message: a.message,
    status: a.status,
    ...(phase === 'resolved' && { resolvedBy: a.resolvedBy }),
  });
  return {
    full: opened.length === opts.limit || resolved.length === opts.limit,
    rows: [...opened.map((a) => item(a, 'opened')), ...resolved.map((a) => item(a, 'resolved'))],
  };
}

/**
 * One page of the feed.
 * @param {{categories?: string[], deviceId?: string, vendor?: string, before?: string, limit?: number}} options
 * @returns {Promise<{items: object[], nextBefore: string|null, categories: string[]}>}
 */
async function list(options) {
  const opts = parseOptions(options);
  const prisma = getPrisma();

  let deviceWhere = {};
  if (opts.deviceId) {
    deviceWhere = { deviceId: opts.deviceId };
  } else if (opts.vendor) {
    const ids = await prisma.device.findMany({ where: { vendor: opts.vendor }, select: { id: true } });
    if (!ids.length) return { items: [], nextBefore: null, categories: opts.categories };
    deviceWhere = { deviceId: { in: ids.map((d) => d.id) } };
  }
  const timeWhere = opts.before ? { lt: opts.before } : null;

  const sources = await Promise.all([
    eventItems(prisma, opts, deviceWhere, timeWhere),
    configItems(prisma, opts, deviceWhere, timeWhere),
    alertItems(prisma, opts, deviceWhere, timeWhere),
  ]);
  const merged = sources.flatMap((s) => s.rows).sort((a, b) => new Date(b.at) - new Date(a.at));

  // Keep items sharing the last kept item's time together, so `before`
  // (strictly older) doesn't skip the rest of them on the next page.
  let page = merged.slice(0, opts.limit);
  if (merged.length > opts.limit) {
    const lastAt = new Date(page[page.length - 1].at).getTime();
    let end = opts.limit;
    while (end < merged.length && new Date(merged[end].at).getTime() === lastAt) end += 1;
    page = merged.slice(0, end);
  }
  const hasMore = merged.length > page.length || sources.some((s) => s.full);
  const nextBefore = hasMore && page.length ? new Date(page[page.length - 1].at).toISOString() : null;

  const ids = [...new Set(page.map((i) => i.deviceId).filter(Boolean))];
  const devices = ids.length
    ? await prisma.device.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, type: true, vendor: true, platform: true },
    })
    : [];
  const byId = new Map(devices.map((d) => [d.id, d]));
  const items = collapse(page).map(({ deviceName, ...item }) => ({
    ...item,
    // A config backup outlives its device; keep the name it had.
    device: byId.get(item.deviceId) || (deviceName ? { id: item.deviceId, name: deviceName, deleted: true } : null),
  }));

  return { items, nextBefore, categories: opts.categories };
}

module.exports = {
  list, collapse, parseOptions, ActivityError,
  CATEGORIES, DEFAULT_CATEGORIES, FEED_EXCLUDED_ALERT_RULES, FLAP_WINDOW_MS,
};
