// The Edit Device dialog is shared by the Devices table and the device page:
// it opens prefilled from the device, saves through the store, and emits the
// updated row.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import { h } from 'vue'
import { VApp } from 'vuetify/components'
import DeviceEditDialog from '@/components/devices/DeviceEditDialog.vue'
import { useDevicesStore } from '@/stores/devices'
import { useSettingsStore } from '@/stores/settings'

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }
globalThis.visualViewport ??= Object.assign(new EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, scale: 1 })

const device = {
  id: 'dev-1',
  name: 'core-1',
  type: 'switch',
  vendor: 'aruba',
  platform: 'aos-cx',
  ipAddress: '10.0.0.2',
  macAddress: '',
  location: 'Lab',
  serial: 'SN123',
  model: '6200F',
  managementMode: 'direct',
  cloudIntegrationId: 'int-1',
  apiCredentialId: 'cred-1'
}

const mountDialog = (onSaved) => mount({
  render: () => h(VApp, () => h(DeviceEditDialog, { modelValue: true, device, onSaved }))
}, {
  global: { plugins: [createVuetify({ components, directives })] },
  attachTo: document.body
})

const button = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

describe('DeviceEditDialog', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    // Already loaded, so the dialog fetches nothing.
    settings.apiCredentials = [{ id: 'cred-1', name: 'switch-admin', type: 'aruba_cx' }]
    settings.cloudIntegrations = [{ id: 'int-1', name: 'Central', provider: 'aruba_central', isActive: true }]
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('saves the prefilled device through the store and emits the updated row', async () => {
    const devices = useDevicesStore()
    const updated = { ...device, location: 'Lab' }
    devices.updateDevice = vi.fn().mockResolvedValue(updated)
    const onSaved = vi.fn()

    const wrapper = mountDialog(onSaved)
    await flushPromises()
    expect(document.body.textContent).toContain('Edit Device')

    button('Save Changes').click()
    await flushPromises()

    expect(devices.updateDevice).toHaveBeenCalledWith('dev-1', expect.objectContaining({
      name: 'core-1',
      ipAddress: '10.0.0.2',
      serial: 'SN123',
      macAddress: null,
      managementMode: 'direct',
      cloudIntegrationId: null, // only kept for cloud devices
      apiCredentialId: 'cred-1'
    }))
    expect(onSaved).toHaveBeenCalledWith(updated)
    wrapper.unmount()
  })

  test('does not save when a required field is empty', async () => {
    const devices = useDevicesStore()
    devices.updateDevice = vi.fn()
    const wrapper = mount({
      render: () => h(VApp, () => h(DeviceEditDialog, { modelValue: true, device: { ...device, location: '' } }))
    }, { global: { plugins: [createVuetify({ components, directives })] }, attachTo: document.body })
    await flushPromises()

    button('Save Changes').click()
    await flushPromises()

    expect(devices.updateDevice).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
