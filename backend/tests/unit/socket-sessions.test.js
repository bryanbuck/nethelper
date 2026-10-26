// Socket sessions follow the user's tokenVersion: the handshake refuses a
// token from an ended session, and a bump drops the user's older sockets.
const http = require('http');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const { initializeSocket, authenticateSocket, endSocketSessions } = require('../../src/websocket/socket.handler');

const handshake = (token) => new Promise((resolve) => {
  const socket = { handshake: { auth: { token } } };
  authenticateSocket(socket, (error) => resolve({ socket, error }));
});

let user;
beforeEach(async () => {
  mockPrisma.user.rows.length = 0;
  user = await mockPrisma.user.create({ data: { email: 'u@example.com', name: 'U', role: 'viewer', password: 'x' } });
});

test('the handshake accepts the current version, and a token without one at version 0', async () => {
  const legacy = await handshake(jwt.sign({ userId: user.id }, process.env.JWT_SECRET));
  expect(legacy.error).toBeUndefined();
  expect(legacy.socket).toMatchObject({ userId: user.id, tokenVersion: 0 });

  user.tokenVersion = 3;
  mockPrisma.user.rows[0].tokenVersion = 3;
  const current = await handshake(jwt.sign({ userId: user.id, tv: 3 }, process.env.JWT_SECRET));
  expect(current.error).toBeUndefined();
  expect(current.socket.tokenVersion).toBe(3);
});

test('the handshake refuses a token from an ended session, and a deleted user', async () => {
  mockPrisma.user.rows[0].tokenVersion = 1;
  const old = await handshake(jwt.sign({ userId: user.id, tv: 0 }, process.env.JWT_SECRET));
  expect(old.error.message).toBe('Session ended');

  const gone = await handshake(jwt.sign({ userId: 'nobody', tv: 0 }, process.env.JWT_SECRET));
  expect(gone.error.message).toBe('Session ended');
});

test('endSocketSessions drops only that user\'s sockets from before the bump', () => {
  const server = http.createServer();
  const io = initializeSocket(server);
  const fake = (id, userId, tokenVersion) => ({ id, userId, tokenVersion, disconnect: jest.fn() });
  const sockets = [fake('a', user.id, 0), fake('b', user.id, 1), fake('c', 'someone-else', 0)];
  sockets.forEach((s) => io.of('/').sockets.set(s.id, s));

  expect(endSocketSessions(user.id, 1)).toBe(1);
  expect(sockets[0].disconnect).toHaveBeenCalledWith(true);
  expect(sockets[1].disconnect).not.toHaveBeenCalled();
  expect(sockets[2].disconnect).not.toHaveBeenCalled();

  sockets.forEach((s) => io.of('/').sockets.delete(s.id));
  io.close();
});
