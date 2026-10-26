/**
 * Alert notification channels (services/notification-channel.service.js):
 * which channels an alert reaches, one queued job per channel on open and
 * resolve, secrets encrypted and never returned (a masked value keeps the
 * stored one), delivery outcomes recorded on the channel only on the last
 * attempt, and the message/payload shape (services/notification.service.js).
 */
jest.mock('axios');
const mockSendMail = jest.fn(async () => ({ messageId: 'm1' }));
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));
const mockQueue = { add: jest.fn(async () => ({})) };
jest.mock('../../src/config/bull', () => ({ getQueue: jest.fn(() => mockQueue) }));
const mockPrisma = {
  notificationChannel: {
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(),
    create: jest.fn(async ({ data }) => ({ id: 'c1', ...data })),
    update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    delete: jest.fn(),
  },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const axios = require('axios');
const nodemailer = require('nodemailer');
const encryption = require('../../src/utils/encryption');
const alertService = require('../../src/services/alert.service');
const channels = require('../../src/services/notification-channel.service');
const { channelMatches, channelTakesCloudAlarm, SECRET_MASK } = require('../../src/services/notification-channel.service');
const cloudAlarmService = require('../../src/services/cloud-alarm.service');
const notifier = require('../../src/services/notification.service');
const { formatAlert, formatCloudAlarm, appBaseUrl } = require('../../src/services/notification.service');
const notificationJob = require('../../src/jobs/notification.job');

const alert = (over = {}) => ({
  id: 'a1', rule: 'device.offline', severity: 'critical', title: 'sw1 is offline', message: 'No ping reply for 3 checks',
  device: { id: 'd1', name: 'sw1', ipAddress: '10.0.0.1' }, port: null, occurrences: 1,
  firstSeenAt: new Date('2026-10-23T10:00:00Z'), resolvedAt: null, ...over,
});
const channel = (over = {}) => ({
  id: 'c1', name: 'Ops', type: 'webhook', enabled: true, minSeverity: 'warning', rules: [],
  config: { url: encryption.encrypt('https://hooks.example.com/services/SECRET'), urlHint: 'https://hooks.example.com/…', headers: {} },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  channels.invalidate();
});

describe('which channels an alert reaches', () => {
  test.each([
    ['severity at the minimum', channel({ minSeverity: 'critical' }), alert(), true],
    ['severity below the minimum', channel({ minSeverity: 'critical' }), alert({ severity: 'warning' }), false],
    ['disabled', channel({ enabled: false }), alert(), false],
    ['no rules = every built-in rule', channel(), alert({ rule: 'backup.failed' }), true],
    ['no rules leaves out automation alerts', channel(), alert({ rule: 'automation.raised' }), false],
    ['automation alerts when named', channel({ rules: ['automation.raised'] }), alert({ rule: 'automation.raised' }), true],
    ['a rule not in the list', channel({ rules: ['backup.failed'] }), alert(), false],
  ])('%s', (_label, ch, a, expected) => {
    expect(channelMatches(ch, a)).toBe(expected);
  });
});

describe('dispatch', () => {
  test('queues one job per matching channel, with a snapshot of the alert', async () => {
    mockPrisma.notificationChannel.findMany.mockResolvedValue([
      channel({ id: 'c1' }), channel({ id: 'c2', rules: ['backup.failed'] }), channel({ id: 'c3', type: 'email', config: { recipients: ['a@x.io'] } }),
    ]);
    const queued = await channels.dispatch('opened', alert());
    expect(queued).toBe(2);
    expect(mockQueue.add).toHaveBeenCalledTimes(2);
    expect(mockQueue.add).toHaveBeenCalledWith('deliver', {
      channelId: 'c1',
      event: 'opened',
      alert: expect.objectContaining({ id: 'a1', rule: 'device.offline', device: { id: 'd1', name: 'sw1' } }),
    }, expect.objectContaining({ attempts: 3 }));
  });

  test('reads channels once while cached; a write drops the cache', async () => {
    mockPrisma.notificationChannel.findMany.mockResolvedValue([]);
    await channels.dispatch('opened', alert());
    await channels.dispatch('resolved', alert());
    expect(mockPrisma.notificationChannel.findMany).toHaveBeenCalledTimes(1);
    await channels.create('u1', { name: 'x', type: 'email', config: { recipients: ['a@x.io'] } });
    await channels.dispatch('opened', alert());
    expect(mockPrisma.notificationChannel.findMany).toHaveBeenCalledTimes(2);
  });

  test('never throws into the alert service', async () => {
    mockPrisma.notificationChannel.findMany.mockRejectedValue(new Error('db down'));
    await expect(channels.dispatch('opened', alert())).resolves.toBe(0);
  });

  test('follows the alert service\'s opened and resolved events once started', async () => {
    const spy = jest.spyOn(channels, 'dispatch').mockResolvedValue(0);
    channels.start();
    try {
      alertService.emit('opened', alert());
      alertService.emit('resolved', alert());
      expect(spy.mock.calls.map(([event]) => event)).toEqual(['opened', 'resolved']);
    } finally {
      channels.stop();
      spy.mockRestore();
    }
  });
});

describe('secrets', () => {
  test('a webhook URL and header values are stored encrypted and never returned', async () => {
    const created = await channels.create('u1', {
      name: 'Slack', type: 'webhook', minSeverity: 'critical',
      config: { url: 'https://hooks.slack.com/services/T0/B0/SECRET', headers: { 'X-Token': 'abc' } },
    });
    const stored = mockPrisma.notificationChannel.create.mock.calls[0][0].data;
    expect(stored.config.url).not.toContain('SECRET');
    expect(encryption.decrypt(stored.config.url)).toBe('https://hooks.slack.com/services/T0/B0/SECRET');
    expect(encryption.decrypt(stored.config.headers['X-Token'])).toBe('abc');
    expect(stored.userId).toBe('u1');
    expect(created.config).toEqual({ url: SECRET_MASK, urlHint: 'https://hooks.slack.com/…', insecure: false, headers: { 'X-Token': SECRET_MASK } });
    expect(JSON.stringify(created)).not.toContain('SECRET');
  });

  test('an update that sends the masks back keeps the stored secrets', async () => {
    const existing = channel({ config: { url: encryption.encrypt('https://h.io/x/SECRET'), urlHint: 'https://h.io/…', headers: { 'X-Token': encryption.encrypt('abc') } } });
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(existing);
    await channels.update('c1', { name: 'Renamed', config: { url: SECRET_MASK, headers: { 'X-Token': SECRET_MASK } } });
    const data = mockPrisma.notificationChannel.update.mock.calls[0][0].data;
    expect(data.config.url).toBe(existing.config.url);
    expect(data.config.headers['X-Token']).toBe(existing.config.headers['X-Token']);
    expect(data.name).toBe('Renamed');
  });

  test('an update that leaves config out keeps it as is', async () => {
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(channel());
    await channels.update('c1', { enabled: false });
    expect(mockPrisma.notificationChannel.update.mock.calls[0][0].data).toEqual({ enabled: false });
  });

  test.each([
    [{ type: 'webhook', name: 'x', config: { url: 'ftp://h.io/x' } }, /must start with https/],
    [{ type: 'webhook', name: 'x', config: { url: 'not a url' } }, /not a valid URL/],
    [{ type: 'webhook', name: 'x', config: {} }, /URL is required/],
    [{ type: 'webhook', name: 'x', config: { url: 'https://h.io', headers: { 'Bad Header': 'v' } } }, /not a valid header name/],
    [{ type: 'email', name: 'x', config: { recipients: [] } }, /at least one email/],
    [{ type: 'email', name: 'x', config: { recipients: ['nope'] } }, /not an email address/],
    [{ type: 'sms', name: 'x', config: {} }, /type must be one of/],
    [{ type: 'email', name: '', config: { recipients: ['a@x.io'] } }, /name is required/],
    [{ type: 'email', name: 'x', minSeverity: 'loud', config: { recipients: ['a@x.io'] } }, /minSeverity/],
    [{ type: 'email', name: 'x', rules: ['no.such-rule'], config: { recipients: ['a@x.io'] } }, /Unknown alert rule/],
  ])('rejects %j', async (data, message) => {
    await expect(channels.create('u1', data)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(message) });
  });

  test('email recipients are trimmed, lowercased and deduplicated', async () => {
    await channels.create('u1', { name: 'x', type: 'email', config: { recipients: [' Ops@Example.com ', 'ops@example.com'] } });
    expect(mockPrisma.notificationChannel.create.mock.calls[0][0].data.config).toEqual({ recipients: ['ops@example.com'] });
  });
});

