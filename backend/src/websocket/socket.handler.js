const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

let io;

function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL,
      credentials: true,
    },
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    logger.info(`User ${socket.userId} connected via WebSocket`);

    // Join user-specific room
    socket.join(`user:${socket.userId}`);

    // Handle events
    socket.on('subscribe:device', (deviceId) => {
      socket.join(`device:${deviceId}`);
      logger.debug(`User ${socket.userId} subscribed to device ${deviceId}`);
    });

    socket.on('unsubscribe:device', (deviceId) => {
      socket.leave(`device:${deviceId}`);
      logger.debug(`User ${socket.userId} unsubscribed from device ${deviceId}`);
    });

    socket.on('subscribe:automation', (automationId) => {
      socket.join(`automation:${automationId}`);
      logger.debug(`User ${socket.userId} subscribed to automation ${automationId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`User ${socket.userId} disconnected`);
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}

// Helper functions for emitting events
function emitDeviceUpdate(deviceId, data) {
  if (io) {
    io.to(`device:${deviceId}`).emit('device:update', data);
  }
}

function emitAutomationUpdate(automationId, data) {
  if (io) {
    io.to(`automation:${automationId}`).emit('automation:update', data);
  }
}

function emitUserNotification(userId, notification) {
  if (io) {
    io.to(`user:${userId}`).emit('notification', notification);
  }
}

module.exports = {
  initializeSocket,
  getIO,
  emitDeviceUpdate,
  emitAutomationUpdate,
  emitUserNotification,
};
