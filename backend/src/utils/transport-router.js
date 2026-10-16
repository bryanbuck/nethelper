/**
 * Transport Router
 *
 * Resolves which transports, in order of preference, should be used to reach
 * a device for a given operation. Generalizes the hand-rolled if-chains that
 * previously lived in config-backup.service#pullConfig() and the device-api
 * test controller into one declarative lookup over the matrix defined in
 * constants/vendors.js.
 *
 *   resolveTransport(device, 'config') -> ['device-rest']        (AOS-CX)
 *   resolveTransport(device, 'config') -> ['cloud']              (cloud-managed)
 *   resolveTransport(device, 'test')   -> ['ssh']                (AOS-S)
 *
 * Transports: 'cloud' (the device's CloudIntegration provider),
 * 'device-rest' (per-device REST API), 'ssh' (CLI over ssh2).
 */

const { TRANSPORT_MATRIX, TRANSPORT_FALLBACKS } = require('../constants/vendors');
const { detectPlatform, detectVendor } = require('./device-platform');

const OPERATIONS = ['config', 'test', 'poll', 'live'];

/**
 * @param {Object} device - Device row (managementMode, vendor, platform, type, ...)
 * @param {string} operation - 'config' | 'test' | 'poll' | 'live'
 * @returns {string[]} Ordered transports to attempt (may be empty = unsupported)
 */
function resolveTransport(device, operation) {
  if (!OPERATIONS.includes(operation)) {
    throw new Error(`Unknown transport operation "${operation}" (expected ${OPERATIONS.join('|')})`);
  }

  // Cloud-managed devices route through their cloud provider. Exception,
  // preserved from the original pullConfig(): a directly-reachable AOS-CX
  // switch is still read over device REST even when cloud-managed (local REST
  // reads keep working under Central management and return the full running
  // config). That preference is expressed by the caller checking device-rest
  // eligibility first; here we only rank, so for cloud devices we return the
  // device row's matrix transports first when they exist, then 'cloud'.
  const key = `${detectVendor(device)}/${detectPlatform(device)}`;
  const row = TRANSPORT_MATRIX[key]
    || (device?.type === 'switch' ? TRANSPORT_FALLBACKS['unknown-switch'] : TRANSPORT_FALLBACKS.default);
  const transports = row[operation] || [];

  // Live state is a read-only local watch. Cloud planes aren't a live source,
  // so a cloud-managed device gets only its direct device-rest transport (an
  // AOS-CX switch under Central still serves local REST reads and
  // notifications), and nothing when it has no reachable IP.
  if (operation === 'live') {
    if (device?.managementMode === 'cloud') {
      return device.ipAddress ? transports.filter((t) => t === 'device-rest') : [];
    }
    return [...transports];
  }

  if (device?.managementMode === 'cloud') {
    // device-rest survives ahead of the cloud plane (AOS-CX case above);
    // ssh does not — we never SSH into a cloud-managed device today.
    const direct = transports.filter((t) => t === 'device-rest');
    return [...direct, 'cloud'];
  }

  return [...transports];
}

module.exports = { resolveTransport };
