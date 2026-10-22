/**
 * Cloud sync upsert (device.service.upsertCloudDevice) for a row that already
 * exists: what a sync may overwrite and what it must keep. Plus the
 * provider factory's fallback for a cloud row with no integration and the
 * base provider's honest defaults.
 */
const mockPrisma = {
  device: { findUnique: jest.fn(), findMany: jest.fn(async () => []), update: jest.fn(), create: jest.fn() },
  cloudIntegration: { findUnique: jest.fn(), findMany: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/alert.service', () => ({ raise: jest.fn(), clear: jest.fn(), clearExcept: jest.fn() }));

const deviceService = require('../../src/services/device.service');
const alertService = require('../../src/services/alert.service');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const BaseCloudProvider = require('../../src/services/cloud-providers/base-cloud-provider');

const mistSwitch = {
  serial: 'SN2', name: 'JNEX-01', type: 'switch', vendor: 'juniper', platform: 'junos', model: 'EX4000-12MP',
  macAddress: '4c4ab4004080', ipAddress: null, firmwareVersion: null, status: 'offline', site: 'Primary Site',
  lastSeen: null, cloudConnectionStatus: 'not_reachable',
  metadata: { mistId: 'm-2', siteId: 's-1', siteName: 'Primary Site', hostname: 'JNEX-01' },
};

const existing = (over = {}) => ({
  id: 'd1', name: 'JNEX-01', serial: 'SN2', ipAddress: '172.16.10.102', firmwareVersion: '24.4R2.25',
  metadata: { sshProfile: 'junos', mistId: 'm-2', configStatus: 'NO_CHANGE' },
  cloudManaged: null, cloudManagedSource: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.device.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
});

describe('upsertCloudDevice on an existing row', () => {
  test('keeps a known IP and firmware when the cloud sent none', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(existing());

    await expect(deviceService.upsertCloudDevice(mistSwitch, 'int-mist')).resolves.toBe('updated');
    const { data } = mockPrisma.device.update.mock.calls[0][0];

    expect(data).not.toHaveProperty('ipAddress');
    expect(data).not.toHaveProperty('firmwareVersion');
    expect(data).toMatchObject({ location: 'Primary Site', cloudStatus: 'offline', cloudIntegrationId: 'int-mist' });
  });

  test('merges metadata, so keys another writer set survive', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(existing());

    await deviceService.upsertCloudDevice(mistSwitch, 'int-mist');
    const { data } = mockPrisma.device.update.mock.calls[0][0];

    expect(data.metadata).toEqual({
      sshProfile: 'junos', configStatus: 'NO_CHANGE', mistId: 'm-2', siteId: 's-1', siteName: 'Primary Site', hostname: 'JNEX-01',
    });
  });

  test('writes cloud ownership a provider reports', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(existing({ serial: 'SN1' }));

    await deviceService.upsertCloudDevice(
      { ...mistSwitch, serial: 'SN1', type: 'access_point', platform: null, cloudManaged: true, cloudManagedSource: 'cloud-inventory' },
      'int-mist'
    );
    const { data } = mockPrisma.device.update.mock.calls[0][0];

    expect(data).toMatchObject({ cloudManaged: true, cloudManagedSource: 'cloud-inventory', cloudConnectionStatus: 'not_reachable' });
    expect(data.cloudManagedCheckedAt).toBeInstanceOf(Date);
  });

  test("never overwrites the switch's own answer (the AOS-CX Central probe)", async () => {
    mockPrisma.device.findUnique.mockResolvedValue(existing({
      cloudManaged: false, cloudManagedSource: 'switch-rest', cloudConnectionStatus: 'connected',
    }));

    await deviceService.upsertCloudDevice({ ...mistSwitch, cloudManaged: true }, 'int-1');
    const { data } = mockPrisma.device.update.mock.calls[0][0];

    expect(data).not.toHaveProperty('cloudManaged');
    expect(data).not.toHaveProperty('cloudConnectionStatus');
  });

  test('a switch whose ownership the cloud did not report keeps the stored value', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(existing({ cloudManaged: true, cloudManagedSource: 'cloud-config' }));

    await deviceService.upsertCloudDevice(mistSwitch, 'int-mist');
    const { data } = mockPrisma.device.update.mock.calls[0][0];

    expect(data).not.toHaveProperty('cloudManaged');
    expect(data.cloudConnectionStatus).toBe('not_reachable');
  });
});

