// Phone layout: data tables stack below sm instead of scrolling sideways, tab
// rows that don't fit get arrows, and wide tables keep only their key columns
// on a phone.
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import vuetify from '@/plugins/vuetify'
import { usePhoneColumns } from '@/composables/usePhoneColumns'

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
})
