/**
 * /api/v1/alerts: query/body validation and controller wiring. The alert
 * service is mocked; tests/unit/alert.service.test.js covers its behavior,
 * and role-gates.test.js covers who may call what.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
const mockAlerts = {
  list: jest.fn(async () => ({ items: [{ id: 'a1' }], total: 1, page: 1, limit: 25 })),
  summary: jest.fn(async () => ({ open: 1, acknowledged: 0 })),
  getRules: jest.fn(async () => [{ key: 'device.offline' }]),
  updateRule: jest.fn(async (key, patch) => ({ key, ...patch })),
  acknowledge: jest.fn(async (ids) => ids.map((id) => ({ id, status: 'acknowledged' }))),
  resolve: jest.fn(async (ids) => ids.map((id) => ({ id, status: 'resolved' }))),
};
jest.mock('../../src/services/alert.service', () => mockAlerts);

const app = require('../../src/app');

const ID = '00000000-0000-4000-8000-000000000001';
let adminToken;
beforeAll(async () => {
  const admin = await mockPrisma.user.create({ data: { email: 'a@example.com', name: 'Admin', role: 'admin', password: 'x' } });
  adminToken = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);
});
beforeEach(() => Object.values(mockAlerts).forEach((fn) => fn.mockClear()));

const get = (path) => request(app).get(`/api/v1/alerts${path}`).set('Authorization', `Bearer ${adminToken}`);
const send = (method, path, body) => request(app)[method](`/api/v1/alerts${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);

test('GET / passes filters through, splitting severity', async () => {
  const res = await get(`/?status=all&severity=critical,warning&rule=device.offline&deviceId=${ID}&q=sw1&page=2&limit=10`);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ data: [{ id: 'a1' }], total: 1 });
  expect(mockAlerts.list).toHaveBeenCalledWith(expect.objectContaining({
    status: 'all', severity: ['critical', 'warning'], rule: 'device.offline', deviceId: ID, q: 'sw1', page: 2, limit: 10,
  }));
});

test.each([
  ['?status=bogus'],
  ['?severity=critical,loud'],
  ['?rule=no.such-rule'],
  ['?deviceId=not-a-uuid'],
  ['?limit=500'],
])('GET /%s is rejected', async (qs) => {
  expect((await get(`/${qs}`)).status).toBe(400);
  expect(mockAlerts.list).not.toHaveBeenCalled();
});

test('PATCH /rules/:key validates the rule and its fields', async () => {
  expect((await send('patch', '/rules/no.such-rule', { enabled: false })).status).toBe(400);
  expect((await send('patch', '/rules/device.offline', { severity: 'loud' })).status).toBe(400);
  expect((await send('patch', '/rules/device.offline', { settleSeconds: 99999 })).status).toBe(400);
  const ok = await send('patch', '/rules/device.offline', { enabled: false, settleSeconds: 10 });
  expect(ok.status).toBe(200);
  expect(mockAlerts.updateRule).toHaveBeenCalledWith('device.offline', { enabled: false, severity: undefined, settleSeconds: 10 });
});

test('acknowledge/resolve need a list of alert ids and pass the user', async () => {
  expect((await send('post', '/acknowledge', { ids: [] })).status).toBe(400);
  expect((await send('post', '/resolve', { ids: ['x'] })).status).toBe(400);
  const res = await send('post', '/acknowledge', { ids: [ID] });
  expect(res.status).toBe(200);
  expect(mockAlerts.acknowledge).toHaveBeenCalledWith([ID], expect.objectContaining({ role: 'admin' }));
});

test('summary and rules', async () => {
  expect((await get('/summary')).body.data).toEqual({ open: 1, acknowledged: 0 });
  expect((await get('/rules')).body.data).toEqual([{ key: 'device.offline' }]);
});
