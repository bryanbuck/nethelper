/**
 * services/automation/engine.run: branching, failures, disabled nodes, and
 * the alert actions (raise/clear pair on a shared key, acknowledge by the
 * automation). The alert and backup services are mocked.
 */
const mockAlertService = {
  raise: jest.fn(async (rule, payload) => ({ id: 'al1', occurrences: 1, rule, ...payload })),
  clear: jest.fn(async () => ({ id: 'al1' })),
  acknowledge: jest.fn(async (ids) => ids.map((id) => ({ id, status: 'acknowledged' }))),
};
const mockBackup = { backupDevice: jest.fn(async () => true) };
jest.mock('../../src/services/alert.service', () => mockAlertService);
jest.mock('../../src/services/config-backup.service', () => mockBackup);

const { run } = require('../../src/services/automation/engine');
const { alertTriggerMatches, render } = require('../../src/services/automation/nodes');

const node = (id, type, subtype, config = {}, extra = {}) => ({
  id, type, data: { label: id, [`${type}Type`]: subtype, config, ...extra },
});
const edge = (source, target, sourceHandle) => ({ id: `${source}-${target}`, source, target, sourceHandle });
const automation = (elements) => ({ id: 'auto1', name: 'Escalate', elements });

const device = { id: 'd1', name: 'sw1', vendor: 'aruba', platform: 'aos-cx', pingStatus: 'offline', cloudStatus: 'online' };
const alert = { id: 'x1', rule: 'device.offline', severity: 'critical', title: 'sw1 is offline' };

beforeEach(() => jest.clearAllMocks());

test('a condition routes along its true or false output only', async () => {
  const elements = [
    node('t', 'trigger', 'manual'),
    node('isCx', 'condition', 'device-property', { property: 'platform', operator: '=', value: 'AOS-CX' }),
    node('yes', 'action', 'raise-alert', { key: 'cx', title: 'CX {{device.name}}' }),
    node('no', 'action', 'raise-alert', { key: 'other', title: 'other' }),
    edge('t', 'isCx'), edge('isCx', 'yes', 'true'), edge('isCx', 'no', 'false'),
  ];
  const { status, results } = await run(automation(elements), { device, executionId: 'e1' });
  expect(status).toBe('success');
  expect(results.map((r) => [r.nodeId, r.status])).toEqual([['t', 'ok'], ['isCx', 'ok'], ['yes', 'ok'], ['no', 'skipped']]);
  expect(mockAlertService.raise).toHaveBeenCalledTimes(1);
  expect(mockAlertService.raise).toHaveBeenCalledWith('automation.raised', expect.objectContaining({
    subjectKey: 'cx:d1', deviceId: 'd1', title: 'CX sw1',
    data: expect.objectContaining({ automationId: 'auto1', executionId: 'e1', key: 'cx' }),
  }));
});

test('raise and clear on the same key name the same subject', async () => {
  await run(automation([node('t', 'trigger', 'manual'), node('r', 'action', 'raise-alert', { key: ' esc ', title: 't', severity: 'critical' }), edge('t', 'r')]), { device });
  await run(automation([node('t', 'trigger', 'manual'), node('c', 'action', 'clear-alert', { key: 'esc' }), edge('t', 'c')]), { device });
  expect(mockAlertService.raise.mock.calls[0][1]).toMatchObject({ subjectKey: 'esc:d1', severity: 'critical' });
  expect(mockAlertService.clear).toHaveBeenCalledWith('automation.raised', { subjectKey: 'esc:d1' });

  await run(automation([node('t', 'trigger', 'manual'), node('c', 'action', 'clear-alert', { key: 'esc' }), edge('t', 'c')]), {});
  expect(mockAlertService.clear).toHaveBeenLastCalledWith('automation.raised', { subjectKey: 'esc:global' });
});

