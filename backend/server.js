require('dotenv').config({ quiet: true });

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
const stateMonitorService = require('./src/services/live/state-monitor.service');
const cloudStreamService = require('./src/services/cloud/cloud-stream.service');
const deviceEvents = require('./src/services/device-events.service');
const liveViewService = require('./src/services/live/live-view.service');
const alertService = require('./src/services/alert.service');
const systemStatusService = require('./src/services/system-status.service');
const automationTriggers = require('./src/services/automation/trigger.service');
const automationSchedules = require('./src/services/automation/schedule.service');
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

    // Re-derive automation cron schedules from their Schedule triggers
    await automationSchedules.syncAll().catch((error) => {
      logger.error(`Automation schedule sync failed: ${error.message}`);
    });

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize WebSocket
    const io = initializeSocket(server);
    logger.info('WebSocket server initialized');

    // Live port/PoE state for devices with liveMonitoring on. Connects are
    // staggered in the background; a slow switch doesn't delay startup.
    stateMonitorService.start().catch((error) => {
      logger.error(`Live state monitoring failed to start: ${error.message}`);
    });

    // Push streams from the clouds (Mist), in the background like the above.
    cloudStreamService.start().catch((error) => {
      logger.error(`Cloud event streams failed to start: ${error.message}`);
    });
    deviceEvents.startPruning();

    // Daily prune of old resolved alerts; automations with an Alert trigger
    alertService.start();
    // In-memory samples for the System Status page
    systemStatusService.start();
    automationTriggers.start();
    automationSchedules.start();

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

      await liveViewService.stop();
      await stateMonitorService.stop(); // logs out of device sessions
      cloudStreamService.stop();
      deviceEvents.stopPruning();
      automationTriggers.stop();
      automationSchedules.stop();
      alertService.stop();
      systemStatusService.stop();
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
