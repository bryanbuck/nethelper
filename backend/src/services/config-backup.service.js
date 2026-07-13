const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const Diff = require('diff');
const { CronExpressionParser } = require('cron-parser');
const { getPrisma } = require('../config/database');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const settingsService = require('./settings.service');
const devicePollerService = require('./device-poller.service');
const sshDeviceService = require('./ssh-device.service');
const { isCxRestCapable } = require('../utils/device-platform');
const { resolveTransport } = require('../utils/transport-router');
const { getQueue } = require('../config/bull');
const { getIO } = require('../websocket/socket.handler');
const logger = require('../utils/logger');

const SCHEDULED_JOB_NAME = 'runScheduled';

class ConfigBackupService {
  constructor() {
    this.storageDir = process.env.BACKUP_STORAGE_PATH
      || path.resolve(__dirname, '../../storage/config-backups');
  }

  emit(event, data) {
    try {
      getIO().emit(event, data);
    } catch (error) {
      // Socket not initialized - state is still persisted in the DB
    }
  }

  scheduleJobId(scheduleId) {
    return `backup-schedule-${scheduleId}`;
  }

  parseCron(cronExpression, timezone) {
    try {
      return CronExpressionParser.parse(cronExpression, { tz: timezone || 'UTC' });
    } catch (error) {
      const err = new Error(`Invalid cron expression "${cronExpression}": ${error.message}`);
      err.statusCode = 400;
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Backup execution
  // ---------------------------------------------------------------------

  /**
   * Resolve the devices a schedule applies to.
   * deviceSelection: { mode: 'all' | 'types' | 'devices', types?: [], deviceIds?: [] }
   */
  async resolveDevices(deviceSelection) {
    const prisma = getPrisma();
    const selection = deviceSelection || { mode: 'all' };
    const where = {};
    if (selection.mode === 'types') {
      where.type = { in: selection.types || [] };
    } else if (selection.mode === 'devices') {
      where.id = { in: selection.deviceIds || [] };
    }
    return prisma.device.findMany({
      where,
      select: { id: true, serial: true, name: true },
    });
  }

  /**
   * Run backups for a set of devices. Devices are processed sequentially to
   * stay well inside Aruba Central rate limits.
   */
  async runBackupBatch({ deviceIds, scheduleId, trigger = 'manual', triggeredBy = null }) {
    const prisma = getPrisma();

    let devices;
    let schedule = null;
    if (scheduleId) {
      schedule = await prisma.backupSchedule.findUnique({ where: { id: scheduleId } });
      if (!schedule) throw new Error(`Backup schedule ${scheduleId} not found`);
      devices = await this.resolveDevices(schedule.deviceSelection);
    } else {
      devices = await prisma.device.findMany({
        where: { id: { in: deviceIds || [] } },
        select: { id: true, serial: true, name: true },
      });
    }

    if (devices.length === 0) {
      logger.warn('Backup run matched no devices', { scheduleId, deviceIds });
      return { total: 0, succeeded: 0, failed: 0 };
    }

    const results = { total: devices.length, succeeded: 0, failed: 0 };
    for (const device of devices) {
      const ok = await this.backupDevice(device, { scheduleId, trigger, triggeredBy });
      if (ok) results.succeeded++;
      else results.failed++;
    }

    if (schedule) {
      await this.pruneRetention(devices.map((d) => d.id), schedule);
      await prisma.backupSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRun: new Date(),
          nextRun: this.parseCron(schedule.cronExpression, schedule.timezone).next().toDate(),
        },
      });
    }

