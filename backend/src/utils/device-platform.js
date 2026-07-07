/**
 * Device Platform Detection
 *
 * Single source of truth for classifying a device's platform family and
 * deciding which transport (Aruba Central API, AOS-CX REST, or SSH CLI) should
 * reach it. Previously this logic was duplicated across the config-backup
 * service, device poller, SSH service, and device-api-test controller; keeping
 * it here prevents the copies from drifting apart.
 *
 * Detection order for a device:
 *   1. metadata.operatingSystem / metadata.os  (authoritative when present)
 *   2. model string patterns
 *   3. sensible defaults by device.type
 */

// AOS-CX switch model families (have a usable REST configuration API).
// Leading word boundary only — matches e.g. "6300M", "8360-32Y4C".
const CX_MODEL_REGEX = /cx|\b83(?:60|25)\d*|\b63(?:00|10)\d*|\b64(?:00|10)\d*/;

// Legacy AOS-Switch (AOS-S) model families — CLI/SSH only for our purposes.
const AOSS_MODEL_REGEX = /29\d\d|25\d\d|54\d\d|38\d\d/;

/**
 * Platform families we distinguish.
 * @typedef {'aos-cx'|'aos-s'|'unknown'} PlatformFamily
 */

/**
 * Classify a device into a platform family.
 * @param {Object} device - Device row (uses type, model, metadata)
 * @returns {PlatformFamily}
 */
function detectPlatform(device) {
  const os = device?.metadata?.operatingSystem || device?.metadata?.os;
  if (os === 'AOS-CX') return 'aos-cx';
  if (os === 'AOS-Switch') return 'aos-s';

  const model = (device?.model || '').toLowerCase();
  if (CX_MODEL_REGEX.test(model)) return 'aos-cx';
  if (AOSS_MODEL_REGEX.test(model) || model.includes('aos-s')) return 'aos-s';

  return 'unknown';
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
 * Should this device be reached over SSH rather than the REST device-API /
 * Aruba Central? Central-managed devices and AOS-CX switches use REST; other
 * direct-managed devices (AOS-S, CLI-only gear, and APs/gateways without a
 * REST device API) use SSH.
 * @param {Object} device
 * @returns {boolean}
 */
function useSshTransport(device) {
  if (device?.managementMode === 'central') return false;
  if (isCxRestCapable(device)) return false;
  // Unknown *switch* stays on REST (preserves the original CX-default behavior);
  // everything else (AOS-S switches, APs, gateways) falls through to SSH.
  if (device?.type === 'switch' && detectPlatform(device) === 'unknown') return false;
  return true;
}

module.exports = {
  detectPlatform,
  isCxRestCapable,
  useSshTransport,
  CX_MODEL_REGEX,
  AOSS_MODEL_REGEX,
};
