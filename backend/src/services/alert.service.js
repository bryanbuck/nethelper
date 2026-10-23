/**
 * Alerts: stateful conditions raised by the built-in rules
 * (constants/alert-rules.js).
 *
 * Callers report conditions, not alerts: raise() when a condition starts (or
 * is seen again), clear() when it ends. One unresolved alert exists per
 * subject (Alert.openKey is unique while unresolved); seeing the condition
 * again bumps its occurrences. clear() resolves it automatically, whether or
 * not someone acknowledged it.
 *
 * A rule with a settle time holds a raise in memory for that long, and a
 * clear() inside the window drops it, so short bounces never become alerts.
 * Like the live state monitor, this assumes a single backend instance.
 *
 * raise() and clear() never throw: alerting must not break the monitor, sync,
 * or backup that reports the condition. Callers don't need to await them.
 *
 * In-process events for automation triggers: 'opened' (a new alert, not a
 * bump) and 'resolved' (by any path except a device merge), each with the
 * alert row. Listeners run after the call returns; a listener that throws
 * is logged and never reaches the caller.
 */

const { EventEmitter } = require('events');
const { getPrisma } = require('../config/database');
const { ALERT_RULES, SEVERITIES } = require('../constants/alert-rules');
const logger = require('../utils/logger');

const UNRESOLVED = { not: 'resolved' };
const DEVICE_SELECT = { id: true, name: true, vendor: true, platform: true, type: true, ipAddress: true };
const INCLUDE = {
  device: { select: DEVICE_SELECT },
  acknowledgedBy: { select: { id: true, name: true } },
  acknowledgedByAutomation: { select: { id: true, name: true } },
};
const RESOLVE = () => ({ status: 'resolved', openKey: null, resolvedAt: new Date() });

function emit(event, payload) {
  try {
    const { getIO } = require('../websocket/socket.handler');
    getIO().emit(event, payload);
  } catch {
    // Socket.io not initialised (tests, CLI scripts).
  }
}

function dedupKey(ruleKey, { subjectKey, port }) {
  return [ruleKey, subjectKey, port].filter((part) => part != null && part !== '').join(':');
}

class AlertService extends EventEmitter {
  constructor() {
    super();
    this.pending = new Map(); // dedupKey -> { timer, ruleKey, payload }
    this.rulesCache = null;
    this.pruneTimer = null;
  }

  start() {
    this.pruneTimer = setInterval(() => this.pruneResolved().catch(() => {}), 24 * 3600 * 1000);
    this.pruneTimer.unref?.();
    this.pruneResolved().catch((error) => logger.warn(`Alert prune failed: ${error.message}`));
  }

