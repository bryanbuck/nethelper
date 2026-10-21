// The connection test component: the device page's Details dialog shows the
// result already reported (no new device session), a cloud-only result is
// information rather than a failure, and Test Again runs a new test.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import DeviceConnectionTest from '@/components/devices/DeviceConnectionTest.vue'
import deviceApiService from '@/services/deviceApi.service'

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }

const mountTest = (props) => mount(DeviceConnectionTest, {
  props: { mode: 'stored', deviceId: 'dev-1', ...props },
  global: { plugins: [createVuetify({ components, directives })] }
})

describe('DeviceConnectionTest', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  test('shows a passed-in result without testing again', async () => {
    const spy = vi.spyOn(deviceApiService, 'testDeviceConnection')
    const wrapper = mountTest({ result: { success: true, transport: 'ssh', responseTime: 120 } })
    await flushPromises()

    expect(spy).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Connection Successful')
    expect(wrapper.text()).toContain('SSH')
    expect(wrapper.text()).toContain('Test Again')
  })

  test('a cloud-only result is information, not a failure', async () => {
    const wrapper = mountTest({
      result: { success: false, cloudOnly: true, message: 'NetHelper reaches ap-1 only through My Mist, so there is no direct connection to test.' }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('No direct connection to test')
    expect(wrapper.text()).toContain('only through My Mist')
    expect(wrapper.text()).not.toContain('Troubleshooting')
    expect(wrapper.find('.v-alert').classes().join(' ')).toContain('info')
  })

  test('Test Again runs a new test and reports it', async () => {
    const result = { success: false, message: 'Authentication failed' }
    vi.spyOn(deviceApiService, 'testDeviceConnection').mockResolvedValue(result)
    const wrapper = mountTest({ result: { success: true } })
    await flushPromises()

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(deviceApiService.testDeviceConnection).toHaveBeenCalledWith('dev-1')
    expect(wrapper.emitted('test-complete')[0][0]).toEqual(result)
    expect(wrapper.text()).toContain('Authentication Failed')
  })
})
