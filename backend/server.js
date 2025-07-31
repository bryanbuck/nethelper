require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const { initializeSocket } = require('./src/websocket/socket.handler');
const logger = require('./src/utils/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const { connectRedis, disconnectRedis } = require('./src/config/redis');
const { initializeQueues } = require('./src/config/bull');

const PORT = process.env.PORT || 3000;

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

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize WebSocket
    initializeSocket(server);
    logger.info('WebSocket server initialized');

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(async () => {
        logger.info('HTTP server closed');
        await disconnectDatabase();
        await disconnectRedis();
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
