const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { getPrisma } = require('../config/database');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const gitBackupService = require('./git-backup.service');
const alertService = require('./alert.service');
const { describeFormat } = require('../utils/config-format');
const { unifiedDiff } = require('../utils/config-diff');
const { getIO } = require('../websocket/socket.handler');
const logger = require('../utils/logger');

const safe = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '_');
const scopeSubject = (identity) => `scope:${identity.integrationId}:${identity.scopeType}:${identity.scopeId}`;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Cloud-scope configuration backups: the config a cloud plane holds above the
 * device (a Mist org or site, a Central group). Access points have no
 * per-device config on either plane, so this is where their configuration is
 * captured. Read-only; nothing here writes to a cloud.
 *
 * Mirrors config-backup.service for device backups: flat files under
 * BACKUP_STORAGE_PATH/_scopes are authoritative, the Git mirror is additive
 * and best-effort, and a CapabilityError means "this plane can't" (recorded,
 * never faked).
 */
class ScopeBackupService {
  constructor() {
    this.storageDir = path.join(
      process.env.BACKUP_STORAGE_PATH || path.resolve(__dirname, '../../storage/config-backups'),
      '_scopes'
    );
  }

  emit(event, data) {
    try {
      getIO().emit(event, data);
    } catch (error) {
      // Socket not initialized - state is still persisted in the DB
    }
  }

  /**
   * Back up every scope of every active integration (or just one).
   * Integrations whose provider has no scope support are reported, not failed.
   *
   * @param {Object} [options]
   * @param {string} [options.integrationId] - limit to one integration
   * @param {Object} [options.schedule] - apply this schedule's retention afterwards
   * @param {boolean} [options.push=true] - push the Git mirror once at the end
   *   (false when a device batch pushes for both)
   */
  async runScopeBackups({ integrationId = null, trigger = 'manual', triggeredBy = null, schedule = null, push = true } = {}) {
    const providers = (await CloudProviderFactory.activeProviders())
      .filter((p) => !integrationId || p.id === integrationId);

    const results = { total: 0, succeeded: 0, failed: 0, unsupported: [] };
    for (const provider of providers) {
      if (!provider.supports('scope-backup')) {
        results.unsupported.push(provider.label);
        logger.info(`Scope backup not supported by ${provider.label}; skipping`);
        continue;
      }

      let scopes;
      try {
        scopes = await provider.listConfigScopes();
      } catch (error) {
        logger.error(`Could not list configuration scopes of ${provider.label}: ${error.message}`);
        results.failed++;
        continue;
      }

      for (const scope of scopes) {
        results.total++;
        const ok = await this.backupScope(provider, scope, { trigger, triggeredBy, scheduleId: schedule?.id || null });
        if (ok) results.succeeded++;
        else results.failed++;
      }
    }

    if (schedule) await this.pruneRetention(schedule);

    let gitPushed = false;
    if (push) {
      const pushed = await gitBackupService.pushIfConfigured().catch((error) => {
        logger.warn(`Config backup git push failed: ${error.message}`);
        return { pushed: false };
      });
      gitPushed = pushed.pushed === true;
      this.emit('backup:run:completed', { scope: true, scheduleId: schedule?.id || null, ...results, gitPushed });
    }

    logger.info('Scope backup run completed', results);
    return { ...results, gitPushed };
  }

