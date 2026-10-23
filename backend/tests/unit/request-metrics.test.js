/** middleware/request-metrics: interval counters and latency percentiles. */
const { requestMetrics, takeInterval, record, percentile, MAX_DURATIONS } = require('../../src/middleware/request-metrics');
const { EventEmitter } = require('events');

beforeEach(() => takeInterval());

function run(path, statusCode) {
  const res = Object.assign(new EventEmitter(), { statusCode });
  const next = jest.fn();
  requestMetrics({ path }, res, next);
  res.emit('finish');
  return next;
}

test('counts requests by status class, including rate-limited ones', () => {
  run('/api/v1/devices', 200);
  run('/api/v1/devices', 404);
  run('/api/v1/devices', 429);
  run('/api/v1/devices', 500);
  expect(takeInterval()).toMatchObject({ requests: 4, status4xx: 2, status5xx: 1, rateLimited: 1 });
  expect(takeInterval()).toMatchObject({ requests: 0, p50Ms: null, p95Ms: null });
});

test('skips health probes and Socket.io', () => {
  expect(run('/health/ready', 200)).toHaveBeenCalled();
  run('/socket.io/', 200);
  expect(takeInterval().requests).toBe(0);
});

test('percentiles come from the recorded durations, capped in memory', () => {
  for (let i = 1; i <= 100; i += 1) record(200, i);
  expect(takeInterval()).toMatchObject({ p50Ms: 50, p95Ms: 95 });

  for (let i = 0; i < MAX_DURATIONS + 10; i += 1) record(200, 1);
  expect(takeInterval().requests).toBe(MAX_DURATIONS + 10);
  expect(percentile([], 50)).toBeNull();
});
