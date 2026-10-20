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

  const { byMac } = await discoveryService.getCloudInventory();

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

test('importing a host with no known serial stores none, not its MAC', async () => {
  mockPrisma.device.create.mockClear();
  mockPrisma.discoveredDevice.findUnique.mockResolvedValue({
    id: 'dd2', scanId: 's1', status: 'new', ipAddress: '172.16.1.1', macAddress: 'f4:03:43:fb:e4:e0',
    suggestedType: null, suggestedName: null, centralSerial: null, matchedVendor: null, centralMatch: null, openPorts: [22],
  });

  await discoveryService.importDevice('dd2', { name: 'Lab-Core', type: 'switch', platform: 'aos-s' }, 'u1');
  const data = mockPrisma.device.create.mock.calls[0][0].data;

  expect(data).toMatchObject({ serial: null, macAddress: 'f4:03:43:fb:e4:e0', platform: 'aos-s', model: 'Unknown' });
});

test('a routed host (no MAC) matches the cloud by IP, unless two cloud devices share that IP', async () => {
  CloudProviderFactory.activeProviders.mockResolvedValue([{
    id: 'c1', providerType: 'aruba_central', label: 'Aruba Central', integration: { name: 'Central' },
    listInventory: async () => [
      { serial: 'SG38', name: 'Sw-CoreA', type: 'switch', vendor: 'aruba', platform: 'aos-cx', macAddress: 'e4:de:40:aa:bc:80', ipAddress: '192.168.252.4' },
      // Offline in Central with a stale address that Sw-CoreA now uses.
      { serial: 'VN42', name: 'Sw-Agg', type: 'switch', vendor: 'aruba', platform: 'aos-cx', macAddress: 'ec:67:94:bc:b2:00', ipAddress: '192.168.252.4' },
      { serial: 'SG39', name: 'Sw-CoreB', type: 'switch', vendor: 'aruba', platform: 'aos-cx', macAddress: '14:ab:ec:c2:0e:00', ipAddress: '192.168.252.5' },
    ],
  }]);

  const { byMac, byIp } = await discoveryService.getCloudInventory();

  expect(byMac.size).toBe(3);
  expect(byIp.get('192.168.252.5')).toMatchObject({ serial: 'SG39', deviceName: 'Sw-CoreB' });
  expect(byIp.has('192.168.252.4')).toBe(false);
});
