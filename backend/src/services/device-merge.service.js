/**
 * Duplicate devices: find them, and merge them into one row.
 *
 * Duplicates mostly come from cloud sync meeting a device someone added by
 * hand without a serial. Sync adopts such a row itself only on an exact,
 * unambiguous MAC match (device.service.js upsertCloudDevice); everything
 * weaker is reported here for a person to confirm.
 *
 * A merge keeps one row (the target) and folds the others (sources) into it:
 * missing fields are filled, cloud ownership moves to the target so the next
 * sync matches it by serial, and every row that references a source device
 * is re-pointed. If you add a model with a deviceId, re-point it in merge().
 *
 * Hand-added devices sometimes carry a typed-in placeholder serial/MAC
 * ("STUDIO", cc:cc:...). Rows with the same name and IP are therefore offered
 * even when their serials differ. The real serial/MAC is then established,
 * not guessed: from the cloud inventory, else from the device itself
 * (device-identity.service.js). Only when neither can answer does a person
 * choose (identityFrom: the row whose serial and MAC are right).
 */

const { getPrisma } = require('../config/database');
const deviceIdentity = require('./device-identity.service');
const { normalizeMac } = require('../utils/device-key');
const { debugLog, Services } = require('../utils/debug-logger');

const logger = debugLog.createLogger(Services.DEVICE);

const DEVICE_SUMMARY = {
  id: true,
  name: true,
  serial: true,
  type: true,
  vendor: true,
  platform: true,
  model: true,
  ipAddress: true,
  macAddress: true,
  location: true,
  managementMode: true,
  cloudStatus: true,
  cloudIntegrationId: true,
  cloudIntegration: { select: { id: true, name: true, provider: true } },
  apiCredentialId: true,
  liveMonitoring: true,
  firmwareVersion: true,
  metadata: true,
  createdAt: true,
};

// Filled on the target from the first source that has a value.
const FILL_FIELDS = [
  'serial', 'macAddress', 'ipAddress', 'platform', 'model', 'firmwareVersion',
  'apiCredentialId', 'location', 'lastSeen',
];

// Owned by the cloud plane; copied from the cloud row when one is merged in.
const CLOUD_FIELDS = [
  'cloudIntegrationId', 'cloudStatus', 'cloudManaged', 'cloudConnectionStatus',
  'cloudManagedSource', 'cloudManagedCheckedAt',
];

class MergeError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = 'MergeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const isBlank = (value) => value === null || value === undefined || value === '';

/** Distinct non-empty serials among these devices. */
function serialsOf(devices) {
  return [...new Set(devices.map((d) => d.serial).filter(Boolean))];
}

/**
 * Group devices that are probably the same hardware. Pure, for testing.
 * - 'mac': same MAC (normalized). Strong evidence.
 * - 'name-ip': same name (case-insensitive) and same IP. Offered even when
 *   the serials differ, because a hand-added row may hold a placeholder
 *   serial; the merge then asks which serial is real.
 * - 'ip': same IP, where at least one row has no serial (the manual-add vs
 *   cloud sync case). Two rows that both have serials are two devices, even
 *   if an IP got reused.
 * 'mac' and 'ip' groups whose rows carry two different serials are dropped.
 *
 * @returns {Array<{ key, reason: 'mac'|'name-ip'|'ip', serialConflict, devices }>}
 */
function groupDuplicates(devices) {
  const groups = [];
  const grouped = new Set();

  const collect = (reason, keyOf, accept, { allowSerialConflict = false } = {}) => {
    const buckets = new Map();
    for (const device of devices) {
      if (grouped.has(device.id)) continue;
      const key = keyOf(device);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(device);
    }
    for (const members of buckets.values()) {
      if (members.length < 2 || !accept(members)) continue;
      const serialConflict = serialsOf(members).length > 1;
      if (serialConflict && !allowSerialConflict) continue;
      members.forEach((d) => grouped.add(d.id));
      const ids = members.map((d) => d.id).sort();
      groups.push({ key: ids.join(','), reason, serialConflict, devices: members });
    }
  };

  collect('mac', (d) => normalizeMac(d.macAddress), () => true);
  collect(
    'name-ip',
    (d) => (d.ipAddress && d.name ? `${d.name.trim().toLowerCase()}|${d.ipAddress.trim()}` : null),
    () => true,
    { allowSerialConflict: true },
  );
  collect('ip', (d) => (d.ipAddress ? d.ipAddress.trim() : null), (members) => members.some((d) => !d.serial));
  return groups;
}

