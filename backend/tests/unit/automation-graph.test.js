/**
 * services/automation/graph + engine.validate: parsing the builder's saved
 * vue-flow elements and refusing workflows that can't run.
 */
jest.mock('../../src/services/alert.service', () => ({}));

const { parseGraph } = require('../../src/services/automation/graph');
const { validate } = require('../../src/services/automation/engine');

const node = (id, type, subtype, config = {}, extra = {}) => ({
  id, type, position: { x: 0, y: 0 }, data: { label: id, [`${type}Type`]: subtype, config, ...extra },
});
const edge = (source, target, sourceHandle) => ({ id: `${source}-${target}`, type: 'smoothstep', source, target, sourceHandle });

test('splits nodes from edges, even though vue-flow edges carry a type', () => {
  const g = parseGraph([node('t', 'trigger', 'manual'), node('a', 'action', 'create-backup'), edge('t', 'a')]);
  expect(g.errors).toEqual([]);
  expect(g.nodes.map((n) => n.id)).toEqual(['t', 'a']);
  expect(g.edges).toHaveLength(1);
  expect(g.trigger.id).toBe('t');
  expect(g.order.map((n) => n.id)).toEqual(['t', 'a']);
});

test('needs exactly one trigger, no loops, and no dangling connections', () => {
  expect(parseGraph(null).errors).toEqual(['The automation has no workflow']);
  expect(parseGraph([node('a', 'action', 'create-backup')]).errors).toContain('The workflow needs a trigger');
  expect(parseGraph([node('t1', 'trigger', 'manual'), node('t2', 'trigger', 'manual')]).errors)
    .toContain('The workflow can have only one trigger');
  const loop = parseGraph([
    node('t', 'trigger', 'manual'), node('a', 'action', 'raise-alert'), node('b', 'action', 'clear-alert'),
    edge('t', 'a'), edge('a', 'b'), edge('b', 'a'),
  ]);
  expect(loop.errors).toContain('The workflow has a loop; connections must flow one way');
  expect(parseGraph([node('t', 'trigger', 'manual'), edge('t', 'gone')]).errors[0]).toMatch(/no longer exists/);
});

test('validate reports nodes that cannot run yet and bad configs', () => {
  const { errors } = validate([
    node('t', 'trigger', 'manual'),
    node('Reboot', 'action', 'device-reboot'),
    node('Raise', 'action', 'raise-alert', { title: 'x' }),
    node('Ack', 'action', 'acknowledge-alert'),
    node('Email', 'notification', 'email'),
    edge('t', 'Reboot'), edge('t', 'Raise'), edge('t', 'Ack'), edge('t', 'Email'),
  ]);
  expect(errors).toEqual([
    '"Reboot" (action device-reboot) can\'t run yet',
    '"Raise": key is required',
    '"Ack" needs an Alert trigger',
    '"Email" (notification email) can\'t run yet',
  ]);
});

test('disabled nodes are not checked; needsDevice and the trigger type are reported', () => {
  const result = validate([
    node('t', 'trigger', 'alert', { event: 'opened', rules: ['device.offline'] }),
    node('Reboot', 'action', 'device-reboot', {}, { enabled: false }),
    node('Backup', 'action', 'create-backup'),
    edge('t', 'Reboot'), edge('Reboot', 'Backup'),
  ]);
  expect(result.errors).toEqual([]);
  expect(result).toMatchObject({ triggerType: 'alert', needsDevice: true });
});

test('an alert trigger cannot listen to automation-raised alerts', () => {
  const { errors } = validate([node('t', 'trigger', 'alert', { rules: ['automation.raised'] })]);
  expect(errors).toEqual(['"t": unknown alert rule automation.raised']);
});

test('a Schedule trigger needs a valid cron expression and timezone', () => {
  const sched = (config) => validate([node('t', 'trigger', 'schedule', config)]).errors;
  expect(sched({ schedule: '0 2 * * *', timezone: 'Europe/London', deviceIds: ['d1'] })).toEqual([]);
  expect(sched({})).toEqual(['"t": schedule is required']);
  expect(sched({ schedule: '61 * * * *' })[0]).toMatch(/invalid cron expression/);
  expect(sched({ schedule: '0 2 * * *', timezone: 'Nowhere/City' })).toEqual(['"t": unknown timezone Nowhere/City']);
  expect(sched({ schedule: '0 2 * * *', deviceIds: 'd1' })).toEqual(['"t": deviceIds must be a list of ids']);
});
