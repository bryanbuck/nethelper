/**
 * The general API rate limit. A signed-in request counts against its user,
 * everything else against its client IP. Keying by IP alone put every user
 * behind one proxy (nginx, the Vite dev server) in a single bucket unless
 * TRUST_PROXY was set, so one busy browser locked out everybody else.
 *
 * The token is only read to pick the bucket; `authenticate` still decides
 * whether the request is allowed. An invalid or expired token counts against
 * the IP, like an anonymous request.
 */

const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function rateLimitKey(req) {
  const header = req.headers?.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      const { userId } = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      if (userId) return `user:${userId}`;
    } catch {
      // fall through to the IP
    }
  }
  return `ip:${ipKeyGenerator(req.ip || '')}`;
}

function apiLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: rateLimitKey,
    standardHeaders: true,
    legacyHeaders: false,
    // JSON like every other API error; Retry-After says when to try again.
    handler: (req, res, next, options) => {
      res.status(options.statusCode).json({
        success: false,
        error: 'Too many requests. NetHelper limits how many API calls one user can make in a short time.',
        code: 'RATE_LIMITED',
      });
    },
  });
}

module.exports = { apiLimiter, rateLimitKey };
