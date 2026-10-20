/**
 * device-poller: AOS-CX pollers go through a CXSwitchAPI cookie session.
 * AOS-CX REST refuses HTTP Basic auth (401 on 10.16), which is what these
 * pollers used to send, so CX config backups over REST failed on hardware.
 */
const mockApi = {
  login: jest.fn(async () => {}),
  logout: jest.fn(async () => {}),
  makeAuthenticatedRequest: jest.fn(),
  getCentralStatus: jest.fn(),
};

jest.mock('../../src/services/device-api/cx-switch-api', () => jest.fn(() => mockApi));
jest.mock('../../src/config/database', () => ({ getPrisma: () => ({}) }));
jest.mock('../../src/services/settings.service', () => ({}));
jest.mock('../../src/services/ssh-device.service', () => ({ getVersion: jest.fn(async () => 'JUNOS 24.4R2.25') }));
jest.mock('../../src/services/device-api/junos-api', () => {
  const getDeviceInfo = jest.fn(async () => ({ hostname: 'ex1', model: 'ex4000-12mp', version: '24.4R2.25' }));
  const JunosAPI = jest.fn(() => ({ getDeviceInfo }));
  JunosAPI.getDeviceInfo = getDeviceInfo;
  return JunosAPI;
});

const CXSwitchAPI = require('../../src/services/device-api/cx-switch-api');
const JunosAPI = require('../../src/services/device-api/junos-api');
const sshDeviceService = require('../../src/services/ssh-device.service');
const poller = require('../../src/services/device-poller.service');

const device = { id: 'd1', name: 'sw1', type: 'switch', vendor: 'aruba', platform: 'aos-cx', ipAddress: '10.0.0.2' };
const credentials = { username: 'u', password: 'p' };

test('backupPoller reads the JSON configs and the CLI text in one session and logs out', async () => {
  mockApi.makeAuthenticatedRequest.mockImplementation(async (_m, endpoint, _d, opts) => (
    opts?.accept === 'text/plain' ? 'hostname sw1\n' : { endpoint }
  ));
  const result = await poller.backupPoller(device, credentials);

  expect(CXSwitchAPI).toHaveBeenCalledWith(device, credentials);
  expect(mockApi.login).toHaveBeenCalledTimes(1);
  expect(mockApi.makeAuthenticatedRequest.mock.calls.map((c) => c[1])).toEqual([
    '/fullconfigs/running-config',
    '/fullconfigs/startup-config',
    '/configs/running-config',
  ]);
  expect(mockApi.makeAuthenticatedRequest.mock.calls[2][3]).toEqual({ accept: 'text/plain' });
  expect(result.running_config).toEqual({ endpoint: '/fullconfigs/running-config' });
  expect(result.running_config_cli).toBe('hostname sw1\n');
  expect(mockApi.logout).toHaveBeenCalledTimes(1);
});

test('a failed CLI read keeps the JSON backup', async () => {
  mockApi.makeAuthenticatedRequest.mockImplementation(async (_m, endpoint, _d, opts) => {
    if (opts?.accept === 'text/plain') throw new Error('API request failed with status 404: Not Found');
    return { endpoint };
  });
  const result = await poller.backupPoller(device, credentials);

  expect(result.running_config).toEqual({ endpoint: '/fullconfigs/running-config' });
  expect(result.running_config_cli).toBeNull();
  expect(result.running_config_cli_error).toMatch(/404/);
});

test('the session is logged out even when a request fails', async () => {
  mockApi.makeAuthenticatedRequest.mockRejectedValue(new Error('API request failed with status 500'));
  await expect(poller.firmwarePoller(device, credentials)).rejects.toThrow(/500/);
  expect(mockApi.logout).toHaveBeenCalledTimes(1);
});

test('central status uses the session client (aruba_central, then hpe_anw_central inside it)', async () => {
  mockApi.getCentralStatus.mockResolvedValue({ disable: false, status: { central_connection: 'connected' } });
  await poller.centralStatusPoller(device, credentials);
  expect(mockApi.getCentralStatus).toHaveBeenCalledTimes(1);
  expect(mockApi.logout).toHaveBeenCalledTimes(1);
});

describe('version pollers follow the transport router', () => {
  const junos = (over) => ({ id: 'j1', name: 'ex1', type: 'switch', vendor: 'juniper', platform: 'junos', ipAddress: '10.0.0.3', ...over });
  beforeEach(() => jest.clearAllMocks());

  test('a Mist-managed EX is read over NETCONF and never SSHed', async () => {
    const result = await poller.firmwarePoller(junos({ managementMode: 'cloud' }), credentials);

    expect(result).toEqual({ transport: 'netconf', primary_version: '24.4R2.25', model: 'ex4000-12mp', hostname: 'ex1' });
    expect(JunosAPI).toHaveBeenCalledTimes(1);
    expect(sshDeviceService.getVersion).not.toHaveBeenCalled();
  });

  test('a cloud-managed AOS-S switch has no local poll path', async () => {
    const aoss = { id: 's1', name: 'sw2', type: 'switch', vendor: 'aruba', platform: 'aos-s', managementMode: 'cloud', ipAddress: '10.0.0.4' };

    await expect(poller.systemPoller(aoss, credentials)).rejects.toThrow(/No local transport/);
    expect(sshDeviceService.getVersion).not.toHaveBeenCalled();
  });

  test('a direct AOS-S switch is still polled over SSH', async () => {
    const aoss = { id: 's2', name: 'sw3', type: 'switch', vendor: 'aruba', platform: 'aos-s', managementMode: 'direct', ipAddress: '10.0.0.5' };

    const result = await poller.systemPoller(aoss, credentials);

    expect(result.transport).toBe('ssh');
    expect(sshDeviceService.getVersion).toHaveBeenCalledTimes(1);
  });

  test('the Central probe is for Aruba CX switches only', () => {
    expect(poller.canProbeCentralStatus(device)).toBe(true);
    expect(poller.canProbeCentralStatus({ type: 'switch', vendor: 'aruba', model: 'unknown-thing' })).toBe(true);
    expect(poller.canProbeCentralStatus(junos())).toBe(false);
    expect(poller.canProbeCentralStatus({ type: 'switch', vendor: 'cisco', platform: 'ios-xe' })).toBe(false);
    expect(poller.canProbeCentralStatus({ type: 'switch', vendor: 'aruba', platform: 'aos-s' })).toBe(false);
  });
});