    this.emit('backup:run:completed', { scheduleId: scheduleId || null, ...results });
    logger.info('Config backup run completed', { scheduleId, ...results });
    return results;
  }

  /**
   * Back up a single device's configuration from Aruba Central to local
   * storage. Returns true on success.
   */
  async backupDevice(device, { scheduleId = null, trigger = 'manual', triggeredBy = null } = {}) {
    const prisma = getPrisma();
    const record = await prisma.configBackup.create({
      data: {
        deviceId: device.id,
        deviceSerial: device.serial,
        deviceName: device.name,
        status: 'running',
        trigger,
        scheduleId,
        triggeredBy,
      },
    });

    try {
      const { text, source } = await this.pullConfig(device);
      if (!text || text.trim().length === 0) {
        throw new Error(`${source} returned an empty configuration`);
      }

      const checksum = crypto.createHash('sha256').update(text).digest('hex');
      const previous = await prisma.configBackup.findFirst({
        where: { deviceId: device.id, status: 'success', id: { not: record.id } },
        orderBy: { createdAt: 'desc' },
        select: { checksum: true },
      });
      const hasChanges = !previous || previous.checksum !== checksum;

      const safeSerial = device.serial.replace(/[^A-Za-z0-9_-]/g, '_');
      const deviceDir = path.join(this.storageDir, safeSerial);
      await fs.mkdir(deviceDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(deviceDir, `${timestamp}_${record.id}.cfg`);
      await fs.writeFile(filePath, text, 'utf8');

      logger.info(`Config backup for ${device.name} pulled via ${source}`);

      const updated = await prisma.configBackup.update({
        where: { id: record.id },
        data: {
          status: 'success',
          filePath,
          checksum,
          sizeBytes: Buffer.byteLength(text, 'utf8'),
          hasChanges,
        },
      });

      this.emit('backup:completed', {
        backupId: updated.id,
        deviceId: device.id,
        deviceName: device.name,
        hasChanges,
      });
      return true;
    } catch (error) {
      // A CapabilityError means the device's platform genuinely has nothing to
      // back up (e.g. Mist configures APs via site/WLAN templates, not
      // per-device config). That is expected on an "all devices" schedule, so
      // it is a warning, not an error — but it is still recorded on the backup
      // row so the reason is visible in the UI.
      if (error.name === 'CapabilityError') {
        logger.warn(`Config backup not supported for ${device.name}: ${error.message}`);
      } else {
        logger.error(`Config backup failed for device ${device.serial}:`, error);
      }
      await prisma.configBackup.update({
        where: { id: record.id },
        data: { status: 'failed', error: error.message },
      });
      this.emit('backup:failed', {
        backupId: record.id,
        deviceId: device.id,
        deviceName: device.name,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Pull a device's configuration over the transports the router deems
   * appropriate for it, in order (see utils/transport-router.js):
   *   - device-rest: AOS-CX REST, preferred even when cloud-managed. Local
   *     REST *reads* keep working when a switch is Central-managed and return
   *     the complete running config; the probe piggybacked here also
   *     refreshes the switch-reported cloudManaged state.
   *   - cloud:       the device's cloud integration (per its capabilities)
   *   - ssh:         `show running-config` over the platform's SSH profile
   * See docs/CENTRAL_MANAGEMENT_MODE_PLAN.md section 3.3 and
   * docs/MULTI_VENDOR_ROADMAP.md section 5.
   *
   * @param {Object} deviceStub - at least { id, serial, name }
   * @returns {Promise<{ text: string, source: string }>}
   */
  async pullConfig(deviceStub) {
    const prisma = getPrisma();
    const device = await prisma.device.findUnique({ where: { id: deviceStub.id } });
    if (!device) throw new Error(`Device ${deviceStub.id} not found`);

    const credentials = await settingsService.getDeviceCredentialsForUse(device.id);
    const transports = resolveTransport(device, 'config');
    const skipped = [];

    for (const transport of transports) {
      if (transport === 'device-rest') {
        if (!(isCxRestCapable(device) && device.ipAddress && credentials)) {
          skipped.push('device-rest (needs IP address and linked credentials)');
          continue;
        }
        // Refresh the switch-reported cloud-management state first
        // (best-effort; never blocks the backup).
        await devicePollerService.refreshCentralStatus(device, credentials);
        const result = await devicePollerService.backupPoller(device, credentials);
        const running = result.running_config;
        const text = typeof running === 'string' ? running : JSON.stringify(running, null, 2);
        return { text, source: 'AOS-CX REST' };
      }

      if (transport === 'cloud') {
        const provider = await CloudProviderFactory.forDevice(device);
        // CapabilityError (e.g. Central's quarantined config endpoints)
        // propagates as-is: an honest "not supported" beats a fake retry,
        // and we never SSH into cloud-managed devices.
        const config = await provider.getDeviceConfiguration(device.serial);
        // Providers return { text, format, source } per BaseCloudProvider.
        // Intent-based clouds (Mist, and Meraki later) yield a canonical-JSON
        // settings snapshot rather than a CLI running-config; `format` records
        // which, so the UI can label the backup honestly.
        const text = typeof config === 'string' ? config : config.text;
        return { text, source: config.source || provider.label };
      }

      if (transport === 'ssh') {
        if (!credentials) {
          throw new Error(`No credentials linked to device "${device.name}" for direct backup`);
        }
        const text = await sshDeviceService.getRunningConfig(device, credentials);
        return { text, source: 'SSH' };
      }
    }

    throw new Error(
      `No transport available to back up "${device.name}"`
      + (skipped.length ? ` — skipped: ${skipped.join('; ')}` : '')
    );
  }

  /**
   * Apply a schedule's retention policy to the given devices: keep at most
   * retentionMaxCount successful backups per device and drop anything older
   * than retentionDays. Zero disables the respective limit.
   */
  async pruneRetention(deviceIds, schedule) {
    const prisma = getPrisma();
    const { retentionDays, retentionMaxCount } = schedule;
    if (!retentionDays && !retentionMaxCount) return;

    for (const deviceId of deviceIds) {
      const backups = await prisma.configBackup.findMany({
        where: { deviceId, status: 'success' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, filePath: true, createdAt: true },
      });

      const cutoff = retentionDays
        ? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
        : null;
      const toDelete = backups.filter((b, index) => {
        if (retentionMaxCount && index >= retentionMaxCount) return true;
        if (cutoff && b.createdAt < cutoff) return true;
        return false;
      });

      for (const backup of toDelete) {
        if (backup.filePath) {
          await fs.unlink(backup.filePath).catch(() => {});
        }
        await prisma.configBackup.delete({ where: { id: backup.id } });
      }
      if (toDelete.length > 0) {
        logger.info(`Retention pruned ${toDelete.length} backup(s) for device ${deviceId}`);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Backup queries, content, diff
  // ---------------------------------------------------------------------

  async getBackups(filters = {}) {
    const prisma = getPrisma();
    const { deviceId, scheduleId, status, limit = 50, offset = 0 } = filters;
    const where = {};
    if (deviceId) where.deviceId = deviceId;
    if (scheduleId) where.scheduleId = scheduleId;
    if (status) where.status = status;

    const [backups, total] = await Promise.all([
      prisma.configBackup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(limit), 200),
        skip: Number(offset),
        include: { schedule: { select: { id: true, name: true } } },
      }),
      prisma.configBackup.count({ where }),
    ]);
    return { backups, total };
  }

  async getBackup(backupId) {
    const prisma = getPrisma();
    const backup = await prisma.configBackup.findUnique({
      where: { id: backupId },
      include: { schedule: { select: { id: true, name: true } } },
    });
    if (!backup) {
      const error = new Error('Backup not found');
      error.statusCode = 404;
      throw error;
    }
    return backup;
  }

  async getBackupContent(backupId) {
    const backup = await this.getBackup(backupId);
    if (backup.status !== 'success' || !backup.filePath) {
      const error = new Error('Backup has no stored configuration');
      error.statusCode = 400;
      throw error;
    }
    const content = await fs.readFile(backup.filePath, 'utf8');
    return { backup, content };
  }

  /**
   * Unified diff between two backups (typically of the same device).
   */
  async diffBackups(fromId, toId) {
    const [from, to] = await Promise.all([
      this.getBackupContent(fromId),
      this.getBackupContent(toId),
    ]);

    const patch = Diff.createTwoFilesPatch(
      `${from.backup.deviceName} @ ${from.backup.createdAt.toISOString()}`,
      `${to.backup.deviceName} @ ${to.backup.createdAt.toISOString()}`,
      from.content,
      to.content
    );

    let additions = 0;
    let deletions = 0;
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    return {
      from: { id: from.backup.id, createdAt: from.backup.createdAt, deviceName: from.backup.deviceName },
      to: { id: to.backup.id, createdAt: to.backup.createdAt, deviceName: to.backup.deviceName },
      identical: from.backup.checksum === to.backup.checksum,
      additions,
      deletions,
      patch,
    };
  }

  async deleteBackup(backupId) {
    const prisma = getPrisma();
    const backup = await this.getBackup(backupId);
    if (backup.filePath) {
      await fs.unlink(backup.filePath).catch(() => {});
    }
    await prisma.configBackup.delete({ where: { id: backupId } });
  }

  // ---------------------------------------------------------------------
  // Schedule CRUD + Bull repeatable job registration
  // ---------------------------------------------------------------------

  async getSchedules() {
    const prisma = getPrisma();
    return prisma.backupSchedule.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { backups: true } } },
    });
  }

  async createSchedule(data, userId) {
    const prisma = getPrisma();
    const interval = this.parseCron(data.cronExpression, data.timezone);

    const schedule = await prisma.backupSchedule.create({
      data: {
        name: data.name,
        cronExpression: data.cronExpression,
        timezone: data.timezone || 'UTC',
        active: data.active !== false,
        deviceSelection: data.deviceSelection || { mode: 'all' },
        retentionDays: data.retentionDays ?? 90,
        retentionMaxCount: data.retentionMaxCount ?? 30,
        nextRun: interval.next().toDate(),
        createdBy: userId || null,
      },
    });

    if (schedule.active) {
      await this.registerSchedule(schedule);
    }
    return schedule;
  }

  async updateSchedule(scheduleId, data) {
    const prisma = getPrisma();
    const existing = await prisma.backupSchedule.findUnique({ where: { id: scheduleId } });
    if (!existing) {
      const error = new Error('Backup schedule not found');
      error.statusCode = 404;
      throw error;
    }

    const cronExpression = data.cronExpression || existing.cronExpression;
    const timezone = data.timezone || existing.timezone;
    const interval = this.parseCron(cronExpression, timezone);

    await this.unregisterSchedule(existing);

    const schedule = await prisma.backupSchedule.update({
      where: { id: scheduleId },
      data: {
        name: data.name ?? undefined,
        cronExpression,
        timezone,
        active: data.active ?? undefined,
        deviceSelection: data.deviceSelection ?? undefined,
        retentionDays: data.retentionDays ?? undefined,
        retentionMaxCount: data.retentionMaxCount ?? undefined,
        nextRun: interval.next().toDate(),
      },
    });

    if (schedule.active) {
      await this.registerSchedule(schedule);
    }
    return schedule;
  }

  async deleteSchedule(scheduleId) {
    const prisma = getPrisma();
    const existing = await prisma.backupSchedule.findUnique({ where: { id: scheduleId } });
    if (!existing) {
      const error = new Error('Backup schedule not found');
      error.statusCode = 404;
      throw error;
    }
    await this.unregisterSchedule(existing);
    await prisma.backupSchedule.delete({ where: { id: scheduleId } });
  }

  async registerSchedule(schedule) {
    const queue = getQueue('configBackup');
    await queue.add(
      SCHEDULED_JOB_NAME,
      { scheduleId: schedule.id },
      {
        repeat: { cron: schedule.cronExpression, tz: schedule.timezone },
        jobId: this.scheduleJobId(schedule.id),
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    logger.info(`Registered backup schedule "${schedule.name}" (${schedule.cronExpression} ${schedule.timezone})`);
  }

  async unregisterSchedule(schedule) {
    const queue = getQueue('configBackup');
    await queue.removeRepeatable(SCHEDULED_JOB_NAME, {
      cron: schedule.cronExpression,
      tz: schedule.timezone,
      jobId: this.scheduleJobId(schedule.id),
    }).catch(() => {});
  }

  /**
   * Reconcile Bull repeatable jobs with the schedules stored in the DB.
   * Called once at server startup: drops orphaned repeatables and registers
   * every active schedule.
   */
  async syncSchedules() {
    const prisma = getPrisma();
    const queue = getQueue('configBackup');

    const repeatables = await queue.getRepeatableJobs();
    for (const job of repeatables) {
      if (job.id && job.id.startsWith('backup-schedule-')) {
        await queue.removeRepeatableByKey(job.key).catch(() => {});
      }
    }

    const schedules = await prisma.backupSchedule.findMany({ where: { active: true } });
    for (const schedule of schedules) {
      await this.registerSchedule(schedule);
    }
    logger.info(`Backup schedule sync complete: ${schedules.length} active schedule(s) registered`);
  }
}

module.exports = new ConfigBackupService();
