/**
 * config-backup.service: the transport dispatcher (pullConfig), how a backup
 * run records success and failure, and retention. Every transport is mocked;
 * nothing here opens a socket.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CapabilityError } = require('../../src/services/cloud-providers/errors');

const mockDb = { devices: new Map(), backups: [], schedules: new Map() };
const mockPrisma = {
  device: {
    findUnique: jest.fn(async ({ where }) => mockDb.devices.get(where.id) || null),
    findMany: jest.fn(async () => [...mockDb.devices.values()]),
  },
  backupSchedule: {
    findUnique: jest.fn(async ({ where }) => mockDb.schedules.get(where.id) || null),
    update: jest.fn(async () => ({})),
  },
  configBackup: {
    create: jest.fn(async ({ data }) => {
      const row = { id: `b${mockDb.backups.length + 1}`, createdAt: new Date(), ...data };
      mockDb.backups.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => {
      const { artifacts, ...rest } = data;
      const row = Object.assign(mockDb.backups.find((b) => b.id === where.id), rest);
      if (artifacts) row.artifacts = artifacts.create;
      return row;
    }),
    findUnique: jest.fn(async ({ where }) => mockDb.backups.find((b) => b.id === where.id) || null),
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
jest.mock('../../src/services/scope-backup.service', () => ({
  runScopeBackups: jest.fn(async () => ({ total: 2, succeeded: 2, failed: 0, unsupported: [] })),
}));
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
const scopeBackupService = require('../../src/services/scope-backup.service');
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
  test('AOS-CX over device REST yields CLI text and the REST JSON', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx' });
    devicePoller.backupPoller.mockResolvedValue({
      running_config: { System: { hostname: 'cx1' } },
      running_config_cli: 'hostname cx1\n',
    });

    const result = await configBackupService.pullConfig(device);

    expect(result.source).toBe('AOS-CX REST');
    expect(result.artifacts).toEqual([
      { kind: 'cli', format: 'cli-text', text: 'hostname cx1\n' },
      { kind: 'structured', format: 'aoscx-json', text: JSON.stringify({ System: { hostname: 'cx1' } }, null, 2) },
    ]);
    expect(devicePoller.refreshCentralStatus).toHaveBeenCalled();
    expect(sshDeviceService.getRunningConfig).not.toHaveBeenCalled();
  });

  test('AOS-CX without CLI text still backs up the JSON', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx' });
    devicePoller.backupPoller.mockResolvedValue({
      running_config: { System: { hostname: 'cx1' } },
      running_config_cli: null,
      running_config_cli_error: 'API request failed with status 404',
    });

    const result = await configBackupService.pullConfig(device);

    expect(result.artifacts.map((a) => a.format)).toEqual(['aoscx-json']);
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

    expect(result).toMatchObject({ source: 'SSH', artifacts: [{ kind: 'cli', format: 'cli-text', text: 'hostname aoss\n' }] });
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

    expect(result).toMatchObject({ source: 'Junos NETCONF', artifacts: [{ kind: 'cli', format: 'junos-set' }] });
    expect(sshDeviceService.getRunningConfig).not.toHaveBeenCalled();
  });

  test('Junos falls back to SSH when NETCONF is not enabled', async () => {
    const device = addDevice({ vendor: 'juniper', platform: 'junos' });
    JunosAPI.getConfiguration.mockRejectedValue(netconfUnavailable());
    sshDeviceService.getRunningConfig.mockResolvedValue('set system host-name ex1\n');

    const result = await configBackupService.pullConfig(device);

    expect(result).toMatchObject({ source: 'SSH', artifacts: [{ format: 'junos-set' }] });
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
    expect(result).toMatchObject({
      source: 'Mist (juniper_mist)',
      artifacts: [{ kind: 'structured', format: 'mist-config-json', text: '{}' }],
    });
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

  test('AOS-CX stores both artifacts; CLI is the primary', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx', serial: 'CX1' });
    devicePoller.backupPoller.mockResolvedValue({ running_config: { a: 1 }, running_config_cli: 'hostname cx1\n' });

    expect(await configBackupService.backupDevice(device)).toBe(true);
    const row = mockDb.backups[0];
    expect(row).toMatchObject({ status: 'success', format: 'cli-text', hasChanges: true });
    expect(row.artifacts.map((a) => [a.kind, a.format])).toEqual([['cli', 'cli-text'], ['structured', 'aoscx-json']]);
    expect(row.filePath).toBe(row.artifacts[0].filePath);
    expect(row.artifacts[0].filePath.endsWith('.cfg')).toBe(true);
    expect(row.artifacts[1].filePath.endsWith('.json')).toBe(true);
    expect(fs.readFileSync(row.artifacts[1].filePath, 'utf8')).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(gitBackupService.commitDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({
      artifacts: [{ format: 'cli-text', text: 'hostname cx1\n' }, { format: 'aoscx-json', text: JSON.stringify({ a: 1 }, null, 2) }],
    }));
  });

  test('a change in either artifact counts as a change', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx', serial: 'CX2' });
    devicePoller.backupPoller.mockResolvedValue({ running_config: { a: 1 }, running_config_cli: 'hostname cx\n' });
    await configBackupService.backupDevice(device);
    await configBackupService.backupDevice(device);
    expect(mockDb.backups[1].hasChanges).toBe(false);

    // Only the JSON changed (e.g. a default the CLI does not print)
    devicePoller.backupPoller.mockResolvedValue({ running_config: { a: 2 }, running_config_cli: 'hostname cx\n' });
    await configBackupService.backupDevice(device);
    expect(mockDb.backups[2].hasChanges).toBe(true);
  });

  test('a pre-artifact JSON-only row compares by kind, so new CLI is a change', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx', serial: 'CX3' });
    const json = JSON.stringify({ a: 1 }, null, 2);
    const checksum = require('crypto').createHash('sha256').update(json).digest('hex');
    mockDb.backups.push({
      id: 'legacy', deviceId: device.id, status: 'success', format: 'aoscx-json',
      filePath: '/nonexistent', checksum, createdAt: new Date(Date.now() - 1000),
    });
    devicePoller.backupPoller.mockResolvedValue({ running_config: { a: 1 }, running_config_cli: null });
    await configBackupService.backupDevice(device);
    expect(mockDb.backups[1].hasChanges).toBe(false);

    devicePoller.backupPoller.mockResolvedValue({ running_config: { a: 1 }, running_config_cli: 'hostname cx\n' });
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

describe('content and diff by artifact kind', () => {
  async function cxBackup(device, cli, json) {
    devicePoller.backupPoller.mockResolvedValue({ running_config: json, running_config_cli: cli });
    await configBackupService.backupDevice(device);
    return mockDb.backups[mockDb.backups.length - 1];
  }

  test('content defaults to the primary and serves either kind', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx', serial: 'CX4' });
    const row = await cxBackup(device, 'hostname a\n', { h: 'a' });

    expect(await configBackupService.getBackupContent(row.id)).toMatchObject({
      content: 'hostname a\n', artifact: { kind: 'cli', format: 'cli-text' },
    });
    expect((await configBackupService.getBackupContent(row.id, 'structured')).artifact.format).toBe('aoscx-json');
  });

  test('a missing kind is a 400', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-s' });
    sshDeviceService.getRunningConfig.mockResolvedValue('hostname a\n');
    await configBackupService.backupDevice(device);

    await expect(configBackupService.getBackupContent(mockDb.backups[0].id, 'structured'))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('a legacy row without artifacts serves its single file', async () => {
    const filePath = path.join(storageDir, 'legacy.json');
    fs.writeFileSync(filePath, '{}');
    mockDb.backups.push({ id: 'legacy', deviceId: 'dx', status: 'success', format: 'aoscx-json', filePath, checksum: 'c', createdAt: new Date() });

    expect(await configBackupService.getBackupContent('legacy')).toMatchObject({ content: '{}', artifact: { kind: 'structured' } });
    await expect(configBackupService.getBackupContent('legacy', 'cli')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('diff prefers CLI and can compare the JSON', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx', serial: 'CX5' });
    const a = await cxBackup(device, 'hostname a\n', { h: 'a' });
    const b = await cxBackup(device, 'hostname b\n', { h: 'b' });

    const cli = await configBackupService.diffBackups(a.id, b.id);
    expect(cli).toMatchObject({ kind: 'cli', kinds: ['cli', 'structured'], identical: false, additions: 1, deletions: 1 });

    const json = await configBackupService.diffBackups(a.id, b.id, 'structured');
    expect(json.kind).toBe('structured');
    expect(json.patch).toContain('"h": "b"');
  });

  test('diff falls back to the kind both backups share, and 400s when none', async () => {
    const device = addDevice({ vendor: 'aruba', platform: 'aos-cx', serial: 'CX6' });
    const jsonOnly = await cxBackup(device, null, { h: 'a' });
    const both = await cxBackup(device, 'hostname a\n', { h: 'a' });

    expect((await configBackupService.diffBackups(jsonOnly.id, both.id)).kind).toBe('structured');
    await expect(configBackupService.diffBackups(jsonOnly.id, both.id, 'cli')).rejects.toMatchObject({ statusCode: 400 });
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

  test('removes every artifact file of a pruned backup', async () => {
    const cfg = path.join(storageDir, 'old.cfg');
    const json = path.join(storageDir, 'old.json');
    fs.writeFileSync(cfg, 'x');
    fs.writeFileSync(json, '{}');
    mockDb.backups.push({
      id: 'old', deviceId: 'd2', status: 'success', filePath: cfg, createdAt: new Date(Date.now() - 400 * DAY),
      artifacts: [{ filePath: cfg }, { filePath: json }],
    });

    await configBackupService.pruneRetention(['d2'], { retentionMaxCount: 0, retentionDays: 30 });

    expect(fs.existsSync(cfg)).toBe(false);
    expect(fs.existsSync(json)).toBe(false);
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

describe('runBackupBatch with cloud scopes', () => {
  function addSchedule(fields) {
    const schedule = {
      id: 'sch1', cronExpression: '0 2 * * *', timezone: 'UTC',
      deviceSelection: { mode: 'all' }, retentionDays: 0, retentionMaxCount: 0, ...fields,
    };
    mockDb.schedules.set(schedule.id, schedule);
    return schedule;
  }

  beforeEach(() => {
    mockDb.schedules.clear();
    scopeBackupService.runScopeBackups.mockClear();
    gitBackupService.pushIfConfigured.mockClear();
  });

  test('includeScopes runs the scopes without their own push; one push covers both', async () => {
    addDevice({ vendor: 'aruba', platform: 'aos-s' });
    sshDeviceService.getRunningConfig.mockResolvedValue('hostname a\n');
    const schedule = addSchedule({ includeScopes: true });

    const result = await configBackupService.runBackupBatch({ scheduleId: 'sch1', trigger: 'scheduled' });

    expect(scopeBackupService.runScopeBackups).toHaveBeenCalledWith(expect.objectContaining({ schedule, push: false }));
    expect(result).toMatchObject({ total: 1, succeeded: 1, scopes: { succeeded: 2 } });
    expect(gitBackupService.pushIfConfigured).toHaveBeenCalledTimes(1);
  });

  test('a scopes-only schedule still runs when it matches no devices', async () => {
    addSchedule({ includeScopes: true });

    const result = await configBackupService.runBackupBatch({ scheduleId: 'sch1', trigger: 'scheduled' });

    expect(result).toMatchObject({ total: 0, scopes: { total: 2 } });
  });

  test('without includeScopes, scopes are left alone', async () => {
    addDevice({ vendor: 'aruba', platform: 'aos-s' });
    sshDeviceService.getRunningConfig.mockResolvedValue('hostname a\n');
    addSchedule({ includeScopes: false });

    await configBackupService.runBackupBatch({ scheduleId: 'sch1', trigger: 'scheduled' });

    expect(scopeBackupService.runScopeBackups).not.toHaveBeenCalled();
  });
});
