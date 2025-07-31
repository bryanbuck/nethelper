const jwt = require('jsonwebtoken');
const { getPrisma } = require('../config/database');
const { debugLog, Services } = require('../utils/debug-logger');

// Create service-specific logger
const logger = debugLog.createLogger(Services.AUTH);

async function authenticate(req, res, next) {
  const requestId = Math.random().toString(36).substring(7);
  logger.debug('Authentication middleware started', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    origin: req.get('Origin')
  }, requestId);

  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    logger.debug('Checking authorization header', {
      hasAuthHeader: !!authHeader,
      authHeaderType: authHeader ? (authHeader.startsWith('Bearer ') ? 'Bearer' : 'Other') : 'None',
      authHeaderLength: authHeader?.length
    }, requestId);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('No valid authorization header found', {}, requestId);
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    const token = authHeader.substring(7);
    logger.debug('Token extracted', {
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 10) + '...'
    }, requestId);

    // Verify token
    logger.debug('Verifying JWT token', {}, requestId);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    logger.success('Token verified successfully', {
      userId: decoded.userId,
      iat: decoded.iat,
      exp: decoded.exp,
      isExpired: decoded.exp * 1000 < Date.now()
    }, requestId);

    // Get user from database
    logger.debug('Fetching user from database', { userId: decoded.userId }, requestId);
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    if (!user) {
      logger.warn('User not found in database', { userId: decoded.userId }, requestId);
      return res.status(401).json({
        success: false,
        error: 'User not found',
      });
    }

    logger.success('User found and authenticated', {
      userId: user.id,
      email: user.email,
      role: user.role
    }, requestId);

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    logger.error('Authentication error', {
      message: error.message,
      name: error.name,
      stack: error.stack
    }, requestId);
    
    if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid JWT token format', {}, requestId);
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      logger.warn('JWT token expired', {
        expiredAt: error.expiredAt,
        now: new Date()
      }, requestId);
      return res.status(401).json({
        success: false,
        error: 'Token expired',
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
    }

    next();
  };
}

module.exports = {
  authenticate,
  authorize,
};
