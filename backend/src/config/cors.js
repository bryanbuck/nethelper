/**
 * Allowed browser origins, shared by Express CORS (app.js) and Socket.io
 * (websocket/socket.handler.js) so the two can't drift apart.
 *
 * Production allows exactly CORS_ORIGINS (comma-separated) plus FRONTEND_URL.
 * When the SPA is served by nginx on the same origin as the API, neither is
 * needed. Development also allows any localhost / private-LAN / .local origin,
 * so a Vite dev server on a workstation IP works without listing it.
 */

const DEV_ORIGIN_PATTERNS = [
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/[a-z0-9.-]+\.local(:\d+)?$/i,
];

function allowedOrigins(env = process.env) {
  const listed = (env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (env.FRONTEND_URL) listed.push(env.FRONTEND_URL.replace(/\/+$/, ''));

  const origins = [...new Set(listed)];
  if (env.NODE_ENV === 'development') origins.push(...DEV_ORIGIN_PATTERNS);
  return origins;
}

module.exports = { allowedOrigins, DEV_ORIGIN_PATTERNS };
