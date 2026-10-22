/**
 * services/alert.service: open/bump/clear, settle windows, rule overrides,
 * and the openKey race. Prisma is an in-memory stand-in that enforces
 * Alert.openKey's unique index the way Postgres does (NULLs never collide).
 */
const mockAlerts = [];
const mockRules = new Map();
const mockEmit = jest.fn();

function where(row, w = {}) {
  return Object.entries(w).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
    if (v && typeof v === 'object' && 'lt' in v) return row[k] < v.lt;
    return row[k] === v;
  });
}

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

const mockPrisma = {
  alert: {
    findUnique: jest.fn(async ({ where: w }) => mockAlerts.find((a) => a.openKey && a.openKey === w.openKey) || null),
    findMany: jest.fn(async ({ where: w } = {}) => mockAlerts.filter((a) => where(a, w))),
    count: jest.fn(async ({ where: w } = {}) => mockAlerts.filter((a) => where(a, w)).length),
    create: jest.fn(async ({ data }) => {
      if (mockAlerts.some((a) => a.openKey && a.openKey === data.openKey)) throw uniqueViolation();
      const row = {
        id: `a${mockAlerts.length + 1}`, status: 'open', occurrences: 1,
        firstSeenAt: new Date(), lastSeenAt: new Date(), ...data,
      };
      mockAlerts.push(row);
      return row;
    }),
    update: jest.fn(async ({ where: w, data }) => {
      const row = mockAlerts.find((a) => a.id === w.id);
      for (const [k, v] of Object.entries(data)) {
        row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
      }
      return row;
    }),
    updateMany: jest.fn(async ({ where: w, data }) => {
      const hit = mockAlerts.filter((a) => where(a, w));
      hit.forEach((a) => Object.assign(a, data));
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where: w }) => {
      const keep = mockAlerts.filter((a) => !where(a, w));
      const count = mockAlerts.length - keep.length;
      mockAlerts.splice(0, mockAlerts.length, ...keep);
      return { count };
    }),
    groupBy: jest.fn(async ({ where: w }) => {
      const groups = new Map();
      for (const a of mockAlerts.filter((row) => where(row, w))) {
        const key = `${a.status}|${a.severity}`;
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      return [...groups].map(([key, n]) => {
        const [status, severity] = key.split('|');
        return { status, severity, _count: { _all: n } };
      });
    }),
  },
  alertRule: {
    findMany: jest.fn(async () => [...mockRules.values()]),
    upsert: jest.fn(async ({ where: w, create, update }) => {
      const row = mockRules.has(w.key) ? { ...mockRules.get(w.key), ...update } : create;
      mockRules.set(w.key, row);
      return row;
    }),
  },
};

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => ({ emit: mockEmit }) }));

const { AlertService, dedupKey } = require('../../src/services/alert.service');

const offline = (over = {}) => ({
  subjectKey: 'd1', deviceId: 'd1', title: 'sw1 is offline', message: 'No ping reply', ...over,
});

let alerts;
beforeEach(() => {
  mockAlerts.length = 0;
  mockRules.clear();
  mockEmit.mockClear();
  alerts = new AlertService();
});
afterEach(() => {
  alerts.stop();
  jest.useRealTimers();
});

test('dedupKey joins rule, subject and port', () => {
  expect(dedupKey('live.poe-fault', { subjectKey: 'd1', port: '1/1/4' })).toBe('live.poe-fault:d1:1/1/4');
  expect(dedupKey('device.offline', { subjectKey: 'd1' })).toBe('device.offline:d1');
});

test('raise opens one alert per subject and bumps it on repeats', async () => {
  const first = await alerts.raise('device.offline', offline());
  expect(first).toMatchObject({ rule: 'device.offline', severity: 'critical', openKey: 'device.offline:d1', status: 'open' });
  expect(mockEmit).toHaveBeenCalledWith('alert:new', expect.objectContaining({
    summary: expect.objectContaining({ open: 1, openBySeverity: expect.objectContaining({ critical: 1 }) }),
  }));

  const again = await alerts.raise('device.offline', offline({ message: 'Still nothing' }));
  expect(mockAlerts).toHaveLength(1);
  expect(again).toMatchObject({ id: first.id, occurrences: 2, message: 'Still nothing' });
  expect(mockEmit).toHaveBeenLastCalledWith('alert:updated', expect.objectContaining({ alerts: [expect.objectContaining({ id: first.id })] }));
});

test('bump: false leaves an open alert alone', async () => {
  await alerts.raise('device.offline', offline());
  await alerts.raise('device.offline', offline(), { bump: false });
  expect(mockAlerts[0].occurrences).toBe(1);
});

