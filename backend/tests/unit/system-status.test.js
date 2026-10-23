/**
 * services/system-status.service: fast samples and the ring buffer, slow
 * samples with one failing source, room-scoped emits, Redis INFO parsing.
 */
const mockRooms = new Map();
const mockEmit = jest.fn();
const mockIo = {
  sockets: { adapter: { rooms: mockRooms } },
  of: () => ({ sockets: new Map([['s1', { userId: 'u1' }], ['s2', { userId: 'u1' }], ['s3', { userId: 'u2' }]]) }),
  engine: { clientsCount: 3 },
  to: jest.fn(() => ({ emit: mockEmit })),
};
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => mockIo }));

const mockQueue = (counts, repeatable = []) => ({
  getJobCounts: jest.fn(async () => counts),
  isPaused: jest.fn(async () => false),
  getRepeatableJobs: jest.fn(async () => repeatable),
});
const mockQueues = [
  { name: 'automation', queue: mockQueue({ waiting: 2, active: 1, delayed: 0, failed: 4, completed: 9 }) },
  { name: 'ping-monitor', queue: mockQueue({ waiting: 0, active: 0, delayed: 1, failed: 0, completed: 3 }, [{ next: 2000000000000 }, { next: 1900000000000 }]) },
];
jest.mock('../../src/config/bull', () => ({
  listQueues: () => mockQueues,
  takeThroughput: () => ({ automation: { completed: 5, failed: 1 } }),
}));

const mockRedis = { info: jest.fn() };
jest.mock('../../src/config/redis', () => ({ getRedis: () => mockRedis }));

const mockPrisma = {
  $queryRaw: jest.fn(),
  configBackupArtifact: { aggregate: jest.fn(async () => ({ _sum: { sizeBytes: 2048 }, _count: { _all: 3 } })) },
  scopeBackup: { aggregate: jest.fn(async () => ({ _sum: { sizeBytes: null }, _count: { _all: 0 } })) },
  device: { groupBy: jest.fn(async () => [{ vendor: 'aruba', _count: { _all: 4 } }]) },
  user: { groupBy: jest.fn(async () => [{ role: 'admin', _count: { _all: 1 } }]) },
  execution: { groupBy: jest.fn(async () => [{ status: 'success', _count: { _all: 7 } }]) },
  configBackup: { groupBy: jest.fn(async () => []) },
  deviceEvent: { count: jest.fn(async () => 12) },
  automation: { count: jest.fn(async () => 2) },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/device.service', () => ({
  getStatusSummary: jest.fn(async () => ({ total: 4, online: 3, offline: 1, warning: 0 })),
}));
jest.mock('../../src/services/alert.service', () => ({
  summary: jest.fn(async () => ({ open: 1, acknowledged: 0 })),
  pendingCount: () => 2,
}));
jest.mock('../../src/services/config-backup.service', () => ({ storageDir: '/nonexistent/nethelper-test' }));
jest.mock('../../src/services/live/state-monitor.service', () => ({ stats: () => ({ monitors: 1, connected: 1, always: 1, limit: 200 }) }));
jest.mock('../../src/services/live/live-view.service', () => ({ stats: () => ({ devices: 0, viewers: 0 }) }));
jest.mock('../../src/services/cloud/cloud-stream.service', () => ({ stats: () => ({ enabled: true, streams: [] }) }));

const { SystemStatusService, parseRedisInfo, SYSTEM_STATUS_ROOM } = require('../../src/services/system-status.service');
const requestMetrics = require('../../src/middleware/request-metrics');

beforeEach(() => {
  jest.clearAllMocks();
  mockRooms.clear();
  mockPrisma.$queryRaw
    .mockResolvedValueOnce([{ size: 123456789n, version: '15.4', maxConnections: 100 }])
    .mockResolvedValueOnce([{ total: 5, active: 1 }])
    .mockResolvedValueOnce([{ name: 'Device', bytes: 8192n, rows: 4n }, { name: 'Fresh', bytes: 16n, rows: -1n }]);
  mockRedis.info.mockResolvedValue('# Server\r\nredis_version:7.2.4\r\nuptime_in_seconds:99\r\n# Memory\r\nused_memory:1048576\r\nused_memory_peak:2097152\r\nmaxmemory:0\r\nconnected_clients:6\r\ninstantaneous_ops_per_sec:12\r\n');
});

test('parseRedisInfo reads numbers and strings, skipping section headers', () => {
  expect(parseRedisInfo('# Server\nredis_version:7.2.4\nused_memory:10\nrole:master\n')).toEqual({
    redis_version: '7.2.4', used_memory: 10, role: 'master',
  });
});

