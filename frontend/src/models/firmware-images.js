/**
 * Display helpers for Device.firmwareImages (backend utils/firmware-images.js):
 * { primary, secondary, defaultImage, bootedImage, running, source, checkedAt }.
 */

export const IMAGE_SLOTS = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' }
]

const slotLabel = (key) => IMAGE_SLOTS.find(s => s.key === key)?.label || key

/** One row per partition, with its version and whether it is booted/default. */
export function imageRows(images) {
  if (!images) return []
  return IMAGE_SLOTS.map(({ key, label }) => ({
    slot: key,
    label,
    version: images[key] || null,
    booted: images.bootedImage === key,
    isDefault: images.defaultImage === key
  }))
}

/** The version the device runs: what it reports, else the booted partition's. */
export function runningVersion(images) {
  if (!images) return null
  return images.running || (images.bootedImage && images[images.bootedImage]) || null
}

/**
 * What the next reboot will load, when that is not what runs now: the default
 * image points at the other partition, or new firmware was copied into the
 * booted one. Null when a reboot changes nothing (or it can't be told).
 */
export function nextBootChange(images) {
  if (!images?.defaultImage) return null
  const next = images[images.defaultImage]
  const running = runningVersion(images)
  if (!next || !running || next === running) return null
  return { slot: images.defaultImage, slotLabel: slotLabel(images.defaultImage), version: next, running }
}

/**
 * Whether the device page shows the Image Information card: the row holds
 * images, or its platform can report them (GET /devices/:id imagePoll).
 */
export function imagesCardShown(device, imagePoll) {
  return !!device?.firmwareImages || (!!imagePoll && imagePoll.reason !== 'unsupported')
}
