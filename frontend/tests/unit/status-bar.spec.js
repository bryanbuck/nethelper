// The status bar renders the activity log: current message on the left,
// version on the right, idle text when nothing is current.
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import { h, reactive } from 'vue'
import { VApp } from 'vuetify/components'
import StatusBar from '@/components/common/StatusBar.vue'
import { useNotificationsStore } from '@/stores/notifications'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
const auth = reactive({ isAdmin: false })
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }

const mountBar = () => mount({ render: () => h(VApp, () => h(StatusBar, { version: '1.2.3' })) }, {
  global: { plugins: [createVuetify({ components, directives })] },
  attachTo: document.body
})

describe('StatusBar', () => {
  beforeEach(() => {
    sessionStorage.clear()
    auth.isAdmin = false
    setActivePinia(createPinia())
  })

  test('shows the version and idle text, then the newest message with its action', async () => {
    const wrapper = mountBar()
    expect(wrapper.text()).toContain('NetHelper 1.2.3 · Beta')
    expect(wrapper.text()).toContain('No new activity')

    const store = useNotificationsStore()
    store.addNotification({ type: 'error', title: 'Switch down', message: 'core-1', persistent: true, actions: [{ label: 'View', to: '/alerts' }] })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Switch down — core-1')

    const view = wrapper.findAll('button').find((b) => b.text() === 'View')
    await view.trigger('click')
    expect(push).toHaveBeenCalledWith('/alerts')

    await wrapper.find('button[title="Dismiss"]').trigger('click')
    expect(wrapper.text()).toContain('No new activity')
    wrapper.unmount()
  })

  test('the version indicator opens System Status for admins only', async () => {
    const wrapper = mountBar()
    expect(wrapper.find('button[aria-label="System status"]').exists()).toBe(false)

    auth.isAdmin = true
    await wrapper.vm.$nextTick()
    const button = wrapper.find('button[aria-label="System status"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(push).toHaveBeenCalledWith('/system')
    wrapper.unmount()
  })
})
