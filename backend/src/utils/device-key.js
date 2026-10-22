/**
 * Stable per-device storage key: the serial when there is one, otherwise
 * `device-<id>`. Used for the flat backup directory, the Git mirror directory,
 * and ConfigBackup.deviceSerial, so a device without a serial still gets its
 * own folder (instead of writing into the storage root) and its history lookup
 * still works. Devices with a serial keep exactly the key they always had.
 */
function deviceStorageKey(device) {
  const serial = typeof device?.serial === 'string' ? device.serial.trim() : '';
  return serial || `device-${device.id}`;
}

/** Normalize a serial from user input: blank/whitespace becomes null. */
function normalizeSerial(serial) {
  if (serial === undefined) return undefined;
  const trimmed = typeof serial === 'string' ? serial.trim() : serial;
  return trimmed ? trimmed : null;
}

/**
 * Canonical lower-case colon form (aa:bb:cc:dd:ee:ff), or null if not a MAC.
 * Accepts the shapes network gear prints: `14:ab:ec:00:10:00`, `001a1e-000000`,
 * `00 1a 1e 00 00 00`, `0011.2233.4455`. Rejects strings that only reach 12 hex
 * digits once stripped, such as an IPv4 address used as an LLDP chassis id
 * ("10.100.200.250").
 */
function normalizeMac(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  if (/[^0-9a-fA-F:.\-\s]/.test(mac) || /\d+\.\d+\.\d+\.\d+/.test(mac)) return null;
  return hex.match(/.{2}/g).join(':');
}

/**
 * The spellings a MAC is stored in (providers differ: Central aa:bb:…, Mist
 * bare aabb…), for a database match with `in` + `mode: 'insensitive'`.
 */
function macVariants(mac) {
  const colon = normalizeMac(mac);
  if (!colon) return [];
  const hex = colon.replace(/:/g, '');
  return [colon, hex, colon.replace(/:/g, '-'), hex.match(/.{4}/g).join('.')];
}

module.exports = { deviceStorageKey, normalizeSerial, normalizeMac, macVariants };
