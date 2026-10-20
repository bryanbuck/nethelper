/**
 * connection-test.service: the test is routed like a real operation, and a
 * cloud's view of a device it couldn't reach is context, never a pass.
 */
jest.mock('../../src/services/device-api/device-api-factory', () => ({ createDeviceAPI: jest.fn() }));
jest.mock('../../src/services/ssh-device.service', () => ({ testConnection: jest.fn() }));
jest.mock('../../src/services/device-poller.service', () => ({ refreshCentralStatus: jest.fn() }));
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ forDevice: jest.fn() }));

const DeviceAPIFactory = require('../../src/services/device-api/device-api-factory');
const sshDeviceService = require('../../src/services/ssh-device.service');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const NetconfClient = require('../../src/services/device-api/netconf-client');
const { testDeviceConnection } = require('../../src/services/connection-test.service');

const CREDS = { username: 'admin', password: 'pw' };
const mistSwitch = (over = {}) => ({
  id: 'd1', name: 'JNEX-01', serial: 'SN1', type: 'switch', vendor: 'juniper', platform: 'junos',
  managementMode: 'cloud', ipAddress: '172.16.10.102', ...over,
});
const mistReports = (status) => {
  const getDeviceStatus = jest.fn(async () => ({ status, lastSeen: new Date(1791421861000) }));
  CloudProviderFactory.forDevice.mockResolvedValue({ integration: { name: 'My Mist' }, label: 'My Mist (juniper_mist)', getDeviceStatus });
  return getDeviceStatus;
};

beforeEach(() => jest.resetAllMocks());

test('a direct NETCONF answer passes without asking the cloud', async () => {
  DeviceAPIFactory.createDeviceAPI.mockReturnValue({ testConnection: async () => ({ success: true, transport: 'netconf' }) });
  const getDeviceStatus = mistReports('online');

  const result = await testDeviceConnection(mistSwitch(), CREDS);

  expect(result).toMatchObject({ success: true, transport: 'netconf' });
  expect(getDeviceStatus).not.toHaveBeenCalled();
});

test('NETCONF off on a Mist switch: fails, never SSHes, and adds what Mist reports', async () => {
  DeviceAPIFactory.createDeviceAPI.mockReturnValue({
    testConnection: async () => ({ success: false, code: NetconfClient.NETCONF_UNAVAILABLE }),
  });
  mistReports('offline');

  const result = await testDeviceConnection(mistSwitch(), CREDS);

  expect(result.success).toBe(false);
  expect(result.cloudStatus).toMatchObject({ provider: 'My Mist', status: 'offline' });
  expect(result.message).toMatch(/My Mist reports the device offline; NetHelper did not reach it directly/);
  expect(sshDeviceService.testConnection).not.toHaveBeenCalled();
});

test('a real NETCONF failure stays the result, with the cloud view attached', async () => {
  DeviceAPIFactory.createDeviceAPI.mockReturnValue({
    testConnection: async () => ({ success: false, message: 'authentication failed', transport: 'netconf' }),
  });
  mistReports('online');

  const result = await testDeviceConnection(mistSwitch(), CREDS);

  expect(result).toMatchObject({ success: false, transport: 'netconf', cloudStatus: { status: 'online' } });
  expect(result.message).toMatch(/^authentication failed\. /);
});

test('a direct device that fails gets no cloud view', async () => {
  sshDeviceService.testConnection.mockResolvedValue({ success: false, message: 'timeout', transport: 'ssh' });

  const result = await testDeviceConnection(
    { id: 'd2', name: 'sw', serial: null, type: 'switch', vendor: 'aruba', platform: 'aos-s', managementMode: 'direct', ipAddress: '10.0.0.2' },
    CREDS
  );

  expect(result).toEqual({ success: false, message: 'timeout', transport: 'ssh' });
  expect(CloudProviderFactory.forDevice).not.toHaveBeenCalled();
});

test('a cloud failure to answer leaves the result as it was', async () => {
  DeviceAPIFactory.createDeviceAPI.mockImplementation(() => { throw new Error('no client'); });
  CloudProviderFactory.forDevice.mockRejectedValue(new Error('No cloud integration'));

  const result = await testDeviceConnection(mistSwitch(), CREDS);

  expect(result.success).toBe(false);
  expect(result.cloudStatus).toBeUndefined();
  expect(result.message).toMatch(/No usable transport/);
});
