/**
 * Port Identity collector (services/ports/port-client.service.js): one run
 * over live-captured tables, with Prisma, the CX session and the cloud
 * provider mocked.
 */
const swStudioMacs = require('../fixtures/aos-cx-live/port-clients/sw-studio-macs.json');
const swStudioArp = require('../fixtures/aos-cx-live/port-clients/sw-studio-arp.json');
const swStudioIfaces = require('../fixtures/aos-cx-live/port-clients/sw-studio-interfaces.json');
const centralClients = require('../fixtures/central-live/clients.json');
const { Prisma } = require('@prisma/client');

const serialOf = (name) => centralClients.items.find((i) => i.connectedTo === name).connectedDeviceSerial;

const mockPrisma = {
  device: { findMany: jest.fn() },
  deviceLink: { findMany: jest.fn(async () => []) },
  portNote: { findMany: jest.fn(async () => []) },
  portClient: {
    findMany: jest.fn(async () => []), update: jest.fn(async () => ({})), updateMany: jest.fn(), createMany: jest.fn(),
  },
  portReadState: { upsert: jest.fn(async () => ({})), deleteMany: jest.fn(async () => ({ count: 0 })) },
  $executeRaw: jest.fn(async () => 0),
};
mockPrisma.$transaction = jest.fn(async (fn) => fn(mockPrisma));

const mockCx = { getClientTables: jest.fn() };
const mockProvider = {
  integration: { id: 'int-central' },
  label: 'Aruba Central',
  supports: (c) => c === 'wired-clients',
  listWiredClients: jest.fn(),
};

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/settings.service', () => ({
  getDeviceCredentialsForUse: jest.fn(async (id) => (id === 'no-cred' ? null : { username: 'u', password: 'p' })),
}));
jest.mock('../../src/services/device-poller.service', () => ({
  withCxSession: jest.fn(async (device, creds, fn) => fn(mockCx)),
}));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({
  forDevice: jest.fn(async () => mockProvider),
}));
jest.mock('../../src/services/discovery.service', () => ({ lookupVendor: () => null }));

const { parseCentralWiredClients } = require('../../src/services/ports/parsers/cloud-clients');
const devicePoller = require('../../src/services/device-poller.service');
const deviceEvents = require('../../src/services/device-events.service');
const service = require('../../src/services/ports/port-client.service');

const studio = {
  id: 'd-studio', name: 'Sw-Studio', type: 'switch', vendor: 'aruba', platform: 'aos-cx', model: 'CX-6200F',
  managementMode: 'cloud', ipAddress: '10.0.0.2', serial: serialOf('Sw-Studio'), macAddress: null,
};
const mgmt = {
  id: 'no-cred', name: 'Sw-Mgmt', type: 'switch', vendor: 'aruba', platform: 'aos-s', model: 'AS-2930F',
  managementMode: 'cloud', ipAddress: '10.0.0.3', serial: serialOf('Sw-Mgmt'), macAddress: null,
};
const directAosS = {
  id: 'd-aoss', name: 'Lab-2930', type: 'switch', vendor: 'aruba', platform: 'aos-s', managementMode: 'direct', ipAddress: '10.0.0.4',
};

function setDevices(switches) {
  mockPrisma.device.findMany.mockImplementation(async ({ where }) => (where.type === 'switch' ? switches : []));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCx.getClientTables.mockResolvedValue({ interfaces: swStudioIfaces, macs: swStudioMacs, arp: swStudioArp });
  mockProvider.listWiredClients.mockImplementation(async () => parseCentralWiredClients(centralClients.items, new Date()));
});

