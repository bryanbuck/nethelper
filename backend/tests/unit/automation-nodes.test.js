/**
 * The automation steps that reach outside the engine: notification channel
 * and email steps, the HTTP Request step (templating, header secrets, the
 * refused addresses), Run Discovery, and the Time Window condition.
 * Channels, SMTP, the scan service and the network are mocked.
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'unit-test-encryption-key-0123456789abcdef';
process.env.APP_BASE_URL = 'https://nethelper.example';

const mockChannels = { sendMessage: jest.fn(async () => ({ name: 'NOC Slack', type: 'webhook' })) };
const mockDiscovery = {
  isValidCidr: (cidr) => /^\d+\.\d+\.\d+\.\d+\/(1[6-9]|2\d|3[0-2])$/.test(cidr),
  createScan: jest.fn(async (subnets) => ({ id: 'scan1', subnets: subnets.length ? subnets : ['192.168.0.0/24'] })),
};
const mockQueue = { add: jest.fn(async () => ({})) };
const mockAxios = { request: jest.fn(async () => ({ status: 200, data: 'ok' })) };
jest.mock('../../src/services/alert.service', () => ({}));
jest.mock('../../src/services/notification-channel.service', () => mockChannels);
jest.mock('../../src/services/discovery.service', () => mockDiscovery);
jest.mock('../../src/config/bull', () => ({ getQueue: () => mockQueue }));
jest.mock('../../src/config/database', () => ({ getPrisma: () => ({}) }));
jest.mock('axios', () => mockAxios);
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const { run, validate } = require('../../src/services/automation/engine');
const { inTimeWindow, render } = require('../../src/services/automation/nodes');
const secrets = require('../../src/services/automation/secrets');
const { checkUrl, isBlockedAddress } = require('../../src/services/automation/http-request');
const notifier = require('../../src/services/notification.service');

const node = (id, type, subtype, config = {}) => ({ id, type, data: { label: id, [`${type}Type`]: subtype, config } });
const edge = (source, target, sourceHandle) => ({ id: `${source}-${target}`, source, target, sourceHandle });
const automation = (elements) => ({ id: 'auto1', name: 'Config watch', elements });
const flow = (step, trigger = node('t', 'trigger', 'manual')) => automation([trigger, step, edge('t', step.id)]);
const device = { id: 'd1', name: 'sw "core" 1', ipAddress: '10.0.0.5' };
const configChange = { backupId: 'b2', previousBackupId: 'b1', changedKinds: ['cli'] };

beforeEach(() => {
  jest.clearAllMocks();
  notifier.sendEmail = jest.fn(async () => {});
});

describe('notification steps', () => {
  test('a channel step with no message says what happened and links to it', async () => {
    const { status, results } = await run(flow(node('n', 'notification', 'channel', { channelId: 'c1' })), { device, configChange });
    expect(status).toBe('success');
    expect(results[1].result).toEqual({ sentTo: 'NOC Slack', type: 'webhook' });
    const [channelId, message] = mockChannels.sendMessage.mock.calls[0];
    expect(channelId).toBe('c1');
    expect(message.subject).toBe('Config watch: sw "core" 1');
    expect(message.text).toBe('Configuration changed on sw "core" 1 (cli)\nhttps://nethelper.example/devices/d1?tab=history');
    expect(message.payload).toMatchObject({
      event: 'automation.notification',
      text: `${message.subject}\n${message.text}`,
      device: { id: 'd1' },
      configChange,
      url: 'https://nethelper.example/devices/d1?tab=history',
    });
  });

  test('a channel step sends its own templated message; a failed delivery fails the step', async () => {
    const step = node('n', 'notification', 'channel', { channelId: 'c1', subject: 'Change on {{device.name}}', message: '{{change.kinds}} changed at {{device.ipAddress}}: {{link}}' });
    await run(flow(step), { device, configChange });
    expect(mockChannels.sendMessage.mock.calls[0][1]).toMatchObject({
      subject: 'Change on sw "core" 1',
      text: 'cli changed at 10.0.0.5: https://nethelper.example/devices/d1?tab=history',
    });

    mockChannels.sendMessage.mockRejectedValueOnce(new Error('The webhook answered HTTP 404'));
    const failed = await run(flow(step), { device });
    expect(failed.status).toBe('failed');
    expect(failed.results[1].error).toBe('The webhook answered HTTP 404');
  });

  test('a channel step needs a channel', () => {
    expect(validate(flow(node('n', 'notification', 'channel', {})).elements).errors).toEqual(['"n": channelId is required']);
  });

  test('an email step sends to its recipients and checks them', async () => {
    const step = node('n', 'notification', 'email', { recipients: ['noc@example.com', ' ops@example.com '], subject: '', message: 'Look at {{device.name}}' });
    const { results } = await run(flow(step), { device });
    expect(notifier.sendEmail).toHaveBeenCalledWith(['noc@example.com', 'ops@example.com'], 'Config watch: sw "core" 1', 'Look at sw "core" 1');
    expect(results[1].result).toEqual({ sentTo: 2, subject: 'Config watch: sw "core" 1' });

    expect(validate(flow(node('n', 'notification', 'email', { recipients: [] })).elements).errors[0]).toMatch(/at least one recipient/);
    expect(validate(flow(node('n', 'notification', 'email', { recipients: ['nope'] })).elements).errors[0]).toMatch(/"nope" is not an email address/);
  });
});

describe('HTTP Request step', () => {
  const http = (config) => node('h', 'action', 'http-request', config);
  const stored = (elements) => secrets.protectElements(elements);

  test('sends the templated request with its decrypted headers', async () => {
    const elements = stored(flow(http({
      method: 'POST',
      url: 'https://hooks.example/notify?device={{device.name}}',
      headers: [{ name: 'Authorization', value: 'Bearer s3cret' }],
      body: '{"text": "Change on {{device.name}}"}',
    })).elements);
    const { status, results } = await run(automation(elements), { device });
    expect(status).toBe('success');
    const sent = mockAxios.request.mock.calls[0][0];
    expect(sent).toMatchObject({
      method: 'POST',
      url: 'https://hooks.example/notify?device=sw%20%22core%22%201',
      headers: { Authorization: 'Bearer s3cret', 'Content-Type': 'application/json' },
      maxRedirects: 0,
      proxy: false,
    });
    // A quote in a value can't break out of the JSON string it lands in.
    expect(JSON.parse(sent.data)).toEqual({ text: 'Change on sw "core" 1' });
    expect(results[1].result).toMatchObject({ status: 200, body: 'ok' });
  });

  test('anything but a 2xx answer fails the step', async () => {
    mockAxios.request.mockResolvedValueOnce({ status: 503, data: 'busy' });
    const { status, results } = await run(automation(stored(flow(http({ method: 'GET', url: 'https://api.example/x' })).elements)), {});
    expect(status).toBe('failed');
    expect(results[1].error).toBe('GET answered HTTP 503: busy');
  });

  test('header values are encrypted at rest, masked on the way out, and kept through a masked save', () => {
    const first = stored(flow(http({ url: 'https://api.example/x', headers: [{ name: 'X-Api-Key', value: 'k1' }, { name: 'X-Other', value: 'o1' }] })).elements);
    const value = first[1].data.config.headers[0].value;
    expect(value).toMatch(/^enc:/);
    expect(value).not.toContain('k1');

    const masked = secrets.maskElements(first);
    expect(masked[1].data.config.headers).toEqual([{ name: 'X-Api-Key', value: '***' }, { name: 'X-Other', value: '***' }]);
    expect(first[1].data.config.headers[0].value).toBe(value); // masking copies

    // Saved again from the builder: one header untouched, one retyped.
    masked[1].data.config.headers[1].value = 'o2';
    const second = secrets.protectElements(masked, first);
    expect(second[1].data.config.headers[0].value).toBe(value);
    expect(secrets.revealHeaders(second[1].data.config.headers)).toEqual({ 'X-Api-Key': 'k1', 'X-Other': 'o2' });
  });

  test('a masked value with nothing stored behind it is saved empty and refused', () => {
    const copy = secrets.protectElements(flow(http({ url: 'https://api.example/x', headers: [{ name: 'X-Api-Key', value: '***' }] })).elements);
    expect(copy[1].data.config.headers).toEqual([{ name: 'X-Api-Key', value: '' }]);
    expect(validate(copy).errors).toEqual(['"h": header "X-Api-Key" needs its value entered again']);

    // A ciphertext sent by the client is not trusted either.
    const forged = secrets.protectElements(flow(http({ url: 'https://api.example/x', headers: [{ name: 'X-Api-Key', value: 'enc:abcd' }] })).elements);
    expect(forged[1].data.config.headers[0].value).toBe('');
  });

  test('refuses addresses on the host itself, bad URLs and broken JSON', () => {
    const errors = (config) => validate(stored(flow(http(config)).elements)).errors;
    expect(errors({ url: 'http://127.0.0.1:3000/api' })[0]).toMatch(/NetHelper host itself/);
    expect(errors({ url: 'http://localhost/x' })[0]).toMatch(/NetHelper host itself/);
    expect(errors({ url: 'http://169.254.169.254/latest/meta-data' })[0]).toMatch(/NetHelper host itself/);
    expect(errors({ url: 'ftp://files.example/x' })[0]).toMatch(/must start with https/);
    expect(errors({ url: 'https://user:pw@api.example/x' })[0]).toMatch(/credentials in a header/);
    expect(errors({ url: 'https://api.example/x', method: 'TRACE' })[0]).toMatch(/method must be one of/);
    expect(errors({ url: 'https://api.example/x', body: '{"a": }' })[0]).toMatch(/not valid JSON/);
    expect(errors({ url: 'http://192.168.1.20:8123/api/webhook/{{device.name}}', body: '{"a": "{{device.name}}"}' })).toEqual([]);

    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1', '169.254.169.254', 'fe80::1', '0.0.0.0'].every(isBlockedAddress)).toBe(true);
    expect(['192.168.0.1', '10.1.2.3', '8.8.8.8', '2001:db8::1'].some(isBlockedAddress)).toBe(false);
    expect(() => checkUrl('http://[::1]:8080/')).toThrow(/NetHelper host itself/);
  });

  test('key rotation re-encrypts stored header values only', () => {
    const first = stored(flow(http({ url: 'https://api.example/x', headers: [{ name: 'A', value: 'one' }, { name: 'B', value: '' }] })).elements);
    const seen = [];
    const next = secrets.rotateElements(first, (ciphertext, label) => {
      seen.push(label);
      return `${ciphertext}-rotated`;
    });
    expect(seen).toEqual(['node h header A']);
    expect(next[1].data.config.headers[0].value).toMatch(/^enc:.*-rotated$/);
    expect(secrets.rotateElements(first, () => null)).toBeNull();
  });
});

describe('Run Discovery step', () => {
  test('starts a scan on the queue and reports it', async () => {
    const { results } = await run(flow(node('s', 'action', 'run-discovery', { subnets: ['10.0.0.0/24'] })), {});
    expect(mockDiscovery.createScan).toHaveBeenCalledWith(['10.0.0.0/24'], null);
    expect(mockQueue.add).toHaveBeenCalledWith('runScan', { scanId: 'scan1', triggeredBy: 'automation auto1' }, { attempts: 1 });
    expect(results[1].result).toEqual({ started: true, scanId: 'scan1', subnets: ['10.0.0.0/24'] });
  });

  test('a scan already in progress is reported, not a failure', async () => {
    mockDiscovery.createScan.mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 409 }));
    const { status, results } = await run(flow(node('s', 'action', 'run-discovery', {})), {});
    expect(status).toBe('success');
    expect(results[1].result).toEqual({ started: false, reason: 'a discovery scan is already in progress' });
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  test('checks its subnets', () => {
    expect(validate(flow(node('s', 'action', 'run-discovery', { subnets: ['10.0.0.0/8', 'x'] })).elements).errors[0]).toMatch(/invalid subnet\(s\) 10.0.0.0\/8, x/);
  });
});

describe('Time Window condition', () => {
  const at = (iso) => new Date(iso);
  test('a daytime window, in its timezone, end exclusive', () => {
    const office = { startTime: '08:00', endTime: '17:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], timezone: 'America/New_York' };
    expect(inTimeWindow(office, at('2026-11-11T14:00:00Z'))).toBe(true); // Wed 09:00 EST
    expect(inTimeWindow(office, at('2026-11-11T12:30:00Z'))).toBe(false); // Wed 07:30
    expect(inTimeWindow(office, at('2026-11-11T22:00:00Z'))).toBe(false); // Wed 17:00
    expect(inTimeWindow(office, at('2026-11-14T15:00:00Z'))).toBe(false); // Saturday
  });

  test('a window past midnight belongs to the day it starts on', () => {
    const night = { startTime: '22:00', endTime: '06:00', days: ['friday'] };
    expect(inTimeWindow(night, at('2026-11-13T23:00:00Z'))).toBe(true); // Friday night
    expect(inTimeWindow(night, at('2026-11-14T03:00:00Z'))).toBe(true); // Saturday early
    expect(inTimeWindow(night, at('2026-11-13T03:00:00Z'))).toBe(false); // Friday early (Thursday's window)
    expect(inTimeWindow(night, at('2026-11-14T12:00:00Z'))).toBe(false);
  });

  test('routes a run along its true or false output', async () => {
    jest.useFakeTimers().setSystemTime(at('2026-11-11T10:00:00Z'));
    const elements = [
      node('t', 'trigger', 'manual'),
      node('w', 'condition', 'time-window', { startTime: '08:00', endTime: '17:00' }),
      node('in', 'notification', 'channel', { channelId: 'day' }),
      node('out', 'notification', 'channel', { channelId: 'night' }),
      edge('t', 'w'), edge('w', 'in', 'true'), edge('w', 'out', 'false'),
    ];
    const { results } = await run(automation(elements), {});
    jest.useRealTimers();
    expect(results.map((r) => [r.nodeId, r.status])).toEqual([['t', 'ok'], ['w', 'ok'], ['in', 'ok'], ['out', 'skipped']]);
  });

  test('checks its times', () => {
    const errors = (config) => validate(flow(node('w', 'condition', 'time-window', config)).elements).errors;
    expect(errors({ startTime: '8am', endTime: '17:00' })[0]).toMatch(/startTime must be a time like 08:00/);
    expect(errors({ startTime: '09:00', endTime: '09:00' })[0]).toMatch(/are the same/);
    expect(errors({ startTime: '09:00', endTime: '10:00', days: ['someday'] })[0]).toMatch(/weekdays/);
    expect(errors({ startTime: '09:00', endTime: '10:00', timezone: 'Mars/Olympus' })[0]).toMatch(/unknown timezone/);
  });
});

test('templates leave unknown and missing values empty', () => {
  expect(render('[{{device.name}}] [{{alert.title}}] [{{device.metadata}}] [{{nope.x}}]', { automation: {}, device: { name: 'sw1', metadata: { a: 1 } } }))
    .toBe('[sw1] [] [] [{{nope.x}}]');
});
