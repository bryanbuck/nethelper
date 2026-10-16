import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'
import { layoutTopology, NODE_SIZE } from '@/utils/topologyLayout'

vi.mock('@/services/topology.service', () => ({
  default: {
    getGraph: vi.fn(),
    getLayout: vi.fn(),
    saveLayout: vi.fn(),
    getChanges: vi.fn(),
    collect: vi.fn()
  }
}))

const { default: topologyService } = await import('@/services/topology.service')
const { useTopologyStore } = await import('@/stores/topology')

const graph = {
  nodes: [
    { id: 'device:gw', kind: 'device', data: { name: 'gw', type: 'gateway' } },
    { id: 'device:core', kind: 'device', data: { name: 'core', type: 'switch', pingStatus: 'online' } },
    { id: 'ghost:aa', kind: 'ghost', data: { name: 'phone' } },
    { id: 'device:lonely', kind: 'device', data: { name: 'lonely' } },
    { id: 'subnet:10.0.0.0/24', kind: 'subnet', data: { name: '10.0.0.0/24', count: 3 } }
  ],
  edges: [
    { id: 'e1', source: 'device:gw', target: 'device:core' },
    { id: 'e2', source: 'device:core', target: 'ghost:aa' }
  ],
  sites: ['HQ'],
  stats: { devices: 3 }
}

describe('layoutTopology', () => {
  test('linked nodes are layered top-down along the edges', () => {
    const pos = layoutTopology(graph.nodes, graph.edges)
    expect(pos['device:gw'].y).toBeLessThan(pos['device:core'].y)
    expect(pos['device:core'].y).toBeLessThan(pos['ghost:aa'].y)
  })

  test('unlinked nodes go in a grid below, devices before subnet groups', () => {
    const pos = layoutTopology(graph.nodes, graph.edges)
    const bottom = pos['ghost:aa'].y + NODE_SIZE.ghost.height
    expect(pos['device:lonely'].y).toBeGreaterThan(bottom)
    expect(pos['subnet:10.0.0.0/24'].x).toBeGreaterThan(pos['device:lonely'].x)
  })

  test('saved positions win unless forced', () => {
    const saved = { 'device:core': { x: 999, y: 7 }, 'device:gone': { x: 1, y: 1 } }
    expect(layoutTopology(graph.nodes, graph.edges, saved)['device:core']).toEqual({ x: 999, y: 7 })
    expect(layoutTopology(graph.nodes, graph.edges, saved)['device:gone']).toBeUndefined()
    expect(layoutTopology(graph.nodes, graph.edges, saved, { force: true })['device:core']).not.toEqual({ x: 999, y: 7 })
  })
})

describe('topology store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  test('fetchGraph passes the scope and discovery toggle', async () => {
    topologyService.getGraph.mockResolvedValue({ data: graph })
    const store = useTopologyStore()
    store.site = 'HQ'
    store.includeDiscovered = true
    await store.fetchGraph()
    expect(topologyService.getGraph).toHaveBeenCalledWith({ site: 'HQ', includeDiscovered: true })
    expect(store.scope).toBe('site:HQ')
    expect(store.sites).toEqual(['HQ'])
  })

  test('a missing layout falls back to auto-layout', async () => {
    topologyService.getLayout.mockRejectedValue(new Error('boom'))
    const store = useTopologyStore()
    await store.fetchLayout()
    expect(store.layout.positions).toEqual({})
    expect(store.layoutDirty).toBe(false)
  })

  test('saveLayout writes the current scope and clears the dirty flag', async () => {
    topologyService.saveLayout.mockResolvedValue({ data: { positions: { 'device:gw': { x: 1, y: 2 } } } })
    const store = useTopologyStore()
    store.markLayoutDirty()
    await store.saveLayout({ 'device:gw': { x: 1, y: 2 } })
    expect(topologyService.saveLayout).toHaveBeenCalledWith('all', { 'device:gw': { x: 1, y: 2 } })
    expect(store.layoutDirty).toBe(false)
  })

  test('socket progress and completion', () => {
    const store = useTopologyStore()
    store.handleProgress({ done: 1, total: 4 })
    expect(store.collecting).toBe(true)
    const before = store.staleAt
    store.handleUpdated({ ok: 4, total: 4, trigger: 'manual' })
    expect(store.collecting).toBe(false)
    expect(store.staleAt).toBeGreaterThanOrEqual(before)
    expect(store.lastRun.ok).toBe(4)
  })

  test('ping status patches a device node in place', async () => {
    topologyService.getGraph.mockResolvedValue({ data: JSON.parse(JSON.stringify(graph)) })
    const store = useTopologyStore()
    await store.fetchGraph()
    store.applyDeviceStatus('core', { pingStatus: 'offline' })
    expect(store.graph.nodes.find((n) => n.id === 'device:core').data).toMatchObject({ name: 'core', pingStatus: 'offline' })
    store.applyDeviceStatus('unknown', { pingStatus: 'offline' }) // not on the map: no-op
  })
})
