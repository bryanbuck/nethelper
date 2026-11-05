// Device page Image Information card and its display model. The images are
// shaped like the backend's utils/firmware-images.js, from the live AOS-CX
// replies in backend/tests/fixtures/aos-cx-live/firmware.json.
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import deviceService from '@/services/device.service'
import { imageRows, nextBootChange, runningVersion } from '@/models/firmware-images'
import DeviceImagesCard from '@/components/devices/DeviceImagesCard.vue'

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }

const bootedSecondary = {
  primary: 'FL.10.15.1010', secondary: 'FL.10.16.1006', defaultImage: 'secondary', bootedImage: 'secondary',
  running: 'FL.10.16.1006', source: 'aos-cx-rest', checkedAt: new Date().toISOString()
}
const ready = { available: true, reason: null }

const mountCard = (props) => mount(DeviceImagesCard, {
  props: { canEdit: true, imagePoll: ready, ...props },
  global: { plugins: [createVuetify({ components, directives })] }
})

describe('firmware images model', () => {
  test('one row per partition with booted/default flags', () => {
    expect(imageRows(bootedSecondary)).toEqual([
      { slot: 'primary', label: 'Primary', version: 'FL.10.15.1010', booted: false, isDefault: false },
      { slot: 'secondary', label: 'Secondary', version: 'FL.10.16.1006', booted: true, isDefault: true }
    ])
    expect(imageRows(null)).toEqual([])
  })

  test('the next reboot changes nothing when default = booted and unchanged', () => {
    expect(nextBootChange(bootedSecondary)).toBeNull()
  })

  test('a default pointing at the other partition loads its version next', () => {
    expect(nextBootChange({ ...bootedSecondary, defaultImage: 'primary' }))
      .toEqual({ slot: 'primary', slotLabel: 'Primary', version: 'FL.10.15.1010', running: 'FL.10.16.1006' })
  })

  test('new firmware copied into the booted partition loads next', () => {
    const staged = { ...bootedSecondary, secondary: 'FL.10.17.0001' }
    expect(nextBootChange(staged)).toMatchObject({ slot: 'secondary', version: 'FL.10.17.0001' })
  })

  test('runningVersion falls back to the booted partition', () => {
    expect(runningVersion({ ...bootedSecondary, running: null })).toBe('FL.10.16.1006')
  })
})

describe('DeviceImagesCard', () => {
  beforeEach(() => vi.restoreAllMocks())

  test('lists both images with Booted and Default on the right one', () => {
    const wrapper = mountCard({ device: { id: 'd1', firmwareImages: bootedSecondary } })
    const primary = wrapper.find('[data-slot="primary"]')
    const secondary = wrapper.find('[data-slot="secondary"]')
    expect(primary.text()).toContain('FL.10.15.1010')
    expect(primary.text()).not.toMatch(/Booted|Default/)
    expect(secondary.text()).toContain('FL.10.16.1006')
    expect(secondary.text()).toContain('Booted')
    expect(secondary.text()).toContain('Default')
    expect(wrapper.find('[data-test="next-boot"]').exists()).toBe(false)
  })

  test('warns when the next reboot loads another version', () => {
    const wrapper = mountCard({ device: { id: 'd1', firmwareImages: { ...bootedSecondary, defaultImage: 'primary' } } })
    expect(wrapper.find('[data-test="next-boot"]').text()).toContain('FL.10.15.1010')
  })

  test('hidden for a platform that reports no images', () => {
    const wrapper = mountCard({ device: { id: 'd1' }, imagePoll: { available: false, reason: 'unsupported' } })
    expect(wrapper.text()).toBe('')
  })

  test('Refresh polls this device and emits the stored images', async () => {
    vi.spyOn(deviceService, 'pollDeviceFirmware').mockResolvedValue({
      results: [{ deviceId: 'd1', success: true, data: { images: bootedSecondary, firmwareVersion: 'FL.10.16.1006' } }]
    })
    const wrapper = mountCard({ device: { id: 'd1' } })
    expect(wrapper.text()).toContain('Not read yet')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(deviceService.pollDeviceFirmware).toHaveBeenCalledWith(['d1'])
    expect(wrapper.emitted('patch')[0][0]).toEqual({ firmwareImages: bootedSecondary, firmwareVersion: 'FL.10.16.1006' })
  })

  test('a viewer gets no Refresh button', () => {
    const wrapper = mountCard({ device: { id: 'd1', firmwareImages: bootedSecondary }, canEdit: false })
    expect(wrapper.find('button').exists()).toBe(false)
  })

  test('a failed poll shows its error', async () => {
    vi.spyOn(deviceService, 'pollDeviceFirmware').mockResolvedValue({
      results: [{ deviceId: 'd1', success: false, error: 'CX login failed' }]
    })
    const wrapper = mountCard({ device: { id: 'd1' } })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('CX login failed')
    expect(wrapper.emitted('patch')).toBeUndefined()
  })
})
