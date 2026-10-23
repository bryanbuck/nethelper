/**
 * The System Status page (admins): how this backend process and what it
 * depends on are doing, sampled in memory.
 *
 * Fast samples (process, host, HTTP, sockets, queues) are taken every
 * SYSTEM_SAMPLE_INTERVAL_MS and the last hour is kept in a ring buffer, so
 * opening the page shows history at once. Slow samples (Postgres, Redis,
 * disk, usage counts, in-memory subsystems) are taken at most once a minute,
 * and only while someone watches. Every source is read on its own: one that
 * fails reports `{ error }` and the rest still answer. In-memory and
 * single-instance, like the live monitor.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');
const logger = require('../utils/logger');
const { withTimeout } = require('../utils/with-timeout');
const { version } = require('../../package.json');

const HISTORY_WINDOW_MS = 60 * 60 * 1000;
const SLOW_INTERVAL_MS = 60 * 1000;
const SOURCE_TIMEOUT_MS = 3000;
const ROOM = 'system:status';

function intervalMs() {
  const value = Number(process.env.SYSTEM_SAMPLE_INTERVAL_MS);
  return Number.isFinite(value) && value >= 1000 ? value : 5000;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parse Redis INFO text into { key: value } (numbers where they parse). */
function parseRedisInfo(text) {
  const info = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at);
    const raw = line.slice(at + 1);
    const n = Number(raw);
    info[key] = raw !== '' && Number.isFinite(n) ? n : raw;
  }
  return info;
}

