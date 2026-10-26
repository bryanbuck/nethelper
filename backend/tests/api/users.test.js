const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const app = require('../../src/app');

const PASSWORD = 'correct horse battery';
const tokenFor = (u) => jwt.sign({ userId: u.id }, process.env.JWT_SECRET, { expiresIn: '5m' });

let admin;
let operator;
async function seed(role, email) {
  return mockPrisma.user.create({
    data: { email, name: `${role} user`, role, password: bcrypt.hashSync(PASSWORD, 4) },
  });
}

beforeEach(async () => {
  mockPrisma.user.rows.length = 0;
  admin = await seed('admin', 'admin@example.com');
  operator = await seed('operator', 'op@example.com');
});

const asAdmin = (req) => req.set('Authorization', `Bearer ${tokenFor(admin)}`);

describe('/users (admin)', () => {
  test('lists users without password hashes or tokens', async () => {
    const res = await asAdmin(request(app).get('/api/v1/users'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((u) => u.email)).toEqual(['admin@example.com', 'op@example.com']);
    for (const u of res.body.data) {
      expect(u.password).toBeUndefined();
      expect(u.refreshToken).toBeUndefined();
    }
  });

  test('changes name and role', async () => {
    const res = await asAdmin(request(app).put(`/api/v1/users/${operator.id}`)).send({ name: 'Ops', role: 'viewer' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Ops', role: 'viewer' });
  });

  test('rejects an invalid role', async () => {
    const res = await asAdmin(request(app).put(`/api/v1/users/${operator.id}`)).send({ role: 'root' });
    expect(res.status).toBe(400);
  });

  test('an admin cannot change their own role', async () => {
    const res = await asAdmin(request(app).put(`/api/v1/users/${admin.id}`)).send({ role: 'viewer' });
    expect(res.status).toBe(400);
    expect(mockPrisma.user.rows[0].role).toBe('admin');
  });

  test('an admin can demote another admin', async () => {
    const second = await seed('admin', 'admin2@example.com');
    const ok = await asAdmin(request(app).put(`/api/v1/users/${second.id}`)).send({ role: 'operator' });
    expect(ok.status).toBe(200);
  });

  test('resets a password and signs the user out', async () => {
    mockPrisma.user.rows[1].refreshToken = 'old-refresh';
    const res = await asAdmin(request(app).post(`/api/v1/users/${operator.id}/reset-password`)).send({ password: 'a brand new password' });
    expect(res.status).toBe(200);
    const row = mockPrisma.user.rows[1];
    expect(row.refreshToken).toBeNull();
    expect(await bcrypt.compare('a brand new password', row.password)).toBe(true);
  });

  test('a reset ends the user\'s access tokens at once, not at expiry', async () => {
    const opToken = tokenFor(operator);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${opToken}`)).status).toBe(200);

    await asAdmin(request(app).post(`/api/v1/users/${operator.id}/reset-password`)).send({ password: 'a brand new password' });
    expect(mockPrisma.user.rows[1].tokenVersion).toBe(1);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${opToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Session ended');

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'op@example.com', password: 'a brand new password' });
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  test('reset enforces the 12-character minimum', async () => {
    const res = await asAdmin(request(app).post(`/api/v1/users/${operator.id}/reset-password`)).send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  test('delete hands the user\'s shared records to the acting admin', async () => {
    mockPrisma.cloudIntegration.rows.push({ id: 'ci1', userId: operator.id });
    mockPrisma.apiCredential.rows.push({ id: 'cr1', userId: operator.id }, { id: 'cr2', userId: admin.id });

    const res = await asAdmin(request(app).delete(`/api/v1/users/${operator.id}`));

    expect(res.status).toBe(200);
    expect(res.body.data.reassigned).toEqual({ cloudIntegration: 1, apiCredential: 1 });
    expect(mockPrisma.user.rows.map((u) => u.id)).toEqual([admin.id]);
    expect(mockPrisma.cloudIntegration.rows[0].userId).toBe(admin.id);
    expect(mockPrisma.apiCredential.rows.every((r) => r.userId === admin.id)).toBe(true);
  });

  test('an admin cannot delete themselves', async () => {
    const res = await asAdmin(request(app).delete(`/api/v1/users/${admin.id}`));
    expect(res.status).toBe(400);
  });

  test('unknown user is a 404; a malformed id is a 400', async () => {
    expect((await asAdmin(request(app).delete('/api/v1/users/00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    expect((await asAdmin(request(app).delete('/api/v1/users/not-a-uuid'))).status).toBe(400);
  });

  test('a deleted user\'s token stops working', async () => {
    const opToken = tokenFor(operator);
    await asAdmin(request(app).delete(`/api/v1/users/${operator.id}`));
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${opToken}`);
    expect(res.status).toBe(401);
  });

  test('a role change applies on the next request, not at token expiry', async () => {
    const opToken = tokenFor(operator);
    await asAdmin(request(app).put(`/api/v1/users/${operator.id}`)).send({ role: 'viewer' });
    const res = await request(app).post('/api/v1/backups/run').set('Authorization', `Bearer ${opToken}`).send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /auth/change-password', () => {
  const change = (user, body) => request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${tokenFor(user)}`)
    .send(body);

  test('requires the current password', async () => {
    const res = await change(operator, { currentPassword: 'wrong', newPassword: 'a brand new password' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Current password is incorrect');
  });

  test('enforces the minimum length', async () => {
    const res = await change(operator, { currentPassword: PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  test('rejects reusing the current password', async () => {
    const res = await change(operator, { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(res.status).toBe(400);
  });

  test('changes the password and rotates the session tokens', async () => {
    mockPrisma.user.rows[1].refreshToken = 'old-refresh';
    const res = await change(operator, { currentPassword: PASSWORD, newPassword: 'a brand new password' });
    expect(res.status).toBe(200);

    const row = mockPrisma.user.rows[1];
    expect(await bcrypt.compare('a brand new password', row.password)).toBe(true);
    expect(row.refreshToken).toBe(res.body.data.refreshToken);
    expect(jwt.verify(res.body.data.accessToken, process.env.JWT_SECRET).userId).toBe(operator.id);

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'op@example.com', password: 'a brand new password' });
    expect(login.status).toBe(200);
  });

  test('ends the other sessions at once; the tokens it returns keep working', async () => {
    const otherSession = tokenFor(operator);
    const res = await change(operator, { currentPassword: PASSWORD, newPassword: 'a brand new password' });
    expect(res.status).toBe(200);
    expect(jwt.verify(res.body.data.accessToken, process.env.JWT_SECRET).tv).toBe(1);

    const stale = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${otherSession}`);
    expect(stale.status).toBe(401);
    expect(stale.body.error).toBe('Session ended');
    const fresh = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(fresh.status).toBe(200);

    // A refresh keeps the new version
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: res.body.data.refreshToken });
    expect(jwt.verify(refreshed.body.data.accessToken, process.env.JWT_SECRET).tv).toBe(1);
  });
});
