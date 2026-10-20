/**
 * Cloud event streams: the Mist stream parser over a live capture
 * (2026-10-19, anonymised), the stream client against a local WebSocket
 * server, and cloud-stream.service's triggers, events and reconnects.
 */
jest.mock('../../src/config/redis', () => ({ getRedis: jest.fn() }));
const mockPrisma = { device: { findMany: jest.fn(async () => []) } };
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/cloud-status.service', () => ({
  refreshProvider: jest.fn(async () => ({ statusChanges: 0 })),
}));
jest.mock('../../src/services/device-events.service', () => ({ record: jest.fn(async () => ({})) }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ activeProviders: jest.fn(async () => []) }));

const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');
const cloudStatus = require('../../src/services/cloud-status.service');
const deviceEvents = require('../../src/services/device-events.service');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const MistProvider = require('../../src/services/cloud-providers/mist.provider');
const ArubaCentralProvider = require('../../src/services/cloud-providers/aruba-central.provider');
const { CapabilityError } = require('../../src/services/cloud-providers/errors');
const {
  MistStream, parseStreamStats, mergeStreamState, streamEvents,
} = require('../../src/services/cloud/mist-stream');
const { CloudStreamService, IntegrationStream } = require('../../src/services/cloud/cloud-stream.service');
const { normalizeMac } = require('../../src/utils/device-key');

// One site: an EX4000 (one message a minute) and an AP33 (two: port stats, then uptime).
const capture = require('../fixtures/mist-live/stream-stats-devices.json');
const messages = capture.filter((m) => m.event === 'data').map((m) => m.data);
const switchStats = messages.find((d) => d.type === 'switch');
const apStats = messages.find((d) => d.type === 'ap');
const apBasic = messages.find((d) => !d.type && d.uptime !== undefined);

describe('Mist stream parser (live capture)', () => {
  test('a switch message names the device by MAC and serial, with uptime and physical ports only', () => {
    const update = parseStreamStats(switchStats);
    expect(update).toMatchObject({ mac: normalizeMac(switchStats.mac), serial: switchStats.serial, ttlMs: 190000, uptime: switchStats.uptime });
    expect(update.ports['mge-0/0/0']).toEqual({ up: true, speedMbps: null });
    expect(Object.keys(update.ports).every((p) => /^(ge|mge|xe|et)-|^ae/.test(p))).toBe(true);
    expect(update.ports).not.toHaveProperty('irb');
  });

  test("an AP's two messages: port stats without uptime, then uptime without ports, neither with a serial", () => {
    expect(parseStreamStats(apStats)).toEqual({
      mac: normalizeMac(apStats.mac), serial: null, name: 'JNAP-01', ttlMs: 190000,
      ports: { eth0: { up: true, speedMbps: 2500 }, eth1: { up: false, speedMbps: null } },
    });
    const basic = parseStreamStats(apBasic);
    expect(basic).toMatchObject({ mac: normalizeMac(apStats.mac), uptime: apBasic.uptime });
    expect(basic).not.toHaveProperty('ports');
  });

  test('no message carries a status, so the stream cannot say a device went offline', () => {
    expect(messages.some((d) => 'status' in d)).toBe(false);
  });

  test('a message with no MAC is not a device', () => {
    expect(parseStreamStats({ name: 'x' })).toBeNull();
    expect(parseStreamStats(null)).toBeNull();
  });
});