test('clear resolves the open alert, and the next raise opens a new one', async () => {
  const first = await alerts.raise('device.offline', offline());
  const resolved = await alerts.clear('device.offline', { subjectKey: 'd1' });
  expect(resolved).toMatchObject({ id: first.id, status: 'resolved', openKey: null, resolvedBy: 'auto' });

  const second = await alerts.raise('device.offline', offline());
  expect(second.id).not.toBe(first.id);
  expect(mockAlerts).toHaveLength(2);
});

test('clear also resolves an acknowledged alert', async () => {
  const first = await alerts.raise('device.offline', offline());
  await alerts.acknowledge([first.id], { id: 'u1' });
  expect(mockAlerts[0]).toMatchObject({ status: 'acknowledged', acknowledgedById: 'u1' });
  await alerts.clear('device.offline', { subjectKey: 'd1' });
  expect(mockAlerts[0].status).toBe('resolved');
});

test('a condition that clears inside the settle window never becomes an alert', async () => {
  jest.useFakeTimers();
  const fault = { subjectKey: 'd1', deviceId: 'd1', port: '1/1/4', title: 'PoE fault', message: 'fault' };
  await alerts.raise('live.poe-fault', fault); // 30 s settle by default
  expect(mockAlerts).toHaveLength(0);
  await alerts.clear('live.poe-fault', fault);
  await jest.advanceTimersByTimeAsync(60000);
  expect(mockAlerts).toHaveLength(0);
});

test('a condition that holds past the settle window opens', async () => {
  jest.useFakeTimers();
  const fault = { subjectKey: 'd1', deviceId: 'd1', port: '1/1/4', title: 'PoE fault', message: 'fault' };
  await alerts.raise('live.poe-fault', fault);
  await alerts.raise('live.poe-fault', fault); // repeat while settling: one timer
  await jest.advanceTimersByTimeAsync(31000);
  expect(mockAlerts).toHaveLength(1);
  expect(mockAlerts[0]).toMatchObject({ port: '1/1/4', occurrences: 1 });
});

test('rule overrides: disabled rules do nothing, severity and settle apply', async () => {
  await alerts.updateRule('device.offline', { enabled: false });
  expect(await alerts.raise('device.offline', offline())).toBeNull();
  expect(mockAlerts).toHaveLength(0);

  await alerts.updateRule('device.offline', { enabled: true, severity: 'warning' });
  expect((await alerts.raise('device.offline', offline())).severity).toBe('warning');

  const rule = await alerts.getRule('device.offline');
  expect(rule).toMatchObject({ enabled: true, severity: 'warning', defaults: { severity: 'critical', settleSeconds: 0 } });
  expect(await alerts.updateRule('no.such-rule', { enabled: false })).toBeNull();
});

test('turning a rule off drops raises still settling', async () => {
  jest.useFakeTimers();
  await alerts.raise('live.monitor-down', { subjectKey: 'd1', deviceId: 'd1', title: 't', message: 'm' });
  await alerts.updateRule('live.monitor-down', { enabled: false });
  await jest.advanceTimersByTimeAsync(300000);
  expect(mockAlerts).toHaveLength(0);
});

test('losing the create race turns into a bump', async () => {
  mockPrisma.alert.findUnique.mockResolvedValueOnce(null); // our lookup misses...
  mockAlerts.push({ id: 'other', openKey: 'device.offline:d1', status: 'open', occurrences: 1 }); // ...another caller wins
  const result = await alerts.raise('device.offline', offline());
  expect(result).toMatchObject({ id: 'other', occurrences: 2 });
  expect(mockAlerts).toHaveLength(1);

  mockPrisma.alert.findUnique.mockResolvedValueOnce(null);
  await alerts.raise('device.offline', offline(), { bump: false });
  expect(mockAlerts[0].occurrences).toBe(2); // a lost race doesn't count when bump is off
});

test('raise and clear swallow database errors', async () => {
  mockPrisma.alert.findUnique.mockRejectedValueOnce(new Error('db down'));
  await expect(alerts.raise('device.offline', offline())).resolves.toBeNull();
  mockPrisma.alert.findUnique.mockRejectedValueOnce(new Error('db down'));
  await expect(alerts.clear('device.offline', { subjectKey: 'd1' })).resolves.toBeNull();
});