describe('CloudProviderFactory.forDevice without an integration id', () => {
  const legacy = (vendor) => ({ name: 'legacy', vendor, managementMode: 'cloud', cloudIntegrationId: null });
  const mist = { id: 'i-mist', provider: 'juniper_mist', name: 'Mist', baseUrl: 'https://api.mist.com', credentials: { orgId: 'o', apiToken: 'plain' } };

  test("uses the vendor's own cloud when exactly one is active", async () => {
    mockPrisma.cloudIntegration.findMany.mockResolvedValue([mist]);
    jest.spyOn(CloudProviderFactory, 'decryptCredentials').mockReturnValue(mist.credentials);

    const provider = await CloudProviderFactory.forDevice(legacy('juniper'));

    expect(provider.providerType).toBe('juniper_mist');
    expect(mockPrisma.cloudIntegration.findMany.mock.calls[0][0].where.provider).toEqual({ in: ['juniper_mist'] });
  });

  test('refuses to guess between several', async () => {
    mockPrisma.cloudIntegration.findMany.mockResolvedValue([mist, { ...mist, id: 'i-mist-2' }]);

    await expect(CloudProviderFactory.forDevice(legacy('juniper'))).rejects.toThrow(/2 could manage it/);
  });

  test('never falls back to the env Central integration for another vendor', async () => {
    mockPrisma.cloudIntegration.findMany.mockResolvedValue([]);
    const env = jest.spyOn(CloudProviderFactory, 'envArubaIntegration').mockReturnValue({ id: 'env', provider: 'aruba_central' });

    await expect(CloudProviderFactory.forDevice(legacy('juniper'))).rejects.toThrow(/No cloud integration available/);
    expect(env).not.toHaveBeenCalled();
  });
});

describe('syncDevicesFromCloud sync.failed alerts', () => {
  const ok = (id) => ({ id, label: id, listInventory: jest.fn(async () => []) });
  const failing = (id) => ({ id, label: id, listInventory: jest.fn(async () => { throw new Error('Unable to connect'); }) });

  test('a full sync clears its providers\' alerts and resolves the rest as stale', async () => {
    jest.spyOn(CloudProviderFactory, 'activeProviders').mockResolvedValue([ok('int-central'), failing('int-mist')]);

    await deviceService.syncDevicesFromCloud();

    expect(alertService.clear).toHaveBeenCalledWith('sync.failed', { subjectKey: 'int-central' });
    expect(alertService.raise).toHaveBeenCalledWith('sync.failed', expect.objectContaining({ subjectKey: 'int-mist' }));
    // e.g. env:aruba_central once a real integration exists: never syncs again
    expect(alertService.clearExcept).toHaveBeenCalledWith('sync.failed', ['int-central', 'int-mist']);
  });

  test('a single-integration sync leaves the other integrations\' alerts alone', async () => {
    jest.spyOn(CloudProviderFactory, 'forIntegration').mockResolvedValue(ok('int-central'));

    await deviceService.syncDevicesFromCloud('int-central');

    expect(alertService.clear).toHaveBeenCalledWith('sync.failed', { subjectKey: 'int-central' });
    expect(alertService.clearExcept).not.toHaveBeenCalled();
  });
});

test('base provider operations nobody implements are CapabilityErrors, not TypeErrors', async () => {
  const provider = new BaseCloudProvider({ id: 'x', provider: 'juniper_mist', name: 'X', baseUrl: 'https://x', credentials: {} });

  for (const call of [
    () => provider.getDeviceStats('S', 'cpu', '1h'),
    () => provider.executeCommand('S', 'show version'),
    () => provider.updateDeviceConfiguration('S', {}),
    () => provider.backupConfiguration('S'),
  ]) {
    await expect(call()).rejects.toMatchObject({ name: 'CapabilityError' });
  }
});
