/**
 * A device's displayed status. Ping is NetHelper's own view of reachability,
 * so it comes first; a device ping doesn't cover falls back to its cloud's
 * view. When the two disagree in one specific way, a cloud-managed device
 * that fails ping while its cloud reports it online, the device is up but
 * NetHelper can't reach it (no route, a firewall dropping ICMP): `warning`,
 * not `offline`.
 *
 * Mirrored by `effectiveStatus` in frontend/src/models/Device.js.
 */

/** One of the DeviceStatus values. */
function effectiveStatus(device) {
  const { pingStatus, cloudStatus, managementMode } = device || {};
  if (pingStatus === 'offline' && managementMode === 'cloud' && cloudStatus === 'online') return 'warning';
  return pingStatus || cloudStatus || 'offline';
}

const CLOUD_UP_PING_DOWN = { pingStatus: 'offline', managementMode: 'cloud', cloudStatus: 'online' };

/** A Prisma `where` matching devices whose effectiveStatus() is `status`. */
function statusWhere(status) {
  const byPingThenCloud = [
    { pingStatus: status },
    { AND: [{ pingStatus: null }, { cloudStatus: status }] },
  ];
  if (status === 'warning') return { OR: [...byPingThenCloud, CLOUD_UP_PING_DOWN] };
  if (status === 'offline') {
    return { OR: [{ AND: [{ pingStatus: 'offline' }, { NOT: CLOUD_UP_PING_DOWN }] }, byPingThenCloud[1]] };
  }
  return { OR: byPingThenCloud };
}

module.exports = { effectiveStatus, statusWhere };
