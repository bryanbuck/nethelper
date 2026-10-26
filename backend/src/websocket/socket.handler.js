const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { allowedOrigins } = require('../config/cors');
const { tokenVersionMatches } = require('../middleware/auth.middleware');

let io;

// Handshake auth: a valid access token for an existing user at its current
// tokenVersion (a password change or reset ends older sessions).
async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { getPrisma } = require('../config/database');
    const user = await getPrisma().user.findUnique({ where: { id: decoded.userId }, select: { tokenVersion: true } });
    if (!user || !tokenVersionMatches(decoded, user)) return next(new Error('Session ended'));
    socket.userId = decoded.userId;
    socket.tokenVersion = user.tokenVersion ?? 0;
    next();
  } catch (error) {
    logger.error('Socket authentication error:', error);
    next(new Error('Invalid token'));
  }
}

function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins(),
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  // Authentication middleware
  io.use(authenticateSocket);

  // Connection handler
  io.on('connection', (socket) => {
    logger.info(`User ${socket.userId} connected via WebSocket`);

    // Live tab: port/PoE state + counters for one device (services/live/).
    // The ack carries the current snapshot, or { ok: false, error } when the
    // device can't be watched (no IP, no credential, unsupported platform).
    socket.on('subscribe:device-live', async (deviceId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (typeof deviceId !== 'string' || !deviceId) return reply({ ok: false, error: 'deviceId required' });
      const liveView = require('../services/live/live-view.service');
      const room = `device:live:${deviceId}`;
      socket.join(room);
      try {
        const snapshot = await liveView.watch(deviceId, socket.id);
        reply({ ok: true, snapshot });
      } catch (error) {
        socket.leave(room);
        reply({ ok: false, error: error.message });
      }
    });

    socket.on('unsubscribe:device-live', async (deviceId) => {
      if (typeof deviceId !== 'string') return;
      socket.leave(`device:live:${deviceId}`);
      const liveView = require('../services/live/live-view.service');
      await liveView.unwatch(deviceId, socket.id).catch((error) => {
        logger.warn(`Live unwatch failed for ${deviceId}: ${error.message}`);
      });
    });

    // System Status page (admins only). Sockets carry only the user id, so
    // the role is read on subscribe; the ack carries the current snapshot.
    socket.on('subscribe:system-status', async (_payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const { getPrisma } = require('../config/database');
        const user = await getPrisma().user.findUnique({ where: { id: socket.userId }, select: { role: true } });
        if (user?.role !== 'admin') return reply({ ok: false, error: 'Admins only' });
        const systemStatus = require('../services/system-status.service');
        socket.join(systemStatus.SYSTEM_STATUS_ROOM);
        reply({ ok: true, snapshot: await systemStatus.snapshot() });
      } catch (error) {
        logger.warn(`System status subscribe failed: ${error.message}`);
        reply({ ok: false, error: error.message });
      }
    });

    socket.on('unsubscribe:system-status', () => {
      socket.leave(require('../services/system-status.service').SYSTEM_STATUS_ROOM);
    });

    socket.on('disconnect', () => {
      logger.info(`User ${socket.userId} disconnected`);
      const liveView = require('../services/live/live-view.service');
      liveView.unwatchAll(socket.id).catch((error) => {
        logger.warn(`Live cleanup failed for socket ${socket.id}: ${error.message}`);
      });
    });
  });

  return io;
}

// Drop a user's sockets opened before tokenVersion `version` (a password
// change or reset). They can reconnect only with a current token. Returns
// how many were dropped.
function endSocketSessions(userId, version) {
  if (!io) return 0;
  let ended = 0;
  for (const socket of io.of('/').sockets.values()) {
    if (socket.userId === userId && (socket.tokenVersion ?? 0) < version) {
      socket.disconnect(true);
      ended += 1;
    }
  }
  if (ended) logger.info(`Ended ${ended} socket session(s) for user ${userId}`);
  return ended;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}

module.exports = {
  initializeSocket,
  getIO,
  authenticateSocket,
  endSocketSessions,
};
