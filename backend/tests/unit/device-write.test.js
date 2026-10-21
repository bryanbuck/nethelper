/**
 * POST/PUT /devices write only user-editable fields: system-owned columns
 * (status, cloud ownership, ping state, metadata, test results) are dropped,
 * while cloud sync still writes them through the service. Prisma is mocked.
 */
const mockPrisma = {
  device: {
    create: jest.fn(async ({ data }) => ({ id: 'd1', ...data })),
    update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    findUnique: jest.fn(async () => ({ apiCredentialId: null })),
  },
};

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/alert.service', () => ({ raise: jest.fn(), clear: jest.fn() }));
jest.mock('../../src/services/live/state-monitor.service', () => ({ refresh: jest.fn(async () => {}) }));

const deviceService = require('../../src/services/device.service');
const deviceController = require('../../src/controllers/device.controller');

const ID = 'b48dcfc0-06f2-466e-8cb8-0eef143294ca';
const SYSTEM_OWNED = {
  status: 'online',
  cloudStatus: 'online',
  pingStatus: 'online',
  cloudManaged: true,
  cloudManagedSource: 'switch-rest',
  consecutiveFailures: 0,
  metadata: { injected: true },
  firmwareVersion: '10.16',
  liveMonitoring: true,
  apiTestStatus: 'success',
  bogus: 'x',
};

const call = async (handler, req) => {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  const next = jest.fn();
  await handler.call(deviceController, req, res, next);
  expect(next).not.toHaveBeenCalled();
  return res;
};

describe('deviceService.editableFields', () => {
  test('keeps only editable fields', () => {
    expect(deviceService.editableFields({ name: 'sw-1', type: 'switch', ...SYSTEM_OWNED })).toEqual({ name: 'sw-1', type: 'switch' });
  });

  test('stores blanks as null and leaves a blank model unchanged', () => {
    expect(deviceService.editableFields({ ipAddress: '', location: '  ', macAddress: null, model: '', serial: '' }))
      .toEqual({ ipAddress: null, location: null, macAddress: null, serial: '' });
  });

  test('trims strings', () => {
    expect(deviceService.editableFields({ name: ' sw-1 ', ipAddress: ' 10.0.0.1 ' })).toEqual({ name: 'sw-1', ipAddress: '10.0.0.1' });
  });
});

describe('device routes write only editable fields', () => {
  beforeEach(() => jest.clearAllMocks());

  test('PUT /devices/:id drops system-owned fields', async () => {
    await call(deviceController.updateDevice, {
      params: { deviceId: ID },
      body: { name: 'sw-1', location: '', ...SYSTEM_OWNED },
    });

    const { data } = mockPrisma.device.update.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(['location', 'name', 'updatedAt']);
    expect(data.location).toBeNull();
  });

  test('POST /devices drops system-owned fields', async () => {
    const res = await call(deviceController.createDevice, {
      body: { name: 'sw-1', type: 'switch', ipAddress: '10.0.0.1', ...SYSTEM_OWNED },
    });

    expect(res.status).toHaveBeenCalledWith(201);
    const { data } = mockPrisma.device.create.mock.calls[0][0];
    expect(data.cloudStatus).toBe('offline');
    expect(data.metadata).toEqual({});
    expect(data.firmwareVersion).toBeUndefined();
    expect(data).not.toHaveProperty('cloudManaged');
    expect(data).not.toHaveProperty('status');
  });

  test('cloud sync still writes system-owned fields on create', async () => {
    const checkedAt = new Date();
    await deviceService.createDevice({
      name: 'ap-1', type: 'access_point', serial: 'S1', cloudStatus: 'online', firmwareVersion: '0.14',
      metadata: { siteId: 's' }, lastSeen: checkedAt,
      cloudManaged: true, cloudManagedSource: 'cloud-inventory', cloudManagedCheckedAt: checkedAt, cloudConnectionStatus: 'connected',
    });

    const { data } = mockPrisma.device.create.mock.calls[0][0];
    expect(data).toMatchObject({
      cloudStatus: 'online', firmwareVersion: '0.14', metadata: { siteId: 's' }, lastSeen: checkedAt,
      cloudManaged: true, cloudManagedSource: 'cloud-inventory', cloudManagedCheckedAt: checkedAt, cloudConnectionStatus: 'connected',
    });
  });
});
