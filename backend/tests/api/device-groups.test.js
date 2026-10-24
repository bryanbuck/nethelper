/**
 * Device groups over /api/v1/devices: the members route's validation and the
 * list's group filter wiring. The device service is spied; the unit test
 * device-groups.test.js covers its queries, role-gates.test.js who may call.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const app = require('../../src/app');
const deviceService = require('../../src/services/device.service');

const GROUP = '00000000-0000-4000-8000-0000000000aa';
const D1 = '00000000-0000-4000-8000-000000000001';
let token;
beforeAll(async () => {
  const admin = await mockPrisma.user.create({ data: { email: 'a@example.com', name: 'Admin', role: 'admin', password: 'x' } });
  token = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);
});
afterEach(() => jest.restoreAllMocks());

const post = (path, body) => request(app).post(`/api/v1/devices${path}`).set('Authorization', `Bearer ${token}`).send(body);

test('POST /groups/:id/members adds and removes devices', async () => {
  const spy = jest.spyOn(deviceService, 'updateGroupMembers').mockResolvedValue({ id: GROUP, name: 'Core', deviceCount: 3 });
  const res = await post(`/groups/${GROUP}/members`, { add: [D1] });
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ id: GROUP, name: 'Core', deviceCount: 3 });
  expect(spy).toHaveBeenCalledWith(GROUP, { add: [D1], remove: [] });
});

test.each([
  ['an empty change', GROUP, {}],
  ['empty lists', GROUP, { add: [], remove: [] }],
  ['a bad device id', GROUP, { add: ['nope'] }],
  ['a bad group id', 'nope', { add: [D1] }],
])('POST /groups/:id/members rejects %s', async (_label, groupId, body) => {
  const spy = jest.spyOn(deviceService, 'updateGroupMembers');
  expect((await post(`/groups/${groupId}/members`, body)).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});

test('GET /devices passes the group filter through', async () => {
  const spy = jest.spyOn(deviceService, 'getDevices').mockResolvedValue([]);
  const res = await request(app).get(`/api/v1/devices?group=${GROUP}`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(spy.mock.calls[0][0]).toMatchObject({ group: GROUP });
});
