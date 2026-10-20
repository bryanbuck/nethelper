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