  /** Back up one scope. Returns true on success. */
  async backupScope(provider, scope, { trigger = 'manual', triggeredBy = null, scheduleId = null } = {}) {
    const prisma = getPrisma();
    const identity = {
      integrationId: provider.id,
      integrationName: provider.integration.name,
      provider: provider.providerType,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      scopeName: scope.name,
    };
    const record = await prisma.scopeBackup.create({
      data: { ...identity, status: 'running', trigger, triggeredBy, scheduleId },
    });

    try {
      const { text, format, source } = await provider.getScopeConfiguration(scope);
      if (!text || text.trim().length === 0) {
        throw new Error(`${source || provider.label} returned an empty configuration`);
      }

      const checksum = crypto.createHash('sha256').update(text).digest('hex');
      const previous = await prisma.scopeBackup.findFirst({
        where: {
          integrationId: identity.integrationId,
          scopeType: identity.scopeType,
          scopeId: identity.scopeId,
          status: 'success',
          id: { not: record.id },
        },
        orderBy: { createdAt: 'desc' },
        select: { checksum: true },
      });
      const hasChanges = !previous || previous.checksum !== checksum;

      const dir = path.join(this.storageDir, safe(identity.integrationId), `${safe(scope.scopeType)}-${safe(scope.scopeId)}`);
      await fs.mkdir(dir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(dir, `${timestamp}_${record.id}.${describeFormat(format).ext}`);
      await fs.writeFile(filePath, text, 'utf8');

      // Best-effort, as for device backups: the flat file is authoritative.
      let commitSha = null;
      try {
        const result = await gitBackupService.commitScopeConfig({
          scope: identity,
          artifacts: [{ format, text }],
          source,
          backupId: record.id,
          trigger,
        });
        commitSha = result.commitSha || null;
      } catch (gitError) {
        logger.warn(`Git mirror failed for ${scope.scopeType} ${scope.name}: ${gitError.message}`);
      }

      await prisma.scopeBackup.update({
        where: { id: record.id },
        data: {
          status: 'success',
          filePath,
          checksum,
          sizeBytes: Buffer.byteLength(text, 'utf8'),
          hasChanges,
          format,
          commitSha,
        },
      });

      this.emit('backup:completed', {
        scope: true,
        scopeBackupId: record.id,
        scopeType: scope.scopeType,
        scopeName: scope.name,
        integrationName: identity.integrationName,
        hasChanges,
      });
      alertService.clear('backup.failed', { subjectKey: scopeSubject(identity) });
      return true;
    } catch (error) {
      if (error.name === 'CapabilityError') {
        logger.warn(`Scope backup not supported for ${scope.scopeType} ${scope.name}: ${error.message}`);
      } else {
        logger.error(`Scope backup failed for ${scope.scopeType} ${scope.name} (${provider.label}):`, error);
      }
      await prisma.scopeBackup.update({
        where: { id: record.id },
        data: { status: 'failed', error: error.message },
      });
      this.emit('backup:failed', {
        scope: true,
        scopeBackupId: record.id,
        scopeType: scope.scopeType,
        scopeName: scope.name,
        error: error.message,
      });
      if (error.name !== 'CapabilityError') {
        alertService.raise('backup.failed', {
          subjectKey: scopeSubject(identity),
          title: `Scope backup failed for ${scope.scopeType} ${scope.name}`,
          message: error.message,
          data: { scopeBackupId: record.id, integrationId: identity.integrationId, scopeType: scope.scopeType, scopeId: scope.scopeId },
        });
      }
      return false;
    }
  }

  /**
   * Apply a schedule's retention per scope, like pruneRetention for devices.
   * Git history is left intact, deliberately (see config-backup.service).
   */
  async pruneRetention(schedule) {
    const prisma = getPrisma();
    const { retentionDays, retentionMaxCount } = schedule;
    if (!retentionDays && !retentionMaxCount) return;

    const backups = await prisma.scopeBackup.findMany({
      where: { status: 'success' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, integrationId: true, scopeType: true, scopeId: true, filePath: true, createdAt: true },
    });
    const cutoff = retentionDays ? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000) : null;
    const seen = new Map();
    let pruned = 0;

    for (const backup of backups) {
      const key = `${backup.integrationId}|${backup.scopeType}|${backup.scopeId}`;
      const index = seen.get(key) || 0;
      seen.set(key, index + 1);
      const tooMany = retentionMaxCount && index >= retentionMaxCount;
      const tooOld = cutoff && backup.createdAt < cutoff;
      if (!tooMany && !tooOld) continue;

      if (backup.filePath) await fs.unlink(backup.filePath).catch(() => {});
      await prisma.scopeBackup.delete({ where: { id: backup.id } });
      pruned++;
    }
    if (pruned > 0) logger.info(`Retention pruned ${pruned} scope backup(s)`);
  }

  // ---------------------------------------------------------------------
  // Queries, content, diff
  // ---------------------------------------------------------------------

  async getScopeBackups(filters = {}) {
    const prisma = getPrisma();
    const { integrationId, scopeType, scopeId, status, limit = 50, offset = 0 } = filters;
    const where = {};
    if (integrationId) where.integrationId = integrationId;
    if (scopeType) where.scopeType = scopeType;
    if (scopeId) where.scopeId = scopeId;
    if (status) where.status = status;

    const [backups, total] = await Promise.all([
      prisma.scopeBackup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(limit), 200),
        skip: Number(offset),
      }),
      prisma.scopeBackup.count({ where }),
    ]);
    return { backups, total };
  }

  async getScopeBackup(id) {
    const backup = await getPrisma().scopeBackup.findUnique({ where: { id } });
    if (!backup) throw httpError('Scope backup not found', 404);
    return backup;
  }

  async getScopeBackupContent(id) {
    const backup = await this.getScopeBackup(id);
    if (backup.status !== 'success' || !backup.filePath) {
      throw httpError('Scope backup has no stored configuration', 400);
    }
    const content = await fs.readFile(backup.filePath, 'utf8');
    return { backup, content };
  }

  async diffScopeBackups(fromId, toId) {
    const [from, to] = await Promise.all([
      this.getScopeBackupContent(fromId),
      this.getScopeBackupContent(toId),
    ]);
    const label = (b) => `${b.scopeType} ${b.scopeName} @ ${b.createdAt.toISOString()}`;
    const { patch, additions, deletions } = unifiedDiff(label(from.backup), label(to.backup), from.content, to.content);
    const summary = (b) => ({ id: b.id, createdAt: b.createdAt, scopeType: b.scopeType, scopeName: b.scopeName });
    return {
      from: summary(from.backup),
      to: summary(to.backup),
      identical: from.backup.checksum === to.backup.checksum,
      additions,
      deletions,
      patch,
    };
  }

  async deleteScopeBackup(id) {
    const backup = await this.getScopeBackup(id);
    if (backup.filePath) await fs.unlink(backup.filePath).catch(() => {});
    await getPrisma().scopeBackup.delete({ where: { id } });
  }
}

module.exports = new ScopeBackupService();
