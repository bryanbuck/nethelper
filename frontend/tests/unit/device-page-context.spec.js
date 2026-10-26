// Device page context: the unresolved-alerts banner and the Recent Automation
// Runs card. Both show nothing when empty and reload only for socket events
// about their own device.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createRouter, createMemoryHistory } from 'vue-router'
import { vi } from 'vitest'
import alertsService from '@/services/alerts.service'
import executionsService from '@/services/executions.service'

const handlers = {}
vi.mock('@/composables/useWebSocket', () => ({
  useWebSocket: () => ({
    on: (event, fn) => { handlers[event] = fn },
    off: (event) => { delete handlers[event] }
  })
}))

const { default: DeviceAlertsBanner } = await import('@/components/devices/DeviceAlertsBanner.vue')
const { default: DeviceRecentRunsCard } = await import('@/components/devices/DeviceRecentRunsCard.vue')

const plugins = () => [
  createVuetify({ components, directives }),
  createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] })
]

const alert = (id, severity, extra = {}) => ({
  id, severity, rule: 'device.offline', status: 'open', title: `Alert ${id}`, deviceId: 'd1',
  firstSeenAt: new Date().toISOString(), ...extra
})

describe('device page context', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    Object.keys(handlers).forEach((k) => delete handlers[k])
  })
  afterEach(() => vi.useRealTimers())

  test('alerts banner: nothing without alerts', async () => {
    vi.spyOn(alertsService, 'list').mockResolvedValue({ data: [], total: 0 })
    const wrapper = mount(DeviceAlertsBanner, { props: { deviceId: 'd1' }, global: { plugins: plugins() } })
    await flushPromises()

    expect(alertsService.list).toHaveBeenCalledWith({ deviceId: 'd1', status: 'active', limit: 10 })
    expect(wrapper.find('.v-alert').exists()).toBe(false)
  })

  test('alerts banner: worst severity, the first three, and a link to the rest', async () => {
    const alerts = [alert('a1', 'warning'), alert('a2', 'critical'), alert('a3', 'info'), alert('a4', 'info', { status: 'acknowledged' })]
    vi.spyOn(alertsService, 'list').mockResolvedValue({ data: alerts, total: 5 })
    const wrapper = mount(DeviceAlertsBanner, { props: { deviceId: 'd1' }, global: { plugins: plugins() } })
    await flushPromises()

    const banner = wrapper.find('.v-alert')
    expect(banner.classes()).toContain('text-error')
    expect(banner.text()).toContain('5 unresolved alerts')
    expect(banner.text()).toContain('Alert a3')
    expect(banner.text()).not.toContain('Alert a4')
    expect(banner.text()).toContain('and 2 more')
    expect(wrapper.find('a[href="/alerts?deviceId=d1"]').exists()).toBe(true)
  })

  test('alerts banner: reloads for this device\'s alerts only', async () => {
    vi.useFakeTimers()
    vi.spyOn(alertsService, 'list').mockResolvedValue({ data: [], total: 0 })
    mount(DeviceAlertsBanner, { props: { deviceId: 'd1' }, global: { plugins: plugins() } })
    await flushPromises()
    expect(alertsService.list).toHaveBeenCalledTimes(1)

    handlers['alert:new']({ alert: { deviceId: 'd2' } })
    handlers['alert:updated']({ alerts: [{ deviceId: 'd2' }] })
    await vi.runAllTimersAsync()
    expect(alertsService.list).toHaveBeenCalledTimes(1)

    handlers['alert:updated']({ alerts: [{ deviceId: 'd1', status: 'resolved' }] })
    await vi.runAllTimersAsync()
    expect(alertsService.list).toHaveBeenCalledTimes(2)

    // Rows removed in bulk (a delete or merge) say nothing about which device
    handlers['alert:updated']({ alerts: [] })
    await vi.runAllTimersAsync()
    expect(alertsService.list).toHaveBeenCalledTimes(3)
  })

  test('runs card: nothing until a run exists, then the newest runs', async () => {
    vi.useFakeTimers()
    const list = vi.spyOn(executionsService, 'list').mockResolvedValue({ executions: [], pagination: { total: 0 } })
    const wrapper = mount(DeviceRecentRunsCard, { props: { deviceId: 'd1' }, global: { plugins: plugins() } })
    await flushPromises()
    expect(list).toHaveBeenCalledWith({ deviceId: 'd1', limit: 5 })
    expect(wrapper.find('.v-card').exists()).toBe(false)

    list.mockResolvedValue({
      executions: [{
        id: 'e1', status: 'failed', trigger: 'schedule', duration: 1200, error: 'Backup: timed out',
        createdAt: new Date().toISOString(), automation: { id: 'a1', name: 'Nightly check' }
      }],
      pagination: { total: 12 }
    })
    handlers['automation:completed']({ executionId: 'x', deviceId: 'd2', status: 'success' })
    await vi.runAllTimersAsync()
    expect(list).toHaveBeenCalledTimes(1)

    handlers['automation:completed']({ executionId: 'e1', deviceId: 'd1', status: 'failed' })
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    const card = wrapper.find('.v-card')
    expect(card.text()).toContain('Nightly check')
    expect(card.text()).toContain('Backup: timed out')
    expect(card.text()).toContain('All 12 runs')
    expect(wrapper.find('a[href="/automations/executions?deviceId=d1"]').exists()).toBe(true)
  })
})
