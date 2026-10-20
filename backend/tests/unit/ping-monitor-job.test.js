/**
 * The ping monitor has one scheduler, the Bull repeatable job. Startup used
 * to also run a setInterval loop, so every device was pinged twice a minute,
 * the two sweeps overwrote each other's stats, and both counted consecutive
 * failures (a device went offline after half its threshold).
 */
jest.mock('../../src/config/database', () => ({ getPrisma: () => ({}) }));
jest.mock('../../src/services/alert.service', () => ({ raise: jest.fn(), clear: jest.fn() }));

const pingMonitorService = require('../../src/services/ping-monitor.service');
const pingMonitorJob = require('../../src/jobs/ping-monitor.job');

function fakeQueue(repeatables = []) {
  return {
    process: jest.fn(),
    getRepeatableJobs: jest.fn(async () => repeatables),
    removeRepeatableByKey: jest.fn(async () => {}),
    add: jest.fn(async () => ({})),
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  delete process.env.PING_MONITOR_ENABLED;
  delete process.env.PING_MONITOR_INTERVAL;
});

test('the service has no scheduler of its own', () => {
  expect(pingMonitorService.startMonitoring).toBeUndefined();
  expect(pingMonitorService.getStats().isMonitoring).toBe(true);
});

test('one repeatable sweep; a job left from another interval is removed', async () => {
  process.env.PING_MONITOR_INTERVAL = '60000';
  const queue = fakeQueue([
    { name: 'checkDevices', every: '30000', key: 'old' },
    { name: 'checkDevices', every: '60000', key: 'current' },
  ]);

  pingMonitorJob(queue);
  await settle();

  expect(queue.removeRepeatableByKey.mock.calls).toEqual([['old']]);
  expect(queue.add).toHaveBeenCalledTimes(1);
  expect(queue.add).toHaveBeenCalledWith('checkDevices', {}, expect.objectContaining({ repeat: { every: 60000 } }));
});

test('turning monitoring off removes the scheduled sweep', async () => {
  process.env.PING_MONITOR_ENABLED = 'false';
  const queue = fakeQueue([{ name: 'checkDevices', every: '60000', key: 'current' }]);

  pingMonitorJob(queue);
  await settle();

  expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('current');
  expect(queue.add).not.toHaveBeenCalled();
  expect(pingMonitorService.getStats().isMonitoring).toBe(false);
});
