require('dotenv').config();

// Validate configuration before any module reads process.env at load time.
const { validateEnv } = require('./src/config/env');
try {
  const warnings = validateEnv();
  for (const warning of warnings) {
    console.warn(`[config] WARNING: ${warning} (fatal when NODE_ENV=production)`);
  }
} catch (error) {
  console.error(`[config] ${error.message}`);
  process.exit(1);
}

const http = require('http');
const app = require('./src/app');
const { initializeSocket } = require('./src/websocket/socket.handler');
const logger = require('./src/utils/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const { connectRedis, disconnectRedis } = require('./src/config/redis');
const { initializeQueues, closeQueues } = require('./src/config/bull');
const pingMonitorService = require('./src/services/ping-monitor.service');
const { version } = require('./package.json');

const PORT = process.env.PORT || 3000;
// 127.0.0.1 when nginx runs on the same host, so the API isn't reachable around it.
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';
const SHUTDOWN_TIMEOUT_MS = 10000;

async function startServer() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Database connected successfully');

    // Connect to Redis
    await connectRedis();
    logger.info('Redis connected successfully');

    // Initialize Bull queues
    await initializeQueues();
    logger.info('Job queues initialized successfully');

    // Register active config backup schedules as repeatable jobs
    const configBackupService = require('./src/services/config-backup.service');
    await configBackupService.syncSchedules();

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize WebSocket
    const io = initializeSocket(server);
    logger.info('WebSocket server initialized');

    // Start ping monitoring
    pingMonitorService.startMonitoring();
    logger.info('Ping monitoring service started');

    // Start server
    server.listen(PORT, BIND_ADDRESS, () => {
      logger.info(`NetHelper ${version} listening on ${BIND_ADDRESS}:${PORT} in ${process.env.NODE_ENV} mode`);
    });

    // Graceful shutdown. Runs once even if several signals arrive: under
    // systemd + npm + nodemon every process in the group gets the signal, so
    // node commonly sees it twice.
    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received: shutting down`);

      // Don't hang forever on a stuck connection or job.
      setTimeout(() => {
        logger.error('Graceful shutdown timed out; forcing exit');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref();

      pingMonitorService.stopMonitoring();
      // io.close() disconnects WebSocket clients and closes the HTTP server;
      // plain server.close() would wait on those long-lived connections.
      await new Promise((resolve) => io.close(() => resolve()));
      server.closeAllConnections?.(); // idle keep-alive HTTP sockets
      logger.info('HTTP and WebSocket servers closed');
      await closeQueues();
      await disconnectDatabase();
      await disconnectRedis();
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