  stop() {
    clearInterval(this.pruneTimer);
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  // --- rules -------------------------------------------------------------

  /** Every built-in rule with its admin overrides applied. */
  async getRules() {
    if (!this.rulesCache) {
      const rows = await getPrisma().alertRule.findMany();
      const overrides = new Map(rows.map((r) => [r.key, r]));
      this.rulesCache = Object.entries(ALERT_RULES).map(([key, def]) => {
        const row = overrides.get(key);
        return {
          key,
          label: def.label,
          description: def.description,
          enabled: row ? row.enabled : true,
          severity: row ? row.severity : def.severity,
          settleSeconds: row ? row.settleSeconds : def.settleSeconds,
          defaults: { severity: def.severity, settleSeconds: def.settleSeconds },
        };
      });
    }
    return this.rulesCache;
  }

  async getRule(key) {
    return (await this.getRules()).find((r) => r.key === key) || null;
  }

  async updateRule(key, patch) {
    const current = await this.getRule(key);
    if (!current) return null;
    const next = {
      enabled: patch.enabled ?? current.enabled,
      severity: patch.severity ?? current.severity,
      settleSeconds: patch.settleSeconds ?? current.settleSeconds,
    };
    await getPrisma().alertRule.upsert({ where: { key }, create: { key, ...next }, update: next });
    this.rulesCache = null;
    // A rule turned off stops opening alerts, including ones waiting to settle.
    // Its open alerts stay and still resolve when their condition clears.
    if (!next.enabled) {
      for (const [k, entry] of this.pending) {
        if (entry.ruleKey === key) this.cancelPending(k);
      }
    }
    return this.getRule(key);
  }

  // --- conditions ----------------------------------------------------------

  /**
   * A condition holds. Opens (after the rule's settle time) or bumps its alert.
   * @param {string} ruleKey - key in ALERT_RULES
   * @param {{ subjectKey: string, deviceId?: string, port?: string,
   *           title: string, message: string, data?: Object }} payload
   * @param {{ bump?: boolean }} [options] - bump: false makes a repeat
   *   report of a still-open condition a no-op (for callers that report a
   *   state on every check rather than on transitions)
   */
  async raise(ruleKey, payload, { bump = true } = {}) {
    try {
      const rule = await this.getRule(ruleKey);
      if (!rule) throw new Error(`Unknown alert rule ${ruleKey}`);
      if (!rule.enabled) return null;
      const key = dedupKey(ruleKey, payload);

      const existing = await getPrisma().alert.findUnique({ where: { openKey: key } });
      if (existing) return bump ? await this.bump(existing.id, payload) : existing;

      if (rule.settleSeconds > 0) {
        const entry = this.pending.get(key);
        if (entry) {
          entry.payload = payload; // keep the original deadline, latest details
        } else {
          const timer = setTimeout(() => {
            this.pending.delete(key);
            this.open(ruleKey, key, payload, { bump }).catch((error) => {
              logger.warn(`Alert ${key} could not open: ${error.message}`);
            });
          }, rule.settleSeconds * 1000);
          timer.unref?.();
          this.pending.set(key, { timer, ruleKey, deviceId: payload.deviceId || null, payload });
        }
        return null;
      }
      return await this.open(ruleKey, key, payload, { bump });
    } catch (error) {
      logger.warn(`Alert raise ${ruleKey} failed: ${error.message}`);
      return null;
    }
  }

  /** The condition ended: drop a pending raise, resolve the open alert. */
  async clear(ruleKey, subject) {
    try {
      const key = dedupKey(ruleKey, subject);
      this.cancelPending(key);
      const existing = await getPrisma().alert.findUnique({ where: { openKey: key } });
      if (!existing) return null;
      const alert = await getPrisma().alert.update({
        where: { id: existing.id },
        data: { ...RESOLVE(), resolvedBy: 'auto' },
        include: INCLUDE,
      });
      await this.emitUpdated([alert]);
      this.notify('resolved', [alert]);
      return alert;
    } catch (error) {
      logger.warn(`Alert clear ${ruleKey} failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve a device's unresolved alerts for the given rules (nothing will
   * be watching to clear them, e.g. live monitoring was turned off).
   */
  async clearDevice(deviceId, ruleKeys) {
    try {
      this.forgetDevice(deviceId, ruleKeys);
      const where = { deviceId, rule: { in: ruleKeys }, status: UNRESOLVED };
      const ids = (await getPrisma().alert.findMany({ where, select: { id: true } })).map((a) => a.id);
      if (!ids.length) return 0;
      await getPrisma().alert.updateMany({
        where: { id: { in: ids } },
        data: { ...RESOLVE(), resolvedBy: 'auto' },
      });
      const alerts = await this.findByIds(ids);
      await this.emitUpdated(alerts);
      this.notify('resolved', alerts);
      return ids.length;
    } catch (error) {
      logger.warn(`Alert clear for device ${deviceId} failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Resolve a rule's unresolved alerts for every subject not in
   * subjectKeys: subjects that will never report again to clear their own
   * (a deleted or deactivated cloud integration).
   */
  async clearExcept(ruleKey, subjectKeys) {
    try {
      const keep = new Set(subjectKeys.map((subjectKey) => dedupKey(ruleKey, { subjectKey })));
      for (const [key, entry] of this.pending) {
        if (entry.ruleKey === ruleKey && !keep.has(key)) this.cancelPending(key);
      }
      const open = await getPrisma().alert.findMany({
        where: { rule: ruleKey, status: UNRESOLVED },
        select: { id: true, openKey: true },
      });
      const ids = open.filter((a) => !keep.has(a.openKey)).map((a) => a.id);
      if (!ids.length) return 0;
      await getPrisma().alert.updateMany({
        where: { id: { in: ids } },
        data: { ...RESOLVE(), resolvedBy: 'auto' },
      });
      const alerts = await this.findByIds(ids);
      await this.emitUpdated(alerts);
      this.notify('resolved', alerts);
      return ids.length;
    } catch (error) {
      logger.warn(`Alert clear of stale ${ruleKey} failed: ${error.message}`);
      return 0;
    }
  }

  /** Drop pending (still settling) raises for a device, e.g. before a merge deletes it. */
  forgetDevice(deviceId, ruleKeys = null) {
    for (const [key, entry] of this.pending) {
      if (entry.deviceId === deviceId && (!ruleKeys || ruleKeys.includes(entry.ruleKey))) this.cancelPending(key);
    }
  }

  cancelPending(key) {
    const entry = this.pending.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(key);
    }
  }

  async open(ruleKey, key, payload, { bump = true } = {}) {
    const rule = await this.getRule(ruleKey);
    if (!rule?.enabled) return null; // turned off while settling
    const severity = ALERT_RULES[ruleKey].callerSeverity && SEVERITIES.includes(payload.severity)
      ? payload.severity
      : rule.severity;
    try {
      const alert = await getPrisma().alert.create({
        data: {
          rule: ruleKey,
          severity,
          dedupKey: key,
          openKey: key,
          deviceId: payload.deviceId || null,
          port: payload.port || null,
          title: payload.title,
          message: payload.message || '',
          data: payload.data || {},
        },
        include: INCLUDE,
      });
      emit('alert:new', { alert, summary: await this.summary() });
      this.notify('opened', [alert]);
      return alert;
    } catch (error) {
      if (error.code !== 'P2002') throw error;
      // Another caller opened it between our lookup and create.
      const existing = await getPrisma().alert.findUnique({ where: { openKey: key } });
      if (!existing) return null;
      return bump ? this.bump(existing.id, payload) : existing;
    }
  }

  async bump(id, payload) {
    const alert = await getPrisma().alert.update({
      where: { id },
      data: {
        occurrences: { increment: 1 },
        lastSeenAt: new Date(),
        title: payload.title,
        message: payload.message || '',
        ...(payload.data && { data: payload.data }),
      },
      include: INCLUDE,
    });
    await this.emitUpdated([alert]);
    return alert;
  }

  // --- reads and user actions -----------------------------------------------

  /**
   * @param {{ status?: 'active'|'open'|'acknowledged'|'resolved'|'all', severity?: string[],
   *           rule?: string, deviceId?: string, q?: string, page?: number, limit?: number }} filters
   */
  async list(filters = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || 25));
    const where = {};
    const status = filters.status || 'active';
    if (status === 'active') where.status = UNRESOLVED;
    else if (status !== 'all') where.status = status;
    if (filters.severity?.length) where.severity = { in: filters.severity };
    if (filters.rule) where.rule = filters.rule;
    if (filters.deviceId) where.deviceId = filters.deviceId;
    if (filters.q) {
      const contains = { contains: filters.q, mode: 'insensitive' };
      where.OR = [{ title: contains }, { message: contains }, { port: contains }, { device: { name: contains } }];
    }
    const prisma = getPrisma();
    const [items, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: INCLUDE,
        orderBy: { lastSeenAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.alert.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** Raises waiting out their rule's settle time (in memory). */
  pendingCount() {
    return this.pending.size;
  }

  /** Counts of unresolved alerts: by status, and by severity (all, and not yet acknowledged). */
  async summary() {
    const rows = await getPrisma().alert.groupBy({
      by: ['status', 'severity'],
      where: { status: UNRESOLVED },
      _count: { _all: true },
    });
    const summary = {
      open: 0,
      acknowledged: 0,
      bySeverity: { critical: 0, warning: 0, info: 0 },
      openBySeverity: { critical: 0, warning: 0, info: 0 },
    };
    for (const row of rows) {
      const n = row._count._all;
      summary[row.status] = (summary[row.status] || 0) + n;
      summary.bySeverity[row.severity] = (summary.bySeverity[row.severity] || 0) + n;
      if (row.status === 'open') summary.openBySeverity[row.severity] = (summary.openBySeverity[row.severity] || 0) + n;
    }
    return summary;
  }

  /**
   * @param {string[]} ids
   * @param {{ id: string }|null} user - the acknowledging user, or null for an automation
   * @param {{ automationId?: string }} [options] - the automation acknowledging them
   */
  async acknowledge(ids, user, { automationId = null } = {}) {
    await getPrisma().alert.updateMany({
      where: { id: { in: ids }, status: 'open' },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedById: user?.id || null,
        acknowledgedByAutomationId: automationId,
      },
    });
    const alerts = await this.findByIds(ids);
    await this.emitUpdated(alerts);
    return alerts;
  }

  /**
   * Resolve by hand. The condition may still hold; most rules raise on a
   * transition, so it reopens only after it clears and happens again.
   */
  async resolve(ids, user) {
    const prisma = getPrisma();
    const unresolved = await prisma.alert.findMany({
      where: { id: { in: ids }, status: UNRESOLVED },
      select: { id: true },
    });
    const resolving = new Set(unresolved.map((a) => a.id));
    await prisma.alert.updateMany({
      where: { id: { in: [...resolving] } },
      data: { ...RESOLVE(), resolvedBy: 'user' },
    });
    logger.info('Alerts resolved by user', { ids, userId: user.id });
    const alerts = await this.findByIds(ids);
    await this.emitUpdated(alerts);
    this.notify('resolved', alerts.filter((a) => resolving.has(a.id)));
    return alerts;
  }

  findByIds(ids) {
    return getPrisma().alert.findMany({ where: { id: { in: ids } }, include: INCLUDE });
  }

  /**
   * Inside a device merge transaction: resolve the merged-away devices'
   * alerts (their dedupKeys name the old ids) and move all their alerts to
   * the kept device.
   */
  async mergeDevices(tx, sourceIds, targetId) {
    for (const id of sourceIds) this.forgetDevice(id);
    await tx.alert.updateMany({
      where: { deviceId: { in: sourceIds }, status: UNRESOLVED },
      data: { ...RESOLVE(), resolvedBy: 'merge' },
    });
    await tx.alert.updateMany({ where: { deviceId: { in: sourceIds } }, data: { deviceId: targetId } });
  }

  /** Tell in-process listeners (automation triggers), off the caller's stack. */
  notify(event, alerts) {
    if (!alerts.length || !this.listenerCount(event)) return;
    setImmediate(() => {
      for (const alert of alerts) {
        try {
          this.emit(event, alert);
        } catch (error) {
          logger.warn(`Alert '${event}' listener failed: ${error.message}`);
        }
      }
    });
  }

  async emitUpdated(alerts) {
    emit('alert:updated', { alerts, summary: await this.summary() });
  }

  async pruneResolved() {
    const days = Number(process.env.ALERT_RETENTION_DAYS) > 0 ? Number(process.env.ALERT_RETENTION_DAYS) : 90;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const { count } = await getPrisma().alert.deleteMany({ where: { status: 'resolved', resolvedAt: { lt: cutoff } } });
    if (count) logger.info(`Pruned ${count} resolved alert(s) older than ${days} days`);
  }
}

const service = new AlertService();
module.exports = service;
module.exports.AlertService = AlertService;
module.exports.dedupKey = dedupKey;
