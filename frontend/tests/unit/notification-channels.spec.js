// Settings → Notifications: the store keeps the list sorted and knows whether
// email can deliver; the editor never sends a blank secret, only the mask
// that tells the server to keep the stored URL or header value.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'

vi.mock('@/services/settings.service', () => ({
  default: {
    getNotificationChannels: vi.fn(),
    createNotificationChannel: vi.fn(async (p) => ({ id: 'new', rules: [], config: {}, ...p })),
    updateNotificationChannel: vi.fn(async (id, p) => ({ id, rules: [], config: {}, ...p })),
    deleteNotificationChannel: vi.fn(),
    testNotificationChannel: vi.fn(),
    getCloudAlarmNames: vi.fn(async () => [
      { provider: 'aruba_central', name: 'IPsec SA Down' },
      { provider: 'aruba_central', name: 'Port Flap' },
      { provider: 'juniper_mist', name: 'Port flap' }
    ])
  }
}))

const { default: settingsService } = await import('@/services/settings.service')
const { useNotificationChannelsStore } = await import('@/stores/notificationChannels')
const { default: NotificationChannels } = await import('@/components/settings/NotificationChannels.vue')

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }
globalThis.visualViewport ??= Object.assign(new EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, scale: 1 })

const WEBHOOK = {
  id: 'c1', name: 'Slack', type: 'webhook', minSeverity: 'critical', rules: [], enabled: true,
  config: { url: '***', urlHint: 'https://hooks.slack.com/…', insecure: false, headers: { 'X-Token': '***' } }
}

describe('notification channels', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    settingsService.getNotificationChannels.mockResolvedValue({ data: [WEBHOOK], emailConfigured: false })
  })

  test('the store loads channels and the email flag, and keeps them sorted', async () => {
    const store = useNotificationChannelsStore()
    await store.fetchChannels()
    expect(store.emailConfigured).toBe(false)
    await store.createChannel({ name: 'Mail', type: 'email' })
    expect(store.channels.map((c) => c.name)).toEqual(['Mail', 'Slack'])
    await store.deleteChannel('c1')
    expect(store.channels.map((c) => c.id)).toEqual(['new'])
  })

  test('editing a webhook without retyping secrets sends the masks', async () => {
    const wrapper = mount(NotificationChannels, {
      global: { plugins: [createVuetify({ components, directives })] },
      attachTo: document.body
    })
    await flushPromises()
    wrapper.vm.openEditor(WEBHOOK)
    wrapper.vm.draft.name = 'Slack ops'
    expect(wrapper.vm.payloadOf(wrapper.vm.draft)).toEqual({
      name: 'Slack ops',
      type: 'webhook',
      minSeverity: 'critical',
      rules: [],
      cloudAlarms: false,
      cloudAlarmNames: [],
      enabled: true,
      config: { url: '***', headers: { 'X-Token': '***' } }
    })
    wrapper.vm.draft.url = 'https://hooks.slack.com/services/NEW'
    wrapper.vm.draft.headers[0].value = 'fresh'
    expect(wrapper.vm.payloadOf(wrapper.vm.draft).config).toEqual({
      url: 'https://hooks.slack.com/services/NEW', headers: { 'X-Token': 'fresh' }
    })
    wrapper.unmount()
  })

  test('cloud alarms: names offered once per spelling, loaded once, sent trimmed', async () => {
    const wrapper = mount(NotificationChannels, {
      global: { plugins: [createVuetify({ components, directives })] },
      attachTo: document.body
    })
    await flushPromises()
    wrapper.vm.openEditor({ ...WEBHOOK, cloudAlarms: true, cloudAlarmNames: ['Port Flap'] })
    await flushPromises()
    expect(wrapper.vm.cloudAlarmNameItems).toEqual(['IPsec SA Down', 'Port Flap'])
    wrapper.vm.draft.cloudAlarmNames.push('  IPsec SA Down ')
    expect(wrapper.vm.payloadOf(wrapper.vm.draft)).toMatchObject({ cloudAlarms: true, cloudAlarmNames: ['Port Flap', 'IPsec SA Down'] })

    wrapper.vm.openEditor(null)
    await flushPromises()
    expect(settingsService.getCloudAlarmNames).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.draft).toMatchObject({ cloudAlarms: false, cloudAlarmNames: [] })
    wrapper.unmount()
  })

  test('a test send reports the server\'s reason when it fails', async () => {
    settingsService.testNotificationChannel.mockResolvedValue({ success: false, error: 'The webhook answered HTTP 404' })
    const wrapper = mount(NotificationChannels, {
      global: { plugins: [createVuetify({ components, directives })] },
      attachTo: document.body
    })
    await flushPromises()
    const { useNotificationsStore } = await import('@/stores/notifications')
    const log = useNotificationsStore()
    await wrapper.vm.sendTest(WEBHOOK)
    expect(settingsService.testNotificationChannel).toHaveBeenCalledWith('c1')
    expect(log.entries[0].message).toContain('The webhook answered HTTP 404')
    wrapper.unmount()
  })
})
