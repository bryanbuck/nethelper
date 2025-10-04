const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Import routes
// This section imports all the route modules that define the API endpoints for different functional areas.
// Each route module handles a specific domain of the application and exports Express router objects.
const authRoutes = require('./routes/auth.routes');
const deviceRoutes = require('./routes/device.routes');
const automationRoutes = require('./routes/automation.routes');
const scheduleRoutes = require('./routes/schedule.routes');
const executionRoutes = require('./routes/execution.routes');

// Import middleware
// This section imports custom middleware functions that will be applied to requests.
// These middleware components provide cross-cutting concerns like error handling and logging.
const errorMiddleware = require('./middleware/error.middleware');
const logger = require('./utils/logger');

const app = express();

// Security middleware
// Helmet provides essential security headers to protect against common vulnerabilities like XSS,
// clickjacking, and other attacks. It sets various HTTP headers to secure the application.
app.use(helmet());

// CORS configuration
// Cross-Origin Resource Sharing (CORS) configuration allows the frontend application running on
// different ports/domains to make requests to this API. The configuration includes allowed origins,
// credentials support, permitted methods, and headers for secure cross-origin communication.
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'http://192.168.0.169:5173',
    'https://dev-nethelper.buck.local',
    'http://dev-nethelper.buck.local',
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
// Enables gzip compression for response bodies to reduce bandwidth usage and improve performance.
// This middleware automatically compresses responses when the client supports it.
app.use(compression());

// Body parsing middleware
// These middleware functions parse incoming request bodies in different formats (JSON and URL-encoded).
// The 10MB limit allows for larger payloads like device configurations or automation definitions.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
// Implements rate limiting to prevent abuse and DDoS attacks by limiting the number of requests
// from a single IP address within a specified time window. Configuration is driven by environment variables.
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Request logging with enhanced auth debugging
// Custom middleware that logs all incoming requests with additional detail for authentication routes.
// This provides comprehensive request tracking including IP addresses, user agents, headers, and
// sanitized request bodies (with password redaction for security).
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
// Provides a simple health status endpoint that monitoring systems and load balancers can use
// to verify the application is running and responsive. Returns HTTP 200 with timestamp.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// API routes
// Mounts all the imported route modules under the configured API prefix (default: /api/v1).
// This creates the main API structure with endpoints for authentication, device management,
// automation workflows, scheduling, and execution history.
const apiPrefix = process.env.API_PREFIX || '/api/v1';
app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/devices`, deviceRoutes);
app.use(`${apiPrefix}/automations`, automationRoutes);
app.use(`${apiPrefix}/schedules`, scheduleRoutes);
app.use(`${apiPrefix}/executions`, executionRoutes);

// 404 handler
// Catch-all middleware that handles requests to undefined routes by returning a standardized
// 404 Not Found response with consistent error formatting.
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource does not exist',
  });
});

// Error handling middleware (must be last)
// Global error handler that processes all unhandled errors and exceptions from the application.
// Must be defined last to catch errors from all preceding middleware and routes.
app.use(errorMiddleware);

module.exports = app;
