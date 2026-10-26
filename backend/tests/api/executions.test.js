/**
 * /api/v1/executions: the history list's trigger filter, the detail route
 * (it used to select a column the schema no longer has), and cancel.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
const mockRows = new Map();
mockPrisma.execution = {
  findMany: jest.fn(async () => [...mockRows.values()]),
  count: jest.fn(async () => mockRows.size),
  findUnique: jest.fn(async ({ where, include }) => {
    const row = mockRows.get(where.id);
    if (row && include?.automation?.select?.workflow) throw new Error('Unknown field `workflow`');
    return row || null;
  }),
  update: jest.fn(async ({ where, data }) => ({ ...Object.assign(mockRows.get(where.id), data), automation: { id: 'a1', name: 'Nightly' } })),
};
const mockEmit = jest.fn();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => ({ emit: mockEmit }) }));

const app = require('../../src/app');

const ID = '00000000-0000-4000-8000-000000000001';
let token;
beforeAll(async () => {
  const admin = await mockPrisma.user.create({ data: { email: 'a@example.com', name: 'Admin', role: 'admin', password: 'x' } });
  token = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET);
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRows.clear();
  mockRows.set(ID, { id: ID, automationId: 'a1', deviceId: 'd1', status: 'pending', trigger: 'schedule', startedAt: null });
});
const auth = (r) => r.set('Authorization', `Bearer ${token}`);

test('GET / filters by trigger; alert matches both alert events', async () => {
  expect((await auth(request(app).get('/api/v1/executions?trigger=schedule'))).status).toBe(200);
  expect(mockPrisma.execution.findMany.mock.calls[0][0].where).toEqual({ trigger: 'schedule' });
  await auth(request(app).get('/api/v1/executions?trigger=alert'));
  expect(mockPrisma.execution.findMany.mock.calls[1][0].where).toEqual({ trigger: { startsWith: 'alert:' } });
  expect((await auth(request(app).get('/api/v1/executions?trigger=bogus'))).status).toBe(400);
});

test('GET /:id returns the run', async () => {
  const res = await auth(request(app).get(`/api/v1/executions/${ID}`));
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ id: ID, trigger: 'schedule' });
});

test('cancelling a pending run tells clients; a finished run can\'t be cancelled', async () => {
  const res = await auth(request(app).patch(`/api/v1/executions/${ID}/cancel`));
  expect(res.status).toBe(200);
  expect(mockRows.get(ID).status).toBe('cancelled');
  expect(mockEmit).toHaveBeenCalledWith('automation:completed', expect.objectContaining({ executionId: ID, deviceId: 'd1', status: 'cancelled' }));
  expect((await auth(request(app).patch(`/api/v1/executions/${ID}/cancel`))).status).toBe(400);
});
