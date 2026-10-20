/**
 * A device's displayed status. Ping is NetHelper's own view of reachability,
 * so it comes first; a device ping doesn't cover falls back to its cloud's
 * view. When the two disagree about a cloud-managed device, it is `warning`:
 * - its cloud reports it online but it fails ping: it's up, but NetHelper
 *   can't reach it (no route, a firewall dropping ICMP);
 * - its cloud reports it offline but its address answers ping: something
 *   answers, maybe not this device (a cloud can keep an offline device's old
 *   IP after another device took it; seen with Central on 2026-10-20).
 *
 * Mirrored by `effectiveStatus` in frontend/src/models/Device.js.
 */

/** One of the DeviceStatus values. */
function effectiveStatus(device) {
  const { pingStatus, cloudStatus, managementMode } = device || {};
  if (managementMode === 'cloud') {
    if (pingStatus === 'offline' && cloudStatus === 'online') return 'warning';
    if (pingStatus === 'online' && cloudStatus === 'offline') return 'warning';
  }
  return pingStatus || cloudStatus || 'offline';
}

const CLOUD_UP_PING_DOWN = { pingStatus: 'offline', managementMode: 'cloud', cloudStatus: 'online' };
const CLOUD_DOWN_PING_UP = { pingStatus: 'online', managementMode: 'cloud', cloudStatus: 'offline' };

/** A Prisma `where` matching devices whose effectiveStatus() is `status`. */
function statusWhere(status) {
  const byPingThenCloud = [
    { pingStatus: status },
    { AND: [{ pingStatus: null }, { cloudStatus: status }] },
  ];
  if (status === 'warning') return { OR: [...byPingThenCloud, CLOUD_UP_PING_DOWN, CLOUD_DOWN_PING_UP] };
  if (status === 'offline') {
    return { OR: [{ AND: [{ pingStatus: 'offline' }, { NOT: CLOUD_UP_PING_DOWN }] }, byPingThenCloud[1]] };
  }
  if (status === 'online') {
    return { OR: [{ AND: [{ pingStatus: 'online' }, { NOT: CLOUD_DOWN_PING_UP }] }, byPingThenCloud[1]] };
  }
  return { OR: byPingThenCloud };
}

module.exports = { effectiveStatus, statusWhere };
