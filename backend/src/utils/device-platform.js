/**
 * Device Platform Detection
 *
 * Single source of truth for classifying a device's platform family and
 * deciding which transport (cloud provider API, device REST, or SSH CLI)
 * should reach it. Keeping this logic here prevents copies in the
 * config-backup service, device poller, SSH service, and device-api-test
 * controller from drifting apart.
 *
 * Since the multi-vendor Phase 0 migration, `Device.platform` is an explicit
 * column (backfilled once from the heuristics below) and is authoritative
 * when set. The heuristics remain only as a fallback for legacy/unclassified
 * Aruba rows:
 *   1. Device.platform                              (authoritative when set)
 *   2. metadata.operatingSystem / metadata.os       (Aruba rows only)
 *   3. model string patterns                        (Aruba rows only)
 *   4. 'unknown'
 */

const { PLATFORMS, VENDORS } = require('../constants/vendors');

// AOS-CX switch model families (have a usable REST configuration API).
// Leading word boundary only — matches e.g. "6300M", "8360-32Y4C".
const CX_MODEL_REGEX = /cx|\b83(?:60|25)\d*|\b63(?:00|10)\d*|\b64(?:00|10)\d*/;

// Legacy AOS-Switch (AOS-S) model families — CLI/SSH only for our purposes.
const AOSS_MODEL_REGEX = /29\d\d|25\d\d|54\d\d|38\d\d/;

/**
 * Classify a device into a platform family ('aos-cx', 'aos-s', 'junos',
 * 'ios-xe', 'meraki', or 'unknown').
 * @param {Object} device - Device row (uses platform, vendor, type, model, metadata)
 * @returns {string}
 */
function detectPlatform(device) {
  // Explicit platform column wins.
  const explicit = device?.platform;
  if (explicit && PLATFORMS[explicit]) return explicit;

  // The model/OS heuristics below only know Aruba families; never apply them
  // to a device explicitly recorded as another vendor.
  const vendor = device?.vendor;
  if (vendor && vendor !== 'aruba') return 'unknown';

  const os = device?.metadata?.operatingSystem || device?.metadata?.os;
  if (os === 'AOS-CX') return 'aos-cx';
  if (os === 'AOS-Switch') return 'aos-s';

  const model = (device?.model || '').toLowerCase();
  if (CX_MODEL_REGEX.test(model)) return 'aos-cx';
  if (AOSS_MODEL_REGEX.test(model) || model.includes('aos-s')) return 'aos-s';

  return 'unknown';
}

/**
 * Vendor for a device, inferred from the platform when the vendor column is
 * missing (legacy rows).
 * @param {Object} device
 * @returns {string} Vendor id ('aruba', 'juniper', 'cisco', 'other')
 */
function detectVendor(device) {
  if (device?.vendor && VENDORS[device.vendor]) return device.vendor;
  const platform = detectPlatform(device);
  return PLATFORMS[platform]?.vendor || 'aruba';
}

/**
 * Does this device expose the AOS-CX REST API (config, firmware, system)?
 * Only switches can; APs/gateways never do in this codebase.
 * @param {Object} device
 * @returns {boolean}
 */
function isCxRestCapable(device) {
  if (device?.type !== 'switch') return false;
  return detectPlatform(device) === 'aos-cx';
}

/**
 * Should this device be reached over SSH rather than a REST device API /
 * its cloud provider? Cloud-managed devices and AOS-CX switches use REST;
 * other direct-managed devices (AOS-S, Junos, IOS, CLI-only gear, and
 * APs/gateways without a REST device API) use SSH.
 * @param {Object} device
 * @returns {boolean}
 */
function useSshTransport(device) {
  if (device?.managementMode === 'cloud') return false;
  if (isCxRestCapable(device)) return false;
  // Unknown *switch* stays on REST (preserves the original CX-default behavior);
  // everything else (AOS-S switches, APs, gateways) falls through to SSH.
  if (device?.type === 'switch' && detectPlatform(device) === 'unknown') return false;
  return true;
}

module.exports = {
  detectPlatform,
  detectVendor,
  isCxRestCapable,
  useSshTransport,
  CX_MODEL_REGEX,
  AOSS_MODEL_REGEX,
};
