const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { CronExpressionParser } = require('cron-parser');
const { getPrisma } = require('../config/database');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const settingsService = require('./settings.service');
const { deviceStorageKey } = require('../utils/device-key');
const devicePollerService = require('./device-poller.service');
const sshDeviceService = require('./ssh-device.service');
const JunosAPI = require('./device-api/junos-api');
const NetconfClient = require('./device-api/netconf-client');
const { isCxRestCapable, detectPlatform } = require('../utils/device-platform');
const { resolveTransport } = require('../utils/transport-router');
const { ARTIFACT_KINDS, describeFormat, kindForFormat, junosDeniedHierarchies } = require('../utils/config-format');
const { unifiedDiff } = require('../utils/config-diff');
const gitBackupService = require('./git-backup.service');
const alertService = require('./alert.service');
const scopeBackupService = require('./scope-backup.service');
const { getQueue } = require('../config/bull');
const { getIO } = require('../websocket/socket.handler');
const logger = require('../utils/logger');

const SCHEDULED_JOB_NAME = 'runScheduled';

const artifact = (format, text) => ({ kind: kindForFormat(format), format, text });

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** A backup warning for the hierarchies a Junos config read withheld, or null. */
function withheldWarning(text) {
  const denied = junosDeniedHierarchies(text);
  return denied.length
    ? `Junos withheld ${denied.join(', ')} from this account; the CLI copy is missing those hierarchies.`
    : null;
}

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

    const includeScopes = Boolean(schedule?.includeScopes);
    if (devices.length === 0 && !includeScopes) {
      logger.warn('Backup run matched no devices', { scheduleId, deviceIds });
      return { total: 0, succeeded: 0, failed: 0 };
    }

    const results = { total: devices.length, succeeded: 0, failed: 0 };
    for (const device of devices) {
      const ok = await this.backupDevice(device, { scheduleId, trigger, triggeredBy });
      if (ok) results.succeeded++;
      else results.failed++;
    }

    // Cloud scopes (Mist org/sites: where AP config lives) ride along on
    // schedules that ask for them. The one push below covers both.
    let scopes = null;
    if (includeScopes) {
      scopes = await scopeBackupService.runScopeBackups({ trigger, triggeredBy, schedule, push: false })
        .catch((error) => {
          logger.error(`Scope backups failed: ${error.message}`);
          return { total: 0, succeeded: 0, failed: 0, unsupported: [], error: error.message };
        });
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

    // One push per run rather than per device: fewer round-trips, and a failed
    // push never fails the run (commits stay local and the next push catches up).
    const push = await gitBackupService.pushIfConfigured().catch((error) => {
      logger.warn(`Config backup git push failed: ${error.message}`);
      return { pushed: false, error: error.message };
    });

    this.emit('backup:run:completed', {
      scheduleId: scheduleId || null,
      ...results,
      ...(scopes && { scopes }),
      gitPushed: push.pushed === true,
    });
    logger.info('Config backup run completed', { scheduleId, ...results, ...(scopes && { scopes }) });
    return { ...results, ...(scopes && { scopes }), gitPushed: push.pushed === true };
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
        deviceSerial: deviceStorageKey(device),
        deviceName: device.name,
        status: 'running',
        trigger,
        scheduleId,
        triggeredBy,
      },
    });

    try {
      const { artifacts, source, warning, device: fullDevice } = await this.pullConfig(device);
      // CLI first: it becomes the primary (ConfigBackup.filePath/format).
      const captured = artifacts
        .filter((a) => a.text && a.text.trim().length > 0)
        .sort((a, b) => ARTIFACT_KINDS.indexOf(a.kind) - ARTIFACT_KINDS.indexOf(b.kind))
        .map((a) => ({
          ...a,
          checksum: crypto.createHash('sha256').update(a.text).digest('hex'),
          sizeBytes: Buffer.byteLength(a.text, 'utf8'),
        }));
      if (captured.length === 0) {
        throw new Error(`${source} returned an empty configuration`);
      }

      // Changed when any artifact differs from the same kind last time (a kind
      // captured for the first time counts as a change).
      const previous = await prisma.configBackup.findFirst({
        where: { deviceId: device.id, status: 'success', id: { not: record.id } },
        orderBy: { createdAt: 'desc' },
        include: { artifacts: true },
      });
      const previousByKind = Object.fromEntries(
        (previous ? this.artifactsOf(previous) : []).map((a) => [a.kind, a.checksum])
      );
      const hasChanges = !previous || captured.some((a) => previousByKind[a.kind] !== a.checksum);

      const safeKey = deviceStorageKey(device).replace(/[^A-Za-z0-9_-]/g, '_');
      const deviceDir = path.join(this.storageDir, safeKey);
      await fs.mkdir(deviceDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      for (const artifact of captured) {
        artifact.filePath = path.join(deviceDir, `${timestamp}_${record.id}.${describeFormat(artifact.format).ext}`);
        await fs.writeFile(artifact.filePath, artifact.text, 'utf8');
      }

      logger.info(`Config backup for ${device.name} pulled via ${source} (${captured.map((a) => a.format).join(', ')})`);

      // Mirror into Git when enabled. Best-effort by design: the flat files
      // above are authoritative and already written, so a git failure must not
      // fail the backup — it is logged and the run continues.
      let commitSha = null;
      try {
        const result = await gitBackupService.commitDeviceConfig({
          device: fullDevice || device,
          artifacts: captured.map(({ format, text }) => ({ format, text })),
          source,
          backupId: record.id,
          trigger,
        });
        commitSha = result.commitSha || null;
      } catch (gitError) {
        logger.warn(`Git mirror failed for ${device.name}: ${gitError.message}`);
      }

      const primary = captured[0];
      const updated = await prisma.configBackup.update({
        where: { id: record.id },
        data: {
          status: 'success',
          filePath: primary.filePath,
          checksum: primary.checksum,
          sizeBytes: primary.sizeBytes,
          hasChanges,
          format: primary.format,
          commitSha,
          warning: warning || null,
          artifacts: {
            create: captured.map(({ kind, format, filePath, checksum, sizeBytes }) => ({
              kind, format, filePath, checksum, sizeBytes,
            })),
          },
        },
      });

      this.emit('backup:completed', {
        backupId: updated.id,
        deviceId: device.id,
        deviceName: device.name,
        hasChanges,
        kinds: captured.map((a) => a.kind),
        ...(warning && { warning }),
      });
      alertService.clear('backup.failed', { subjectKey: `device:${device.id}` });
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
        logger.error(`Config backup failed for device ${device.name} (${deviceStorageKey(device)}):`, error);
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
      // Nothing to back up on this platform is expected, not an alert.
      if (error.name !== 'CapabilityError') {
        alertService.raise('backup.failed', {
          subjectKey: `device:${device.id}`,
          deviceId: device.id,
          title: `Config backup failed for ${device.name}`,
          message: error.message,
          data: { backupId: record.id },
        });
      }
      return false;
    }
  }

  /**
   * Pull a device's configuration over the transports the router deems
   * appropriate for it, in order (see utils/transport-router.js):
   *   - device-rest: the device's own API, by platform —
   *       AOS-CX: REST, preferred even when cloud-managed (local REST *reads*
   *         keep working under Central management and return the complete
   *         running config; the probe piggybacked here also refreshes the
   *         switch-reported cloudManaged state).
   *       Junos:  NETCONF (set-format config). Not enabled by default on Junos,
   *         so a device that refuses the subsystem falls through to SSH below
   *         rather than failing. Cloud-managed (Mist): the cloud's config
   *         object is added as the structured artifact, and any NETCONF
   *         failure falls through to the cloud.
   *   - cloud:       the device's cloud integration (per its capabilities)
   *   - ssh:         the platform's SSH profile (`show running-config`, or
   *                  `show configuration | display set` on Junos)
   * See docs/MULTI_VENDOR_ROADMAP.md section 5.
   *
   * @param {Object} deviceStub - at least { id, serial, name }
   * @returns {Promise<{ artifacts: Array<{kind, format, text}>, source: string, device: Object }>}
   *   One artifact per representation captured. Most transports yield one;
   *   AOS-CX yields the CLI text and the REST JSON. `format` records what each
   *   artifact is ('cli-text', 'junos-set', 'aoscx-json', 'mist-config-json',
   *   ...) and `kind` groups it as 'cli' (pasteable) or 'structured' (JSON),
   *   see utils/config-format.js. It picks the filename in the Git mirror, so
   *   an intent-based JSON snapshot is never mislabelled as a running-config.
   *   `device` is the full row loaded here, so callers need not re-query.
   */
  async pullConfig(deviceStub) {
    const prisma = getPrisma();
    const device = await prisma.device.findUnique({ where: { id: deviceStub.id } });
    if (!device) throw new Error(`Device ${deviceStub.id} not found`);

    const credentials = await settingsService.getDeviceCredentialsForUse(device.id);
    const transports = resolveTransport(device, 'config');
    const skipped = [];
    // Failures a later transport covered for; shown with the backup's source.
    const fallbackReasons = [];

    for (const transport of transports) {
      if (transport === 'device-rest') {
        if (!device.ipAddress || !credentials) {
          skipped.push('device API (needs IP address and linked credentials)');
          continue;
        }

        // AOS-CX keeps its bespoke path: the backup poller also piggybacks the
        // switch-reported cloud-management probe onto this REST session.
        if (isCxRestCapable(device)) {
          await devicePollerService.refreshCentralStatus(device, credentials);
          const result = await devicePollerService.backupPoller(device, credentials);
          const artifacts = [];
          if (result.running_config_cli) {
            artifacts.push(artifact('cli-text', result.running_config_cli));
          }
          const running = result.running_config;
          if (typeof running === 'string') {
            if (!result.running_config_cli) artifacts.push(artifact('cli-text', running));
          } else if (running) {
            artifacts.push(artifact('aoscx-json', JSON.stringify(running, null, 2)));
          }
          return { artifacts, source: 'AOS-CX REST', device };
        }

        if (detectPlatform(device) === 'junos') {
          const api = new JunosAPI(device, credentials);
          let text;
          try {
            text = await api.getConfiguration();
          } catch (error) {
            // NETCONF is not enabled by default on Junos. If the device refused
            // the subsystem, that is not a failure — fall through to the next
            // transport (the SSH CLI when direct, the cloud when cloud-managed).
            if (error.code === NetconfClient.NETCONF_UNAVAILABLE) {
              logger.info(`NETCONF unavailable on ${device.name}; trying the next transport`);
              skipped.push('NETCONF (not enabled on the device)');
              continue;
            }
            // Under cloud management the cloud still holds the device's config,
            // so an unreachable switch or a wrong password costs the CLI copy,
            // not the backup. Direct devices have no such fallback.
            if (transports.includes('cloud')) {
              logger.warn(`NETCONF failed on ${device.name}; falling back to the cloud: ${error.message}`);
              skipped.push(`NETCONF (${error.message})`);
              fallbackReasons.push(`NETCONF failed: ${error.message}`);
              continue;
            }
            throw error;
          }
          const artifacts = [artifact('junos-set', text)];
          let source = 'Junos NETCONF';
          const withheld = withheldWarning(text);
          // Cloud-managed: the cloud's config object too, as the structured
          // artifact (like AOS-CX's CLI + JSON). Best-effort.
          if (transports.includes('cloud')) {
            const snapshot = await this.cloudSnapshot(device);
            if (snapshot) {
              artifacts.push(artifact(snapshot.format, snapshot.text));
              source = `${source} + ${snapshot.source}`;
            }
          }
          return { artifacts, source, ...(withheld && { warning: withheld }), device };
        }

        skipped.push(`device API (no client for platform "${detectPlatform(device)}")`);
        continue;
      }

      if (transport === 'cloud') {
        const provider = await CloudProviderFactory.forDevice(device);
        // CapabilityError (e.g. Central's quarantined config endpoints)
        // propagates as-is: an honest "not supported" beats a fake retry,
        // and we never SSH into cloud-managed devices.
        const config = await provider.getDeviceConfiguration(device.serial);
        await this.recordCloudManaged(device, config);
        // Providers return { text, format, source } per BaseCloudProvider.
        // Intent-based clouds (Mist, and Meraki later) yield a canonical-JSON
        // settings snapshot rather than a CLI running-config; `format` records
        // which, so the UI can label the backup honestly.
        const text = typeof config === 'string' ? config : config.text;
        const format = (typeof config === 'object' && config.format) || 'cli-text';
        const source = config.source || provider.label;
        return {
          artifacts: [artifact(format, text)],
          source: fallbackReasons.length ? `${source} (${fallbackReasons.join('; ')})` : source,
          // Shown on the backup: it succeeded, but without the device's own copy.
          ...(fallbackReasons.length && { warning: `Only the cloud's copy was taken. ${fallbackReasons.join('; ')}` }),
          device,
        };
      }

      if (transport === 'ssh') {
        if (!credentials) {
          throw new Error(`No credentials linked to device "${device.name}" for direct backup`);
        }
        const text = await sshDeviceService.getRunningConfig(device, credentials);
        const junos = detectPlatform(device) === 'junos';
        const withheld = junos ? withheldWarning(text) : null;
        return {
          artifacts: [artifact(junos ? 'junos-set' : 'cli-text', text)],
          source: 'SSH',
          ...(withheld && { warning: withheld }),
          device,
        };
      }
    }

    throw new Error(
      `No transport available to back up "${device.name}"`
      + (skipped.length ? ` — skipped: ${skipped.join('; ')}` : '')
    );
  }

  /**
   * The cloud's config object for a device read over its own API, or null
   * when the cloud has none (a CapabilityError) or can't be reached right now.
   */
  async cloudSnapshot(device) {
    try {
      const provider = await CloudProviderFactory.forDevice(device);
      const config = await provider.getDeviceConfiguration(device.serial);
      await this.recordCloudManaged(device, config);
      return { text: config.text, format: config.format, source: config.source || provider.label };
    } catch (error) {
      logger.info(`No cloud config snapshot for ${device.name}: ${error.message}`);
      return null;
    }
  }

  /**
   * A cloud config read can say whether the cloud owns the device's config
   * (Mist's `mist_configured`). Record it, unless the switch itself answered
   * (the AOS-CX Central probe), which outranks the cloud.
   */
  async recordCloudManaged(device, config) {
    if (typeof config?.cloudManaged !== 'boolean' || device.cloudManagedSource === 'switch-rest') return;
    try {
      await getPrisma().device.update({
        where: { id: device.id },
        data: { cloudManaged: config.cloudManaged, cloudManagedSource: 'cloud-config', cloudManagedCheckedAt: new Date() },
      });
    } catch (error) {
      logger.warn(`Could not record cloud management for ${device.name}: ${error.message}`);
    }
  }

  /**
   * Apply a schedule's retention policy to the given devices: keep at most
   * retentionMaxCount successful backups per device and drop anything older
   * than retentionDays. Zero disables the respective limit.
   *
   * This prunes NetHelper's own rows and flat files only. The Git mirror's
   * history is deliberately left intact — keeping every version cheaply is the
   * reason the mirror exists, and rewriting history would mean a force-push
   * that breaks any existing clone. Not an oversight.
   */
  async pruneRetention(deviceIds, schedule) {
    const prisma = getPrisma();
    const { retentionDays, retentionMaxCount } = schedule;
    if (!retentionDays && !retentionMaxCount) return;

    for (const deviceId of deviceIds) {
      const backups = await prisma.configBackup.findMany({
        where: { deviceId, status: 'success' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, filePath: true, createdAt: true, artifacts: { select: { filePath: true } } },
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
        await this.unlinkFiles(backup);
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
        include: {
          schedule: { select: { id: true, name: true } },
          artifacts: { select: { kind: true, format: true, sizeBytes: true } },
        },
      }),
      prisma.configBackup.count({ where }),
    ]);
    return { backups, total };
  }

  async getBackup(backupId) {
    const prisma = getPrisma();
    const backup = await prisma.configBackup.findUnique({
      where: { id: backupId },
      include: {
        schedule: { select: { id: true, name: true } },
        artifacts: { select: { kind: true, format: true, sizeBytes: true, checksum: true, filePath: true } },
      },
    });
    if (!backup) {
      const error = new Error('Backup not found');
      error.statusCode = 404;
      throw error;
    }
    return backup;
  }

  /**
   * The artifacts a backup holds, CLI first. Rows from before artifacts
   * existed have none, so their single file stands in as one artifact.
   */
  artifactsOf(backup) {
    const rows = backup.artifacts && backup.artifacts.length
      ? backup.artifacts
      : (backup.filePath && backup.checksum
        ? [{
          kind: kindForFormat(backup.format),
          format: backup.format || 'cli-text',
          filePath: backup.filePath,
          checksum: backup.checksum,
          sizeBytes: backup.sizeBytes,
        }]
        : []);
    return [...rows].sort((a, b) => ARTIFACT_KINDS.indexOf(a.kind) - ARTIFACT_KINDS.indexOf(b.kind));
  }

  /**
   * One artifact's content. `kind` is 'cli' | 'structured'; omitted, the
   * primary (ConfigBackup.filePath, CLI when there is one).
   */
  async getBackupContent(backupId, kind) {
    const backup = await this.getBackup(backupId);
    const artifacts = backup.status === 'success' ? this.artifactsOf(backup) : [];
    if (artifacts.length === 0) {
      throw badRequest('Backup has no stored configuration');
    }
    const chosen = kind
      ? artifacts.find((a) => a.kind === kind)
      : (artifacts.find((a) => a.filePath === backup.filePath) || artifacts[0]);
    if (!chosen) {
      throw badRequest(`Backup has no ${kind === 'cli' ? 'CLI' : 'structured (JSON)'} configuration`);
    }
    const content = await fs.readFile(chosen.filePath, 'utf8');
    return { backup, content, artifact: { kind: chosen.kind, format: chosen.format } };
  }

  /**
   * Unified diff between two backups (typically of the same device), of one
   * artifact kind both hold. Omitted, CLI is preferred when both have it, so
   * an old JSON-only AOS-CX backup still diffs against a new one by JSON.
   */
  async diffBackups(fromId, toId, kind) {
    const [fromBackup, toBackup] = await Promise.all([this.getBackup(fromId), this.getBackup(toId)]);
    const kindsOf = (b) => (b.status === 'success' ? this.artifactsOf(b).map((a) => a.kind) : []);
    const fromKinds = kindsOf(fromBackup);
    const toKinds = kindsOf(toBackup);
    const common = ARTIFACT_KINDS.filter((k) => fromKinds.includes(k) && toKinds.includes(k));
    const chosen = kind || common[0];
    if (!chosen || !common.includes(chosen)) {
      throw badRequest(kind
        ? `Both backups need a ${kind === 'cli' ? 'CLI' : 'structured (JSON)'} configuration to compare`
        : 'These backups have no configuration format in common to compare');
    }

    const [from, to] = await Promise.all([
      this.getBackupContent(fromId, chosen),
      this.getBackupContent(toId, chosen),
    ]);
    const { patch, additions, deletions } = unifiedDiff(
      `${from.backup.deviceName} @ ${from.backup.createdAt.toISOString()}`,
      `${to.backup.deviceName} @ ${to.backup.createdAt.toISOString()}`,
      from.content,
      to.content
    );

    return {
      from: { id: from.backup.id, createdAt: from.backup.createdAt, deviceName: from.backup.deviceName },
      to: { id: to.backup.id, createdAt: to.backup.createdAt, deviceName: to.backup.deviceName },
      kind: chosen,
      kinds: common,
      identical: from.content === to.content,
      additions,
      deletions,
      patch,
    };
  }

  /**
   * Git commit history for a backup's device. Empty when the mirror is off.
   * Backed by `git log`, so it outlives retention pruning of the rows.
   */
  async getBackupHistory(backupId, limit = 50) {
    const backup = await this.getBackup(backupId);
    const commits = await gitBackupService.getDeviceHistory(backup.deviceSerial, limit);
    return { deviceSerial: backup.deviceSerial, deviceName: backup.deviceName, commits };
  }

  async deleteBackup(backupId) {
    const prisma = getPrisma();
    const backup = await this.getBackup(backupId);
    await this.unlinkFiles(backup);
    await prisma.configBackup.delete({ where: { id: backupId } });
  }

  /** Remove every flat file a backup row points at (artifacts cascade in the DB). */
  async unlinkFiles(backup) {
    const paths = new Set([backup.filePath, ...(backup.artifacts || []).map((a) => a.filePath)]);
    for (const filePath of paths) {
      if (filePath) await fs.unlink(filePath).catch(() => {});
    }
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
        includeScopes: data.includeScopes === true,
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
        includeScopes: data.includeScopes ?? undefined,
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
