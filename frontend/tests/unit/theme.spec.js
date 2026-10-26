import {
  THEMES,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  readThemePreference,
  writeThemePreference,
} from '@/utils/theme-preference'
import { defaultsForTheme, classicDefaults } from '@/plugins/theme-defaults'
import { themes } from '@/plugins/themes'
import { contrastRatio as contrast, blend, readableOn } from '@/utils/contrast'

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

// A tonal alert or chip: its text color over a 12% tint of itself.
const tint = (fg, bg, alpha = 0.12) => blend(fg, bg, alpha)

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

// Dashboard tiles (StatsCard): text on a card filled with a status color, in
// the color readableOn() picks; the title and trend at 92% opacity (StatsCard .stats-secondary).
describe('filled tile text', () => {
  for (const [id, theme] of Object.entries(themes)) {
    for (const color of ['primary', 'success', 'error', 'warning']) {
      it(`${id}: text on a ${color} tile is readable`, () => {
        const fill = theme.colors[color]
        const text = readableOn(fill)
        expect(contrast(text, fill)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(blend(text, fill, 0.92), fill)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
