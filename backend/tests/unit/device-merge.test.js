/**
 * Duplicate devices: sync adopting a serial-less row by MAC, duplicate
 * grouping, and merging rows. Prisma and the live monitor are mocked.
 */
const calls = [];
const mockRows = new Map(); // id -> row, so tx.device.update returns the full row like Prisma
const mockTx = new Proxy({}, {
  get: (_, model) => new Proxy({}, {
    get: (__, op) => jest.fn(async (args) => {
      calls.push([`${model}.${op}`, args]);
      if (model === 'device' && op === 'update') return { ...mockRows.get(args.where.id), ...args.data };
      return { count: 0 };
    }),
  }),
});
const mockPrisma = {
  device: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  backupSchedule: { findMany: jest.fn(async () => []) },
  $transaction: jest.fn(async (fn) => fn(mockTx)),
};
const mockMonitor = {
  forget: jest.fn(async () => {}),
  refresh: jest.fn(async () => {}),
  setAlwaysOn: jest.fn(async () => {}),
  getMonitor: jest.fn(() => null),
};

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/live/state-monitor.service', () => mockMonitor);
jest.mock('../../src/services/cloud-providers/cloud-provider-factory', () => ({ activeProviders: jest.fn() }));

const deviceMerge = require('../../src/services/device-merge.service');
const { groupDuplicates, mergedFields, rewriteSelection, MergeError } = deviceMerge;
const deviceService = require('../../src/services/device.service');

const direct = (over = {}) => ({
  id: 'd-direct', name: 'sw-core', serial: null, ipAddress: '10.0.0.2', macAddress: null,
  managementMode: 'direct', cloudIntegrationId: null, apiCredentialId: 'cred-1',
  liveMonitoring: true, metadata: {}, deviceGroups: [], createdAt: new Date(1), ...over,
});
const cloud = (over = {}) => ({
  id: 'd-cloud', name: 'sw-core', serial: 'SG123', ipAddress: '10.0.0.2', macAddress: 'AA-BB-CC-00-11-22',
  managementMode: 'cloud', cloudIntegrationId: 'int-1', cloudStatus: 'online', vendor: 'aruba',
  platform: 'aos-cx', model: '6200F', firmwareVersion: '10.16', apiCredentialId: null,
  liveMonitoring: false, metadata: { site: 'HQ' }, deviceGroups: [{ id: 'g1' }], createdAt: new Date(2), ...over,
});

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
});

