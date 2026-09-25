/**
 * Startup environment validation.
 *
 * Runs before anything else in server.js. Missing required variables are
 * fatal in every environment. Weak or placeholder secrets are fatal in
 * production and a warning elsewhere, so a dev box with a sample .env still
 * starts. Validated values (including defaults) are written back to
 * process.env, so the rest of the code keeps reading process.env as before.
 */
const Joi = require('joi');

// Values copied from .env.example or old code defaults. A deployment that
// still has one of these is running with a publicly known secret.
const PLACEHOLDER_SECRETS = new Set([
  'your-super-secret-jwt-key',
  'your-super-secret-refresh-key',
  'your-super-secret-encryption-key-minimum-32-characters',
  'default-key-change-this-in-production-for-security',
  'change-me',
  'changeme',
]);

const MIN_SECRET_LENGTH = 32;
const SECRET_KEYS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'];

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  BIND_ADDRESS: Joi.string().default('0.0.0.0'),
  API_PREFIX: Joi.string().default('/api/v1'),

  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  ENCRYPTION_KEY: Joi.string().required(),

  // Comma-separated list of allowed browser origins (see config/cors.js).
  CORS_ORIGINS: Joi.string().allow('').default(''),
  FRONTEND_URL: Joi.string().allow('').optional(),
  // Express "trust proxy" setting; set when running behind nginx/a load balancer.
  TRUST_PROXY: Joi.string().allow('').default(''),
  BODY_LIMIT: Joi.string().default('2mb'),

  RATE_LIMIT_WINDOW: Joi.number().integer().min(1).default(15),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().integer().min(1).default(300),
  AUTH_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(10),

  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly').default('info'),
  // File logging (utils/log-transports.js). Containers turn it off and log to stdout.
  LOG_FILES: Joi.string().valid('true', 'false').default('true'),
  LOG_DIR: Joi.string().optional(),

  // Where config backups live. Defaults are under backend/storage/.
  BACKUP_STORAGE_PATH: Joi.string().optional(),
  BACKUP_GIT_REPO_PATH: Joi.string().optional(),
});

function secretProblems(env) {
  const problems = [];
  for (const key of SECRET_KEYS) {
    const value = env[key];
    if (!value) continue; // already reported as missing by Joi
    if (PLACEHOLDER_SECRETS.has(value) || /^your-/i.test(value)) {
      problems.push(`${key} is a placeholder value from the example config`);
    } else if (value.length < MIN_SECRET_LENGTH) {
      problems.push(`${key} is shorter than ${MIN_SECRET_LENGTH} characters`);
    }
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }
  return problems;
}

/**
 * Validate process.env. Returns the list of non-fatal warnings; throws on a
 * fatal problem so the caller decides how to exit.
 */
function validateEnv(env = process.env) {
  const { error, value } = schema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
    convert: true,
  });

  if (error) {
    const details = error.details.map((d) => d.message).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const problems = secretProblems(value);
  if (problems.length && value.NODE_ENV === 'production') {
    throw new Error(`Insecure secrets for production: ${problems.join('; ')}`);
  }

  // Write validated values (and defaults) back so existing process.env reads see them.
  for (const key of Object.keys(schema.describe().keys)) {
    if (value[key] !== undefined) env[key] = String(value[key]);
  }

  return problems;
}

module.exports = { validateEnv, secretProblems, PLACEHOLDER_SECRETS };