test('acknowledge names the automation, and alert-severity compares ranks', async () => {
  const elements = [
    node('t', 'trigger', 'alert', { event: 'opened' }),
    node('sev', 'condition', 'alert-severity', { operator: '>=', severity: 'warning' }),
    node('ack', 'action', 'acknowledge-alert'),
    edge('t', 'sev'), edge('sev', 'ack', 'true'),
  ];
  const { status } = await run(automation(elements), { device, alert });
  expect(status).toBe('success');
  expect(mockAlertService.acknowledge).toHaveBeenCalledWith(['x1'], null, { automationId: 'auto1' });

  await run(automation(elements), { device, alert: { ...alert, severity: 'info' } });
  expect(mockAlertService.acknowledge).toHaveBeenCalledTimes(1);
});

test('a failed step stops its branch unless continueOnError', async () => {
  mockBackup.backupDevice.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
  const build = (config) => [
    node('t', 'trigger', 'manual'),
    node('b', 'action', 'create-backup', config),
    node('r', 'action', 'raise-alert', { key: 'k', title: 't' }),
    edge('t', 'b'), edge('b', 'r'),
  ];
  const stopped = await run(automation(build({})), { device });
  expect(stopped.status).toBe('failed');
  expect(stopped.results.map((r) => r.status)).toEqual(['ok', 'failed', 'skipped']);
  expect(stopped.results[1].error).toMatch(/Config backup of sw1 failed/);
  expect(mockBackup.backupDevice).toHaveBeenCalledWith(device, { trigger: 'automation' });

  const continued = await run(automation(build({ continueOnError: true })), { device });
  expect(continued.results.map((r) => r.status)).toEqual(['ok', 'failed', 'ok']);
});

test('a disabled step passes through; a device step without a device fails', async () => {
  const elements = [
    node('t', 'trigger', 'manual'),
    node('b', 'action', 'create-backup', {}, { enabled: false }),
    node('r', 'action', 'raise-alert', { key: 'k', title: 't' }),
    edge('t', 'b'), edge('b', 'r'),
  ];
  const { results } = await run(automation(elements), {});
  expect(results.map((r) => r.status)).toEqual(['ok', 'disabled', 'ok']);

  const noDevice = await run(automation([node('t', 'trigger', 'manual'), node('b', 'action', 'create-backup'), edge('t', 'b')]), {});
  expect(noDevice.results[1]).toMatchObject({ status: 'failed', error: expect.stringMatching(/needs a device/) });
});

test('run refuses a workflow that cannot run', async () => {
  await expect(run(automation([node('t', 'trigger', 'manual'), node('x', 'action', 'device-reboot'), edge('t', 'x')]), {}))
    .rejects.toThrow(/can't run yet/);
});

test('alert trigger matching: event, rules, severity floor, never automation alerts', () => {
  expect(alertTriggerMatches({ event: 'opened' }, 'opened', alert)).toBe(true);
  expect(alertTriggerMatches({ event: 'resolved' }, 'opened', alert)).toBe(false);
  expect(alertTriggerMatches({ rules: ['live.poe-fault'] }, 'opened', alert)).toBe(false);
  expect(alertTriggerMatches({ minSeverity: 'critical' }, 'opened', { ...alert, severity: 'warning' })).toBe(false);
  expect(alertTriggerMatches({}, 'opened', { ...alert, rule: 'automation.raised' })).toBe(false);
});

test('templates fill known fields and blank unknown ones', () => {
  expect(render('{{device.name}} / {{alert.severity}} / {{automation.name}} / {{device.nope}}', {
    device, alert, automation: { name: 'Escalate' },
  })).toBe('sw1 / critical / Escalate / ');
});

test('a cancelled run stops before its next step', async () => {
  const elements = [
    node('t', 'trigger', 'manual'),
    node('a', 'action', 'raise-alert', { key: 'a', title: 't' }),
    node('b', 'action', 'raise-alert', { key: 'b', title: 't' }),
    edge('t', 'a'), edge('a', 'b'),
  ];
  const shouldStop = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const { status, results } = await run(automation(elements), { shouldStop });
  expect(status).toBe('cancelled');
  expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'cancelled']);
  expect(mockAlertService.raise).toHaveBeenCalledTimes(1);
});
