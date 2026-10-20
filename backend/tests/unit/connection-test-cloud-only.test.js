/**
 * A cloud-only device (a Mist or Central AP) can't be reached directly, so
 * no credential can ever apply to it. Its connection test used to answer
 * "No credentials configured... add API credentials"; it now says there is no
 * direct connection to test and shows the cloud's view, without claiming a pass.
 */
const devices = {
  ap: { id: 'ap', name: 'JNAP-01', type: 'access_point', vendor: 'juniper', platform: null, managementMode: 'cloud', serial: 'A1', ipAddress: '10.0.0.9' },
  ex: { id: 'ex', name: 'JNEX-01', type: 'switch', vendor: 'juniper', platform: 'junos', managementMode: 'cloud', serial: 'S1', ipAddress: '10.0.0.2' },
};
jest.mock('../../src/config/database', () => ({
  getPrisma: () => ({ device: { findUnique: async ({ where }) => devices[where.id] || null } }),
}));
jest.mock('../../src/services/settings.service', () => ({ getDeviceCredentialsForUse: jest.fn(async () => null) }));
jest.mock('../../src/services/connection-test.service', () => ({
  testDeviceConnection: jest.fn(),
  cloudView: jest.fn(async () => ({ provider: 'My Mist', status: 'online', lastSeen: null })),
}));

const controller = require('../../src/controllers/device-api-test.controller');
const settingsService = require('../../src/services/settings.service');

function call(deviceId) {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return controller.testDeviceConnection({ params: { deviceId }, user: { id: 'u1' } }, res, (e) => { throw e; }).then(() => res);
}

test('a cloud-only AP gets the cloud view, not a request for credentials', async () => {
  const res = await call('ap');
  expect(res.statusCode).toBe(200);
  expect(res.body.data).toMatchObject({ success: false, cloudOnly: true, cloudStatus: { status: 'online' } });
  expect(res.body.data.message).toMatch(/only through My Mist.*no direct connection.*My Mist reports it online/);
  expect(settingsService.getDeviceCredentialsForUse).not.toHaveBeenCalled();
});

test('a cloud-managed switch reachable over NETCONF still needs its credential', async () => {
  const res = await call('ex');
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toBe('No credentials configured for this device');
});
