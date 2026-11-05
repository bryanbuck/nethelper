/**
 * Boot images of a device with two firmware partitions, as stored in
 * Device.firmwareImages and shown by the device page's Image Information card.
 *
 *   { primary, secondary,          // version in each partition (null if empty)
 *     defaultImage, bootedImage,   // 'primary' | 'secondary' | null
 *     running,                     // version the device runs now
 *     source, checkedAt }          // where it was read, ISO time of the read
 *
 * Only AOS-CX REST reports partitions today (GET /firmware; a live capture is
 * tests/fixtures/aos-cx-live/firmware.json). Its key for the running version
 * is current_version.
 */

const SLOTS = ['primary', 'secondary'];

const slot = (value) => (SLOTS.includes(value) ? value : null);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Normalize an AOS-CX GET /firmware reply; null when it names no image at all. */
function cxFirmwareImages(raw, checkedAt = new Date()) {
  if (!raw || typeof raw !== 'object') return null;
  const images = {
    primary: text(raw.primary_version),
    secondary: text(raw.secondary_version),
    defaultImage: slot(raw.default_image),
    bootedImage: slot(raw.booted_image),
    running: text(raw.current_version),
    source: 'aos-cx-rest',
    checkedAt: new Date(checkedAt).toISOString(),
  };
  if (!images.primary && !images.secondary && !images.running) return null;
  return images;
}

/** The version the device runs: what it reports, else the booted partition's. */
function runningVersion(images) {
  if (!images) return null;
  return images.running || (images.bootedImage && images[images.bootedImage]) || null;
}

module.exports = { cxFirmwareImages, runningVersion, SLOTS };
