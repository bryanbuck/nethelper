import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'
import { readThemePreference } from '@/utils/theme-preference'
import { themes } from './themes'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: readThemePreference(),
    themes,
  },
  display: {
    mobileBreakpoint: 'sm',
    thresholds: {
      xs: 0,
      sm: 600,
      md: 960,
      lg: 1264,
      xl: 1904,
    },
  },
  icons: {
    defaultSet: 'mdi',
  },
  defaults: {
    VBtn: {
      color: 'primary',
      variant: 'flat',
    },
    VCard: {
      elevation: 2,
    },
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
    },
    VSelect: {
      variant: 'outlined',
      density: 'comfortable',
    },
    VTextarea: {
      variant: 'outlined',
      density: 'comfortable',
    },
    VCheckbox: {
      color: 'primary',
    },
    VRadio: {
      color: 'primary',
    },
    VSwitch: {
      color: 'primary',
    },
    // Below sm (phones) tables stack each row into label/value pairs instead
    // of scrolling sideways. Vuetify's own default is never-mobile.
    VDataTable: {
      fixedHeader: true,
      hover: true,
      mobileBreakpoint: 'sm',
    },
    VDataTableServer: {
      mobileBreakpoint: 'sm',
    },
    // Tabs that don't fit get arrows on every device, not only on desktop.
    VTabs: {
      showArrows: true,
    },
    VChip: {
      size: 'small',
    },
  },
})

export default vuetify