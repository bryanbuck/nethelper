// Component defaults applied per theme through <v-defaults-provider> in App.vue.
// Vuetify's own `defaults` (plugins/vuetify.js) are global; these layer on top
// only while the matching theme is active. Explicit props in templates still win.

const compactField = { density: 'compact', rounded: 0, variant: 'outlined' }

// "Classic": a dense, square, flat circa-2010 admin portal.
export const classicDefaults = {
  global: { ripple: false },
  VAppBar: { density: 'compact', elevation: 0 },
  VToolbar: { density: 'compact' },
  VBtn: { rounded: 0, density: 'compact', elevation: 0 },
  VCard: { rounded: 0, elevation: 0 },
  VSheet: { rounded: 0 },
  VAlert: { rounded: 0, density: 'compact', variant: 'outlined' },
  VChip: { label: true },
  VTextField: compactField,
  VSelect: compactField,
  VTextarea: compactField,
  VAutocomplete: compactField,
  VCombobox: compactField,
  VFileInput: compactField,
  VCheckbox: { density: 'compact' },
  VSwitch: { density: 'compact', inset: false },
  VList: { density: 'compact' },
  VTabs: { density: 'compact' },
  VDataTable: { density: 'compact' },
  VDataTableServer: { density: 'compact' },
  VTable: { density: 'compact' },
  VExpansionPanels: { rounded: 0, variant: 'accordion' },
}

const THEME_DEFAULTS = {
  classic: classicDefaults,
}

export function defaultsForTheme (themeName) {
  return THEME_DEFAULTS[themeName] || {}
}

// Spacing for every theme: tables and lists a step tighter than Vuetify's
// default, and on a phone (below sm) a step tighter again, with compact fields.
// Classic is already compact throughout.
const compactDensity = { density: 'compact' }

export function layoutDefaults (phone) {
  const tables = phone ? compactDensity : { density: 'comfortable' }
  const base = {
    VDataTable: tables,
    VDataTableServer: tables,
    VTable: tables,
  }
  if (!phone) return base
  return {
    ...base,
    VList: compactDensity,
    VTabs: compactDensity,
    VAlert: compactDensity,
    VTextField: compactDensity,
    VSelect: compactDensity,
    VAutocomplete: compactDensity,
    VCombobox: compactDensity,
    VTextarea: compactDensity,
    VBtnToggle: compactDensity,
  }
}

// What App.vue's <v-defaults-provider> applies: the layout defaults, with the
// theme's own (Classic) winning per component.
export function appDefaults (themeName, phone) {
  const layout = layoutDefaults(phone)
  const themed = defaultsForTheme(themeName)
  const merged = { ...layout }
  for (const [key, value] of Object.entries(themed)) {
    merged[key] = { ...layout[key], ...value }
  }
  return merged
}
