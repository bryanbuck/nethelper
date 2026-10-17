/**
 * services/automation/trigger.service: alert events queue runs for the
 * active automations whose Alert trigger matches.
 */
const { EventEmitter } = require('events');

const mockRows = [];
const mockPrisma = {
  automation: { findMany: jest.fn(async () => mockRows) },
  device: { count: jest.fn(async () => 0) },
};
const mockQueue = { add: jest.fn(async () => ({})) };
const mockAlertService = new EventEmitter();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/config/bull', () => ({ getQueue: () => mockQueue }));
jest.mock('../../src/services/alert.service', () => mockAlertService);

const { AutomationTriggerService } = require('../../src/services/automation/trigger.service');

const automationRow = (id, triggerConfig, extra = {}) => ({
  id,
  elements: [{ id: 't', type: 'trigger', data: { triggerType: 'alert', config: triggerConfig, ...extra } }],
});
const offline = { id: 'x1', rule: 'device.offline', severity: 'critical', deviceId: 'd1' };

let triggers;
beforeEach(() => {
  jest.clearAllMocks();
  mockRows.length = 0;
  triggers = new AutomationTriggerService();
});
afterEach(() => triggers.stop());

test('queues a run per matching automation, with a dedup job id', async () => {
  mockRows.push(
    automationRow('a1', { event: 'opened', rules: ['device.offline'] }),
    automationRow('a2', { event: 'resolved' }),
    automationRow('a3', { event: 'opened', minSeverity: 'critical' }),
    automationRow('off', { event: 'opened' }, { enabled: false }),
    { id: 'manual', elements: [{ id: 't', type: 'trigger', data: { triggerType: 'manual' } }] },
  );
  await triggers.handle('opened', offline);
  expect(mockQueue.add.mock.calls.map((c) => c[1].automationId)).toEqual(['a1', 'a3']);
  expect(mockQueue.add).toHaveBeenCalledWith('run',
    { automationId: 'a1', deviceId: 'd1', alertId: 'x1', trigger: 'alert:opened' },
    expect.objectContaining({ jobId: 'alert:a1:x1:opened', attempts: 1 }));
});

test('listens to the alert service once started, and ignores automation-raised alerts', async () => {
  mockRows.push(automationRow('a1', { event: 'opened' }));
  triggers.start();
  mockAlertService.emit('opened', { ...offline, rule: 'automation.raised' });
  mockAlertService.emit('opened', offline);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  expect(mockQueue.add).toHaveBeenCalledTimes(1);
  expect(mockQueue.add.mock.calls[0][1].alertId).toBe('x1');
});

test('a device-group scope needs the alert\'s device in that group', async () => {
  mockRows.push(automationRow('a1', { event: 'opened', deviceGroupId: 'g1' }));
  await triggers.handle('opened', offline);
  expect(mockQueue.add).not.toHaveBeenCalled();
  expect(mockPrisma.device.count).toHaveBeenCalledWith({ where: { id: 'd1', deviceGroups: { some: { id: 'g1' } } } });

  mockPrisma.device.count.mockResolvedValueOnce(1);
  await triggers.handle('opened', offline);
  expect(mockQueue.add).toHaveBeenCalledTimes(1);
});

test('caches automations until invalidated', async () => {
  await triggers.handle('opened', offline);
  await triggers.handle('opened', offline);
  expect(mockPrisma.automation.findMany).toHaveBeenCalledTimes(1);
  triggers.invalidate();
  await triggers.handle('opened', offline);
  expect(mockPrisma.automation.findMany).toHaveBeenCalledTimes(2);
});
