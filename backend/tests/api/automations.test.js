/**
 * /api/v1/automations: Run Now queues engine runs on the right devices, a
 * workflow that can't run is refused (on run and on activation) with the
 * reasons, and every write re-derives the automation's cron schedule.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
const mockAutomations = new Map();
let mockExecutionSeq = 0;
mockPrisma.automation = {
  findUnique: jest.fn(async ({ where }) => mockAutomations.get(where.id) || null),
  update: jest.fn(async ({ where, data }) => {
    const row = Object.assign(mockAutomations.get(where.id), data);
    return { ...row };
  }),
};
mockPrisma.execution = {
  create: jest.fn(async ({ data }) => ({ id: `e${++mockExecutionSeq}`, ...data, device: null })),
};
mockPrisma.device = {
  // By id, or the trigger's OR of ids and groups (group g1 holds d7 and d8).
  findMany: jest.fn(async ({ where }) => {
    if (where.id) return where.id.in.map((id) => ({ id, name: id }));
    return where.OR.flatMap((clause) => (clause.id ? clause.id.in : ['d7', 'd8'])).map((id) => ({ id, name: id }));
  }),
};
mockPrisma.deviceGroup = { findMany: jest.fn(async () => []) };
const mockSchedules = { sync: jest.fn(async () => null), remove: jest.fn(async () => {}) };
jest.mock('../../src/services/automation/schedule.service', () => mockSchedules);
const mockQueue = { add: jest.fn(async () => ({})) };
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/config/bull', () => ({ getQueue: () => mockQueue }));
jest.mock('../../src/services/alert.service', () => ({ on: jest.fn(), off: jest.fn() }));

const app = require('../../src/app');

const node = (id, type, subtype, config = {}) => ({ id, type, data: { label: id, [`${type}Type`]: subtype, config } });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });
const automation = (id, elements, extra = {}) => mockAutomations.set(id, {
  id, name: id, enabled: true, active: false, elements, deviceGroups: [], ...extra,
});

let token;
beforeAll(async () => {
  const admin = await mockPrisma.user.create({ data: { email: 'a@example.com', name: 'Admin', role: 'admin', password: 'x' } });
  token = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);
});
beforeEach(() => {
  jest.clearAllMocks();
  mockAutomations.clear();
});

const post = (path, body = {}) => request(app).post(`/api/v1/automations${path}`).set('Authorization', `Bearer ${token}`).send(body);
const patch = (path) => request(app).patch(`/api/v1/automations${path}`).set('Authorization', `Bearer ${token}`).send({});

test('Run Now queues one run per target device', async () => {
  automation('backup', [node('t', 'trigger', 'manual'), node('b', 'action', 'create-backup'), edge('t', 'b')]);
  const res = await post('/backup/execute', { deviceIds: ['d1', 'd2'] });
  expect(res.status).toBe(200);
  expect(mockQueue.add).toHaveBeenCalledTimes(2);
  expect(mockQueue.add).toHaveBeenCalledWith('run', expect.objectContaining({ automationId: 'backup', deviceId: 'd1', trigger: 'manual' }), expect.objectContaining({ attempts: 1 }));
});

test('Run Now accepts a single deviceId, and runs device-free workflows once', async () => {
  automation('raise', [node('t', 'trigger', 'manual'), node('r', 'action', 'raise-alert', { key: 'k', title: 't' }), edge('t', 'r')]);
  expect((await post('/raise/execute', { deviceId: 'd9' })).status).toBe(200);
  expect(mockQueue.add.mock.calls[0][1].deviceId).toBe('d9');

  mockQueue.add.mockClear();
  expect((await post('/raise/execute')).status).toBe(200);
  expect(mockQueue.add).toHaveBeenCalledTimes(1);
  expect(mockQueue.add.mock.calls[0][1].deviceId).toBeNull();
});

test('Run Now refuses non-runnable workflows, alert triggers, and device steps with no devices', async () => {
  automation('reboot', [node('t', 'trigger', 'manual'), node('x', 'action', 'device-reboot'), edge('t', 'x')]);
  const bad = await post('/reboot/execute', { deviceIds: ['d1'] });
  expect(bad.status).toBe(400);
  expect(bad.body.details[0].msg).toMatch(/can't run yet/);

  automation('onAlert', [node('t', 'trigger', 'alert', { event: 'opened' })]);
  expect((await post('/onAlert/execute')).body.error).toMatch(/only Manual and Schedule triggers/);

  automation('backup', [node('t', 'trigger', 'manual'), node('b', 'action', 'create-backup'), edge('t', 'b')]);
  expect((await post('/backup/execute')).body.error).toMatch(/No target devices/);
  expect(mockQueue.add).not.toHaveBeenCalled();
});

test('activating a workflow that can\'t run is refused; deactivating always works', async () => {
  automation('reboot', [node('t', 'trigger', 'alert'), node('x', 'action', 'device-reboot'), edge('t', 'x')]);
  const res = await patch('/reboot/toggle');
  expect(res.status).toBe(400);
  expect(mockPrisma.automation.update).not.toHaveBeenCalled();

  automation('on', [node('t', 'trigger', 'alert'), node('x', 'action', 'device-reboot'), edge('t', 'x')], { active: true });
  expect((await patch('/on/toggle')).status).toBe(200);
  expect(mockAutomations.get('on').active).toBe(false);
});

test('Run Now uses the trigger\'s devices and groups, and runs scheduled automations too', async () => {
  automation('nightly', [
    node('t', 'trigger', 'schedule', { schedule: '0 2 * * *', deviceIds: ['d1', 'd7'], deviceGroupIds: ['g1'] }),
    node('b', 'action', 'create-backup'), edge('t', 'b'),
  ]);
  expect((await post('/nightly/execute')).status).toBe(200);
  expect(mockQueue.add.mock.calls.map((c) => c[1].deviceId).sort()).toEqual(['d1', 'd7', 'd8']); // deduplicated
  expect(mockPrisma.execution.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ trigger: 'manual', status: 'pending' }),
  }));
});

test('every write re-derives the cron schedule; delete removes it first', async () => {
  automation('on', [node('t', 'trigger', 'schedule', { schedule: '*/5 * * * *' })]);
  expect((await patch('/on/toggle')).status).toBe(200);
  expect(mockSchedules.sync).toHaveBeenCalledWith('on');

  mockPrisma.automation.delete = jest.fn(async () => ({}));
  expect((await request(app).delete('/api/v1/automations/on').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  expect(mockSchedules.remove).toHaveBeenCalledWith('on');
  expect(mockSchedules.remove.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.automation.delete.mock.invocationCallOrder[0]);
});

test('a bad cron expression or timezone can\'t be activated', async () => {
  automation('badCron', [node('t', 'trigger', 'schedule', { schedule: 'every day' })]);
  const res = await patch('/badCron/toggle');
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/invalid cron expression "every day"/);

  automation('badTz', [node('t', 'trigger', 'schedule', { schedule: '0 2 * * *', timezone: 'Mars/Olympus' })]);
  expect((await patch('/badTz/toggle')).body.error).toMatch(/unknown timezone Mars\/Olympus/);
});