describe('delivery', () => {
  test('a webhook gets the payload with decrypted headers; success is recorded', async () => {
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(channel({ config: {
      url: encryption.encrypt('https://hooks.example.com/x'), urlHint: '', headers: { 'X-Token': encryption.encrypt('abc') },
    } }));
    axios.post.mockResolvedValue({ status: 200 });
    await channels.deliver({ channelId: 'c1', event: 'opened', alert: alert() });
    expect(axios.post).toHaveBeenCalledWith('https://hooks.example.com/x',
      expect.objectContaining({ event: 'alert.opened', text: expect.stringContaining('sw1 is offline') }),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Token': 'abc' }), timeout: 5000 }));
    expect(mockPrisma.notificationChannel.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastDeliveryStatus: 'success', lastDeliveryError: null }),
    }));
  });

  test('a failure is retried silently and recorded on the last attempt, without the URL', async () => {
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(channel());
    axios.post.mockRejectedValue(Object.assign(new Error('Request failed https://hooks.example.com/services/SECRET'), { response: { status: 404 } }));

    await expect(channels.deliver({ channelId: 'c1', event: 'opened', alert: alert() }, { finalAttempt: false }))
      .rejects.toThrow('The webhook answered HTTP 404');
    expect(mockPrisma.notificationChannel.update).not.toHaveBeenCalled();

    await expect(channels.deliver({ channelId: 'c1', event: 'opened', alert: alert() }, { finalAttempt: true }))
      .rejects.toThrow('The webhook answered HTTP 404');
    const data = mockPrisma.notificationChannel.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ lastDeliveryStatus: 'failed', lastDeliveryError: 'The webhook answered HTTP 404' });
    expect(data.lastDeliveryError).not.toContain('SECRET');
  });

  test('a deleted or disabled channel is skipped', async () => {
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(null);
    await expect(channels.deliver({ channelId: 'gone', event: 'opened', alert: alert() })).resolves.toEqual({ skipped: true });
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(channel({ enabled: false }));
    await expect(channels.deliver({ channelId: 'c1', event: 'opened', alert: alert() })).resolves.toEqual({ skipped: true });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('an email channel without SMTP fails with a clear reason', async () => {
    const before = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(channel({ type: 'email', config: { recipients: ['a@x.io'] } }));
    try {
      await expect(channels.test('c1')).resolves.toEqual({ success: false, error: expect.stringMatching(/SMTP_HOST/) });
    } finally {
      if (before !== undefined) process.env.SMTP_HOST = before;
    }
  });

  test('the job marks only its last attempt final', async () => {
    let processor;
    notificationJob({ process: (name, fn) => { processor = fn; } });
    const spy = jest.spyOn(channels, 'deliver').mockResolvedValue({ delivered: true });
    await processor({ data: { channelId: 'c1' }, opts: { attempts: 3 }, attemptsMade: 0 });
    await processor({ data: { channelId: 'c1' }, opts: { attempts: 3 }, attemptsMade: 2 });
    expect(spy.mock.calls.map(([, opts]) => opts.finalAttempt)).toEqual([false, true]);
    spy.mockRestore();
  });

  test('email goes through SMTP; a relay without SMTP_USER gets no login', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { SMTP_HOST: 'relay.local', SMTP_PORT: '25', SMTP_FROM: 'nh@x.io' });
    delete process.env.SMTP_USER;
    notifier.transport = null;
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(channel({ type: 'email', config: { recipients: ['a@x.io', 'b@x.io'] } }));
    try {
      await channels.deliver({ channelId: 'c1', event: 'opened', alert: alert() });
      expect(nodemailer.createTransport).toHaveBeenCalledWith({ host: 'relay.local', port: 25, secure: false });
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: 'nh@x.io', to: 'a@x.io, b@x.io', subject: '[CRITICAL] sw1 is offline',
      }));
    } finally {
      process.env = saved;
      notifier.transport = null;
    }
  });

  test('emailConfigured needs only SMTP_HOST', () => {
    const before = process.env.SMTP_HOST;
    process.env.SMTP_HOST = 'relay.local';
    expect(notifier.emailConfigured()).toBe(true);
    delete process.env.SMTP_HOST;
    expect(notifier.emailConfigured()).toBe(false);
    if (before !== undefined) process.env.SMTP_HOST = before;
  });
});

