const winston = require('winston');
const { redactFormat } = require('./redact');
const { fileTransports } = require('./log-transports');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  // Jest runs are quiet and don't write to logs/.
  silent: process.env.NODE_ENV === 'test',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    redactFormat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'nethelper-backend' },
  transports: fileTransports(),
});

// Console: colorized text in development. In production, the same JSON as the
// files, which Docker and journald collect from stdout.
logger.add(
  process.env.NODE_ENV === 'production'
    ? new winston.transports.Console()
    : new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
);

module.exports = logger;