describe('collectAll', () => {
  it('reads AOS-CX over REST, a Central-only switch from the cloud, and skips what has no source', async () => {
    setDevices([studio, mgmt, directAosS]);
    const summary = await service.collectAll({ trigger: 'manual' });

    expect(summary).toMatchObject({ total: 3, ok: 2, skipped: 1, failed: 0 });
    expect(summary.results.find((r) => r.name === 'Lab-2930')).toMatchObject({ status: 'unsupported' });
    // One cloud read for the run, shared by both cloud-managed switches.
    expect(mockProvider.listWiredClients).toHaveBeenCalledTimes(1);

    const created = mockPrisma.portClient.createMany.mock.calls.map(([a]) => a.data);
    const studioRows = created.find((rows) => rows[0].deviceId === 'd-studio');
    // The 56-MAC uplink keeps a count; the phone, the PC behind it and one more client are stored.
    expect(studioRows.map((r) => r.port).sort()).toEqual(['1/1/1', '1/1/4', '1/1/4']);
    expect(studioRows.every((r) => r.state === 'present' && r.sources.includes('mac-table'))).toBe(true);
    // Nullable JSON columns are written as SQL NULL, never JSON null.
    expect(created.flat().some((r) => r.lldp === null || r.profile === null || r.goneDetail === null)).toBe(false);
    expect(studioRows.filter((r) => r.lldp === Prisma.DbNull).length).toBeGreaterThan(0);

    const mgmtRows = created.find((rows) => rows[0].deviceId === 'no-cred');
    const connected = centralClients.items.filter((i) => i.connectedTo === 'Sw-Mgmt' && i.type === 'Wired' && i.status === 'Connected');
    expect(mgmtRows).toHaveLength(connected.length);
    expect(mgmtRows.every((r) => r.sources.includes('cloud-wired') && r.profile?.source === 'Aruba Central')).toBe(true);

    const states = mockPrisma.portReadState.upsert.mock.calls.map(([a]) => a.create);
    expect(states).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceId: 'd-studio', source: 'device-rest', error: null }),
      expect.objectContaining({ deviceId: 'no-cred', source: 'cloud', error: null }),
    ]));
    expect(states.find((s) => s.deviceId === 'd-studio').portSummary['1/1/13']).toMatchObject({ uplink: true, macCount: 56 });
  });

  it('a failed switch read with no cloud records the failure and changes no sighting', async () => {
    const direct = { ...studio, id: 'd-direct', managementMode: 'direct' };
    setDevices([direct]);
    devicePoller.withCxSession.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));
    const summary = await service.collectAll();

    expect(summary).toMatchObject({ ok: 0, failed: 1 });
    expect(mockPrisma.portClient.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.portClient.update).not.toHaveBeenCalled();
    expect(mockPrisma.portReadState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ deviceId: 'd-direct', source: 'device-rest', error: expect.stringContaining('ETIMEDOUT') }),
      update: expect.not.objectContaining({ lastSuccessAt: expect.anything() }),
    }));
  });

  it('a failed switch read falls back to the cloud and says the device read failed', async () => {
    setDevices([studio]);
    devicePoller.withCxSession.mockRejectedValueOnce(new Error('401 Unauthorized'));
    const summary = await service.collectAll();

    expect(summary.results[0]).toMatchObject({ status: 'ok', source: 'Aruba Central' });
    const sources = mockPrisma.portReadState.upsert.mock.calls.map(([a]) => [a.create.source, a.create.error]);
    expect(sources).toEqual(expect.arrayContaining([['cloud', null], ['device-rest', '401 Unauthorized']]));
  });

  it('ends a sighting on another port when the MAC is now present on exactly one edge port', async () => {
    setDevices([{ ...studio, managementMode: 'direct' }]);
    const phoneMac = Object.values(swStudioMacs['18']).find((e) => e.port['1/1/4']).mac_addr.toLowerCase();
    mockPrisma.portClient.findMany.mockImplementation(async ({ where }) => (where.mac
      ? [{ id: 'old', deviceId: 'd-other', port: '1/1/9', mac: phoneMac, state: 'present' }]
      : []));
    const summary = await service.collectAll();

    expect(summary.moved).toBe(1);
    expect(mockPrisma.portClient.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: expect.objectContaining({ state: 'gone', goneReason: 'moved', goneDetail: { deviceId: 'd-studio', port: '1/1/4' } }),
    });
  });
});