describe('message format', () => {
  test('opened: severity in the subject, details and a link in the text', () => {
    const { subject, text, payload } = formatAlert('opened', alert(), 'https://nh.example.com');
    expect(subject).toBe('[CRITICAL] sw1 is offline');
    expect(text).toContain('Device: sw1');
    expect(text).toContain('Rule: Device offline (ping)');
    expect(text).toContain('https://nh.example.com/alerts');
    expect(payload).toMatchObject({
      event: 'alert.opened',
      alert: { id: 'a1', rule: 'device.offline', ruleLabel: 'Device offline (ping)', severity: 'critical', device: { id: 'd1', name: 'sw1' }, url: 'https://nh.example.com/alerts' },
    });
    expect(payload.text).toContain('[CRITICAL] sw1 is offline');
  });

  test('resolved and test subjects; no link without a base URL', () => {
    expect(formatAlert('resolved', alert({ resolvedAt: new Date() }), '').subject).toBe('[Resolved] sw1 is offline');
    expect(formatAlert('test', alert(), '').subject).toBe('[Test] [CRITICAL] sw1 is offline');
    expect(formatAlert('opened', alert(), '').payload.alert.url).toBeNull();
  });

  test('the base URL falls back from APP_BASE_URL to CORS_ORIGINS', () => {
    expect(appBaseUrl({ APP_BASE_URL: 'https://a.io/', CORS_ORIGINS: 'https://b.io' })).toBe('https://a.io');
    expect(appBaseUrl({ CORS_ORIGINS: 'https://b.io,https://c.io' })).toBe('https://b.io');
    expect(appBaseUrl({})).toBe('');
  });
});

