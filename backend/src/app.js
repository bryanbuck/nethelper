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
const settingsRoutes = require('./routes/settings.routes');
const deviceApiTestRoutes = require('./routes/device-api-test.routes');
const discoveryRoutes = require('./routes/discovery.routes');
const backupRoutes = require('./routes/backup.routes');

// Import middleware
// This section imports custom middleware functions that will be applied to requests.
// These middleware components provide cross-cutting concerns like error handling and logging.
const errorMiddleware = require('./middleware/error.middleware');
const logger = require('./utils/logger');
const { allowedOrigins } = require('./config/cors');
const { getPrisma } = require('./config/database');
const { getRedis } = require('./config/redis');
const { version } = require('../package.json');

const app = express();

// Behind nginx or a load balancer, trust X-Forwarded-For so rate limiting and
// logs see the real client IP. TRUST_PROXY accepts "true", a hop count, or
// Express's named values ("loopback", a subnet list, ...).
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === 'true' ? true : /^\d+$/.test(tp) ? Number(tp) : tp);
}

// Security middleware
// Helmet provides essential security headers to protect against common vulnerabilities like XSS,
// clickjacking, and other attacks. It sets various HTTP headers to secure the application.
app.use(helmet());

// CORS configuration
// Allowed origins come from CORS_ORIGINS / FRONTEND_URL (config/cors.js), shared with Socket.io.
app.use(cors({
  origin: allowedOrigins(),
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
// BODY_LIMIT (default 2mb) caps request bodies; device configs are pulled, not posted.
const bodyLimit = process.env.BODY_LIMIT || '2mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// Rate limiting
// Implements rate limiting to prevent abuse and DDoS attacks by limiting the number of requests
// from a single IP address within a specified time window. Configuration is driven by environment variables.
const windowMs = Number(process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000;
const limiter = rateLimit({
  windowMs,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Stricter limit on credential endpoints to slow password guessing. Only
// failed attempts count, so normal logins and token refreshes aren't throttled.
const authLimiter = rateLimit({
  windowMs,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many failed attempts, please try again later.' },
});
const apiPrefix = process.env.API_PREFIX || '/api/v1';
app.use(`${apiPrefix}/auth/login`, authLimiter);
app.use(`${apiPrefix}/auth/refresh`, authLimiter);

// Request logging with enhanced auth debugging
// Custom middleware that logs all incoming requests with additional detail for authentication routes.
// This provides comprehensive request tracking including IP addresses, user agents, headers, and
// sanitized request bodies (with password redaction for security).
app.use((req, res, next) => {
  const isAuthRoute = req.path.startsWith('/api/v1/auth');

  // Detailed auth request dumps are a development aid only.
  if (isAuthRoute && process.env.NODE_ENV === 'development') {
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
  
  // Health probes arrive every few seconds; logging them would drown the rest.
  if (!req.path.startsWith('/health')) {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  }
  next();
});

// Health check endpoint
// Provides a simple health status endpoint that monitoring systems and load balancers can use
// to verify the application is running and responsive. Returns HTTP 200 with timestamp.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    version,
    timestamp: new Date().toISOString(),
  });
});

// Readiness: the process is up AND its dependencies answer. Container health
// checks and load balancers use this; /health stays a cheap liveness probe.
// Reports only up/down per dependency, never connection details.
app.get('/health/ready', async (req, res) => {
  const withTimeout = (promise) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000).unref()),
  ]);
  const check = async (fn) => {
    try {
      await withTimeout(fn());
      return 'up';
    } catch {
      return 'down';
    }
  };

  const [database, redis] = await Promise.all([
    check(() => getPrisma().$queryRaw`SELECT 1`),
    check(() => getRedis().ping()),
  ]);
  const ready = database === 'up' && redis === 'up';
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'unavailable',
    version,
    checks: { database, redis },
    timestamp: new Date().toISOString(),
  });
});

// API routes
// Mounts all the imported route modules under the configured API prefix (default: /api/v1).
// This creates the main API structure with endpoints for authentication, device management,
// automation workflows, scheduling, and execution history.
app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/devices`, deviceRoutes);
app.use(`${apiPrefix}/automations`, automationRoutes);
app.use(`${apiPrefix}/schedules`, scheduleRoutes);
app.use(`${apiPrefix}/executions`, executionRoutes);
app.use(`${apiPrefix}/settings`, settingsRoutes);
app.use(`${apiPrefix}/device-api`, deviceApiTestRoutes);
app.use(`${apiPrefix}/discovery`, discoveryRoutes);
app.use(`${apiPrefix}/backups`, backupRoutes);

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
