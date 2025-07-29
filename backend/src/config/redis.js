const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient;

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

async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    logger.info('Redis disconnected');
  }
}

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