describe('cloud alarms', () => {
  const cloudAlarm = (over = {}) => ({
    id: 'ca1', externalId: 'x1', integrationId: 'int-c', integrationName: 'Home Network', provider: 'aruba_central',
    type: 'Port Flap', name: 'Port Flap', severity: 'warning', status: 'active', summary: 'Port 1/1/7 flapped 52 times in 10 minutes',
    siteName: 'HQ', device: { id: 'd1', name: 'sw1' }, count: 1, raisedAt: '2026-10-25T10:00:00.000Z', clearedAt: null, clearedReason: null, ...over,
  });

  test.each([
    ['off by default', channel(), cloudAlarm(), false],
    ['opted in, any name', channel({ cloudAlarms: true }), cloudAlarm(), true],
    ['below the minimum severity', channel({ cloudAlarms: true, minSeverity: 'critical' }), cloudAlarm(), false],
    ['a disabled channel', channel({ cloudAlarms: true, enabled: false }), cloudAlarm(), false],
    ['named, any spelling', channel({ cloudAlarms: true, cloudAlarmNames: ['port_flap'] }), cloudAlarm(), true],
    ['Mist type by its display name', channel({ cloudAlarms: true, cloudAlarmNames: ['Port Flap'] }), cloudAlarm({ name: 'Port flap', type: 'port_flap' }), true],
    ['another name', channel({ cloudAlarms: true, cloudAlarmNames: ['IPsec SA Down'] }), cloudAlarm(), false],
  ])('which channels take one: %s', (_label, ch, a, expected) => {
    expect(channelTakesCloudAlarm(ch, a)).toBe(expected);
  });

  test('queues a delivery per channel that takes it, following the mirror\'s events once started', async () => {
    mockPrisma.notificationChannel.findMany.mockResolvedValue([channel({ id: 'c1', cloudAlarms: true }), channel({ id: 'c2' })]);
    channels.start();
    try {
      cloudAlarmService.events.emit('raised', cloudAlarm());
      await new Promise((r) => setImmediate(r));
    } finally {
      channels.stop();
    }
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith('deliver', { channelId: 'c1', event: 'raised', cloudAlarm: cloudAlarm() }, expect.objectContaining({ attempts: 3 }));
  });

  test('a webhook gets the cloud alarm payload', async () => {
    mockPrisma.notificationChannel.findUnique.mockResolvedValue(channel({ cloudAlarms: true }));
    axios.post.mockResolvedValue({ status: 200 });
    await channels.deliver({ channelId: 'c1', event: 'raised', cloudAlarm: cloudAlarm() });
    const [, payload] = axios.post.mock.calls[0];
    expect(payload).toMatchObject({ event: 'cloud-alarm.raised', cloudAlarm: { name: 'Port Flap', device: { id: 'd1', name: 'sw1' } } });
    expect(payload.text).toMatch(/^\[WARNING\] Home Network: Port Flap on sw1/);
  });

  test('message format: raised, cleared by timer, site-level', () => {
    const raised = formatCloudAlarm('raised', cloudAlarm(), 'https://nh.example');
    expect(raised.subject).toBe('[WARNING] Home Network: Port Flap on sw1');
    expect(raised.text).toContain('Port 1/1/7 flapped 52 times in 10 minutes');
    expect(raised.text).toContain('acknowledge or clear it there');
    expect(raised.text).toContain('https://nh.example/activity?categories=cloud-alarm&deviceId=d1');

    const cleared = formatCloudAlarm('cleared', cloudAlarm({
      status: 'cleared', clearedAt: '2026-10-25T10:20:00.000Z', clearedReason: 'Due to clear alert timer configuration', device: null,
    }), '');
    expect(cleared.subject).toBe('[Cleared] Home Network: Port Flap at HQ');
    expect(cleared.text).toContain('the problem may not be fixed');
    expect(cleared.text).not.toContain('http');
  });

  test('cloudAlarmNames are trimmed and deduplicated; a non-list is refused', async () => {
    const row = await channels.create('u1', {
      name: 'Ops', type: 'email', config: { recipients: ['a@x.io'] }, cloudAlarms: true, cloudAlarmNames: [' Port Flap ', 'Port Flap', ''],
    });
    expect(row).toMatchObject({ cloudAlarms: true, cloudAlarmNames: ['Port Flap'] });
    await expect(channels.create('u1', { name: 'x', type: 'email', config: { recipients: ['a@x.io'] }, cloudAlarmNames: 'Port Flap' }))
      .rejects.toThrow('cloudAlarmNames must be a list');
  });

  test('name suggestions: seen ones plus well-known ones not seen yet', async () => {
    mockPrisma.cloudAlarm = { findMany: jest.fn(async () => [{ provider: 'aruba_central', name: 'IPsec SA Down' }, { provider: 'aruba_central', name: 'Port Flap' }]) };
    try {
      expect(await channels.cloudAlarmNames()).toEqual([
        { provider: 'aruba_central', name: 'IPsec SA Down' },
        { provider: 'aruba_central', name: 'Port Flap' },
        { provider: 'juniper_mist', name: 'Port flap' },
      ]);
    } finally {
      delete mockPrisma.cloudAlarm;
    }
  });
});
