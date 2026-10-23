/**
 * Request counters for the System Status page: how many API requests finished
 * in the current sample interval, by status class, and how long they took.
 * Bounded memory (at most MAX_DURATIONS samples per interval) and no per-route
 * or per-user breakdown. Health probes and Socket.io polling are not counted.
 */

const MAX_DURATIONS = 5000;

function emptyInterval() {
  return { requests: 0, status4xx: 0, status5xx: 0, rateLimited: 0, durations: [] };
}

let current = emptyInterval();

function record(statusCode, durationMs) {
  current.requests += 1;
  if (statusCode === 429) current.rateLimited += 1;
  if (statusCode >= 500) current.status5xx += 1;
  else if (statusCode >= 400) current.status4xx += 1;
  if (current.durations.length < MAX_DURATIONS) current.durations.push(durationMs);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** This interval's totals and latency percentiles (ms), then start a new interval. */
function takeInterval() {
  const taken = current;
  current = emptyInterval();
  const sorted = taken.durations.sort((a, b) => a - b);
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    requests: taken.requests,
    status4xx: taken.status4xx,
    status5xx: taken.status5xx,
    rateLimited: taken.rateLimited,
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
  };
}

function requestMetrics(req, res, next) {
  const path = req.path || '';
  if (path.startsWith('/health') || path.startsWith('/socket.io')) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    record(res.statusCode, Number(process.hrtime.bigint() - start) / 1e6);
  });
  next();
}

module.exports = { requestMetrics, takeInterval, record, percentile, MAX_DURATIONS };