describe('stream events', () => {
  const ap = mergeStreamState(mergeStreamState(null, parseStreamStats(apStats)), parseStreamStats(apBasic));

  test('the first message is a baseline; partial messages keep what the other carried', () => {
    expect(streamEvents(null, parseStreamStats(apStats))).toEqual([]);
    expect(ap).toMatchObject({ uptime: apBasic.uptime, ports: { eth0: { up: true } } });
    expect(streamEvents(ap, parseStreamStats(apBasic))).toEqual([]);
  });

  test('a port changing state is a link event, with the speed when it comes up', () => {
    const down = { ...apStats, port_stat: { ...apStats.port_stat, eth0: { ...apStats.port_stat.eth0, up: false, speed: 0 } } };
    expect(streamEvents(ap, parseStreamStats(down))).toEqual([{ type: 'port.link.down', port: 'eth0', data: {} }]);
    const afterDown = mergeStreamState(ap, parseStreamStats(down));
    expect(streamEvents(afterDown, parseStreamStats(apStats))).toEqual([{ type: 'port.link.up', port: 'eth0', data: { speedMbps: 2500 } }]);
  });

  test('uptime going backwards is a restart; a few seconds of jitter is not', () => {
    expect(streamEvents(ap, { ...parseStreamStats(apBasic), uptime: 42 })).toEqual([
      { type: 'device.restarted', port: null, data: { uptimeSec: 42 } },
    ]);
    expect(streamEvents(ap, { ...parseStreamStats(apBasic), uptime: apBasic.uptime - 5 })).toEqual([]);
  });

  test('a switch port that drops is seen through its logical units', () => {
    const sw = mergeStreamState(null, parseStreamStats(switchStats));
    const ifStat = { ...switchStats.if_stat, 'mge-0/0/0.0': { ...switchStats.if_stat['mge-0/0/0.0'], up: false } };
    expect(streamEvents(sw, parseStreamStats({ ...switchStats, if_stat: ifStat }))).toEqual([
      { type: 'port.link.down', port: 'mge-0/0/0', data: {} },
    ]);
  });
});

describe('Mist stream URL and capability', () => {
  const mist = (baseUrl) => new MistProvider({
    id: 'int-mist', provider: 'juniper_mist', name: 'My Mist', baseUrl, credentials: { apiToken: 't', orgId: 'o' },
  });

  test('each regional API host has its stream on api-ws', () => {
    expect(mist('https://api.ac2.mist.com').streamUrl).toBe('wss://api-ws.ac2.mist.com/api-ws/v1/stream');
    expect(mist('https://api.mist.com').streamUrl).toBe('wss://api-ws.mist.com/api-ws/v1/stream');
    expect(mist('https://api.mist.com').supports('events')).toBe(true);
  });

  test('a base URL that is not a Mist API host has no stream', () => {
    expect(mist('https://mist.example.com').streamUrl).toBeNull();
    expect(mist('http://api.mist.com').streamUrl).toBeNull();
    expect(() => mist('https://mist.example.com').openEventStream([])).toThrow(CapabilityError);
  });

  test('the channels are device stats per site', async () => {
    const provider = mist('https://api.ac2.mist.com');
    provider.requestAllPages = jest.fn(async () => [{ id: 's1', name: 'HQ' }, { id: 's2', name: 'Lab' }]);
    await expect(provider.listEventChannels()).resolves.toEqual(['/sites/s1/stats/devices', '/sites/s2/stats/devices']);
  });

  test('Central has no stream', () => {
    const central = new ArubaCentralProvider({
      id: 'int-c', provider: 'aruba_central', name: 'Home Network', baseUrl: 'https://us4.api.central.arubanetworks.com', credentials: { clientId: 'c', clientSecret: 's' },
    });
    expect(central.supports('events')).toBe(false);
    expect(() => central.openEventStream([])).toThrow(CapabilityError);
  });
});

