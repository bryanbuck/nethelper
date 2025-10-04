const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

let prisma;

/**
 * Establishes connection to the PostgreSQL database using Prisma ORM.
 * Configures logging levels based on environment (verbose in development, errors only in production).
 * Initializes the global Prisma client instance for use throughout the application.
 * 
 * @returns {Promise<void>} Promise that resolves when database connection is established
 * @throws {Error} If database connection fails
 */
async function connectDatabase() {
  try {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
    
    await prisma.$connect();
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }
}

/**
 * Gracefully disconnects from the database and cleans up the Prisma client.
 * Should be called during application shutdown to ensure proper cleanup of database connections.
 * Safely handles cases where the database connection was never established.
 * 
 * @returns {Promise<void>} Promise that resolves when disconnection is complete
 */
async function disconnectDatabase() {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  }
}

/**
 * Returns the initialized Prisma client instance for database operations.
 * Provides access to all database models and operations throughout the application.
 * Ensures the database connection has been established before allowing access.
 * 
 * @returns {PrismaClient} The initialized Prisma client instance
 * @throws {Error} If database hasn't been initialized yet
 */
function getPrisma() {
  if (!prisma) {
    throw new Error('Database not initialized. Call connectDatabase() first.');
  }
  return prisma;
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getPrisma,
};
