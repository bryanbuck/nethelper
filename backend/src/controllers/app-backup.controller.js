const fs = require('fs');
const appBackupService = require('../services/app-backup.service');
const logger = require('../utils/logger');

class AppBackupController {
  /** GET /app-backups: settings, tool check, archives, recent runs. */
  async overview(req, res, next) {
    try {
      res.json({ success: true, data: await appBackupService.overview() });
    } catch (error) {
      next(error);
    }
  }

  /** PUT /app-backups/config */
  async saveConfig(req, res, next) {
    try {
      const config = await appBackupService.saveConfig(req.body || {}, req.user.id);
      logger.info(`App backup: config.update by ${req.user.email}`);
      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }

  /** POST /app-backups/run: queue a backup now. */
  async run(req, res, next) {
    try {
      const result = await appBackupService.requestRun(req.user.id);
      logger.info(`App backup: run by ${req.user.email}`);
      res.status(202).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  /** GET /app-backups/:name/download */
  async download(req, res, next) {
    try {
      const file = await appBackupService.resolveArchive(req.params.name);
      logger.info(`App backup: download ${req.params.name} by ${req.user.email}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
      res.setHeader('Cache-Control', 'no-store');
      const stream = fs.createReadStream(file);
      stream.on('error', next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /app-backups/:name */
  async remove(req, res, next) {
    try {
      await appBackupService.deleteArchive(req.params.name);
      logger.info(`App backup: delete ${req.params.name} by ${req.user.email}`);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AppBackupController();