describe('MistStream client (local server)', () => {
  let server;
  let url;
  const seen = { headers: null, sent: [] };

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise((resolve) => server.on('listening', resolve));
    url = `ws://127.0.0.1:${server.address().port}`;
    server.on('connection', (socket, req) => {
      seen.headers = req.headers;
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        seen.sent.push(message);
        if (!message.subscribe) return;
        socket.send(JSON.stringify({ event: 'channel_subscribed', channel: message.subscribe }));
        // As Mist sends it: data is a JSON string.
        socket.send(JSON.stringify({ event: 'data', channel: message.subscribe, data: JSON.stringify(switchStats) }));
      });
    });
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('sends the token, subscribes, and hands over parsed data; only subscribe messages go out', async () => {
    seen.sent = [];
    const stream = new MistStream({ url, headers: { Authorization: 'Token abc' }, channels: ['/sites/s1/stats/devices'] });
    const subscribed = new Promise((resolve) => stream.once('subscribed', resolve));
    const data = new Promise((resolve) => stream.once('data', resolve));
    stream.open();

    await expect(subscribed).resolves.toBe('/sites/s1/stats/devices');
    await expect(data).resolves.toEqual({ channel: '/sites/s1/stats/devices', data: switchStats });
    expect(seen.headers.authorization).toBe('Token abc');
    expect(seen.sent).toEqual([{ subscribe: '/sites/s1/stats/devices' }]);

    const closed = new Promise((resolve) => stream.once('close', resolve));
    stream.close();
    await expect(closed).resolves.toMatchObject({ code: 1000 });
  });

  test('a dropped connection is reported with its error', async () => {
    const stream = new MistStream({ url: 'ws://127.0.0.1:1', headers: {} });
    const closed = new Promise((resolve) => stream.once('close', resolve));
    stream.open();
    await expect(closed).resolves.toMatchObject({ error: expect.objectContaining({ code: 'ECONNREFUSED' }) });
  });
});

