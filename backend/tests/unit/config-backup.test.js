/**
 * config-backup.service: the transport dispatcher (pullConfig), how a backup
 * run records success and failure, and retention. Every transport is mocked;
 * nothing here opens a socket.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CapabilityError } = require('../../src/services/cloud-providers/errors');

const mockDb = { devices: new Map(), backups: [] };
const mockPrisma = {
  device: {
    findUnique: jest.fn(async ({ where }) => mockDb.devices.get(where.id) || null),
  },
  configBackup: {
    create: jest.fn(async ({ data }) => {
      const row = { id: `b${mockDb.backups.length + 1}`, createdAt: new Date(), ...data };
      mockDb.backups.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(mockDb.backups.find((b) => b.id === where.id), data)),
    findFirst: jest.fn(async ({ where }) => mockDb.backups
      .filter((b) => b.deviceId === where.deviceId && b.status === 'success' && b.id !== where.id.not)
      .sort((a, b) => b.createdAt - a.createdAt)[0] || null),
    findMany: jest.fn(async ({ where }) => mockDb.backups
      .filter((b) => b.deviceId === where.deviceId && b.status === where.status)
      .sort((a, b) => b.createdAt - a.createdAt)),
    delete: jest.fn(async ({ where }) => {
      mockDb.backups = mockDb.backups.filter((b) => b.id !== where.id);
    }),
  },
};

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/config/bull', () => ({ getQueue: jest.fn() }));
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock('../../src/services/settings.service', () => ({ getDeviceCredentialsForUse: jest.fn() }));
jest.mock('../../src/services/device-poller.service', () => ({
  refreshCentralStatus: jest.fn(),
  backupPoller: jest.fn(),
}));
jest.mock('../../src/services/ssh-device.service', () => ({ getRunningConfig: jest.fn() }));
jest.mock('../../src/services/device-api/junos-api', () => {
  const getConfiguration = jest.fn();
  const JunosAPI = jest.fn(() => ({ getConfiguration }));
  JunosAPI.getConfiguration = getConfiguration;
  return JunosAPI;
});
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ forDevice: jest.fn() }));
jest.mock('../../src/services/git-backup.service', () => ({
  commitDeviceConfig: jest.fn(async () => ({ commitSha: null })),
  pushIfConfigured: jest.fn(async () => ({ pushed: false })),
}));

const settingsService = require('../../src/services/settings.service');
const devicePoller = require('../../src/services/device-poller.service');
const sshDeviceService = require('../../src/services/ssh-device.service');
const JunosAPI = require('../../src/services/device-api/junos-api');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const gitBackupService = require('../../src/services/git-backup.service');
const configBackupService = require('../../src/services/config-backup.service');

const CREDS = { username: 'admin', password: 'pw' };

function addDevice(fields) {
  const device = {
    id: `d${mockDb.devices.size + 1}`,
    name: `device-${mockDb.devices.size + 1}`,
    serial: null,
    ipAddress: '192.0.2.10',
    managementMode: 'direct',
    type: 'switch',
    ...fields,
  };
  mockDb.devices.set(device.id, device);
  return device;
}

function netconfUnavailable() {
  const error = new Error('subsystem request failed');
  error.code = 'NETCONF_UNAVAILABLE';
  return error;
}

let storageDir;
beforeEach(() => {
  mockDb.devices.clear();
  mockDb.backups = [];
  settingsService.getDeviceCredentialsForUse.mockResolvedValue(CREDS);
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nethelper-backups-'));
  configBackupService.storageDir = storageDir;
});
afterEach(() => fs.rmSync(storageDir, { recursive: true, force: true }));

describe('pullConfig transport dispatch', () => {
  test('AOS-CX over device REST: text config is cli-text', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx' });
    devicePoller.backupPoller.mockResolvedValue({ running_config: 'hostname cx1\n' });

    const result = await configBackupService.pullConfig(device);

    expect(result).toMatchObject({ text: 'hostname cx1\n', source: 'AOS-CX REST', format: 'cli-text' });
    expect(devicePoller.refreshCentralStatus).toHaveBeenCalled();
    expect(sshDeviceService.getRunningConfig).not.toHaveBeenCalled();
  });

  test('AOS-CX JSON config is labelled aoscx-json', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx' });
    devicePoller.backupPoller.mockResolvedValue({ running_config: { System: { hostname: 'cx1' } } });

    const result = await configBackupService.pullConfig(device);

    expect(result.format).toBe('aoscx-json');
    expect(JSON.parse(result.text)).toEqual({ System: { hostname: 'cx1' } });
  });

  test('AOS-CX without credentials reports what was skipped', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx' });
    settingsService.getDeviceCredentialsForUse.mockResolvedValue(null);

    await expect(configBackupService.pullConfig(device)).rejects.toThrow(/No transport available.*needs IP address and linked credentials/);
  });

  test('AOS-S goes straight to SSH', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-s' });
    sshDeviceService.getRunningConfig.mockResolvedValue('hostname aoss\n');

    const result = await configBackupService.pullConfig(device);

    expect(result).toMatchObject({ source: 'SSH', format: 'cli-text' });
    expect(devicePoller.backupPoller).not.toHaveBeenCalled();
  });

  test('SSH without credentials is an error', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-s' });
    settingsService.getDeviceCredentialsForUse.mockResolvedValue(null);

    await expect(configBackupService.pullConfig(device)).rejects.toThrow(/No credentials linked/);
  });

  test('Junos prefers NETCONF', async () => {
    const device = addDevice({ vendor: 'juniper', platform: 'junos' });
    JunosAPI.getConfiguration.mockResolvedValue('set system host-name ex1\n');

    const result = await configBackupService.pullConfig(device);

    expect(result).toMatchObject({ source: 'Junos NETCONF', format: 'junos-set' });
    expect(sshDeviceService.getRunningConfig).not.toHaveBeenCalled();
  });

  test('Junos falls back to SSH when NETCONF is not enabled', async () => {
    const device = addDevice({ vendor: 'juniper', platform: 'junos' });
    JunosAPI.getConfiguration.mockRejectedValue(netconfUnavailable());
    sshDeviceService.getRunningConfig.mockResolvedValue('set system host-name ex1\n');

    const result = await configBackupService.pullConfig(device);

    expect(result).toMatchObject({ source: 'SSH', format: 'junos-set' });
  });

  test('any other NETCONF error is real and does not fall back', async () => {
    const device = addDevice({ vendor: 'juniper', platform: 'junos' });
    JunosAPI.getConfiguration.mockRejectedValue(new Error('authentication failed'));

    await expect(configBackupService.pullConfig(device)).rejects.toThrow('authentication failed');
    expect(sshDeviceService.getRunningConfig).not.toHaveBeenCalled();
  });

  test('a cloud device surfaces CapabilityError and is never SSHed', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-s', managementMode: 'cloud', serial: 'SG1' });
    CloudProviderFactory.forDevice.mockResolvedValue({
      label: 'Central',
      getDeviceConfiguration: jest.fn(async () => {
        throw new CapabilityError('Central does not support "config-backup"');
      }),
    });

    await expect(configBackupService.pullConfig(device)).rejects.toMatchObject({ name: 'CapabilityError' });
    expect(sshDeviceService.getRunningConfig).not.toHaveBeenCalled();
  });

  test('a Mist switch without direct access uses the cloud snapshot', async () => {
    const device = addDevice({
      vendor: 'juniper', platform: 'junos', managementMode: 'cloud', serial: 'MS1', ipAddress: null,
    });
    const getDeviceConfiguration = jest.fn(async () => ({ text: '{}', format: 'mist-config-json', source: 'Mist (juniper_mist)' }));
    CloudProviderFactory.forDevice.mockResolvedValue({ label: 'Mist', getDeviceConfiguration });

    const result = await configBackupService.pullConfig(device);

    expect(getDeviceConfiguration).toHaveBeenCalledWith('MS1');
    expect(result).toMatchObject({ format: 'mist-config-json', source: 'Mist (juniper_mist)' });
    expect(JunosAPI).not.toHaveBeenCalled();
  });

  test('a direct Meraki device has no transport', async () => {
    const device = addDevice({ vendor: 'cisco', platform: 'meraki' });

    await expect(configBackupService.pullConfig(device)).rejects.toThrow(/No transport available/);
  });
});

describe('backupDevice', () => {
  test('stores the config and tracks changes by checksum', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-s', serial: null });
    sshDeviceService.getRunningConfig.mockResolvedValue('hostname a\n');

    expect(await configBackupService.backupDevice(device)).toBe(true);
    const first = mockDb.backups[0];
    expect(first).toMatchObject({ status: 'success', deviceSerial: `device-${device.id}`, hasChanges: true, format: 'cli-text' });
    expect(first.filePath.startsWith(path.join(storageDir, `device-${device.id}`))).toBe(true);
    expect(fs.readFileSync(first.filePath, 'utf8')).toBe('hostname a\n');

    await configBackupService.backupDevice(device);
    expect(mockDb.backups[1]).toMatchObject({ status: 'success', hasChanges: false, checksum: first.checksum });

    sshDeviceService.getRunningConfig.mockResolvedValue('hostname b\n');
    await configBackupService.backupDevice(device);
    expect(mockDb.backups[2].hasChanges).toBe(true);
  });

  test('an empty config is a failure, not a backup', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-s' });
    sshDeviceService.getRunningConfig.mockResolvedValue('   \n');

    expect(await configBackupService.backupDevice(device)).toBe(false);
    expect(mockDb.backups[0]).toMatchObject({ status: 'failed', error: 'SSH returned an empty configuration' });
  });

  test('a CapabilityError is recorded on the row', async () => {
    const device = addDevice({ vendor: 'juniper', managementMode: 'cloud', type: 'access_point', serial: 'AP1' });
    CloudProviderFactory.forDevice.mockResolvedValue({
      label: 'Mist',
      getDeviceConfiguration: jest.fn(async () => {
        throw new CapabilityError('AP1 is an access point');
      }),
    });

    expect(await configBackupService.backupDevice(device)).toBe(false);
    expect(mockDb.backups[0]).toMatchObject({ status: 'failed', error: 'AP1 is an access point' });
  });

  test('a Git mirror failure does not fail the backup', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-s', serial: 'SG9' });
    sshDeviceService.getRunningConfig.mockResolvedValue('hostname a\n');
    gitBackupService.commitDeviceConfig.mockRejectedValueOnce(new Error('git exploded'));

    expect(await configBackupService.backupDevice(device)).toBe(true);
    expect(mockDb.backups[0]).toMatchObject({ status: 'success', commitSha: null, deviceSerial: 'SG9' });
  });
});

describe('pruneRetention', () => {
  const DAY = 24 * 60 * 60 * 1000;

  function seedBackups(deviceId, ages) {
    for (const [i, days] of ages.entries()) {
      const filePath = path.join(storageDir, `${deviceId}-${i}.cfg`);
      fs.writeFileSync(filePath, 'x');
      mockDb.backups.push({ id: `${deviceId}-${i}`, deviceId, status: 'success', filePath, createdAt: new Date(Date.now() - days * DAY) });
    }
    mockDb.backups.push({ id: `${deviceId}-failed`, deviceId, status: 'failed', createdAt: new Date(Date.now() - 999 * DAY) });
  }

  test('keeps at most retentionMaxCount successful backups', async () => {
    seedBackups('d1', [0, 1, 2, 3, 4]);

    await configBackupService.pruneRetention(['d1'], { retentionMaxCount: 2, retentionDays: 0 });

    expect(mockDb.backups.map((b) => b.id).sort()).toEqual(['d1-0', 'd1-1', 'd1-failed']);
    expect(fs.existsSync(path.join(storageDir, 'd1-4.cfg'))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, 'd1-0.cfg'))).toBe(true);
  });

  test('drops backups older than retentionDays', async () => {
    seedBackups('d1', [0, 5, 40]);

    await configBackupService.pruneRetention(['d1'], { retentionMaxCount: 0, retentionDays: 30 });

    expect(mockDb.backups.map((b) => b.id).sort()).toEqual(['d1-0', 'd1-1', 'd1-failed']);
  });

  test('zero limits prune nothing', async () => {
    seedBackups('d1', [0, 400]);

    await configBackupService.pruneRetention(['d1'], { retentionMaxCount: 0, retentionDays: 0 });

    expect(mockDb.backups).toHaveLength(3);
  });
});
