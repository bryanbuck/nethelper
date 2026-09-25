/**
 * File transports shared by utils/logger.js and utils/debug-logger.js.
 *
 *   LOG_DIR    directory for error.log / combined.log (default: logs, relative
 *              to the working directory)
 *   LOG_FILES  "false" disables file logging entirely. Containers set this and
 *              rely on stdout; bare-metal installs keep it on.
 *
 * Files rotate by size (10 MB, 5 kept), so a long-running install can't fill
 * the disk.
 */
const path = require('path');
const winston = require('winston');

const MAX_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

/** @param {string} prefix - filename prefix, so each logger owns its files */
function fileTransports(prefix = '') {
  if (process.env.LOG_FILES === 'false') return [];
  const dir = process.env.LOG_DIR || 'logs';
  const common = { maxsize: MAX_SIZE, maxFiles: MAX_FILES, tailable: true };
  return [
    new winston.transports.File({ filename: path.join(dir, `${prefix}error.log`), level: 'error', ...common }),
    new winston.transports.File({ filename: path.join(dir, `${prefix}combined.log`), ...common }),
  ];
}

module.exports = { fileTransports };
