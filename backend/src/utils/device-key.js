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

module.exports = { deviceStorageKey, normalizeSerial };