/**
 * The field values the target ends up with. Pure, for testing.
 * @param {Object} target - full Device row
 * @param {Object[]} sources - full Device rows
 * @param {Object} [identity] - the real { serial, macAddress }, plus the merged
 *   row that already carries that serial ({ row }) if any
 */
function mergedFields(target, sources, identity = null) {
  const all = [target, ...sources];
  const data = {};

  for (const field of FILL_FIELDS) {
    if (!isBlank(target[field])) continue;
    const donor = sources.find((s) => !isBlank(s[field]));
    if (donor) data[field] = donor[field];
  }

  if (identity) {
    const real = {
      serial: identity.serial,
      macAddress: identity.macAddress || identity.row?.macAddress || null,
    };
    for (const field of ['serial', 'macAddress']) {
      if (isBlank(real[field])) continue;
      if (field === 'macAddress' && normalizeMac(real.macAddress) === normalizeMac(target.macAddress)) continue;
      if (real[field] !== target[field]) data[field] = real[field];
    }
  }

  // The row carrying the real serial has the real cloud data; else any cloud row.
  const cloudRow = identity?.row?.managementMode === 'cloud'
    ? identity.row
    : all.find((d) => d.managementMode === 'cloud');
  if (cloudRow) {
    data.managementMode = 'cloud';
    if (cloudRow !== target) {
      for (const field of CLOUD_FIELDS) data[field] = cloudRow[field];
      // The cloud's view of the device is the one sync will keep writing.
      for (const field of ['vendor', 'platform', 'model', 'firmwareVersion']) {
        if (!isBlank(cloudRow[field])) data[field] = cloudRow[field];
      }
    }
  }

  if (!target.liveMonitoring && sources.some((s) => s.liveMonitoring)) data.liveMonitoring = true;

  const metadata = Object.assign({}, ...[...sources].reverse().map((s) => s.metadata || {}), target.metadata || {});
  if (Object.keys(metadata).length) data.metadata = metadata;

  return data;
}

/** Replace source ids with the target id in a BackupSchedule.deviceSelection. */
function rewriteSelection(selection, sourceIds, targetId) {
  if (!selection || !Array.isArray(selection.deviceIds)) return null;
  if (!selection.deviceIds.some((id) => sourceIds.includes(id))) return null;
  const deviceIds = [...new Set(selection.deviceIds.map((id) => (sourceIds.includes(id) ? targetId : id)))];
  return { ...selection, deviceIds };
}

class DeviceMergeService {
  async findDuplicateGroups() {
    const devices = await getPrisma().device.findMany({
      select: DEVICE_SUMMARY,
      orderBy: { createdAt: 'asc' },
    });
    return groupDuplicates(devices);
  }

  /** Why these devices can't be merged, or null. Pure, for testing. */
  validate(target, sources, identity = null) {
    if (serialsOf([target, ...sources]).length > 1 && !identity?.serial) {
      return 'These devices have different serial numbers, and neither the cloud nor the device could confirm the real one; choose it';
    }
    const integrations = new Set(
      [target, ...sources].filter((d) => d.managementMode === 'cloud' && d.cloudIntegrationId).map((d) => d.cloudIntegrationId)
    );
    if (integrations.size > 1) return 'These devices belong to different cloud integrations';
    return null;
  }

  async loadRows(targetId, sourceIds) {
    const ids = [...new Set(sourceIds || [])];
    if (!targetId || ids.length === 0) throw new MergeError('Choose a device to keep and at least one to merge into it');
    if (ids.includes(targetId)) throw new MergeError('The device to keep cannot also be merged away');

    const rows = await getPrisma().device.findMany({
      where: { id: { in: [targetId, ...ids] } },
      // full rows: mergedFields() copies cloud columns
      include: { deviceGroups: { select: { id: true } } },
    });
    const target = rows.find((d) => d.id === targetId);
    const sources = ids.map((id) => rows.find((d) => d.id === id));
    if (!target || sources.some((s) => !s)) throw new MergeError('Device not found', 404);
    return { ids, rows, target, sources };
  }

  /**
   * The real serial/MAC: established by the cloud or the device when either
   * answers (that wins over a person's choice), else the row a person named.
   * @returns {Promise<{serial, macAddress, source, label, row}|null>}
   */
  async identityFor(rows, identityFrom = null) {
    const truth = await deviceIdentity.resolve(rows);
    if (truth?.serial) return { ...truth, row: rows.find((r) => r.serial === truth.serial) || null };
    if (!identityFrom) return null;
    const row = rows.find((r) => r.id === identityFrom);
    if (!row) throw new MergeError('identityFrom must be one of the devices being merged');
    return { serial: row.serial, macAddress: row.macAddress, source: 'user', label: 'your choice', row };
  }

