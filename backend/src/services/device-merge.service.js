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
 * even when their serials differ, and the merge then needs identityFrom: the
 * row whose serial and MAC are real (normally the one the cloud reported).
 */

const { getPrisma } = require('../config/database');
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
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'MergeError';
    this.statusCode = statusCode;
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
 * @param {Object} [identity] - row whose serial and MAC win (serial conflict)
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
    for (const field of ['serial', 'macAddress']) {
      if (!isBlank(identity[field]) && identity[field] !== target[field]) data[field] = identity[field];
    }
  }

  // The identity row's cloud data is the real one; otherwise any cloud row.
  const cloudRow = identity?.managementMode === 'cloud'
    ? identity
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
      return 'These devices have different serial numbers; choose which one is real (identityFrom)';
    }
    const integrations = new Set(
      [target, ...sources].filter((d) => d.managementMode === 'cloud' && d.cloudIntegrationId).map((d) => d.cloudIntegrationId)
    );
    if (integrations.size > 1) return 'These devices belong to different cloud integrations';
    return null;
  }

  /**
   * Fold sourceIds into targetId.
   * @returns {Promise<Object>} the merged device
   */
  async merge(targetId, sourceIds, { identityFrom = null } = {}) {
    const ids = [...new Set(sourceIds || [])];
    if (!targetId || ids.length === 0) throw new MergeError('Choose a device to keep and at least one to merge into it');
    if (ids.includes(targetId)) throw new MergeError('The device to keep cannot also be merged away');

    const prisma = getPrisma();
    const rows = await prisma.device.findMany({
      where: { id: { in: [targetId, ...ids] } },
      // full rows: mergedFields() copies cloud columns
      include: { deviceGroups: { select: { id: true } } },
    });
    const target = rows.find((d) => d.id === targetId);
    const sources = ids.map((id) => rows.find((d) => d.id === id));
    if (!target || sources.some((s) => !s)) throw new MergeError('Device not found', 404);
    const identity = identityFrom ? rows.find((d) => d.id === identityFrom) : null;
    if (identityFrom && !identity) throw new MergeError('identityFrom must be one of the devices being merged');

    const reason = this.validate(target, sources, identity);
    if (reason) throw new MergeError(reason, 409);

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
      identityFrom,
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
