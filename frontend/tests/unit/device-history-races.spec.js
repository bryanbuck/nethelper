// Stale replies (#52): the History tab shows only the newest request's reply,
// and an address lookup that finishes after navigating to another device is
// dropped instead of shown on the new device's banner.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import deviceService from '@/services/device.service'

vi.mock('@/composables/useWebSocket', () => ({ useWebSocket: () => ({ on: vi.fn(), off: vi.fn() }) }))

const { default: DeviceHistoryPanel } = await import('@/components/devices/DeviceHistoryPanel.vue')
const { default: DeviceAddressLookup } = await import('@/components/devices/DeviceAddressLookup.vue')

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }
const vuetify = () => createVuetify({ components, directives })

const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

const history = (from, to) => ({ from, to, lanes: [], markers: [] })

describe('stale replies', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  test('History: a slower reply for an older range is not drawn over the newer one', async () => {
    const replies = { '24h': deferred(), '30d': deferred() }
    vi.spyOn(deviceService, 'getDeviceHistory').mockImplementation((id, { range }) => replies[range].promise)
    const wrapper = mount(DeviceHistoryPanel, { props: { device: { id: 'd1' } }, global: { plugins: [vuetify()] } })
    await flushPromises()

    wrapper.vm.range = '30d'
    await flushPromises()
    // The 24 h load started on mount; switch back so 24 h is the newest request.
    replies['24h'] = deferred()
    wrapper.vm.range = '24h'
    await flushPromises()

    replies['24h'].resolve(history('2026-10-22T10:00:00Z', '2026-10-23T10:00:00Z'))
    await flushPromises()
    replies['30d'].resolve(history('2026-09-23T10:00:00Z', '2026-10-23T10:00:00Z'))
    await flushPromises()

    expect(wrapper.vm.history.from).toBe('2026-10-22T10:00:00Z')
    expect(wrapper.vm.loadedRange).toBe('24h')
    wrapper.unmount()
  })

  test('Address lookup: an answer for the previous device is dropped', async () => {
    const reply = deferred()
    vi.spyOn(deviceService, 'lookupAddress').mockReturnValue(reply.promise)
    const wrapper = mount(DeviceAddressLookup, { props: { deviceId: 'd1' }, global: { plugins: [vuetify()] } })

    const running = wrapper.vm.run()
    await wrapper.setProps({ deviceId: 'd2' })
    reply.resolve({ sources: [], sameMac: false, mac: 'aa:bb:cc:dd:ee:ff' })
    await running
    await flushPromises()

    expect(wrapper.vm.result).toBeNull()
    expect(wrapper.vm.loading).toBe(false)
  })
})
