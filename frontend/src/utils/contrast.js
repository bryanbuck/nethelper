// WCAG 2 contrast between #rrggbb colors, and the readable text color for a
// fill. Used where text sits on a theme color picked at runtime (StatsCard)
// and by tests/unit/theme.spec.js.

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `fg` drawn at `alpha` over `bg`, as one opaque color. */
export function blend(fg, bg, alpha) {
  const f = channels(fg)
  const b = channels(bg)
  return '#' + [0, 1, 2].map((i) => Math.round(b[i] * (1 - alpha) + f[i] * alpha).toString(16).padStart(2, '0')).join('')
}

/** Black or white, whichever reads better on `fill`. */
export function readableOn(fill) {
  return contrastRatio(fill, '#000000') >= contrastRatio(fill, '#FFFFFF') ? '#000000' : '#FFFFFF'
}
