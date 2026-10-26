import {
  THEMES,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  readThemePreference,
  writeThemePreference,
} from '@/utils/theme-preference'
import { defaultsForTheme, classicDefaults } from '@/plugins/theme-defaults'
import { themes } from '@/plugins/themes'

describe('theme preference', () => {
  beforeEach(() => localStorage.clear())

  it('falls back to the default when nothing is stored', () => {
    expect(readThemePreference()).toBe(DEFAULT_THEME)
  })

  it('round-trips a known theme', () => {
    writeThemePreference('classic')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('classic')
    expect(readThemePreference()).toBe('classic')
  })

  it('ignores unknown or tampered values', () => {
    writeThemePreference('neon')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(readThemePreference()).toBe(DEFAULT_THEME)
  })
})

describe('theme defaults', () => {
  it('only classic layers extra component defaults', () => {
    expect(defaultsForTheme('classic')).toBe(classicDefaults)
    expect(defaultsForTheme('light')).toEqual({})
    expect(defaultsForTheme('dark')).toEqual({})
  })

  it('every selectable theme is registered with Vuetify', () => {
    for (const t of THEMES) expect(themes).toHaveProperty(t.id)
  })
})

// WCAG relative luminance contrast between two #rrggbb colors.
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// A tonal alert or chip: its text color over a 12% tint of itself.
function tint(fg, bg, alpha = 0.12) {
  const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16)
  return '#' + [1, 3, 5].map((i) => Math.round(ch(bg, i) * (1 - alpha) + ch(fg, i) * alpha).toString(16).padStart(2, '0')).join('')
}

describe('theme foreground contrast', () => {
  for (const [id, theme] of Object.entries(themes)) {
    for (const key of ['primary-text', 'warning-text']) {
      it(`${id}: ${key} is at least 4.5:1 on the page, on surfaces and in a tonal tint`, () => {
        const { colors } = theme
        const fg = colors[key]
        expect(fg).toMatch(/^#[0-9A-Fa-f]{6}$/)
        expect(contrast(fg, colors.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(fg, colors.background)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(fg, tint(fg, colors.background))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('Light keeps the brand orange as its fill, with white text on it', () => {
    expect(themes.light.colors.primary).toBe('#FF8300')
    expect(themes.light.colors['on-primary']).toBe('#FFFFFF')
  })
})