test('resolve by hand frees the subject; clearDevice resolves a device\'s live alerts', async () => {
  const a = await alerts.raise('device.offline', offline());
  await alerts.resolve([a.id], { id: 'u1' });
  expect(mockAlerts[0]).toMatchObject({ status: 'resolved', resolvedBy: 'user', openKey: null });

  await alerts.updateRule('live.poe-fault', { settleSeconds: 0 });
  await alerts.raise('live.poe-fault', { subjectKey: 'd1', deviceId: 'd1', port: '1/1/4', title: 't', message: 'm' });
  await alerts.raise('device.offline', offline());
  expect(await alerts.clearDevice('d1', ['live.poe-fault', 'live.monitor-down'])).toBe(1);
  expect(mockAlerts.filter((x) => x.status !== 'resolved').map((x) => x.rule)).toEqual(['device.offline']);
});

test('clearExcept resolves a rule\'s alerts for subjects no longer reporting, and drops their pending raises', async () => {
  const sync = (subjectKey) => ({ subjectKey, title: 't', message: 'm' });
  await alerts.raise('sync.failed', sync('env:aruba_central'));
  await alerts.raise('sync.failed', sync('int-central'));
  await alerts.raise('device.offline', offline());
  await alerts.updateRule('sync.failed', { settleSeconds: 60 });
  await alerts.raise('sync.failed', sync('int-gone'));

  expect(await alerts.clearExcept('sync.failed', ['int-central'])).toBe(1);
  expect(mockAlerts.filter((x) => x.status !== 'resolved').map((x) => x.openKey))
    .toEqual(['sync.failed:int-central', 'device.offline:d1']);
  expect(mockAlerts[0]).toMatchObject({ resolvedBy: 'auto', openKey: null });
  expect(alerts.pending.has('sync.failed:int-gone')).toBe(false);
});

test('mergeDevices resolves the sources\' open alerts and moves their history', async () => {
  await alerts.raise('device.offline', offline());
  await alerts.mergeDevices(mockPrisma, ['d1'], 'target');
  expect(mockAlerts[0]).toMatchObject({ deviceId: 'target', status: 'resolved', resolvedBy: 'merge', openKey: null });
});

test('pruneResolved deletes old resolved alerts only', async () => {
  const old = new Date(Date.now() - 200 * 24 * 3600 * 1000);
  mockAlerts.push(
    { id: 'old', status: 'resolved', resolvedAt: old },
    { id: 'recent', status: 'resolved', resolvedAt: new Date() },
    { id: 'open', status: 'open', resolvedAt: null },
  );
  await alerts.pruneResolved();
  expect(mockAlerts.map((a) => a.id)).toEqual(['recent', 'open']);
});

test('automation.raised takes the caller\'s severity; other rules ignore it', async () => {
  const a = await alerts.raise('automation.raised', { subjectKey: 'esc:d1', deviceId: 'd1', title: 't', message: 'm', severity: 'critical' });
  expect(a.severity).toBe('critical');
  const b = await alerts.raise('automation.raised', { subjectKey: 'esc:d2', title: 't', severity: 'loud' });
  expect(b.severity).toBe('warning'); // not a severity: the rule's default
  const c = await alerts.raise('device.cloud-offline', { subjectKey: 'd1', title: 't', severity: 'critical' });
  expect(c.severity).toBe('warning');
});

test('opened fires once per new alert (not on a bump); resolved fires on clear and manual resolve', async () => {
  const opened = jest.fn();
  const resolved = jest.fn();
  alerts.on('opened', opened);
  alerts.on('resolved', resolved);
  const tick = () => new Promise((r) => setImmediate(r));

  const a = await alerts.raise('device.offline', offline());
  await alerts.raise('device.offline', offline());
  await tick();
  expect(opened).toHaveBeenCalledTimes(1);
  expect(opened).toHaveBeenCalledWith(expect.objectContaining({ id: a.id }));

  await alerts.clear('device.offline', { subjectKey: 'd1' });
  const b = await alerts.raise('device.offline', offline());
  await alerts.resolve([b.id, a.id], { id: 'u1' }); // a is already resolved: not reported again
  await tick();
  expect(resolved.mock.calls.map(([x]) => x.id)).toEqual([a.id, b.id]);
});

test('a listener that throws never reaches raise()', async () => {
  alerts.on('opened', () => { throw new Error('boom'); });
  await expect(alerts.raise('device.offline', offline())).resolves.toMatchObject({ status: 'open' });
  await new Promise((r) => setImmediate(r));
});

test('an automation acknowledges with its id and no user', async () => {
  const a = await alerts.raise('device.offline', offline());
  await alerts.acknowledge([a.id], null, { automationId: 'auto1' });
  expect(mockAlerts[0]).toMatchObject({ status: 'acknowledged', acknowledgedById: null, acknowledgedByAutomationId: 'auto1' });
});
