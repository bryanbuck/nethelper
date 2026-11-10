// Port Identity: the display model against the backend's aging constants, and
// the device page's Ports tab (service mocked).
import { createRequire } from 'node:module'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createRouter, createMemoryHistory } from 'vue-router'
import { vi } from 'vitest'
import portsService from '@/services/ports.service'
import { useAuthStore } from '@/stores/auth'
import {
  FRESHNESS, GONE_REASONS, SOURCES, PORT_KINDS, NOTE_KINDS, NOTE_KIND_ITEMS,
  clientTitle, profileText, freshnessText, portKey
} from '@/models/port-clients'

// Vuetify's data table and slide groups observe their size; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe () {} unobserve () {} disconnect () {} }

const require = createRequire(import.meta.url)
const backend = require('../../../backend/src/services/ports/client-aging.js')

const handlers = {}
vi.mock('@/composables/useWebSocket', () => ({
  useWebSocket: () => ({
    on: (event, fn) => { handlers[event] = fn },
    off: (event) => { delete handlers[event] }
  })
}))

const { default: DevicePortsPanel } = await import('@/components/devices/DevicePortsPanel.vue')

describe('models/port-clients', () => {
  test('value lists mirror backend client-aging.js', () => {
    expect(Object.keys(FRESHNESS).sort()).toEqual([...backend.FRESHNESS].sort())
    expect(Object.keys(GONE_REASONS).sort()).toEqual([...backend.GONE_REASONS].sort())
    expect(Object.keys(SOURCES).sort()).toEqual([...backend.SOURCES].sort())
    expect(Object.keys(PORT_KINDS).sort()).toEqual([...backend.PORT_KINDS].sort())
    expect(NOTE_KINDS).toEqual([...backend.NOTE_KINDS])
    expect(NOTE_KIND_ITEMS.map((i) => i.value)).toEqual([...backend.NOTE_KINDS])
  })

  test('a client is named by hostname, LLDP, cloud profile, vendor, then MAC', () => {
    expect(clientTitle({ hostname: 'desk-pc', profile: { os: 'Windows' }, mac: 'm' })).toBe('desk-pc')
    expect(clientTitle({ lldp: { sysName: 'SEP0001' }, profile: { os: 'Cisco IP Phone' }, mac: 'm' })).toBe('SEP0001')
    expect(clientTitle({ profile: { os: 'HP iLO' }, vendor: 'HP', mac: 'm' })).toBe('HP iLO')
    expect(clientTitle({ vendor: 'Epson', mac: 'm' })).toBe('Epson')
    expect(clientTitle({ mac: 'aa:bb' })).toBe('aa:bb')
    expect(clientTitle({ profile: { os: 'Unclassified' }, vendor: 'Dell', mac: 'm' })).toBe('Dell')
  })

  test('cloud profiling reads as the cloud\'s claim', () => {
    expect(profileText({ os: 'Cisco IP Phone', function: 'VoIP Phone', source: 'Aruba Central' }))
      .toBe('Aruba Central classifies this as Cisco IP Phone (VoIP Phone)')
    expect(profileText({ vendor: 'X', randomMac: true })).toBe('')
  })

  test('freshness says how old and why', () => {
    const now = Date.parse('2026-11-10T12:00:00Z')
    expect(freshnessText({ freshness: 'confirmed', since: '2026-11-10T11:55:00Z' }, now)).toBe('Confirmed 5 min ago')
    expect(freshnessText({ freshness: 'gone', since: '2026-11-10T10:00:00Z', goneReason: 'link-down' }, now)).toBe('Gone 2 h ago: port went down')
    expect(freshnessText({ freshness: 'stale', since: null }, now)).toBe('Stale: never read successfully')
    expect(freshnessText({ freshness: 'unconfirmed', missedReads: 3, since: '2026-11-10T11:00:00Z' }, now)).toBe('Not in the last 3 reads; last seen 1 h ago')
    expect(portKey(' 1/1/4 ')).toBe('1/1/4')
  })
})

const client = (over = {}) => ({
  id: 'c1', mac: 'aa:00:00:00:00:01', state: 'present', freshness: 'confirmed', since: new Date().toISOString(),
  firstSeen: new Date().toISOString(), sources: ['mac-table'], profile: null, ...over
})
const port = (over = {}) => ({
  port: '1/1/4', label: '1/1/4', description: null, linkUp: true, macCount: 1, uplink: false, ap: null,
  kind: { kind: 'new', source: 'derived', reason: '' }, note: null, expected: null, clients: [], goneCount: 0, neighbors: [], vlan: null, ...over
})
const VIEW = {
  device: { id: 'd1', name: 'Sw-Studio' },
  reads: [{ source: 'device-rest', readAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), error: null }],
  ports: [
    port({
      description: 'IP Phone + USB-C dock',
      note: { label: 'Desk 3', location: 'Studio', kind: 'auto' },
      clients: [client({ profile: { os: 'Cisco IP Phone', source: 'Aruba Central' } }), client({ id: 'c2', hostname: 'dock-pc' })]
    }),
    port({ port: '1/1/13', label: '1/1/13', uplink: true, macCount: 56, kind: { kind: 'uplink', source: 'derived' } }),
    port({ port: '1/1/9', label: '1/1/9', linkUp: false, kind: { kind: 'idle', source: 'derived' } })
  ]
}

function mountPanel(role = 'operator') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = { id: 'u1', role }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] })
  return mount(DevicePortsPanel, {
    props: { device: { id: 'd1', name: 'Sw-Studio', type: 'switch' } },
    global: { plugins: [pinia, createVuetify({ components, directives }), router] }
  })
}

describe('DevicePortsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.keys(handlers).forEach((k) => delete handlers[k])
  })

  test('lists ports with the user label, the switch description, and clients by their best name', async () => {
    vi.spyOn(portsService, 'getPorts').mockResolvedValue(VIEW)
    const wrapper = mountPanel()
    await flushPromises()

    const text = wrapper.text()
    expect(portsService.getPorts).toHaveBeenCalledWith('d1')
    expect(text).toContain('Desk 3')
    expect(text).toContain('IP Phone + USB-C dock')
    expect(text).toContain('Cisco IP Phone')
    expect(text).toContain('dock-pc')
    expect(text).toContain('56 MACs through this port')
    expect(text).toContain('2 connected devices')
  })

  test('filters to ports with a device, and hides uplinks on request', async () => {
    vi.spyOn(portsService, 'getPorts').mockResolvedValue(VIEW)
    const wrapper = mountPanel()
    await flushPromises()

    wrapper.vm.$.setupState.show = 'connected'
    await flushPromises()
    expect(wrapper.text()).not.toContain('1/1/9')
    wrapper.vm.$.setupState.show = 'all'
    wrapper.vm.$.setupState.showInfra = false
    await flushPromises()
    expect(wrapper.text()).not.toContain('56 MACs')
    expect(wrapper.text()).toContain('1/1/9')
  })

  test('viewers get no Read now and no Add', async () => {
    vi.spyOn(portsService, 'getPorts').mockResolvedValue(VIEW)
    const wrapper = mountPanel('viewer')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Read now')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Add')).toBe(false)
  })

  test('reloads when this switch\'s ports change, not another\'s', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(portsService, 'getPorts').mockResolvedValue(VIEW)
    mountPanel()
    await flushPromises()
    handlers['ports:updated']({ deviceId: 'other' })
    vi.advanceTimersByTime(2000)
    expect(spy).toHaveBeenCalledTimes(1)
    handlers['ports:updated']({ deviceId: 'd1' })
    vi.advanceTimersByTime(2000)
    expect(spy).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
