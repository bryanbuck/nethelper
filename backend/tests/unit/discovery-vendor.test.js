/**
 * discovery.service vendor matching: OUIs and cloud inventory matches name
 * the vendor (Aruba or Juniper), and an import keeps it.
 */
const mockPrisma = {
  discoveredDevice: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
  device: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ id: 'new', ...data })) },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ activeProviders: jest.fn() }));

const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const discoveryService = require('../../src/services/discovery.service');

test('OUIs name Aruba, Juniper and Mist hardware', () => {
  expect(discoveryService.lookupVendorId('00:0b:86:11:22:33')).toBe('aruba');
  expect(discoveryService.lookupVendorId('4c4ab43b7980')).toBe('juniper');
  expect(discoveryService.lookupVendor('a8-f7-d9-b2-ed-0b')).toBe('Juniper Mist');
  expect(discoveryService.lookupVendorId('02:00:00:00:00:01')).toBeNull();
});

test('a cloud match is already a DeviceType; port heuristics are Aruba-only', () => {
  expect(discoveryService.suggestType({ openPorts: [] }, { deviceType: 'access_point' })).toBe('access_point');
  expect(discoveryService.suggestType({ matchedVendor: 'juniper', openPorts: [22, 443] }, null)).toBeNull();
  expect(discoveryService.suggestType({ matchedVendor: 'aruba', openPorts: [22, 443] }, null)).toBe('switch');
});

test('the cloud cross-check keeps each match\'s vendor, platform and provider', async () => {
  CloudProviderFactory.activeProviders.mockResolvedValue([{
    id: 'int-mist',
    providerType: 'juniper_mist',
    label: 'Buck Home (juniper_mist)',
    integration: { name: 'Buck Home' },
    listInventory: async () => [{
      serial: 'SN2', name: 'JNEX-01', type: 'switch', model: 'EX4000-12MP', status: 'offline',
      vendor: 'juniper', platform: 'junos', macAddress: '4c:4a:b4:3b:79:80',
    }],
  }]);

  const byMac = await discoveryService.getCloudInventoryByMac();

  expect(byMac.get('4c:4a:b4:3b:79:80')).toMatchObject({
    serial: 'SN2', deviceType: 'switch', vendor: 'juniper', platform: 'junos',
    provider: 'juniper_mist', integrationName: 'Buck Home',
  });
});

test('importing a cloud-matched host keeps its vendor and platform', async () => {
  mockPrisma.discoveredDevice.findUnique.mockResolvedValue({
    id: 'dd1', scanId: 's1', status: 'new', ipAddress: '172.16.10.102', macAddress: '4c:4a:b4:3b:79:80',
    suggestedType: 'switch', suggestedName: 'JNEX-01', centralSerial: 'SN2', matchedVendor: 'juniper',
    centralMatch: { model: 'EX4000-12MP', vendor: 'juniper', platform: 'junos' }, openPorts: [22],
  });

  const result = await discoveryService.importDevice('dd1', {}, 'u1');
  const data = mockPrisma.device.create.mock.calls[0][0].data;

  expect(result).toBeTruthy();
  expect(data).toMatchObject({ serial: 'SN2', vendor: 'juniper', platform: 'junos', model: 'EX4000-12MP' });
});
