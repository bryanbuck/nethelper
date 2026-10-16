// The built-in themes and the viewer's saved choice. Users pick between these;
// they can't define their own. Storage can be unavailable (private windows,
// blocked site data), so every access is guarded and falls back to light.

export const THEMES = [
  { id: 'light', label: 'Light', icon: 'mdi-weather-sunny' },
  { id: 'dark', label: 'Dark', icon: 'mdi-weather-night' },
  { id: 'classic', label: 'Classic', icon: 'mdi-monitor' },
]

export const DEFAULT_THEME = 'light'
export const THEME_STORAGE_KEY = 'nethelper.theme'

const isKnownTheme = (id) => THEMES.some((t) => t.id === id)

export function readThemePreference () {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isKnownTheme(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function writeThemePreference (id) {
  if (!isKnownTheme(id)) return
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // Not persisted; the choice still applies for this page load.
  }
}