describe('groupDuplicates', () => {
  it('groups a serial-less row with a cloud row on the same IP', () => {
    const groups = groupDuplicates([direct(), cloud(), { id: 'other', serial: 'X', ipAddress: '10.0.0.9' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('ip');
    expect(groups[0].key).toBe('d-cloud,d-direct');
  });

  it('groups on MAC regardless of format', () => {
    const groups = groupDuplicates([direct({ macAddress: 'aa:bb:cc:00:11:22', ipAddress: '10.9.9.9' }), cloud()]);
    expect(groups).toEqual([expect.objectContaining({ reason: 'mac' })]);
  });

  it('ignores two serialed rows sharing an IP, and conflicting serials', () => {
    expect(groupDuplicates([cloud(), cloud({ id: 'b', serial: 'OTHER', macAddress: null })])).toEqual([]);
    expect(groupDuplicates([cloud(), cloud({ id: 'b', serial: 'OTHER' })])).toEqual([]);
  });
});

describe('mergedFields', () => {
  it('keeping the direct row takes cloud ownership and the serial from the cloud row', () => {
    const data = mergedFields(direct(), [cloud()]);
    expect(data).toMatchObject({
      serial: 'SG123', macAddress: 'AA-BB-CC-00-11-22', managementMode: 'cloud',
      cloudIntegrationId: 'int-1', cloudStatus: 'online', platform: 'aos-cx', metadata: { site: 'HQ' },
    });
    expect(data).not.toHaveProperty('apiCredentialId'); // target already has one
    expect(data).not.toHaveProperty('name');
  });

  it('keeping the cloud row inherits the credential and always-on monitoring', () => {
    const data = mergedFields(cloud(), [direct()]);
    expect(data).toMatchObject({ apiCredentialId: 'cred-1', liveMonitoring: true, managementMode: 'cloud' });
    expect(data).not.toHaveProperty('cloudIntegrationId');
  });
});

describe('rewriteSelection', () => {
  it('replaces merged ids and de-duplicates', () => {
    expect(rewriteSelection({ mode: 'devices', deviceIds: ['a', 'b', 'c'] }, ['b'], 'a'))
      .toEqual({ mode: 'devices', deviceIds: ['a', 'c'] });
    expect(rewriteSelection({ mode: 'all' }, ['b'], 'a')).toBeNull();
  });
});

describe('merge', () => {
  it('frees the serial first, re-points history, deletes sources, then updates the target', async () => {
    mockPrisma.device.findMany.mockResolvedValue([direct(), cloud()]);
    mockRows.set('d-direct', direct());
    mockPrisma.backupSchedule.findMany.mockResolvedValue([
      { id: 's1', deviceSelection: { mode: 'devices', deviceIds: ['d-cloud'] } },
    ]);

    const merged = await deviceMerge.merge('d-direct', ['d-cloud']);

    const ops = calls.map(([op]) => op);
    expect(ops[0]).toBe('device.updateMany');
    expect(calls[0][1]).toEqual({ where: { id: { in: ['d-cloud'] } }, data: { serial: null } });
    expect(ops).toEqual(expect.arrayContaining([
      'deviceEvent.updateMany', 'execution.updateMany', 'configBackup.updateMany',
      'discoveredDevice.updateMany', 'backupSchedule.update',
    ]));
    expect(ops.indexOf('device.deleteMany')).toBeLessThan(ops.indexOf('device.update'));
    expect(calls.find(([op]) => op === 'backupSchedule.update')[1].data.deviceSelection.deviceIds).toEqual(['d-direct']);
    expect(calls.find(([op]) => op === 'device.update')[1].data.deviceGroups).toEqual({ connect: [{ id: 'g1' }] });
    expect(merged.serial).toBe('SG123');
    expect(mockMonitor.forget).toHaveBeenCalledWith('d-cloud');
    expect(mockMonitor.setAlwaysOn).toHaveBeenCalled();
  });

  it('refuses different serials and self-merges', async () => {
    mockPrisma.device.findMany.mockResolvedValue([cloud(), cloud({ id: 'b', serial: 'OTHER' })]);
    await expect(deviceMerge.merge('d-cloud', ['b'])).rejects.toThrow(MergeError);
    await expect(deviceMerge.merge('a', ['a'])).rejects.toThrow(/cannot also be merged/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('cloud sync adoption', () => {
  const normalized = {
    serial: 'SG123', name: 'Central-name', type: 'switch', vendor: 'aruba', platform: 'aos-cx',
    model: '6200F', ipAddress: '10.0.0.2', macAddress: 'aa:bb:cc:00:11:22', status: 'online', metadata: {},
  };

  beforeEach(() => {
    mockPrisma.device.findUnique.mockResolvedValue(null);
    mockPrisma.device.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
    mockPrisma.device.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }));
  });

  it('adopts the single serial-less row with the same MAC, keeping its name', async () => {
    mockPrisma.device.findMany.mockResolvedValue([{ id: 'd-direct', macAddress: 'AA-BB-CC-00-11-22' }]);
    await expect(deviceService.upsertCloudDevice(normalized, 'int-1')).resolves.toBe('adopted');
    const { where, data } = mockPrisma.device.update.mock.calls[0][0];
    expect(where.id).toBe('d-direct');
    expect(data).toMatchObject({ serial: 'SG123', managementMode: 'cloud', cloudIntegrationId: 'int-1' });
    expect(data).not.toHaveProperty('name');
    expect(mockPrisma.device.create).not.toHaveBeenCalled();
  });

  it('creates a new row when the MAC match is ambiguous or absent', async () => {
    mockPrisma.device.findMany.mockResolvedValue([
      { id: 'a', macAddress: 'aa:bb:cc:00:11:22' }, { id: 'b', macAddress: 'aabb.cc00.1122' },
    ]);
    await expect(deviceService.upsertCloudDevice(normalized, 'int-1')).resolves.toBe('created');
    mockPrisma.device.findMany.mockResolvedValue([]);
    await expect(deviceService.upsertCloudDevice({ ...normalized, macAddress: null }, 'int-1')).resolves.toBe('created');
  });
});
