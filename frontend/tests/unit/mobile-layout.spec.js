// Phone layout: data tables stack below sm instead of scrolling sideways, tab
// rows that don't fit get arrows, wide tables keep only their key columns on a
// phone, spacing tightens a step on desktop and two on a phone, and toolbar
// buttons go icon-only on a phone.
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import vuetify from '@/plugins/vuetify'
import { usePhoneColumns } from '@/composables/usePhoneColumns'
import { appDefaults } from '@/plugins/theme-defaults'
import ActionButton from '@/components/common/ActionButton.vue'

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Location', key: 'location' },
  { title: 'Status', key: 'status' },
  { title: 'Actions', key: 'actions' }
]

// Vuetify reads the window width when it is created.
const columnsAt = (width) => {
  window.innerWidth = width
  let shown
  mount(defineComponent({
    setup () {
      shown = usePhoneColumns(headers, ['name', 'status', 'actions'])
      return () => h('div')
    }
  }), { global: { plugins: [createVuetify()] } })
  return shown.value.map((h) => h.key)
}

describe('mobile layout', () => {
  const initialWidth = window.innerWidth
  afterEach(() => { window.innerWidth = initialWidth })

  test('tables stack below sm, and tabs get arrows', () => {
    const defaults = vuetify.defaults.value
    expect(defaults.VDataTable.mobileBreakpoint).toBe('sm')
    expect(defaults.VDataTableServer.mobileBreakpoint).toBe('sm')
    expect(defaults.VTabs.showArrows).toBe(true)
  })

  test('a phone keeps only the listed columns, in table order', () => {
    expect(columnsAt(375)).toEqual(['name', 'status', 'actions'])
  })

  test('from sm up every column stays', () => {
    expect(columnsAt(600)).toEqual(['name', 'location', 'status', 'actions'])
    expect(columnsAt(1280)).toEqual(['name', 'location', 'status', 'actions'])
  })

  test('tables are a step tighter on desktop, two on a phone, with compact fields', () => {
    expect(appDefaults('light', false).VDataTable.density).toBe('comfortable')
    expect(appDefaults('light', false).VTextField).toBeUndefined()
    const phone = appDefaults('dark', true)
    expect(phone.VDataTableServer.density).toBe('compact')
    expect(phone.VTextField.density).toBe('compact')
    expect(phone.VList.density).toBe('compact')
  })

  test("Classic's own defaults win, per component", () => {
    const classic = appDefaults('classic', false)
    expect(classic.VDataTable.density).toBe('compact')
    expect(classic.VTextField).toMatchObject({ density: 'compact', rounded: 0, variant: 'outlined' })
  })

  const buttonAt = (width, props) => {
    window.innerWidth = width
    return mount(ActionButton, {
      props: { icon: 'mdi-sync', label: 'Sync', ...props },
      global: { plugins: [createVuetify({ components })] }
    })
  }

  test('an action button is icon-only on a phone, named by its label', () => {
    const btn = buttonAt(375).find('.v-btn')
    expect(btn.text()).toBe('')
    expect(btn.attributes('aria-label')).toBe('Sync')
    expect(btn.attributes('title')).toBe('Sync')
  })

  test('from sm up, or with keep-label, the label shows', () => {
    expect(buttonAt(1280).find('.v-btn').text()).toBe('Sync')
    expect(buttonAt(375, { keepLabel: true }).find('.v-btn').text()).toBe('Sync')
  })
})
