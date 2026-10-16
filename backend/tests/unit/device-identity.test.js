/**
 * device-identity.service: which serial/MAC is real, from the cloud inventory
 * or the device. Providers, credentials and the device API are mocked.
 */
const mockProvider = { label: 'Central (aruba_central)', listInventory: jest.fn() };
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({
  forIntegration: jest.fn(async () => mockProvider),
}));
jest.mock('../../src/services/settings.service', () => ({
  getDeviceCredentialsForUse: jest.fn(async () => ({ username: 'u', password: 'p' })),
}));
const mockApi = { getIdentity: jest.fn() };
jest.mock('../../src/services/device-api/device-api-factory', () => ({
  createDeviceAPI: jest.fn(() => mockApi),
}));

const identity = require('../../src/services/device-identity.service');
const { matchInventory } = identity;
const CXSwitchAPI = require('../../src/services/device-api/cx-switch-api');

const handAdded = { id: 'a', name: 'Sw-Studio', serial: 'STUDIO', macAddress: 'cc:Cc:cc:Cc:Cc:Cc', ipAddress: '192.168.0.14', apiCredentialId: 'c1', cloudIntegrationId: 'int-1' };
const synced = { id: 'b', name: 'Sw-Studio', serial: 'VN37LBD3Z1', macAddress: 'ec:67:94:d1:a8:00', ipAddress: '192.168.0.14', cloudIntegrationId: 'int-1' };
const inventoryEntry = { serial: 'VN37LBD3Z1', macAddress: 'EC-67-94-D1-A8-00', name: 'Sw-Studio' };

beforeEach(() => jest.clearAllMocks());

describe('matchInventory', () => {
  it('finds the cloud device by serial or MAC, ignoring placeholders that match nothing', () => {
    expect(matchInventory([inventoryEntry, { serial: 'OTHER', macAddress: '00:11:22:33:44:55' }], [handAdded, synced]))
      .toEqual([inventoryEntry]);
    expect(matchInventory([inventoryEntry], [{ serial: null, macAddress: 'ec:67:94:d1:a8:00' }])).toEqual([inventoryEntry]);
  });
});

describe('resolve', () => {
  it('trusts the cloud inventory first', async () => {
    mockProvider.listInventory.mockResolvedValue([inventoryEntry]);
    await expect(identity.resolve([handAdded, synced])).resolves.toEqual({
      serial: 'VN37LBD3Z1', macAddress: 'ec:67:94:d1:a8:00', source: 'cloud', label: 'Central (aruba_central)',
    });
    expect(mockApi.getIdentity).not.toHaveBeenCalled();
  });

  it('falls back to the device when the cloud has no answer', async () => {
    mockProvider.listInventory.mockRejectedValue(new Error('Central unreachable'));
    mockApi.getIdentity.mockResolvedValue({ serial: 'VN37LBD3Z1', macAddress: 'ec:67:94:d1:a8:00' });
    await expect(identity.resolve([handAdded, synced])).resolves
      .toMatchObject({ serial: 'VN37LBD3Z1', source: 'device', label: 'the device at 192.168.0.14' });
  });

  it('is unknown when the cloud is ambiguous and no device can be read', async () => {
    mockProvider.listInventory.mockResolvedValue([inventoryEntry, { serial: 'STUDIO' }]);
    await expect(identity.resolve([handAdded, synced].map((r) => ({ ...r, apiCredentialId: null })))).resolves.toBeNull();
  });
});

describe('CXSwitchAPI.getIdentity', () => {
  it('reads serial and base MAC from chassis product_info', async () => {
    const api = new CXSwitchAPI({ name: 'sw', ipAddress: '10.0.0.1' }, { username: 'u', password: 'p' });
    api.makeAuthenticatedRequest = jest.fn(async () => ({
      product_info: { serial_number: 'VN37LBD3Z1', base_mac_address: 'ec:67:94:d1:a8:00', part_number: 'R8Q72A' },
    }));
    await expect(api.getIdentity()).resolves.toEqual({ serial: 'VN37LBD3Z1', macAddress: 'ec:67:94:d1:a8:00' });
    expect(api.makeAuthenticatedRequest).toHaveBeenCalledWith('GET', '/system/subsystems/chassis,1?attributes=product_info');
  });
});
