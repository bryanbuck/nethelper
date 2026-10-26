// Named Vuetify themes. The selectable list (labels, icons) lives in
// utils/theme-preference.js; per-theme component defaults in plugins/theme-defaults.js.
//
// primary-text and warning-text are those colors used as a foreground (text,
// icons, outlines, and tonal alerts, whose text sits on a 12% tint of itself;
// .text-primary and .text-warning map to them in main.scss). Fills keep
// primary and warning. They differ where the fill color is unreadable as text:
// Dark's #2D6A00 is 2.8:1 on #121212, its #5CAB2A 6.5:1; Light's brand orange
// #FF8300 is 2.5:1 on white, its #9E4F00 5.9:1; Light's #FFC107 is 1.6:1,
// its #8C5A00 5.9:1; Classic's #336699 is only 4.2:1 inside a tonal tint on
// its grey-blue page. tests/unit/theme.spec.js holds them all to 4.5:1.

export const themes = {
  light: {
    dark: false,
    colors: {
      primary: '#FF8300',
      'primary-text': '#9E4F00',
      secondary: '#424242',
      success: '#4CAF50',
      warning: '#FFC107',
      'warning-text': '#8C5A00',
      error: '#F44336',
      info: '#2196F3',
      background: '#F5F5F5',
      surface: '#FFFFFF',
      'on-primary': '#FFFFFF',
      'on-secondary': '#FFFFFF',
      'on-success': '#FFFFFF',
      'on-warning': '#000000',
      'on-error': '#FFFFFF',
      'on-info': '#FFFFFF',
      'on-background': '#000000',
      'on-surface': '#000000',
    },
  },
  dark: {
    dark: true,
    colors: {
      primary: '#2D6A00',
      'primary-text': '#5CAB2A',
      secondary: '#616161',
      success: '#4CAF50',
      warning: '#FFC107',
      'warning-text': '#FFC107',
      error: '#F44336',
      info: '#2196F3',
      background: '#121212',
      surface: '#1E1E1E',
      'on-primary': '#FFFFFF',
      'on-secondary': '#FFFFFF',
      'on-success': '#FFFFFF',
      'on-warning': '#000000',
      'on-error': '#FFFFFF',
      'on-info': '#FFFFFF',
      'on-background': '#FFFFFF',
      'on-surface': '#FFFFFF',
    },
  },
  // Classic: utilitarian circa-2010 admin portal. Layout tweaks live in
  // plugins/theme-defaults.js and assets/styles/themes/classic.scss.
  classic: {
    dark: false,
    colors: {
      primary: '#336699',
      'primary-text': '#2D5C8A',
      secondary: '#5A6B7D',
      success: '#2E7D32',
      warning: '#D98E04',
      'warning-text': '#7A4E00',
      error: '#CC0000',
      info: '#2A6EBB',
      background: '#E4E8EE',
      surface: '#FFFFFF',
      'surface-variant': '#DDE3EA',
      'on-surface-variant': '#1C2B3A',
      'on-primary': '#FFFFFF',
      'on-secondary': '#FFFFFF',
      'on-success': '#FFFFFF',
      'on-warning': '#000000',
      'on-error': '#FFFFFF',
      'on-info': '#FFFFFF',
      'on-background': '#1C2B3A',
      'on-surface': '#1C2B3A',
    },
    variables: {
      'border-color': '#7F9DB9',
      'border-opacity': 0.6,
      'hover-opacity': 0.06,
    },
  },
}
