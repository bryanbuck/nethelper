// History tab: a config change opens the Compare dialog with the backup that
// found it and the success before it preselected (operator+ only).
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import deviceService from '@/services/device.service'
import backupService from '@/services/backup.service'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/composables/useWebSocket', () => ({ useWebSocket: () => ({ on: vi.fn(), off: vi.fn() }) }))

const { default: DeviceHistoryPanel } = await import('@/components/devices/DeviceHistoryPanel.vue')

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }
globalThis.visualViewport ??= Object.assign(new EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, scale: 1 })
const vuetify = () => createVuetify({ components, directives })

const history = {
  from: '2026-11-03T10:00:00Z',
  to: '2026-11-04T10:00:00Z',
  lanes: [{ key: 'ping', label: 'Ping', segments: [] }],
  markers: [
    { kind: 'backup', id: 'b1', at: '2026-11-03T12:00:00Z', status: 'success', trigger: 'scheduled', changed: false },
    {
      kind: 'backup', id: 'b2', at: '2026-11-04T02:00:00Z', status: 'success', trigger: 'scheduled', changed: true,
      changedSince: '2026-11-03T12:00:00Z', changedSinceId: 'b1',
    },
  ],
}

const mountAs = async (role) => {
  useAuthStore().user = { id: 'u1', role }
  const wrapper = mount(DeviceHistoryPanel, {
    props: { device: { id: 'd1' } },
    global: { plugins: [vuetify()] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('History tab config changes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    vi.spyOn(deviceService, 'getDeviceHistory').mockResolvedValue(history)
  })

  test('Compare diffs the change against the backup before it', async () => {
    const getBackups = vi.spyOn(backupService, 'getBackups').mockResolvedValue({ data: [] })
    const diff = vi.spyOn(backupService, 'diffBackups')
      .mockResolvedValue({ data: { patch: '', additions: 1, deletions: 0, identical: false, kinds: ['cli'], kind: 'cli' } })
    const wrapper = await mountAs('operator')

    const button = wrapper.findAll('button').find((b) => b.text() === 'Compare')
    expect(button).toBeTruthy()
    await button.trigger('click')
    await flushPromises()

    expect(diff).toHaveBeenCalledWith('b1', 'b2', undefined)
    expect(getBackups).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'd1', status: 'success' }))
    wrapper.unmount()
  })

  test('a viewer sees the change but no Compare', async () => {
    const diff = vi.spyOn(backupService, 'diffBackups')
    const wrapper = await mountAs('viewer')

    expect(wrapper.text()).toContain('Config changes')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Compare')).toBe(false)
    await wrapper.find('.history-change-window').trigger('click')
    expect(diff).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
