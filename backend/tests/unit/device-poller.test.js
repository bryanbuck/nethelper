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
const mockDeviceUpdate = jest.fn(async () => ({}));
jest.mock('../../src/config/database', () => ({ getPrisma: () => ({ device: { update: mockDeviceUpdate } }) }));
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

  test('the CX-only backup and login-sessions pollers never log in to another platform', async () => {
    await expect(poller.backupPoller(junos(), credentials)).rejects.toThrow(/AOS-CX switches over REST only/);
    await expect(poller.loginSessionsPoller({ id: 's3', name: 'cat1', type: 'switch', vendor: 'cisco', platform: 'ios-xe' }, credentials))
      .rejects.toThrow(/AOS-CX switches over REST only/);
    expect(CXSwitchAPI).not.toHaveBeenCalled();
  });
});

test('parseVersionFromText reads the firmware, not the Boot ROM (real 2930F show version)', () => {
  const text = [
    'Image stamp:', ' /ws/swbuildm/rel_beluru_qaoff/code/build/lvm(swbuildm_rel_beluru_qaoff_rel_belu', 'ru)',
    '                Nov 21 2023 03:09:33', '                WC.16.11.0015', '                567',
    'Boot Image:     Primary', '', 'Boot ROM Version:    WC.16.01.0010', 'Active Boot ROM:     Primary',
  ].join('\n');
  expect(poller.parseVersionFromText(text)).toBe('WC.16.11.0015');
  expect(poller.parseVersionFromText('Cisco IOS XE Software, Version 17.09.04a')).toBe('17.09.04a');
});

describe('boot images are stored on the device row', () => {
  const live = require('../fixtures/aos-cx-live/firmware.json');
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeviceUpdate.mockResolvedValue({});
  });

  test('a firmware poll stores the images and the running version (live 10.16 reply)', async () => {
    mockApi.makeAuthenticatedRequest.mockResolvedValue(live['booted-secondary']);
    const result = await poller.firmwarePoller({ ...device, firmwareVersion: 'FL.10.15.1010' }, credentials);

    expect(result.current_version).toBe('FL.10.16.1006');
    expect(result.images).toMatchObject({
      primary: 'FL.10.15.1010', secondary: 'FL.10.16.1006', defaultImage: 'secondary', bootedImage: 'secondary', source: 'aos-cx-rest',
    });
    expect(mockDeviceUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { firmwareImages: result.images, firmwareVersion: 'FL.10.16.1006' },
    });
  });

  test('the system poll reads /firmware in the same session', async () => {
    mockApi.makeAuthenticatedRequest.mockImplementation(async (_m, endpoint) => (
      endpoint === '/firmware' ? live['booted-primary'] : { hostname: 'sw1', software_version: 'ML.10.16.1010' }
    ));
    const result = await poller.systemPoller({ ...device, firmwareVersion: 'ML.10.16.1010' }, credentials);

    expect(mockApi.login).toHaveBeenCalledTimes(1);
    expect(mockApi.makeAuthenticatedRequest.mock.calls.map((c) => c[1])).toEqual(['/system?depth=1', '/firmware']);
    expect(result.firmware_images).toMatchObject({ primary: 'ML.10.16.1010', bootedImage: 'primary' });
    // Version unchanged: only the images are written
    expect(mockDeviceUpdate.mock.calls[0][0].data).toEqual({ firmwareImages: result.firmware_images });
  });

  test('a failed /firmware read keeps the system result and stores no images', async () => {
    mockApi.makeAuthenticatedRequest.mockImplementation(async (_m, endpoint) => {
      if (endpoint === '/firmware') throw new Error('API request failed with status 404');
      return { hostname: 'sw1', software_version: 'ML.10.16.1010' };
    });
    const result = await poller.systemPoller(device, credentials);

    expect(result.hostname).toBe('sw1');
    expect(result.firmware_images).toBeNull();
    expect(mockDeviceUpdate.mock.calls[0][0].data).toEqual({ firmwareVersion: 'ML.10.16.1010' });
  });

  test('a NETCONF poll stores the version only', async () => {
    await poller.firmwarePoller({ id: 'j1', name: 'ex1', type: 'switch', vendor: 'juniper', platform: 'junos', ipAddress: '10.0.0.3' }, credentials);
    expect(mockDeviceUpdate).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { firmwareVersion: '24.4R2.25' } });
  });

  test('a failed write never fails the poll', async () => {
    mockDeviceUpdate.mockRejectedValue(new Error('db down'));
    mockApi.makeAuthenticatedRequest.mockResolvedValue(live['booted-primary']);
    await expect(poller.firmwarePoller(device, credentials)).resolves.toMatchObject({ booted_image: 'primary' });
  });
});

describe('Cisco IOS over SSH (live 3560E show version)', () => {
  const showVersion = require('fs').readFileSync(
    require('path').join(__dirname, '../fixtures/ios-live/show-version.txt'), 'utf8');
  const ios = { id: 'c1', name: 'Switch1', type: 'switch', vendor: 'cisco', platform: 'ios-xe', managementMode: 'direct', ipAddress: '10.0.0.9', model: 'Unknown' };
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeviceUpdate.mockImplementation(async () => ({}));
    sshDeviceService.getVersion.mockResolvedValue(showVersion);
  });

  test('the version keeps its parentheses', () => {
    expect(poller.parseVersionFromText(showVersion)).toBe('15.0(1)SE2');
  });

  test('a hand-added switch gets its firmware, model, serial and MAC from the first poll', async () => {
    const result = await poller.systemPoller(ios, credentials);
    expect(result).toMatchObject({ transport: 'ssh', hostname: 'Switch1', platform_name: 'WS-C3560E-24PD-S', software_version: '15.0(1)SE2' });
    expect(mockDeviceUpdate.mock.calls.map((c) => c[0].data)).toEqual([
      { firmwareVersion: '15.0(1)SE2' },
      { model: 'WS-C3560E-24PD-S', macAddress: 'a8:b1:d4:00:11:00', serial: 'FDO0000X11' },
    ]);
  });

  test('values already on the row are never overwritten', async () => {
    await poller.firmwarePoller({ ...ios, model: 'C3560E', serial: 'TYPED', macAddress: 'aa:aa:aa:aa:aa:aa', firmwareVersion: '15.0(1)SE2' }, credentials);
    expect(mockDeviceUpdate).not.toHaveBeenCalled();
  });

  test('a serial another row already has is left out; the rest is kept', async () => {
    mockDeviceUpdate
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Unique constraint failed on the fields: (`serial`)'));
    await expect(poller.systemPoller(ios, credentials)).resolves.toMatchObject({ software_version: '15.0(1)SE2' });
    expect(mockDeviceUpdate.mock.calls[2][0].data).toEqual({ model: 'WS-C3560E-24PD-S', macAddress: 'a8:b1:d4:00:11:00' });
  });

  test('other SSH platforms are not touched', async () => {
    sshDeviceService.getVersion.mockResolvedValue('Software revision WC.16.11.0015');
    await poller.systemPoller({ ...ios, vendor: 'aruba', platform: 'aos-s', firmwareVersion: 'WC.16.11.0015' }, credentials);
    expect(mockDeviceUpdate).not.toHaveBeenCalled();
  });
});