/** Run one source; a failure becomes { error } instead of failing the sample. */
async function read(label, fn) {
  try {
    return await withTimeout(Promise.resolve().then(fn), SOURCE_TIMEOUT_MS, label);
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

function emit(event, payload) {
  try {
    const io = require('../websocket/socket.handler').getIO();
    if (!io.sockets.adapter.rooms.get(ROOM)?.size) return;
    io.to(ROOM).emit(event, payload);
  } catch {
    // Socket.io not initialised.
  }
}

function watcherCount() {
  try {
    const io = require('../websocket/socket.handler').getIO();
    return io.sockets.adapter.rooms.get(ROOM)?.size || 0;
  } catch {
    return 0;
  }
}

class SystemStatusService {
  constructor() {
    this.startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
    this.history = [];
    this.current = null;
    this.slow = null;
    this.slowAt = 0;
    this.slowPending = null;
    this.timer = null;
    this.sampling = false;
    this.loopDelay = null;
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = process.hrtime.bigint();
  }

  get maxHistory() {
    return Math.ceil(HISTORY_WINDOW_MS / intervalMs());
  }

  start() {
    if (this.timer) return;
    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.loopDelay.enable();
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = process.hrtime.bigint();
    this.timer = setInterval(() => this.tick().catch(() => {}), intervalMs());
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.loopDelay?.disable();
    this.loopDelay = null;
  }

  async tick() {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const sample = await this.sampleFast();
      this.record(sample);
      emit('system:status:sample', sample);
      if (watcherCount() && Date.now() - this.slowAt >= SLOW_INTERVAL_MS) {
        const slow = await this.refreshSlow();
        emit('system:status:slow', slow);
      }
    } catch (error) {
      logger.warn(`system-status: sample failed: ${error.message}`);
    } finally {
      this.sampling = false;
    }
  }

  record(sample) {
    this.current = sample;
    this.history.push(SystemStatusService.compact(sample));
    const extra = this.history.length - this.maxHistory;
    if (extra > 0) this.history.splice(0, extra);
  }

  /** The few numbers the page charts, per sample. */
  static compact(sample) {
    return {
      at: sample.at,
      cpu: sample.process.cpuPercent,
      rss: sample.process.rss,
      heapUsed: sample.process.heapUsed,
      loopP99: sample.eventLoop.p99Ms,
      requests: sample.http.requests,
      errors: sample.http.status5xx,
      sockets: sample.sockets.error ? null : sample.sockets.connections,
      backlog: sample.queueBacklog,
      intervalMs: sample.intervalMs,
    };
  }

  processStats() {
    const memory = process.memoryUsage();
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsedMicros = Number(now - this.lastCpuAt) / 1000;
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
    const cpuPercent = elapsedMicros > 0
      ? Math.round(((cpu.user + cpu.system) / elapsedMicros) * 1000) / 10
      : null;
    return {
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      cpuPercent,
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    };
  }

  eventLoopStats() {
    const h = this.loopDelay;
    if (!h) return { p50Ms: null, p99Ms: null, maxMs: null };
    const ms = (ns) => (Number.isFinite(ns) && ns > 0 ? Math.round(ns / 1e4) / 100 : null);
    const stats = { p50Ms: ms(h.percentile(50)), p99Ms: ms(h.percentile(99)), maxMs: ms(h.max) };
    h.reset();
    return stats;
  }

  hostStats() {
    const [load1, load5, load15] = os.loadavg();
    return {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      cpus: os.cpus().length,
      load1,
      load5,
      load15,
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      uptimeSec: Math.round(os.uptime()),
    };
  }

  socketStats() {
    const io = require('../websocket/socket.handler').getIO();
    const users = new Set();
    for (const socket of io.of('/').sockets.values()) if (socket.userId) users.add(socket.userId);
    return { connections: io.engine.clientsCount, users: users.size, watchers: watcherCount() };
  }

  async queueStats() {
    const { listQueues, takeThroughput } = require('../config/bull');
    const done = takeThroughput();
    return Promise.all(listQueues().map(async ({ name, queue }) => {
      const counts = await read(`queue ${name}`, async () => {
        const [jobCounts, paused] = await Promise.all([queue.getJobCounts(), queue.isPaused()]);
        return { ...jobCounts, paused };
      });
      return {
        name,
        ...counts,
        completedInInterval: done[name]?.completed ?? 0,
        failedInInterval: done[name]?.failed ?? 0,
      };
    }));
  }

  async sampleFast() {
    const { takeInterval } = require('../middleware/request-metrics');
    const span = intervalMs();
    const [queues, sockets] = await Promise.all([
      read('queues', () => this.queueStats()),
      read('sockets', () => this.socketStats()),
    ]);
    const queueList = Array.isArray(queues) ? queues : [];
    const queueBacklog = Array.isArray(queues)
      ? queueList.reduce((sum, q) => sum + (q.error ? 0 : (q.waiting || 0) + (q.active || 0) + (q.delayed || 0)), 0)
      : null;
    return {
      at: new Date().toISOString(),
      intervalMs: span,
      process: this.processStats(),
      eventLoop: this.eventLoopStats(),
      host: this.hostStats(),
      http: takeInterval(),
      sockets,
      queues: Array.isArray(queues) ? queueList : queues,
      queueBacklog,
    };
  }

  /** Take a slow sample; overlapping callers share one. */
  refreshSlow() {
    this.slowPending = this.slowPending || this.sampleSlow()
      .then((slow) => {
        this.slow = slow;
        this.slowAt = Date.now();
        return slow;
      })
      .finally(() => { this.slowPending = null; });
    return this.slowPending;
  }

  async sampleSlow() {
    const [database, redis, storage, usage, schedules, subsystems] = await Promise.all([
      read('database', () => this.databaseStats()),
      read('redis', () => this.redisStats()),
      read('storage', () => this.storageStats()),
      read('usage', () => this.usageStats()),
      read('schedules', () => this.scheduleStats()),
      read('subsystems', () => this.subsystemStats()),
    ]);
    return { at: new Date().toISOString(), database, redis, storage, usage, schedules, subsystems };
  }

  async databaseStats() {
    const prisma = require('../config/database').getPrisma();
    const [[meta], [connections], tables] = await Promise.all([
      prisma.$queryRaw`
        SELECT pg_database_size(current_database())::bigint AS size,
               current_setting('server_version') AS version,
               current_setting('max_connections')::int AS "maxConnections"`,
      prisma.$queryRaw`
        SELECT count(*)::int AS total,
               (count(*) FILTER (WHERE state = 'active'))::int AS active
        FROM pg_stat_activity WHERE datname = current_database()`,
      prisma.$queryRaw`
        SELECT c.relname AS name,
               pg_total_relation_size(c.oid)::bigint AS bytes,
               c.reltuples::bigint AS rows
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = current_schema()
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 10`,
    ]);
    return {
      size: toNumber(meta?.size),
      version: meta?.version || null,
      maxConnections: toNumber(meta?.maxConnections),
      connections: toNumber(connections?.total),
      activeConnections: toNumber(connections?.active),
      // reltuples is -1 for a table never analysed: unknown, not empty.
      tables: tables.map((t) => {
        const rows = toNumber(t.rows);
        return { name: t.name, bytes: toNumber(t.bytes), rows: rows !== null && rows >= 0 ? rows : null };
      }),
    };
  }

  async redisStats() {
    const info = parseRedisInfo(await require('../config/redis').getRedis().info());
    return {
      version: info.redis_version || null,
      uptimeSec: toNumber(info.uptime_in_seconds),
      usedMemory: toNumber(info.used_memory),
      peakMemory: toNumber(info.used_memory_peak),
      maxMemory: toNumber(info.maxmemory) || null,
      clients: toNumber(info.connected_clients),
      opsPerSec: toNumber(info.instantaneous_ops_per_sec),
      keyspaceHits: toNumber(info.keyspace_hits),
      keyspaceMisses: toNumber(info.keyspace_misses),
    };
  }

  async storageStats() {
    const prisma = require('../config/database').getPrisma();
    const configBackupService = require('./config-backup.service');
    const locations = [
      { label: 'Config backups', path: configBackupService.storageDir },
      { label: 'Logs', path: path.resolve(process.env.LOG_DIR || 'logs') },
    ];
    const volumes = await Promise.all(locations.map(async (location) => {
      try {
        const stats = await fs.promises.statfs(location.path);
        return {
          ...location,
          total: stats.blocks * stats.bsize,
          free: stats.bavail * stats.bsize,
        };
      } catch (error) {
        return { ...location, error: error.code === 'ENOENT' ? 'Not created yet' : error.message };
      }
    }));
    const [artifacts, scopes] = await Promise.all([
      prisma.configBackupArtifact.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } }),
      prisma.scopeBackup.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } }),
    ]);
    return {
      volumes,
      configBackupBytes: toNumber(artifacts._sum.sizeBytes) || 0,
      configBackupFiles: artifacts._count._all,
      scopeBackupBytes: toNumber(scopes._sum.sizeBytes) || 0,
      scopeBackups: scopes._count._all,
    };
  }

  async usageStats() {
    const prisma = require('../config/database').getPrisma();
    const deviceService = require('./device.service');
    const alertService = require('./alert.service');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const byKey = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r._count._all]));
    const [devices, byVendor, users, alerts, executions, backups, deviceEvents, automations] = await Promise.all([
      deviceService.getStatusSummary(),
      prisma.device.groupBy({ by: ['vendor'], _count: { _all: true } }),
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      alertService.summary(),
      prisma.execution.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.configBackup.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.deviceEvent.count({ where: { occurredAt: { gte: since } } }),
      prisma.automation.count(),
    ]);
    return {
      devices: { ...devices, byVendor: byKey(byVendor, 'vendor') },
      users: byKey(users, 'role'),
      alerts,
      automations,
      last24h: {
        executions: byKey(executions, 'status'),
        backups: byKey(backups, 'status'),
        deviceEvents,
      },
    };
  }

  /** Repeatable jobs per queue (the ping monitor, syncs, backup and automation schedules). */
  async scheduleStats() {
    const { listQueues } = require('../config/bull');
    return Promise.all(listQueues().map(async ({ name, queue }) => {
      const jobs = await read(`queue ${name}`, () => queue.getRepeatableJobs());
      if (!Array.isArray(jobs)) return { name, ...jobs };
      const next = jobs.map((j) => j.next).filter(Number.isFinite).sort((a, b) => a - b)[0];
      return { name, repeatable: jobs.length, nextRunAt: next ? new Date(next).toISOString() : null };
    }));
  }

  subsystemStats() {
    return {
      liveMonitor: require('./live/state-monitor.service').stats(),
      liveView: require('./live/live-view.service').stats(),
      cloudStreams: require('./cloud/cloud-stream.service').stats(),
      alertSettles: require('./alert.service').pendingCount(),
    };
  }

  /**
   * Everything the page needs on open: identity, the latest samples and the
   * last hour. Takes a fast sample when none exists yet, and a slow one when
   * the cached one is older than a minute.
   */
  async snapshot() {
    if (!this.current) this.record(await this.sampleFast());
    const slow = Date.now() - this.slowAt >= SLOW_INTERVAL_MS ? await this.refreshSlow() : this.slow;
    return {
      version,
      node: process.version,
      startedAt: this.startedAt,
      intervalMs: intervalMs(),
      historyWindowMs: HISTORY_WINDOW_MS,
      current: this.current,
      slow,
      history: this.history,
    };
  }
}

const service = new SystemStatusService();
module.exports = service;
module.exports.SystemStatusService = SystemStatusService;
module.exports.parseRedisInfo = parseRedisInfo;
module.exports.SYSTEM_STATUS_ROOM = ROOM;
