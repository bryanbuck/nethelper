const configBackupService = require('../services/config-backup.service');
const scopeBackupService = require('../services/scope-backup.service');
const { describeFormat } = require('../utils/config-format');
const { getQueue } = require('../config/bull');

class BackupController {
  async getBackups(req, res, next) {
    try {
      const { deviceId, scheduleId, status, limit, offset } = req.query;
      const { backups, total } = await configBackupService.getBackups({
        deviceId,
        scheduleId,
        status,
        limit,
        offset,
      });
      res.json({ success: true, data: backups, total });
    } catch (error) {
      next(error);
    }
  }

  async runBackup(req, res, next) {
    try {
      const { deviceIds } = req.body;
      const job = await getQueue('configBackup').add(
        'runBackup',
        { deviceIds, triggeredBy: req.user.id },
        { attempts: 1 }
      );
      res.status(202).json({
        success: true,
        message: `Backup queued for ${deviceIds.length} device(s)`,
        jobId: job.id,
      });
    } catch (error) {
      next(error);
    }
  }

  async getBackup(req, res, next) {
    try {
      const backup = await configBackupService.getBackup(req.params.backupId);
      res.json({ success: true, data: backup });
    } catch (error) {
      next(error);
    }
  }

  async getBackupContent(req, res, next) {
    try {
      const { backup, content, artifact } = await configBackupService.getBackupContent(
        req.params.backupId,
        req.query.kind
      );
      res.json({ success: true, data: { ...backup, content, artifact } });
    } catch (error) {
      next(error);
    }
  }

  async downloadBackup(req, res, next) {
    try {
      const { backup, content, artifact } = await configBackupService.getBackupContent(
        req.params.backupId,
        req.query.kind
      );
      const timestamp = backup.createdAt.toISOString().replace(/[:.]/g, '-');
      const { ext } = describeFormat(artifact.format);
      res.setHeader('Content-Type', ext === 'json' ? 'application/json' : 'text/plain');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${backup.deviceSerial}_${timestamp}.${ext}"`
      );
      res.send(content);
    } catch (error) {
      next(error);
    }
  }

  async diffBackups(req, res, next) {
    try {
      const diff = await configBackupService.diffBackups(req.params.backupId, req.params.otherId, req.query.kind);
      res.json({ success: true, data: diff });
    } catch (error) {
      next(error);
    }
  }

  async getBackupHistory(req, res, next) {
    try {
      const data = await configBackupService.getBackupHistory(req.params.backupId, req.query.limit);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async deleteBackup(req, res, next) {
    try {
      await configBackupService.deleteBackup(req.params.backupId);
      res.json({ success: true, message: 'Backup deleted' });
    } catch (error) {
      next(error);
    }
  }

  // --- Cloud scopes (Mist org/sites, ...) ---

  async getScopeBackups(req, res, next) {
    try {
      const { integrationId, provider, scopeType, scopeId, status, limit, offset } = req.query;
      const { backups, total } = await scopeBackupService.getScopeBackups({
        integrationId, provider, scopeType, scopeId, status, limit, offset,
      });
      res.json({ success: true, data: backups, total });
    } catch (error) {
      next(error);
    }
  }

  async runScopeBackup(req, res, next) {
    try {
      const integrationId = req.body?.integrationId || null;
      const job = await getQueue('configBackup').add(
        'runScopeBackup',
        { integrationId, triggeredBy: req.user.id },
        { attempts: 1 }
      );
      res.status(202).json({ success: true, message: 'Cloud scope backup queued', jobId: job.id });
    } catch (error) {
      next(error);
    }
  }

  async getScopeBackup(req, res, next) {
    try {
      const backup = await scopeBackupService.getScopeBackup(req.params.scopeBackupId);
      res.json({ success: true, data: backup });
    } catch (error) {
      next(error);
    }
  }

  async getScopeBackupContent(req, res, next) {
    try {
      const { backup, content } = await scopeBackupService.getScopeBackupContent(req.params.scopeBackupId);
      res.json({ success: true, data: { ...backup, content } });
    } catch (error) {
      next(error);
    }
  }

  async downloadScopeBackup(req, res, next) {
    try {
      const { backup, content } = await scopeBackupService.getScopeBackupContent(req.params.scopeBackupId);
      const timestamp = backup.createdAt.toISOString().replace(/[:.]/g, '-');
      const name = `${backup.scopeType}-${backup.scopeName}`.replace(/[^A-Za-z0-9_-]/g, '_');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${name}_${timestamp}.${describeFormat(backup.format).ext}"`);
      res.send(content);
    } catch (error) {
      next(error);
    }
  }

  async diffScopeBackups(req, res, next) {
    try {
      const diff = await scopeBackupService.diffScopeBackups(req.params.scopeBackupId, req.params.otherId);
      res.json({ success: true, data: diff });
    } catch (error) {
      next(error);
    }
  }

  async deleteScopeBackup(req, res, next) {
    try {
      await scopeBackupService.deleteScopeBackup(req.params.scopeBackupId);
      res.json({ success: true, message: 'Scope backup deleted' });
    } catch (error) {
      next(error);
    }
  }

  // --- Schedules ---

  async getSchedules(req, res, next) {
    try {
      const schedules = await configBackupService.getSchedules();
      res.json({ success: true, data: schedules, count: schedules.length });
    } catch (error) {
      next(error);
    }
  }

  async createSchedule(req, res, next) {
    try {
      const schedule = await configBackupService.createSchedule(req.body, req.user.id);
      res.status(201).json({ success: true, data: schedule });
    } catch (error) {
      next(error);
    }
  }

  async updateSchedule(req, res, next) {
    try {
      const schedule = await configBackupService.updateSchedule(req.params.scheduleId, req.body);
      res.json({ success: true, data: schedule });
    } catch (error) {
      next(error);
    }
  }

  async deleteSchedule(req, res, next) {
    try {
      await configBackupService.deleteSchedule(req.params.scheduleId);
      res.json({ success: true, message: 'Schedule deleted' });
    } catch (error) {
      next(error);
    }
  }

  async runScheduleNow(req, res, next) {
    try {
      const job = await getQueue('configBackup').add(
        'runScheduled',
        { scheduleId: req.params.scheduleId },
        { attempts: 1 }
      );
      res.status(202).json({ success: true, message: 'Schedule run queued', jobId: job.id });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new BackupController();
