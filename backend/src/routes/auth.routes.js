const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { normalizeEmail } = require('../utils/email');
const { getPrisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

const router = express.Router();

// Hash of a random string, used to equalize login timing for unknown users.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 12);

// Register validation rules
const registerValidation = [
  body('email').trim().isEmail().customSanitizer(normalizeEmail),
  body('password').isLength({ min: 12 }).withMessage('Password must be at least 12 characters'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('role').optional().isIn(['admin', 'operator', 'viewer']).withMessage('Invalid role'),
];

// Login validation rules
const loginValidation = [
  body('email').trim().isEmail().customSanitizer(normalizeEmail),
  body('password').notEmpty().withMessage('Password is required'),
];

// Generate JWT tokens
function generateTokens(userId) {
  logger.debug('Generating tokens', { userId });
  
  try {
    const accessToken = jwt.sign(
      { userId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    const refreshToken = jwt.sign(
      { userId },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN }
    );

    logger.debug('Tokens generated successfully', { 
      userId,
      accessTokenLength: accessToken?.length,
      refreshTokenLength: refreshToken?.length,
      jwtSecret: process.env.JWT_SECRET ? '[SET]' : '[MISSING]',
      jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ? '[SET]' : '[MISSING]'
    });

    return { accessToken, refreshToken };
  } catch (error) {
    logger.error('Token generation failed', { userId, error: error.message });
    throw error;
  }
}

// Register endpoint — admin-only. There is no self-signup; the first admin is
// created with `npm run user:manage`. The new user signs in separately, so no
// tokens are issued here (that would hand the admin the new user's session).
router.post('/register', authenticate, authorize('admin'), registerValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { email, password, name, role = 'viewer' } = req.body;
    const prisma = getPrisma();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User already exists',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    logger.info('User registered successfully', {
      userId: user.id,
      email: user.email,
      role: user.role,
      createdBy: req.user.id,
    });

    res.status(201).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
    });
  }
});

// Login endpoint
router.post('/login', loginValidation, async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  logger.debug(`[${requestId}] Login attempt started`, {
    email: req.body?.email,
    hasPassword: !!req.body?.password,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    origin: req.get('Origin'),
    referer: req.get('Referer'),
    contentType: req.get('Content-Type'),
    bodySize: JSON.stringify(req.body || {}).length
  });

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.debug(`[${requestId}] Validation failed`, { errors: errors.array() });
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;
    logger.debug(`[${requestId}] Validation passed, searching for user`, { email });
    
    const prisma = getPrisma();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      logger.debug(`[${requestId}] User not found`, { email });
      // Compare against a dummy hash so unknown emails take as long as wrong
      // passwords, and response timing doesn't reveal which accounts exist.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    logger.debug(`[${requestId}] User found, verifying password`, { 
      userId: user.id,
      email: user.email,
      role: user.role,
      hasStoredPassword: !!user.password,
      lastLogin: user.lastLogin
    });

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logger.debug(`[${requestId}] Password verification failed`, { userId: user.id, email });
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    logger.debug(`[${requestId}] Password verified, generating tokens`, { userId: user.id });

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id);
    
    logger.debug(`[${requestId}] Tokens generated, updating database`, { 
      userId: user.id,
      accessTokenLength: accessToken?.length,
      refreshTokenLength: refreshToken?.length
    });

    // Store refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken },
    });

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    logger.debug(`[${requestId}] Database updated, preparing response`, { userId: user.id });

    const responseData = {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        accessToken,
        refreshToken,
      },
    };

    logger.info('User logged in successfully', { userId: user.id, email: user.email, requestId });
    logger.debug(`[${requestId}] Sending successful response`, {
      userId: user.id,
      responseSize: JSON.stringify(responseData).length,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': res.get('Access-Control-Allow-Origin'),
        'access-control-allow-credentials': res.get('Access-Control-Allow-Credentials')
      }
    });

    res.json(responseData);
  } catch (error) {
    logger.error(`[${requestId}] Login error:`, error);
    logger.debug(`[${requestId}] Error details`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      success: false,
      error: 'Login failed',
    });
  }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token required',
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const prisma = getPrisma();

    // Check if refresh token exists in database
    const user = await prisma.user.findFirst({
      where: {
        id: decoded.userId,
        refreshToken,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);

    // Update user with new refresh token
    await prisma.user.update({
      where: { id: decoded.userId },
      data: { refreshToken: newRefreshToken },
    });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Token refresh failed',
    });
  }
});

// Logout endpoint
router.post('/logout', authenticate, async (req, res) => {
  try {
    const prisma = getPrisma();

    // Always revoke the stored refresh token, even if the client didn't send it.
    await prisma.user.update({
      where: { id: req.user.id },
      data: { refreshToken: null },
    });

    logger.info('User logged out successfully', { userId: req.user.id });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
    });
  }
});

// Get current user profile
router.get('/me', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user,
      },
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user profile',
    });
  }
});

// Update user profile
router.put('/me', authenticate, [
  body('name').optional().trim().isLength({ min: 2 }),
  body('email').optional().trim().isEmail().customSanitizer(normalizeEmail),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { name, email } = req.body;
    const prisma = getPrisma();

    // Check if email is already taken by another user
    if (email && email !== req.user.email) {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'Email already taken',
        });
      }
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        updatedAt: true,
      },
    });

    logger.info('User profile updated', { userId: req.user.id });

    res.json({
      success: true,
      data: {
        user: updatedUser,
      },
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
    });
  }
});

// Change your own password. Requires the current one. Issues a fresh token
// pair for this session; the stored refresh token is replaced, so any other
// session is signed out when its access token expires.
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 12 }).withMessage('New password must be at least 12 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    // 400, not 401: the session is valid, and a 401 would make the SPA's
    // interceptor try a token refresh. The auth rate limiter still counts it.
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, error: 'New password must differ from the current one' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(newPassword, 12), refreshToken },
    });

    logger.info('User changed their password', { userId: user.id });
    res.json({ success: true, data: { accessToken, refreshToken } });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

module.exports = router;