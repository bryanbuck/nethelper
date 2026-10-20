/**
 * services/automation/schedule.service: the Schedule trigger in the graph
 * owns the cron schedule; sync() keeps one Schedule row and one Bull
 * repeatable job per scheduled automation, fire() queues the runs.
 */
const mockAutomations = new Map();
const mockSchedules = [];
let mockSeq = 0;
const mockPrisma = {
  automation: {
    findUnique: jest.fn(async ({ where }) => mockAutomations.get(where.id) || null),
    findMany: jest.fn(async () => [...mockAutomations.values()].map(({ id }) => ({ id }))),
  },
  schedule: {
    findMany: jest.fn(async ({ where }) => mockSchedules.filter((s) => s.automationId === where.automationId)),
    findUnique: jest.fn(async ({ where }) => {
      const s = mockSchedules.find((x) => x.id === where.id);
      return s && { ...s, automation: mockAutomations.get(s.automationId) };
    }),
    create: jest.fn(async ({ data }) => {
      const row = { id: `s${++mockSeq}`, ...data };
      mockSchedules.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(mockSchedules.find((s) => s.id === where.id), data)),
    deleteMany: jest.fn(async ({ where }) => {
      const keep = mockSchedules.filter((s) => (where.id ? !where.id.in.includes(s.id) : s.automationId !== where.automationId));
      mockSchedules.splice(0, mockSchedules.length, ...keep);
    }),
  },
  execution: { create: jest.fn(async ({ data }) => data), deleteMany: jest.fn(async () => ({ count: 0 })) },
  device: { findMany: jest.fn(async () => [{ id: 'd1', name: 'sw1' }]) },
  deviceGroup: { findMany: jest.fn(async () => []) },
};
const mockQueue = {
  add: jest.fn(async () => ({})),
  removeRepeatable: jest.fn(async () => {}),
  getRepeatableJobs: jest.fn(async () => [
    { id: 'automation-schedule-old', key: 'k-old' },
    { id: 'backup-schedule-x', key: 'k-backup' },
  ]),
  removeRepeatableByKey: jest.fn(async () => {}),
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/config/bull', () => ({ getQueue: () => mockQueue }));
jest.mock('../../src/services/alert.service', () => ({}));

const { AutomationScheduleService } = require('../../src/services/automation/schedule.service');

const scheduled = (id, config, extra = {}) => mockAutomations.set(id, {
  id, name: id, active: true, enabled: true,
  elements: [
    { id: 't', type: 'trigger', data: { label: 'Nightly', triggerType: 'schedule', config } },
    { id: 'b', type: 'action', data: { label: 'Backup', actionType: 'create-backup', config: {} } },
    { id: 'e', source: 't', target: 'b' },
  ],
  ...extra,
});

let service;
beforeEach(() => {
  jest.clearAllMocks();
  mockAutomations.clear();
  mockSchedules.length = 0;
  service = new AutomationScheduleService();
});

test('sync creates one schedule and a repeatable job for an active scheduled automation', async () => {
  scheduled('a1', { schedule: '0 2 * * *', timezone: 'America/Chicago' });
  const schedule = await service.sync('a1');
  expect(schedule).toMatchObject({ automationId: 'a1', cronExpression: '0 2 * * *', timezone: 'America/Chicago', active: true });
  expect(schedule.nextRun).toBeInstanceOf(Date);
  expect(mockQueue.add).toHaveBeenCalledWith('scheduled', { scheduleId: schedule.id }, expect.objectContaining({
    repeat: { cron: '0 2 * * *', tz: 'America/Chicago' },
    jobId: `automation-schedule-${schedule.id}`,
  }));
});

test('changing the cron replaces the job; deactivating removes schedule and job', async () => {
  scheduled('a1', { schedule: '0 2 * * *' });
  const first = await service.sync('a1');
  scheduled('a1', { schedule: '*/15 * * * *' });
  const second = await service.sync('a1');
  expect(second.id).toBe(first.id);
  expect(mockQueue.removeRepeatable).toHaveBeenCalledWith('scheduled', { cron: '0 2 * * *', tz: 'UTC', jobId: `automation-schedule-${first.id}` });
  expect(mockSchedules).toHaveLength(1);

  mockAutomations.get('a1').active = false;
  expect(await service.sync('a1')).toBeNull();
  expect(mockSchedules).toHaveLength(0);
});

test('no schedule for other triggers or a workflow that can\'t run', async () => {
  mockAutomations.set('manual', { id: 'manual', name: 'm', active: true, enabled: true, elements: [{ id: 't', type: 'trigger', data: { triggerType: 'manual' } }] });
  scheduled('broken', { schedule: 'nonsense' });
  expect(await service.sync('manual')).toBeNull();
  expect(await service.sync('broken')).toBeNull();
  expect(mockQueue.add).not.toHaveBeenCalled();
});

test('fire queues runs on the trigger\'s targets and advances lastRun/nextRun', async () => {
  scheduled('a1', { schedule: '0 2 * * *', deviceIds: ['d1'] });
  const schedule = await service.sync('a1');
  mockQueue.add.mockClear();

  expect(await service.fire(schedule.id)).toEqual({ queued: 1 });
  expect(mockPrisma.device.findMany).toHaveBeenCalledWith({ where: { OR: [{ id: { in: ['d1'] } }] } });
  expect(mockPrisma.execution.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ automationId: 'a1', deviceId: 'd1', trigger: 'schedule', status: 'pending' }),
  }));
  expect(mockQueue.add).toHaveBeenCalledWith('run', expect.objectContaining({ automationId: 'a1', deviceId: 'd1', trigger: 'schedule' }), expect.anything());
  expect(mockSchedules[0].lastRun).toBeInstanceOf(Date);
});

test('fire with no devices for a device step records a failed run instead of skipping silently', async () => {
  scheduled('a1', { schedule: '0 2 * * *' }); // no targets, no device groups
  const schedule = await service.sync('a1');
  mockPrisma.device.findMany.mockResolvedValueOnce([]);
  expect(await service.fire(schedule.id)).toEqual({ queued: 0 });
  expect(mockPrisma.execution.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    status: 'failed', trigger: 'schedule', error: expect.stringMatching(/No target devices/),
  }) });
});

test('fire does nothing once the automation is no longer scheduled', async () => {
  scheduled('a1', { schedule: '0 2 * * *' });
  const schedule = await service.sync('a1');
  mockAutomations.get('a1').enabled = false;
  expect(await service.fire(schedule.id)).toEqual({ skipped: 'automation is inactive or no longer scheduled' });
  expect(mockPrisma.execution.create).not.toHaveBeenCalled();
});

test('syncAll drops stale automation repeatables (not backup ones) and re-registers', async () => {
  scheduled('a1', { schedule: '0 2 * * *' });
  await service.syncAll();
  expect(mockQueue.removeRepeatableByKey).toHaveBeenCalledWith('k-old');
  expect(mockQueue.removeRepeatableByKey).not.toHaveBeenCalledWith('k-backup');
  expect(mockQueue.add).toHaveBeenCalledTimes(1);
});
