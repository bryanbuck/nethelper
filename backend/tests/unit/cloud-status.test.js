/**
 * Cloud status refresh (services/cloud-status.service.js) between full syncs,
 * the providers' status reads over live captures, the cloud config-sync
 * alert, and the scheduled sync/refresh jobs.
 */
jest.mock('axios');
jest.mock('../../src/config/redis', () => ({ getRedis: jest.fn() }));
const mockPrisma = {
  device: { findMany: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
  deviceEvent: { create: jest.fn(async ({ data }) => ({ id: 'e1', occurredAt: new Date(), ...data })) },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/alert.service', () => ({ raise: jest.fn(), clear: jest.fn() }));
jest.mock('../../src/websocket/socket.handler', () => {
  const emit = jest.fn();
  return { getIO: () => ({ emit }), emit };
});
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({
  activeProviders: jest.fn(async () => []),
  ENV_ARUBA_INTEGRATION_ID: 'env-aruba-central',
}));

const axios = require('axios');
const alertService = require('../../src/services/alert.service');
const socket = require('../../src/websocket/socket.handler');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const MistProvider = require('../../src/services/cloud-providers/mist.provider');
const ArubaCentralProvider = require('../../src/services/cloud-providers/aruba-central.provider');
const deviceService = require('../../src/services/device.service');
const cloudStatus = require('../../src/services/cloud-status.service');
const { statusPatch } = require('../../src/services/cloud-status.service');
const deviceSyncJob = require('../../src/jobs/device-sync.job');

// Live captures (anonymised): the Mist org online, and a Central tenant with
// two switches Central reports "Out of sync".
const mistStatsOnline = require('../fixtures/mist-live/stats-devices-allfields-online.json');
const centralDevices = require('../fixtures/central-live/devices.json');

const row = (over = {}) => ({
  id: 'd1', name: 'JNEX-01', serial: 'SN000002', managementMode: 'cloud', pingStatus: null, cloudStatus: 'offline',
  ipAddress: '172.16.10.102', firmwareVersion: '24.4R2.25', lastSeen: null, cloudConnectionStatus: 'not_reachable',
  cloudManagedSource: 'cloud-config', metadata: { mistId: 'm-2', configStatus: 'NO_CHANGE' }, ...over,
});
const report = (over = {}) => ({
  status: 'online', lastSeen: new Date('2026-10-19T20:00:00Z'), ipAddress: '172.16.10.102', firmwareVersion: '24.4R2.25',
  cloudConnectionStatus: 'connected', configInSync: true, configStatus: 'NO_CHANGE', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  axios.mockReset();
});

describe('statusPatch', () => {
  test('nothing changed, nothing written', () => {
    expect(statusPatch(row({ cloudStatus: 'online', cloudConnectionStatus: 'connected' }), report())).toEqual({});
  });

  test('a status change writes the status, connection state and last seen', () => {
    expect(statusPatch(row(), report())).toEqual({
      cloudStatus: 'online', cloudConnectionStatus: 'connected', lastSeen: new Date('2026-10-19T20:00:00Z'),
    });
  });

  test("an online device's last seen alone is not a write (Central's is always now)", () => {
    expect(statusPatch(row({ cloudStatus: 'online', cloudConnectionStatus: 'connected' }), report({ lastSeen: new Date() }))).toEqual({});
  });

  test('a missing IP or firmware keeps the known one; the switch\'s own answer outranks the cloud', () => {
    const patch = statusPatch(
      row({ cloudStatus: 'online', cloudManagedSource: 'switch-rest', cloudConnectionStatus: 'connected' }),
      report({ ipAddress: null, firmwareVersion: null, cloudConnectionStatus: 'not_reachable' })
    );
    expect(patch).toEqual({});
  });

  test('a new config state is merged into metadata', () => {
    const patch = statusPatch(row({ cloudStatus: 'online', cloudConnectionStatus: 'connected' }), report({ configStatus: 'Out of sync' }));
    expect(patch).toEqual({ metadata: { mistId: 'm-2', configStatus: 'Out of sync' } });
  });
});

describe('provider status reads (live captures)', () => {
  test('Mist: one stats read, by serial', async () => {
    axios.mockResolvedValue({ data: mistStatsOnline });
    const provider = new MistProvider({
      id: 'int-mist', provider: 'juniper_mist', name: 'Buck Home', baseUrl: 'https://api.ac2.mist.com', credentials: { apiToken: 't', orgId: 'o' },
    });

    const statuses = await provider.listStatuses();

    expect(axios).toHaveBeenCalledTimes(1);
    expect(axios.mock.calls[0][0].params.fields.split(',')).toEqual(expect.arrayContaining(['serial', 'status', 'config_status']));
    expect(statuses.get('SN000002')).toMatchObject({
      status: 'online', ipAddress: '172.16.10.102', cloudConnectionStatus: 'connected', configInSync: true, configStatus: 'NO_CHANGE',
    });
    // An AP has no config_status: neither in nor out of sync.
    expect(statuses.get('SN000001')).toMatchObject({ status: 'online', configInSync: null });
  });

  test("Central: the inventory read; \"Out of sync\" is out of sync", async () => {
    const provider = new ArubaCentralProvider({
      id: 'int-c', provider: 'aruba_central', name: 'Home Network', baseUrl: 'https://us4.api.central.arubanetworks.com', credentials: { clientId: 'c', clientSecret: 's' },
    });
    provider.makeRequest = jest.fn(async () => centralDevices);

    const statuses = await provider.listStatuses();

    expect(statuses.get('SN000009')).toMatchObject({ status: 'online', configInSync: false, configStatus: 'Out of sync' });
    expect(statuses.get('SN000001')).toMatchObject({ status: 'online', configInSync: true });
  });
});

describe('refreshProvider', () => {
  const provider = (statuses) => ({ id: 'int-mist', label: 'Buck Home (juniper_mist)', providerType: 'juniper_mist', listStatuses: jest.fn(async () => statuses) });

  test('only devices that sync made and this integration owns are read, and nothing is created', async () => {
    mockPrisma.device.findMany.mockResolvedValue([]);
    await cloudStatus.refreshProvider(provider(new Map([['SN000002', report()]])));

    expect(mockPrisma.device.findMany.mock.calls[0][0].where).toEqual({
      cloudIntegrationId: 'int-mist', managementMode: 'cloud', serial: { in: ['SN000002'] },
    });
  });

  test('a device coming online is written, pushed with its displayed status, and clears its offline alert', async () => {
    mockPrisma.device.findMany.mockResolvedValue([row({ pingStatus: 'offline' })]);

    const summary = await cloudStatus.refreshProvider(provider(new Map([['SN000002', report()]])));

    expect(summary).toMatchObject({ devices: 1, updated: 1, statusChanges: 1 });
    expect(mockPrisma.device.updateMany).toHaveBeenCalledWith({ where: { id: 'd1', cloudStatus: 'offline' }, data: expect.objectContaining({ cloudStatus: 'online' }) });
    // Up in the cloud but failing ping: warning (utils/device-status.js).
    expect(socket.emit).toHaveBeenCalledWith('device:status:update', expect.objectContaining({
      deviceId: 'd1', status: 'warning', cloudStatus: 'online',
    }));
    expect(alertService.clear).toHaveBeenCalledWith('device.cloud-offline', { subjectKey: 'd1', deviceId: 'd1' });
  });

  test('a change from a known status is recorded as a cloud event; a first status is not', async () => {
    mockPrisma.device.findMany.mockResolvedValue([row(), row({ id: 'd2', name: 'JNAP-01', serial: 'SN000001', cloudStatus: null })]);

    await cloudStatus.refreshProvider(provider(new Map([['SN000002', report()], ['SN000001', report()]])));

    expect(mockPrisma.deviceEvent.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.deviceEvent.create).toHaveBeenCalledWith({ data: {
      deviceId: 'd1', type: 'cloud.online', port: null, data: { previous: 'offline', provider: 'juniper_mist' }, source: 'cloud',
    } });
  });

  test('a device another refresh already changed is not reported twice', async () => {
    mockPrisma.device.findMany.mockResolvedValue([row()]);
    mockPrisma.device.updateMany.mockResolvedValueOnce({ count: 0 });

    const summary = await cloudStatus.refreshProvider(provider(new Map([['SN000002', report()]])));

    expect(summary).toMatchObject({ updated: 0, statusChanges: 0 });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(mockPrisma.deviceEvent.create).not.toHaveBeenCalled();
    expect(alertService.clear).not.toHaveBeenCalled();
  });

  test('an unchanged device costs no write, no event and no alert call', async () => {
    mockPrisma.device.findMany.mockResolvedValue([row({ cloudStatus: 'online', cloudConnectionStatus: 'connected' })]);

    await cloudStatus.refreshProvider(provider(new Map([['SN000002', report()]])));

    expect(mockPrisma.device.updateMany).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(alertService.raise).not.toHaveBeenCalled();
    expect(alertService.clear).not.toHaveBeenCalled();
  });

  test('a device going out of sync opens the config alert', async () => {
    mockPrisma.device.findMany.mockResolvedValue([row({ cloudStatus: 'online', cloudConnectionStatus: 'connected' })]);

    await cloudStatus.refreshProvider(provider(new Map([['SN000002', report({ configInSync: false, configStatus: 'Out of sync' })]])));

    expect(alertService.raise).toHaveBeenCalledWith('device.cloud-config', expect.objectContaining({
      subjectKey: 'd1', title: 'JNEX-01 config is out of sync', message: expect.stringContaining('"Out of sync"'),
    }), { bump: false });
    expect(socket.emit).not.toHaveBeenCalled(); // no status change
  });

  test('one integration failing does not stop the others', async () => {
    const broken = { id: 'a', label: 'A', listStatuses: jest.fn(async () => { throw new Error('503'); }) };
    const fine = provider(new Map());
    mockPrisma.device.findMany.mockResolvedValue([]);
    CloudProviderFactory.activeProviders.mockResolvedValue([broken, fine]);

    const results = await cloudStatus.refreshAll();

    expect(results).toEqual([
      { integrationId: 'a', name: 'A', error: '503' },
      expect.objectContaining({ integrationId: 'int-mist', devices: 0 }),
    ]);
  });
});

describe('alertCloudConfig', () => {
  const subject = { subjectKey: 'd1', deviceId: 'd1' };

  test('in sync clears; out of sync opens only while online; unknown changes nothing', () => {
    deviceService.alertCloudConfig('d1', 'sw', { status: 'online', configInSync: true });
    expect(alertService.clear).toHaveBeenCalledWith('device.cloud-config', subject);

    deviceService.alertCloudConfig('d1', 'sw', { status: 'offline', configInSync: false });
    deviceService.alertCloudConfig('d1', 'sw', { status: 'online', configInSync: null });
    expect(alertService.raise).not.toHaveBeenCalled();
    expect(alertService.clear).toHaveBeenCalledTimes(1);

    deviceService.alertCloudConfig('d1', 'sw', { status: 'online', configInSync: false, metadata: { configStatus: 'Out of sync' } });
    expect(alertService.raise).toHaveBeenCalledWith('device.cloud-config', expect.objectContaining(subject), { bump: false });
  });
});

describe('scheduled jobs', () => {
  function fakeQueue(repeatables = []) {
    const processors = {};
    return {
      processors,
      process: jest.fn((name, fn) => { processors[name] = fn; }),
      getRepeatableJobs: jest.fn(async () => repeatables),
      removeRepeatableByKey: jest.fn(async () => {}),
      add: jest.fn(async () => ({})),
    };
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  test('the hourly sync and the 5-minute refresh are scheduled; a changed interval replaces the old job', async () => {
    const queue = fakeQueue([{ name: 'refreshStatuses', every: '60000', key: 'old' }]);
    deviceSyncJob(queue);
    await settle();

    expect(queue.add).toHaveBeenCalledWith('syncDevices', {}, expect.objectContaining({ repeat: { every: 3600000 }, attempts: 1 }));
    expect(queue.add).toHaveBeenCalledWith('refreshStatuses', {}, expect.objectContaining({ repeat: { every: 300000 } }));
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('old');
  });

  test('a scheduled sync with no cloud integration is skipped quietly', async () => {
    const queue = fakeQueue();
    deviceSyncJob(queue);
    CloudProviderFactory.activeProviders.mockResolvedValue([]);
    const sync = jest.spyOn(deviceService, 'syncDevicesFromCloud');

    const result = await queue.processors.syncDevices({ id: 1, data: {}, opts: { repeat: { every: 3600000 } }, attemptsMade: 0 });

    expect(result).toEqual({ skipped: 'no active cloud integrations' });
    expect(sync).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  test('sync results carry their trigger, so the UI can stay quiet about scheduled ones', async () => {
    const queue = fakeQueue();
    deviceSyncJob(queue);
    CloudProviderFactory.activeProviders.mockResolvedValue([{}]);
    jest.spyOn(deviceService, 'syncDevicesFromCloud').mockResolvedValue({ total: 2, integrations: [] });

    await queue.processors.syncDevices({ id: 2, data: {}, opts: { repeat: { every: 3600000 } }, attemptsMade: 0 });

    expect(socket.emit).toHaveBeenCalledWith('device:sync:completed', expect.objectContaining({ trigger: 'scheduled', total: 2 }));
  });
});
