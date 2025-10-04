const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient;

/**
 * Establishes connection to the Redis server for caching and session storage.
 * Configures Redis client with connection parameters from environment variables.
 * Sets up event listeners for connection status and error monitoring.
 * 
 * @returns {Promise<void>} Promise that resolves when Redis connection is established
 * @throws {Error} If Redis connection fails
 */
async function connectRedis() {
  try {
    redisClient = createClient({
      socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
      },
      password: process.env.REDIS_PASSWORD || undefined,
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });

    await redisClient.connect();
  } catch (error) {
    logger.error('Redis connection failed:', error);
    throw error;
  }
}

/**
 * Gracefully disconnects from Redis server and cleans up the client connection.
 * Should be called during application shutdown to ensure proper cleanup.
 * Safely handles cases where the Redis connection was never established.
 * 
 * @returns {Promise<void>} Promise that resolves when disconnection is complete
 */
async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    logger.info('Redis disconnected');
  }
}

/**
 * Returns the initialized Redis client instance for caching and data operations.
 * Provides access to all Redis operations including get, set, publish/subscribe, etc.
 * Ensures the Redis connection has been established before allowing access.
 * 
 * @returns {RedisClient} The initialized Redis client instance
 * @throws {Error} If Redis hasn't been initialized yet
 */
function getRedis() {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call connectRedis() first.');
  }
  return redisClient;
}

module.exports = {
  connectRedis,
  disconnectRedis,
  getRedis,
};
