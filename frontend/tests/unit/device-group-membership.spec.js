// The Devices table's Group bulk action: a typed new name creates the group
// first, a typed existing name (any case) reuses it, and removal names only
// the selected devices.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'

vi.mock('@/services/device.service', () => ({
  default: {
    getDeviceGroups: vi.fn(async () => [{ id: 'g1', name: 'Core', _count: { devices: 2, automations: 0 } }]),
    createDeviceGroup: vi.fn(async ({ name }) => ({ id: 'g-new', name })),
    updateGroupMembers: vi.fn(async (id) => ({ id, name: id === 'g1' ? 'Core' : 'Lab', deviceCount: 2 }))
  }
}))

const { default: deviceService } = await import('@/services/device.service')
const { default: Dialog } = await import('@/components/devices/DeviceGroupMembershipDialog.vue')

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }
globalThis.visualViewport ??= Object.assign(new EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, scale: 1 })

const mountDialog = async () => {
  const wrapper = mount(Dialog, {
    props: { modelValue: false, deviceIds: ['d1', 'd2'] },
    global: { plugins: [createVuetify({ components, directives })] },
    attachTo: document.body
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

describe('DeviceGroupMembershipDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  test('a new name creates the group, then adds the devices', async () => {
    const wrapper = await mountDialog()
    wrapper.vm.choice = 'Lab'
    expect(wrapper.vm.isNewGroup).toBe(true)
    await wrapper.vm.apply()
    expect(deviceService.createDeviceGroup).toHaveBeenCalledWith({ name: 'Lab' })
    expect(deviceService.updateGroupMembers).toHaveBeenCalledWith('g-new', { add: ['d1', 'd2'] })
    expect(wrapper.emitted('changed')).toHaveLength(1)
    wrapper.unmount()
  })

  test('an existing name typed in another case reuses that group', async () => {
    const wrapper = await mountDialog()
    wrapper.vm.choice = 'core'
    expect(wrapper.vm.isNewGroup).toBe(false)
    await wrapper.vm.apply()
    expect(deviceService.createDeviceGroup).not.toHaveBeenCalled()
    expect(deviceService.updateGroupMembers).toHaveBeenCalledWith('g1', { add: ['d1', 'd2'] })
  })

  test('remove takes only the selected devices out', async () => {
    const wrapper = await mountDialog()
    wrapper.vm.mode = 'remove'
    await flushPromises()
    wrapper.vm.choice = { id: 'g1', name: 'Core' }
    await wrapper.vm.apply()
    expect(deviceService.updateGroupMembers).toHaveBeenCalledWith('g1', { remove: ['d1', 'd2'] })
  })
})