  /**
   * How a merge would settle serial/MAC, without changing anything. Contacts
   * the cloud and/or the device.
   * @returns {Promise<{identity, serialConflict, needsChoice}>}
   */
  async preview(targetId, sourceIds) {
    const { rows } = await this.loadRows(targetId, sourceIds);
    const truth = await deviceIdentity.resolve(rows);
    const serialConflict = serialsOf(rows).length > 1;
    return {
      identity: truth?.serial ? truth : null,
      serialConflict,
      needsChoice: serialConflict && !truth?.serial,
    };
  }

  /**
   * Fold sourceIds into targetId.
   * @returns {Promise<Object>} the merged device
   */
  async merge(targetId, sourceIds, { identityFrom = null } = {}) {
    const prisma = getPrisma();
    const { ids, rows, target, sources } = await this.loadRows(targetId, sourceIds);
    const identity = await this.identityFor(rows, identityFrom);

    const reason = this.validate(target, sources, identity);
    if (reason) throw new MergeError(reason, 409, identity ? null : 'identity_unresolved');

    // The real serial may sit on a device outside this merge.
    if (identity?.serial) {
      const holder = await prisma.device.findUnique({ where: { serial: identity.serial }, select: { id: true, name: true } });
      if (holder && !rows.some((r) => r.id === holder.id)) {
        throw new MergeError(`Serial ${identity.serial} belongs to another device, "${holder.name}"; include it in the merge`, 409);
      }
    }

    const data = mergedFields(target, sources, identity);
    const groupIds = [...new Set(sources.flatMap((s) => s.deviceGroups.map((g) => g.id)))]
      .filter((id) => !target.deviceGroups.some((g) => g.id === id));
    const schedules = await prisma.backupSchedule.findMany({ select: { id: true, deviceSelection: true } });
    const scheduleUpdates = schedules
      .map((s) => ({ id: s.id, deviceSelection: rewriteSelection(s.deviceSelection, ids, targetId) }))
      .filter((s) => s.deviceSelection);

    // Stop watching the rows that are about to disappear.
    const stateMonitor = require('./live/state-monitor.service');
    for (const id of ids) await stateMonitor.forget(id);

    const merged = await prisma.$transaction(async (tx) => {
      // serial is unique: free it on the sources before the target takes it.
      await tx.device.updateMany({ where: { id: { in: ids } }, data: { serial: null } });
      await tx.deviceEvent.updateMany({ where: { deviceId: { in: ids } }, data: { deviceId: targetId } });
      await tx.execution.updateMany({ where: { deviceId: { in: ids } }, data: { deviceId: targetId } });
      // deviceSerial and file paths stay: they say where each backup's files
      // and Git commits live.
      await tx.configBackup.updateMany({ where: { deviceId: { in: ids } }, data: { deviceId: targetId } });
      await tx.discoveredDevice.updateMany({ where: { existingDeviceId: { in: ids } }, data: { existingDeviceId: targetId } });
      for (const s of scheduleUpdates) {
        await tx.backupSchedule.update({ where: { id: s.id }, data: { deviceSelection: s.deviceSelection } });
      }
      await tx.device.deleteMany({ where: { id: { in: ids } } });
      return tx.device.update({
        where: { id: targetId },
        data: {
          ...data,
          ...(groupIds.length && { deviceGroups: { connect: groupIds.map((id) => ({ id })) } }),
        },
      });
    });

    logger.info('Devices merged', {
      targetId,
      sourceIds: ids,
      identity: identity && { serial: identity.serial, source: identity.source },
      fields: Object.keys(data),
      groups: groupIds.length,
      schedules: scheduleUpdates.length,
    });

    // The target may have gained an IP, credential, or always-on monitoring.
    try {
      if (stateMonitor.getMonitor(targetId)) await stateMonitor.refresh(merged);
      else if (merged.liveMonitoring) await stateMonitor.setAlwaysOn(merged, true);
    } catch (error) {
      logger.warn('Live monitor restart after merge failed', { targetId, error: error.message });
    }

    return merged;
  }
}

const service = new DeviceMergeService();
module.exports = service;
module.exports.MergeError = MergeError;
module.exports.groupDuplicates = groupDuplicates;
module.exports.mergedFields = mergedFields;
module.exports.rewriteSelection = rewriteSelection;
