const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Import routes
const authRoutes = require('./routes/auth.routes');
const deviceRoutes = require('./routes/device.routes');
const automationRoutes = require('./routes/automation.routes');
const scheduleRoutes = require('./routes/schedule.routes');
const executionRoutes = require('./routes/execution.routes');

// Import middleware
const errorMiddleware = require('./middleware/error.middleware');
const logger = require('./utils/logger');

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'http://192.168.0.169:5173',
    /^http:\/\/192\.168\.0\.\d+:5173$/,
    /^https:\/\/192\.168\.0\.\d+:5173$/,
    /^http:\/\/192\.168\.2\d\.\d+:5173$/,
    /^https:\/\/192\.168\.2\d\.\d+:5173$/
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Request logging with enhanced auth debugging
app.use((req, res, next) => {
  const isAuthRoute = req.path.startsWith('/api/v1/auth');
  
  if (isAuthRoute) {
    logger.debug('Auth route request details', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      origin: req.get('origin'),
      referer: req.get('referer'),
      contentType: req.get('content-type'),
      authorization: req.get('authorization') ? 'Bearer [TOKEN]' : 'None',
      cookies: Object.keys(req.cookies || {}),
      body: req.method === 'POST' ? {
        ...req.body,
        password: req.body?.password ? '[REDACTED]' : undefined
      } : undefined
    });
  }
  
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// API routes
const apiPrefix = process.env.API_PREFIX || '/api/v1';
app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/devices`, deviceRoutes);
app.use(`${apiPrefix}/automations`, automationRoutes);
app.use(`${apiPrefix}/schedules`, scheduleRoutes);
app.use(`${apiPrefix}/executions`, executionRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource does not exist',
  });
});

// Error handling middleware (must be last)
app.use(errorMiddleware);

module.exports = app;