describe('cloud-stream.service', () => {
  const ap = { id: 'd-ap', name: 'JNAP-01', serial: 'SNAP', macAddress: apStats.mac.match(/../g).join(':'), cloudStatus: 'online' };
  const ex = { id: 'd-ex', name: 'JNEX-01', serial: switchStats.serial, macAddress: null, cloudStatus: 'online' };

  function fakeProvider(id = 'int-mist', integration = {}) {
    const streams = [];
    const provider = {
      id,
      label: 'My Mist (juniper_mist)',
      integration: { baseUrl: 'https://api.ac2.mist.com', updatedAt: new Date('2026-10-19T00:00:00Z'), ...integration },
      supports: (capability) => capability === 'events',
      listEventChannels: jest.fn(async () => ['/sites/s1/stats/devices']),
      openEventStream: jest.fn((channels) => {
        const stream = new EventEmitter();
        stream.channels = new Set(channels);
        stream.isOpen = false;
        stream.open = jest.fn(() => { stream.isOpen = true; });
        stream.close = jest.fn(() => { stream.isOpen = false; });
        stream.subscribe = jest.fn((c) => stream.channels.add(c));
        stream.unsubscribe = jest.fn((c) => stream.channels.delete(c));
        streams.push(stream);
        return stream;
      }),
      streams,
    };
    return provider;
  }

  async function connected(devices = [ap, ex]) {
    // Fresh rows per read, as the database would return.
    mockPrisma.device.findMany.mockImplementation(async () => devices.map((d) => ({ ...d })));
    const provider = fakeProvider();
    const stream = new IntegrationStream(provider);
    await stream.start();
    provider.streams[0].emit('open');
    await Promise.resolve();
    return { provider, stream, wire: provider.streams[0] };
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('every connect resyncs through the status refresh', async () => {
    const { provider } = await connected();
    expect(mockPrisma.device.findMany.mock.calls[0][0].where).toEqual({ cloudIntegrationId: 'int-mist', managementMode: 'cloud' });
    expect(cloudStatus.refreshProvider).toHaveBeenCalledWith(provider);
  });

  test('an online device reporting costs nothing; one held offline asks for a refresh', async () => {
    const { stream, wire } = await connected([ap, { ...ex, cloudStatus: 'offline' }]);
    await flush();
    cloudStatus.refreshProvider.mockClear();
    stream.refresh.lastAt = 0; // past the minimum gap

    wire.emit('data', { data: apStats });
    await flush();
    expect(cloudStatus.refreshProvider).not.toHaveBeenCalled();

    wire.emit('data', { data: switchStats });
    await flush();
    expect(cloudStatus.refreshProvider).toHaveBeenCalledTimes(1);
  });

  test('refreshes are spaced out: a burst of reports in the gap is one later refresh', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const { stream, wire } = await connected([{ ...ap, cloudStatus: 'offline' }, { ...ex, cloudStatus: 'offline' }]);
    await flush();
    expect(cloudStatus.refreshProvider).toHaveBeenCalledTimes(1); // the connect resync

    wire.emit('data', { data: apStats });
    wire.emit('data', { data: switchStats });
    wire.emit('data', { data: apBasic });
    await flush();
    expect(cloudStatus.refreshProvider).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30000);
    await flush();
    expect(cloudStatus.refreshProvider).toHaveBeenCalledTimes(2);
    stream.stop();
  });

  test('a port change becomes a cloud event; a device not synced yet is ignored', async () => {
    const { wire } = await connected();
    wire.emit('data', { data: apStats });
    await flush();
    const down = { ...apStats, port_stat: { ...apStats.port_stat, eth0: { ...apStats.port_stat.eth0, up: false } } };
    wire.emit('data', { data: down });
    wire.emit('data', { data: { ...down, mac: '000000000099' } });
    await flush();

    expect(deviceEvents.record).toHaveBeenCalledTimes(1);
    expect(deviceEvents.record).toHaveBeenCalledWith(expect.objectContaining({ id: 'd-ap' }), { type: 'port.link.down', port: 'eth0', data: {} }, 'cloud');
  });

  test('an online device whose report expired asks for a refresh; once the cloud says offline, silence asks nothing', async () => {
    const { stream, wire } = await connected();
    wire.emit('data', { data: switchStats });
    await flush();
    cloudStatus.refreshProvider.mockClear();
    stream.refresh.lastAt = 0;

    const sent = Date.now();
    stream.sweep(sent + 100000); // within 190 s + grace
    expect(cloudStatus.refreshProvider).not.toHaveBeenCalled();
    stream.sweep(sent + 230000);
    await flush();
    expect(cloudStatus.refreshProvider).toHaveBeenCalledTimes(1);

    // The refresh found it offline; a silent offline device asks nothing more.
    stream.devices.byId.get('d-ex').cloudStatus = 'offline';
    stream.refresh.lastAt = 0;
    stream.sweep(sent + 500000);
    await flush();
    expect(cloudStatus.refreshProvider).toHaveBeenCalledTimes(1);
  });

  test('a dropped stream reconnects with backoff and resyncs again', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const { provider, stream, wire } = await connected();
    wire.emit('close', { code: 1006, error: new Error('socket hang up') });
    expect(stream.status()).toMatchObject({ state: 'disconnected', lastError: 'socket hang up' });

    jest.advanceTimersByTime(6000); // first backoff is 5 s ± 20 %
    await flush();
    expect(provider.openEventStream).toHaveBeenCalledTimes(2);
    provider.streams[1].emit('open');
    expect(stream.status().state).toBe('connected');
    jest.advanceTimersByTime(30000); // the resync waits out the minimum gap
    await flush();
    expect(cloudStatus.refreshProvider).toHaveBeenCalledTimes(2);
    stream.stop();
    expect(provider.streams[1].close).toHaveBeenCalled();
  });

  test('reconcile opens new integrations, keeps unchanged ones, reconnects edited ones, closes removed ones', async () => {
    const service = new CloudStreamService();
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    CloudProviderFactory.activeProviders.mockResolvedValue([a, b, { id: 'c', supports: () => false }]);
    await service.reconcile();
    expect([...service.streams.keys()]).toEqual(['a', 'b']);

    const aEdited = fakeProvider('a', { updatedAt: new Date('2026-10-20T00:00:00Z') });
    CloudProviderFactory.activeProviders.mockResolvedValue([aEdited]);
    await service.reconcile();
    await flush();
    expect(b.streams[0].close).toHaveBeenCalled();
    expect(a.streams[0].close).toHaveBeenCalled();
    expect(aEdited.openEventStream).toHaveBeenCalled();
    expect([...service.streams.keys()]).toEqual(['a']);
    expect(service.status('a')).toMatchObject({ state: 'connecting' });
    expect(service.status('b')).toBeNull();
    service.stop();
  });
});
