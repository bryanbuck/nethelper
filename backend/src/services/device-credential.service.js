/**
 * Bulk device-credential assignment: link one ApiCredential to many devices
 * (or unlink it) from the Devices page selection.
 *
 * plan() says what would happen to each device without changing anything;
 * assign() applies the same plan. A device is skipped only when nothing would
 * ever read its credential: every transport for it goes through a cloud
 * provider (a Central/Mist-managed AP, a Meraki device). A device without an
 * IP is still linked, with a warning, because the credential works once the
 * IP is known. Cloud-managed AOS-CX switches are linked: their local REST
 * reads (config backup, live state, topology) use the device credential.
 */
const { getPrisma } = require('../config/database');
const { resolveTransport } = require('../utils/transport-router');
const { detectPlatform } = require('../utils/device-platform');
const { PLATFORMS } = require('../constants/vendors');
const { debugLog, Services } = require('../utils/debug-logger');

const logger = debugLog.createLogger(Services.DEVICE);

const OPERATIONS = ['config', 'test', 'poll', 'live', 'topology'];
const DIRECT_TRANSPORTS = new Set(['device-rest', 'ssh']);
const MAX_DEVICES = 500;

// ApiCredential.type names the device class it was made for; 'other' fits any.
const CREDENTIAL_DEVICE_TYPES = {
  switch: ['switch'], ap: ['access_point'], gateway: ['gateway'], controller: ['controller'],
};
const CREDENTIAL_TYPE_LABELS = { switch: 'switches', ap: 'access points', gateway: 'gateways', controller: 'controllers' };

class CredentialAssignError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CredentialAssignError';
    this.statusCode = statusCode;
  }
}

/** True when some operation reaches this device directly (REST/NETCONF or SSH). */
function usesDeviceCredential(device) {
  return OPERATIONS.some((op) => resolveTransport(device, op).some((t) => DIRECT_TRANSPORTS.has(t)));
}

function platformLabel(device) {
  return PLATFORMS[detectPlatform(device)]?.label || null;
}

/** A warning when the credential was made for another class of device, else null. */
function typeMismatch(device, credential) {
  const fits = credential && CREDENTIAL_DEVICE_TYPES[credential.type];
  if (!fits || fits.includes(device.type)) return null;
  return `This credential is for ${CREDENTIAL_TYPE_LABELS[credential.type]}`;
}

/**
 * What linking credentialId (null = unlink) does to one device:
 * { outcome: 'link' | 'replace' | 'unlink' | 'unchanged' | 'skip', reason, warning }.
 */
function classify(device, credentialId) {
  const current = device.apiCredentialId || null;

  if (!credentialId) {
    if (!current) return { outcome: 'unchanged', reason: 'No credential linked', warning: null };
    return {
      outcome: 'unlink',
      reason: null,
      warning: device.liveMonitoring ? 'Live monitoring is turned off: it reads the device directly' : null,
    };
  }

  if (current === credentialId) return { outcome: 'unchanged', reason: 'Already linked', warning: null };

  if (!usesDeviceCredential(device)) {
    const label = platformLabel(device);
    const reason = device.managementMode === 'cloud'
      ? 'Reached only through its cloud platform; nothing reads a device credential'
      : `No direct transport for ${label || 'this platform'}`;
    return { outcome: 'skip', reason, warning: null };
  }

  return {
    outcome: current ? 'replace' : 'link',
    reason: null,
    warning: device.ipAddress ? null : 'No IP address yet; the credential is used once one is set',
  };
}

function withTypeWarning(result, device, credential) {
  if (result.outcome !== 'link' && result.outcome !== 'replace') return result;
  const mismatch = typeMismatch(device, credential);
  if (!mismatch) return result;
  return { ...result, warning: [mismatch, result.warning].filter(Boolean).join('. ') };
}

async function buildPlan(deviceIds, credentialId) {
  const ids = [...new Set(deviceIds)];
  if (ids.length === 0) throw new CredentialAssignError('Select at least one device');
  if (ids.length > MAX_DEVICES) throw new CredentialAssignError(`At most ${MAX_DEVICES} devices at a time`);

  const prisma = getPrisma();
  let credential = null;
  if (credentialId) {
    credential = await prisma.apiCredential.findUnique({
      where: { id: credentialId },
      select: { id: true, name: true, type: true },
    });
    if (!credential) throw new CredentialAssignError('Credential not found', 404);
  }

  const found = await prisma.device.findMany({
    where: { id: { in: ids } },
    include: { apiCredential: { select: { id: true, name: true } } },
  });
  const byId = new Map(found.map((d) => [d.id, d]));

  const devices = ids.map((id) => {
    const device = byId.get(id);
    if (!device) return { id, name: null, outcome: 'skip', reason: 'Device not found', warning: null };
    return {
      id: device.id,
      name: device.name,
      ipAddress: device.ipAddress,
      type: device.type,
      vendor: device.vendor,
      platform: device.platform,
      platformLabel: platformLabel(device),
      managementMode: device.managementMode,
      liveMonitoring: device.liveMonitoring,
      current: device.apiCredential || null,
      ...withTypeWarning(classify(device, credentialId), device, credential),
    };
  });

  const counts = { link: 0, replace: 0, unlink: 0, unchanged: 0, skip: 0 };
  for (const d of devices) counts[d.outcome] += 1;
  return { credential, devices, counts };
}

/** What assign() would do; changes nothing. */
async function plan(deviceIds, credentialId = null) {
  return buildPlan(deviceIds, credentialId || null);
}

/**
 * Link credentialId to the devices (null unlinks). Skipped and unchanged
 * devices are left alone. Returns the plan with `updated` (devices changed).
 */
async function assign(deviceIds, credentialId = null, { userId = null } = {}) {
  const result = await buildPlan(deviceIds, credentialId || null);
  const linkIds = result.devices.filter((d) => d.outcome === 'link' || d.outcome === 'replace').map((d) => d.id);
  const unlinkIds = result.devices.filter((d) => d.outcome === 'unlink').map((d) => d.id);
  const changedIds = [...linkIds, ...unlinkIds];
  if (changedIds.length === 0) return { ...result, updated: 0 };

  const prisma = getPrisma();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (linkIds.length) {
      await tx.device.updateMany({
        where: { id: { in: linkIds } },
        data: { apiCredentialId: credentialId, updatedAt: now },
      });
    }
    if (unlinkIds.length) {
      // Live monitoring needs a credential (PATCH /live-monitoring refuses
      // without one), so the flag must not outlive it.
      await tx.device.updateMany({
        where: { id: { in: unlinkIds } },
        data: { apiCredentialId: null, liveMonitoring: false, updatedAt: now },
      });
    }
  });

  logger.info('Device credentials assigned', {
    credentialId,
    linked: linkIds.length,
    unlinked: unlinkIds.length,
    skipped: result.counts.skip,
    userId,
  });

  // Watched devices reconnect with the new credential (or stop without one).
  // Best-effort, like updateDevice: the rows are already saved.
  try {
    const stateMonitor = require('./live/state-monitor.service');
    const changed = await prisma.device.findMany({ where: { id: { in: changedIds } } });
    for (const device of changed) {
      if (unlinkIds.includes(device.id)) await stateMonitor.setAlwaysOn(device, false);
      await stateMonitor.refresh(device);
    }
  } catch (error) {
    logger.warn('Live monitor refresh after credential change failed', { error: error.message });
  }

  return { ...result, updated: changedIds.length };
}

module.exports = { plan, assign, classify, usesDeviceCredential, CredentialAssignError, MAX_DEVICES };
