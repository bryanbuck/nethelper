const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const app = require('../../src/app');

const PASSWORD = 'correct horse battery';
const api = (path) => `/api/v1/auth${path}`;

async function seedUser(role) {
  return mockPrisma.user.create({
    data: {
      email: `${role}@example.com`,
      name: `${role} user`,
      role,
      password: bcrypt.hashSync(PASSWORD, 4),
    },
  });
}

const tokenFor = (userRow) => jwt.sign({ userId: userRow.id }, process.env.JWT_SECRET, { expiresIn: '5m' });

let admin;
let viewer;
beforeAll(async () => {
  admin = await seedUser('admin');
  viewer = await seedUser('viewer');
});

describe('POST /auth/register (admin only)', () => {
  const newUser = { email: 'new@example.com', password: 'twelve chars!!', name: 'New User', role: 'operator' };

  test('rejects an anonymous caller', async () => {
    const res = await request(app).post(api('/register')).send({ ...newUser, role: 'admin' });
    expect(res.status).toBe(401);
    expect(mockPrisma.user.rows.find((u) => u.email === 'new@example.com')).toBeUndefined();
  });

  test('rejects a non-admin', async () => {
    const res = await request(app)
      .post(api('/register'))
      .set('Authorization', `Bearer ${tokenFor(viewer)}`)
      .send({ ...newUser, role: 'admin' });
    expect(res.status).toBe(403);
  });

  test('rejects a forged token', async () => {
    const forged = jwt.sign({ userId: admin.id }, 'not-the-server-secret');
    const res = await request(app).post(api('/register')).set('Authorization', `Bearer ${forged}`).send(newUser);
    expect(res.status).toBe(401);
  });

  test('enforces the 12-character password minimum', async () => {
    const res = await request(app)
      .post(api('/register'))
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ ...newUser, password: 'short-pw' });
    expect(res.status).toBe(400);
  });

  test('an admin creates the user; no tokens are issued', async () => {
    const res = await request(app)
      .post(api('/register'))
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send(newUser);
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'new@example.com', role: 'operator' });
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();

    const stored = mockPrisma.user.rows.find((u) => u.email === 'new@example.com');
    expect(await bcrypt.compare(newUser.password, stored.password)).toBe(true);
  });

  test('refuses a duplicate email', async () => {
    const res = await request(app)
      .post(api('/register'))
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send(newUser);
    expect(res.status).toBe(409);
  });
});

describe('login, refresh, logout', () => {
  test('wrong password and unknown user get the same 401', async () => {
    const wrong = await request(app).post(api('/login')).send({ email: 'admin@example.com', password: 'nope' });
    const unknown = await request(app).post(api('/login')).send({ email: 'ghost@example.com', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  test('a +tagged Gmail address created by the CLI can sign in', async () => {
    // The CLI stores trim().toLowerCase(); login used normalizeEmail(), which
    // turned this into someone@gmail.com and never found the user.
    await mockPrisma.user.create({
      data: { email: 'some.one+nh@gmail.com', name: 'Tagged', role: 'admin', password: bcrypt.hashSync(PASSWORD, 4) },
    });
    const login = await request(app).post(api('/login')).send({ email: ' Some.One+NH@Gmail.com ', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.email).toBe('some.one+nh@gmail.com');
  });

  test('full session lifecycle', async () => {
    const login = await request(app).post(api('/login')).send({ email: 'admin@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
    const { accessToken, refreshToken, user } = login.body.data;
    expect(user).toEqual({ id: admin.id, email: 'admin@example.com', name: 'admin user', role: 'admin' });
    expect(mockPrisma.user.rows.find((u) => u.id === admin.id).refreshToken).toBe(refreshToken);

    const me = await request(app).get(api('/me')).set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.password).toBeUndefined();

    // Refresh rotates the token. jwt iat has 1s resolution, so wait to get a
    // distinct token.
    await new Promise((r) => setTimeout(r, 1100));
    const refreshed = await request(app).post(api('/refresh')).send({ refreshToken });
    expect(refreshed.status).toBe(200);
    const next = refreshed.body.data.refreshToken;
    expect(next).not.toBe(refreshToken);

    // The old refresh token is dead after rotation.
    const replay = await request(app).post(api('/refresh')).send({ refreshToken });
    expect(replay.status).toBe(401);

    // Logout revokes the stored token even though the client didn't send it.
    const logout = await request(app).post(api('/logout')).set('Authorization', `Bearer ${accessToken}`);
    expect(logout.status).toBe(200);
    const afterLogout = await request(app).post(api('/refresh')).send({ refreshToken: next });
    expect(afterLogout.status).toBe(401);
  });

  test('an access token is not accepted as a refresh token', async () => {
    const res = await request(app).post(api('/refresh')).send({ refreshToken: tokenFor(admin) });
    expect(res.status).toBe(401);
  });

  test('a garbage refresh token is a 401, not a 500', async () => {
    const res = await request(app).post(api('/refresh')).send({ refreshToken: 'garbage' });
    expect(res.status).toBe(401);
  });

  test('an expired access token is rejected', async () => {
    const expired = jwt.sign({ userId: admin.id, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
    const res = await request(app).get(api('/me')).set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token expired');
  });
});