describe('read failures are filed under the source that failed', () => {
  // A Central-managed CX switch with no linked credential: only its cloud is tried.
  const noCredCx = { ...studio, id: 'no-cred', name: 'Lab-Edge2' };

  it('a cloud failure on a switch whose REST read was never tried is a cloud error, not a device one', async () => {
    setDevices([noCredCx]);
    mockProvider.listWiredClients.mockRejectedValueOnce(new Error('Unable to connect to Aruba Central'));
    const summary = await service.collectAll();

    expect(summary).toMatchObject({ ok: 0, failed: 1 });
    const filed = mockPrisma.portReadState.upsert.mock.calls.map(([a]) => [a.create.source, a.create.error]);
    expect(filed).toEqual([['cloud', 'Unable to connect to Aruba Central']]);
    // A device-rest row that never succeeded (the old misfiled error) goes away.
    expect(mockPrisma.portReadState.deleteMany).toHaveBeenCalledWith({
      where: { deviceId: 'no-cred', source: { in: ['device-rest'] }, lastSuccessAt: null },
    });
  });

  it('a cloud failure is recorded even when the switch itself was read', async () => {
    setDevices([studio]);
    mockProvider.listWiredClients.mockRejectedValueOnce(new Error('Central 503'));
    const summary = await service.collectAll();

    expect(summary.results[0]).toMatchObject({ status: 'ok', source: 'AOS-CX REST' });
    const filed = mockPrisma.portReadState.upsert.mock.calls.map(([a]) => [a.create.source, a.create.error]);
    expect(filed).toEqual(expect.arrayContaining([['device-rest', null], ['cloud', 'Central 503']]));
  });

  it('a switch with nothing to read records no failure', async () => {
    setDevices([directAosS, { ...studio, id: 'no-cred', managementMode: 'direct' }]);
    const summary = await service.collectAll();

    expect(summary).toMatchObject({ ok: 0, failed: 0, skipped: 2 });
    expect(mockPrisma.portReadState.upsert).not.toHaveBeenCalled();
  });
});

describe('clientSourcePlan', () => {
  const { clientSourcePlan } = service;
  it('says a platform with no reader is unsupported', () => {
    expect(clientSourcePlan({ ...directAosS, platform: 'junos', vendor: 'juniper' })).toEqual({ supported: false, platform: 'junos', sources: [] });
    expect(clientSourcePlan({ ...directAosS, platform: 'ios-xe', vendor: 'cisco' })).toMatchObject({ supported: false });
  });

  it('names what an AOS-CX switch needs before its own tables can be read', () => {
    const plan = clientSourcePlan({ ...studio, managementMode: 'direct' }, { hasCredential: false });
    expect(plan).toEqual({
      supported: true,
      platform: 'aos-cx',
      sources: [{ source: 'device-rest', ready: false, note: 'needs an IP address and a linked device credential' }],
    });
    expect(clientSourcePlan({ ...studio, managementMode: 'direct' }, { hasCredential: true }).sources[0].ready).toBe(true);
  });

  it('a cloud-managed switch also has its cloud; one without an IP has only the cloud', () => {
    expect(clientSourcePlan(studio, { hasCredential: true }).sources.map((x) => x.source)).toEqual(['device-rest', 'cloud']);
    expect(clientSourcePlan({ ...studio, ipAddress: null }).sources).toEqual([{ source: 'cloud', ready: true, note: null }]);
  });
});

describe('link-down events', () => {
  it('end the port sightings between runs', async () => {
    service.start();
    mockPrisma.portClient.findMany.mockResolvedValue([{ id: 'r1', deviceId: 'd-studio', port: '1/1/4', state: 'present' }]);
    deviceEvents.events.emit('recorded', {
      deviceId: 'd-studio', type: 'port.link.down', port: '1/1/4', occurredAt: '2026-11-10T02:00:00Z',
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockPrisma.portClient.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: expect.objectContaining({ state: 'gone', goneReason: 'link-down' }),
    });
  });

  it('ignore other events', async () => {
    service.start();
    deviceEvents.events.emit('recorded', { deviceId: 'd-studio', type: 'port.link.up', port: '1/1/4' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockPrisma.portClient.update).not.toHaveBeenCalled();
  });
});
