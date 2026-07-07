const configBackupService = require('../services/config-backup.service');
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
      const { backup, content } = await configBackupService.getBackupContent(req.params.backupId);
      res.json({ success: true, data: { ...backup, content } });
    } catch (error) {
      next(error);
    }
  }

  async downloadBackup(req, res, next) {
    try {
      const { backup, content } = await configBackupService.getBackupContent(req.params.backupId);
      const timestamp = backup.createdAt.toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${backup.deviceSerial}_${timestamp}.cfg"`
      );
      res.send(content);
    } catch (error) {
      next(error);
    }
  }

  async diffBackups(req, res, next) {
    try {
      const diff = await configBackupService.diffBackups(req.params.backupId, req.params.otherId);
      res.json({ success: true, data: diff });
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
