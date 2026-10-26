// Dashboard tiles: on a filled card the text follows the fill (black or
// white, whichever reads better), never the page's text or the fill color.
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { themes } from '@/plugins/themes'
import { defaultsForTheme } from '@/plugins/theme-defaults'
import StatsCard from '@/components/dashboard/StatsCard.vue'

const mountIn = (themeId, props) => mount(StatsCard, {
  props: { title: 'Online Devices', value: 12, showActions: true, ...props },
  global: {
    plugins: [createVuetify({
      components,
      directives,
      theme: { defaultTheme: themeId, themes },
      // The app-wide default (App.vue) makes buttons primary unless told otherwise
      defaults: { VBtn: { color: 'primary' }, ...defaultsForTheme(themeId) }
    })]
  }
})

describe('StatsCard', () => {
  test.each([
    ['classic', 'primary', 'rgb(255, 255, 255)'],
    ['classic', 'warning', 'rgb(0, 0, 0)'],
    ['dark', 'warning', 'rgb(0, 0, 0)'],
    ['light', 'primary', 'rgb(0, 0, 0)']
  ])('%s %s tile: text in %s, the button inherits it', (themeId, color, expected) => {
    const wrapper = mountIn(themeId, { color })
    const text = wrapper.find('.v-card-text')
    expect(text.element.style.color).toBe(expected)
    expect(text.find('.stats-value').classes()).not.toContain('text-high-emphasis')
    expect(wrapper.find('.v-card-actions').element.style.color).toBe(expected)
    expect(wrapper.find('.v-btn').classes()).not.toContain('text-primary')
    expect(wrapper.find('.v-btn').classes()).not.toContain(`text-${color}`)
  })

  test('a tonal card keeps the colored treatment', () => {
    const wrapper = mountIn('classic', { color: 'success', variant: 'tonal', trend: 'up' })
    expect(wrapper.find('.v-card-text').element.style.color).toBe('')
    expect(wrapper.find('.stats-value').classes()).toContain('text-high-emphasis')
    expect(wrapper.find('.text-caption').classes()).toContain('text-success')
  })
})
