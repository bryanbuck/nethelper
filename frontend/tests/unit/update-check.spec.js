// Update notice: the store reads the server's last check, and the System
// Status card says what it means and which command to run.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import { h } from 'vue'
import { VApp } from 'vuetify/components'

const getUpdateStatus = vi.fn()
const checkForUpdate = vi.fn()
vi.mock('@/services/system.service', () => ({ default: { getUpdateStatus, checkForUpdate } }))

const { useUpdateCheckStore } = await import('@/stores/updateCheck')
const { default: UpdateStatusCard } = await import('@/components/system/UpdateStatusCard.vue')

globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }

const NOW = '2026-11-11T12:00:00Z'
const current = { enabled: true, current: '1.2.3', latest: { version: '1.2.3', url: 'u', publishedAt: null }, updateAvailable: false, checkedAt: NOW, error: null }
const newer = {
  enabled: true, current: '1.2.3', updateAvailable: true, checkedAt: NOW, error: null,
  latest: { version: '1.3.0', url: 'https://github.com/bryanbuck/nethelper/releases/tag/v1.3.0', publishedAt: '2026-11-10T00:00:00Z' }
}

const mountCard = () => mount({ render: () => h(VApp, () => h(UpdateStatusCard)) }, {
  global: { plugins: [createVuetify({ components, directives })] }
})
const headline = (wrapper) => wrapper.find('[data-testid="update-headline"]').text()

beforeEach(() => {
  setActivePinia(createPinia())
  getUpdateStatus.mockReset()
  checkForUpdate.mockReset()
})

describe('update check store', () => {
  test('start reads once and again every six hours; stop forgets the answer', async () => {
    vi.useFakeTimers()
    getUpdateStatus.mockResolvedValue(newer)
    const store = useUpdateCheckStore()
    store.start()
    store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getUpdateStatus).toHaveBeenCalledTimes(1)
    expect(store.updateAvailable).toBe(true)
    expect(store.latestVersion).toBe('1.3.0')

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(getUpdateStatus).toHaveBeenCalledTimes(2)

    store.stop()
    expect(store.status).toBeNull()
    expect(store.updateAvailable).toBe(false)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(getUpdateStatus).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  test('a failed read keeps the last answer and records the error', async () => {
    const store = useUpdateCheckStore()
    getUpdateStatus.mockResolvedValueOnce(newer)
    await store.load()
    getUpdateStatus.mockRejectedValueOnce(new Error('Network error'))
    await store.load()
    expect(store.updateAvailable).toBe(true)
    expect(store.error).toBe('Network error')
  })

  test('checkNow replaces the answer and never runs twice at once', async () => {
    const store = useUpdateCheckStore()
    let release
    checkForUpdate.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const first = store.checkNow()
    store.checkNow()
    expect(store.checking).toBe(true)
    release(newer)
    await first
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
    expect(store.checking).toBe(false)
    expect(store.latestVersion).toBe('1.3.0')
  })
})

describe('UpdateStatusCard', () => {
  test('a newer release: says so, links the notes and shows both commands', async () => {
    getUpdateStatus.mockResolvedValue(newer)
    const wrapper = mountCard()
    await flushPromises()
    expect(headline(wrapper)).toBe('NetHelper 1.3.0 is available')
    expect(wrapper.text()).toContain('This server runs 1.2.3')
    expect(wrapper.find('a[href="https://github.com/bryanbuck/nethelper/releases/tag/v1.3.0"]').text()).toBe('Release notes')
    const commands = wrapper.find('[data-testid="update-commands"]')
    expect(commands.text()).toContain('./install.sh --upgrade')
    expect(commands.text()).toContain('nethelper-admin upgrade')
    expect(commands.text()).toContain('NetHelper never updates itself')
  })

  test('up to date: no commands; Check now asks the server', async () => {
    getUpdateStatus.mockResolvedValue(current)
    checkForUpdate.mockResolvedValue(newer)
    const wrapper = mountCard()
    await flushPromises()
    expect(headline(wrapper)).toBe('NetHelper 1.2.3 is up to date')
    expect(wrapper.find('[data-testid="update-commands"]').exists()).toBe(false)

    await wrapper.findAll('button').find((b) => b.text().includes('Check now')).trigger('click')
    await flushPromises()
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
    expect(headline(wrapper)).toBe('NetHelper 1.3.0 is available')
  })

  test('turned off: says how, and offers no check', async () => {
    getUpdateStatus.mockResolvedValue({ enabled: false, current: '1.2.3', latest: null, updateAvailable: false, checkedAt: null, error: null })
    const wrapper = mountCard()
    await flushPromises()
    expect(headline(wrapper)).toBe('Update check is off')
    expect(wrapper.text()).toContain('UPDATE_CHECK_ENABLED=false')
    expect(wrapper.findAll('button').some((b) => b.text().includes('Check now'))).toBe(false)
  })

  test('a check that never succeeded, and one that failed after an answer', async () => {
    getUpdateStatus.mockResolvedValue({ enabled: true, current: '1.2.3', latest: null, updateAvailable: false, checkedAt: null, error: "Couldn't reach GitHub (ENOTFOUND)" })
    let wrapper = mountCard()
    await flushPromises()
    expect(headline(wrapper)).toBe("Couldn't check for updates")
    expect(wrapper.text()).toContain('ENOTFOUND')
    wrapper.unmount()

    setActivePinia(createPinia())
    getUpdateStatus.mockResolvedValue({ ...newer, error: 'GitHub is rate-limiting this address; try again later' })
    wrapper = mountCard()
    await flushPromises()
    expect(headline(wrapper)).toBe('NetHelper 1.3.0 is available')
    expect(wrapper.find('[data-testid="update-error"]').text()).toContain('rate-limiting')
  })

  test('not checked yet, and a server that cannot be asked', async () => {
    getUpdateStatus.mockResolvedValue({ enabled: true, current: '1.2.3', latest: null, updateAvailable: false, checkedAt: null, error: null })
    let wrapper = mountCard()
    await flushPromises()
    expect(headline(wrapper)).toBe('Not checked for updates yet')
    wrapper.unmount()

    setActivePinia(createPinia())
    getUpdateStatus.mockRejectedValue(new Error('Request failed while loading the update status'))
    wrapper = mountCard()
    await flushPromises()
    expect(headline(wrapper)).toBe("Couldn't load the update status")
  })
})
