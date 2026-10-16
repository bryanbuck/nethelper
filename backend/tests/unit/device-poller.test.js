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
jest.mock('../../src/services/ssh-device.service', () => ({}));

const CXSwitchAPI = require('../../src/services/device-api/cx-switch-api');
const poller = require('../../src/services/device-poller.service');

const device = { id: 'd1', name: 'sw1', type: 'switch', vendor: 'aruba', platform: 'aos-cx', ipAddress: '10.0.0.2' };
const credentials = { username: 'u', password: 'p' };

test('backupPoller reads both configs in one session and logs out', async () => {
  mockApi.makeAuthenticatedRequest.mockImplementation(async (_m, endpoint) => ({ endpoint }));
  const result = await poller.backupPoller(device, credentials);

  expect(CXSwitchAPI).toHaveBeenCalledWith(device, credentials);
  expect(mockApi.login).toHaveBeenCalledTimes(1);
  expect(mockApi.makeAuthenticatedRequest.mock.calls.map((c) => c[1])).toEqual([
    '/fullconfigs/running-config',
    '/fullconfigs/startup-config',
  ]);
  expect(result.running_config).toEqual({ endpoint: '/fullconfigs/running-config' });
  expect(mockApi.logout).toHaveBeenCalledTimes(1);
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