test('a fast sample covers process, HTTP, sockets and queues', async () => {
  const service = new SystemStatusService();
  requestMetrics.takeInterval(); // drop anything earlier tests recorded
  requestMetrics.record(200, 10);
  requestMetrics.record(503, 30);
  const sample = await service.sampleFast();

  expect(sample.process.rss).toBeGreaterThan(0);
  expect(sample.http).toMatchObject({ requests: 2, status5xx: 1 });
  expect(sample.sockets).toMatchObject({ connections: 3, users: 2 });
  expect(sample.queues[0]).toMatchObject({ name: 'automation', waiting: 2, active: 1, completedInInterval: 5, failedInInterval: 1 });
  expect(sample.queues[1]).toMatchObject({ completedInInterval: 0 });
  expect(sample.queueBacklog).toBe(4); // waiting + active + delayed
});

test('a failing queue reports its error and the rest still answer', async () => {
  mockQueues[0].queue.getJobCounts.mockRejectedValueOnce(new Error('redis down'));
  const sample = await new SystemStatusService().sampleFast();
  expect(sample.queues[0]).toMatchObject({ name: 'automation', error: 'redis down' });
  expect(sample.queueBacklog).toBe(1);
});

test('history keeps one hour of samples', () => {
  const service = new SystemStatusService();
  const sample = { at: 'x', intervalMs: 5000, process: { cpuPercent: 1, rss: 1, heapUsed: 1 }, eventLoop: { p99Ms: 1 }, http: { requests: 0, status5xx: 0 }, sockets: { connections: 0 }, queueBacklog: 0 };
  for (let i = 0; i < service.maxHistory + 10; i += 1) service.record(sample);
  expect(service.history).toHaveLength(720);
  expect(service.history[0]).toEqual({ at: 'x', cpu: 1, rss: 1, heapUsed: 1, loopP99: 1, requests: 0, errors: 0, sockets: 0, backlog: 0, intervalMs: 5000 });
});

test('a slow sample reads every source; a Redis failure leaves the others intact', async () => {
  mockRedis.info.mockRejectedValueOnce(new Error('NOAUTH'));
  const slow = await new SystemStatusService().sampleSlow();

  expect(slow.redis).toEqual({ error: 'NOAUTH' });
  expect(slow.database).toMatchObject({ size: 123456789, version: '15.4', connections: 5, maxConnections: 100 });
  expect(slow.database.tables).toEqual([{ name: 'Device', bytes: 8192, rows: 4 }, { name: 'Fresh', bytes: 16, rows: null }]);
  expect(slow.storage).toMatchObject({ configBackupBytes: 2048, configBackupFiles: 3, scopeBackupBytes: 0 });
  expect(slow.storage.volumes[0]).toMatchObject({ label: 'Config backups', error: 'Not created yet' });
  expect(slow.usage).toMatchObject({ devices: { total: 4, byVendor: { aruba: 4 } }, users: { admin: 1 }, automations: 2 });
  expect(slow.usage.last24h).toEqual({ executions: { success: 7 }, backups: {}, deviceEvents: 12 });
  expect(slow.schedules[1]).toEqual({ name: 'ping-monitor', repeatable: 2, nextRunAt: new Date(1900000000000).toISOString() });
  expect(slow.subsystems.alertSettles).toBe(2);
});

test('redis INFO maps to the page fields', async () => {
  const redis = await new SystemStatusService().redisStats();
  expect(redis).toEqual({
    version: '7.2.4', uptimeSec: 99, usedMemory: 1048576, peakMemory: 2097152, maxMemory: null,
    clients: 6, opsPerSec: 12, keyspaceHits: null, keyspaceMisses: null,
  });
});

test('samples are emitted only while someone watches', async () => {
  const service = new SystemStatusService();
  await service.tick();
  expect(mockEmit).not.toHaveBeenCalled();

  mockRooms.set(SYSTEM_STATUS_ROOM, new Set(['s1']));
  await service.tick();
  expect(mockIo.to).toHaveBeenCalledWith(SYSTEM_STATUS_ROOM);
  expect(mockEmit).toHaveBeenCalledWith('system:status:sample', expect.objectContaining({ http: expect.any(Object) }));
  expect(mockEmit).toHaveBeenCalledWith('system:status:slow', expect.objectContaining({ database: expect.any(Object) }));
});

test('snapshot samples on first use and carries the history', async () => {
  const snapshot = await new SystemStatusService().snapshot();
  expect(snapshot.current).toBeTruthy();
  expect(snapshot.slow.database.size).toBe(123456789);
  expect(snapshot.history).toHaveLength(1);
  expect(snapshot).toMatchObject({ node: process.version, intervalMs: 5000 });
});
