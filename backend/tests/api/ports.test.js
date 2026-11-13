/**
 * Port Identity over /api/v1/devices: port names in the URL, note validation
 * and status codes. The view service is spied; tests/unit/port-view.test.js
 * covers it, role-gates.test.js who may call.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const app = require('../../src/app');
const portView = require('../../src/services/ports/port-view.service');

const D1 = '00000000-0000-4000-8000-000000000001';
let token;
beforeAll(async () => {
  const admin = await mockPrisma.user.create({ data: { email: 'a@example.com', name: 'Admin', role: 'admin', password: 'x' } });
  token = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);
});
afterEach(() => jest.restoreAllMocks());

const api = (method, path) => request(app)[method](`/api/v1/devices${path}`).set('Authorization', `Bearer ${token}`);

test('a port name with slashes arrives decoded', async () => {
  const spy = jest.spyOn(portView, 'getPort').mockResolvedValue({ port: { port: '1/1/4' } });
  const res = await api('get', `/${D1}/ports/${encodeURIComponent('1/1/4')}`);
  expect(res.status).toBe(200);
  expect(spy).toHaveBeenCalledWith(D1, '1/1/4');
});

test('PUT note passes the body and the signed-in user', async () => {
  const spy = jest.spyOn(portView, 'setNote').mockResolvedValue({ label: 'Room 214 printer' });
  const res = await api('put', `/${D1}/ports/${encodeURIComponent('ge-0/0/1')}/note`)
    .send({ label: 'Room 214 printer', kind: 'static', expectedMac: 'AA-BB-CC-00-11-22' });
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ label: 'Room 214 printer' });
  expect(spy).toHaveBeenCalledWith(D1, 'ge-0/0/1', expect.objectContaining({ label: 'Room 214 printer' }), expect.any(String));
});

test.each([
  ['a label over 64 characters', { label: 'x'.repeat(65) }],
  ['an unknown kind', { kind: 'printer' }],
  ['a bad expected MAC', { expectedMac: 'not-a-mac' }],
  ['notes that are not text', { notes: 42 }],
])('PUT note rejects %s', async (_label, body) => {
  const spy = jest.spyOn(portView, 'setNote');
  expect((await api('put', `/${D1}/ports/1%2F1%2F4/note`).send(body)).status).toBe(400);
  expect(spy).not.toHaveBeenCalled();
});

test('PUT note allows clearing a field with null', async () => {
  const spy = jest.spyOn(portView, 'setNote').mockResolvedValue(null);
  const res = await api('put', `/${D1}/ports/1%2F1%2F4/note`).send({ label: null, expectedMac: '' });
  expect(res.status).toBe(200);
  expect(spy).toHaveBeenCalled();
});

test('a bad device id is a 400, a missing device a 404', async () => {
  expect((await api('get', '/nope/ports')).status).toBe(400);
  jest.spyOn(portView, 'getPorts').mockRejectedValue(new portView.PortError('Device not found', 404));
  expect((await api('get', `/${D1}/ports`)).status).toBe(404);
});

test('search needs at least 2 characters and is not taken for a device id', async () => {
  const spy = jest.spyOn(portView, 'search').mockResolvedValue({ clients: [], notes: [] });
  expect((await api('get', '/ports/search?q=a')).status).toBe(400);
  const res = await api('get', '/ports/search?q=aa:bb');
  expect(res.status).toBe(200);
  expect(spy).toHaveBeenCalledWith('aa:bb');
});

test('read now refuses a switch NetHelper has no reader for, or one with nothing configured, before queueing', async () => {
  const load = jest.spyOn(portView, 'loadDevice');
  load.mockResolvedValueOnce({
    id: D1, type: 'switch', vendor: 'juniper', platform: 'junos', managementMode: 'direct', ipAddress: '10.0.0.9',
  });
  let res = await api('post', `/${D1}/ports/read`);
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/can't read connected devices from junos switches yet/);

  load.mockResolvedValueOnce({
    id: D1, type: 'switch', vendor: 'aruba', platform: 'aos-cx', managementMode: 'direct', ipAddress: null, apiCredentialId: null,
  });
  res = await api('post', `/${D1}/ports/read`);
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/needs an IP address and a linked device credential/);
});
