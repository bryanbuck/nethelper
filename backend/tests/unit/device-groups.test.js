/**
 * Device groups in device.service: the list's group filter, bulk membership
 * changes, and a duplicate name reported as a 409 that names it.
 */
const mockPrisma = {
  device: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
  deviceGroup: { create: jest.fn(), update: jest.fn() },
  cloudStatusCheck: { findMany: jest.fn(async () => []) },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const deviceService = require('../../src/services/device.service');

beforeEach(() => jest.clearAllMocks());

test.each([
  ['none', { none: {} }],
  ['g1', { some: { id: 'g1' } }],
])('group filter %s', async (group, expected) => {
  await deviceService.getDevices({ group });
  expect(mockPrisma.device.findMany.mock.calls[0][0].where.deviceGroups).toEqual(expected);
});

test('no group filter leaves groups out of the query', async () => {
  await deviceService.getDevices({});
  expect(mockPrisma.device.findMany.mock.calls[0][0].where.deviceGroups).toBeUndefined();
});

test('updateGroupMembers connects and disconnects only the named devices', async () => {
  mockPrisma.deviceGroup.update.mockResolvedValue({ id: 'g1', name: 'Core', _count: { devices: 4 } });
  const result = await deviceService.updateGroupMembers('g1', { add: ['d1', 'd2'], remove: ['d3'] });
  expect(mockPrisma.deviceGroup.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'g1' },
    data: { devices: { connect: [{ id: 'd1' }, { id: 'd2' }], disconnect: [{ id: 'd3' }] } },
  }));
  expect(result).toEqual({ id: 'g1', name: 'Core', deviceCount: 4 });
});

test('updateGroupMembers with only removals sends no connect', async () => {
  mockPrisma.deviceGroup.update.mockResolvedValue({ id: 'g1', name: 'Core', _count: { devices: 0 } });
  await deviceService.updateGroupMembers('g1', { remove: ['d3'] });
  expect(mockPrisma.deviceGroup.update.mock.calls[0][0].data).toEqual({ devices: { disconnect: [{ id: 'd3' }] } });
});

test('a duplicate group name is a 409 naming it', async () => {
  mockPrisma.deviceGroup.create.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
  await expect(deviceService.createDeviceGroup({ name: 'Core' }))
    .rejects.toMatchObject({ statusCode: 409, message: 'A group named "Core" already exists' });
  mockPrisma.deviceGroup.update.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
  await expect(deviceService.updateDeviceGroup('g1', { name: 'Edge' }))
    .rejects.toMatchObject({ statusCode: 409, message: 'A group named "Edge" already exists' });
});
