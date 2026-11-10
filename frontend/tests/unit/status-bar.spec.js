// The status bar renders the activity log: current message on the left,
// version on the right, idle text when nothing is current.
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import { h, reactive } from 'vue'
import { VApp, VMenu } from 'vuetify/components'
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
    expect(wrapper.text()).toContain('NetHelper 1.2.3')
    expect(wrapper.text()).not.toContain('Beta')
    expect(wrapper.text()).toContain('Not connected to real-time updates') // no socket yet

    const store = useNotificationsStore()
    store.setConnection('connected')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="status-idle"]').text()).toBe('Ready')
    store.addNotification({ type: 'error', title: 'Switch down', message: 'core-1', persistent: true, actions: [{ label: 'View', to: '/alerts' }] })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Switch down — core-1')

    const view = wrapper.findAll('button').find((b) => b.text() === 'View')
    await view.trigger('click')
    expect(push).toHaveBeenCalledWith('/alerts')

    await wrapper.find('button[title="Dismiss"]').trigger('click')
    expect(wrapper.text()).toContain('Ready')
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

  test('the history menu lets clicks beside its card through, so they close it', () => {
    // The menu's content box is as wide as the activator (the whole bar): the
    // empty space right of the card counted as inside. The box takes no clicks.
    const wrapper = mountBar()
    expect(wrapper.findComponent(VMenu).props('contentClass')).toBe('status-history-overlay')
    wrapper.unmount()
  })

  test('a flash shows in the bar without adding to the history or its badge', async () => {
    vi.useFakeTimers()
    const wrapper = mountBar()
    const store = useNotificationsStore()
    store.showSuccess('Layout saved', 'Network Map')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Network Map — Layout saved')
    expect(wrapper.find('.v-badge__badge').exists() && wrapper.find('.v-badge__badge').isVisible()).toBe(false)
    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="status-idle"]').exists()).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  })

  test('the idle text says Ready only while the connection dot is green', async () => {
    const wrapper = mountBar()
    const store = useNotificationsStore()
    const idle = () => wrapper.find('[data-testid="status-idle"]').text()
    const dot = () => wrapper.find('.status-meta__dot').classes().find((c) => c.startsWith('status-meta__dot--'))
    const seen = {}
    for (const state of ['idle', 'connecting', 'connected', 'reconnecting', 'failed']) {
      store.setConnection(state)
      await wrapper.vm.$nextTick()
      seen[state] = idle()
      expect(dot()).toBe(`status-meta__dot--${state}`)
    }
    expect(seen).toEqual({
      idle: 'Not connected to real-time updates',
      connecting: 'Connecting…',
      connected: 'Ready',
      reconnecting: 'Connection lost, reconnecting…',
      failed: 'Real-time updates unavailable. Refresh the page.'
    })
    wrapper.unmount()
  })

  test('dismissing a pinned connection message never leaves Ready behind a yellow or red dot', async () => {
    const wrapper = mountBar()
    const store = useNotificationsStore()
    for (const [state, title] of [['reconnecting', 'Connection Lost'], ['failed', 'Connection Failed']]) {
      store.setConnection(state)
      store.addNotification({ id: 'socket-connection', type: 'warning', title, persistent: true, transient: true })
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain(title)
      await wrapper.find('button[title="Dismiss"]').trigger('click')
      expect(wrapper.find('[data-testid="status-idle"]').text()).not.toBe('Ready')
    }
    wrapper.unmount()
  })
})
