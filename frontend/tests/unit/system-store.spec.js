// System Status page: store reducers, socket/HTTP subscribe, display helpers.
import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

const socket = { on: vi.fn(), off: vi.fn() }
const ws = { socket: null, connected: false, request: vi.fn(), emit: vi.fn() }
vi.mock('@/services/websocket.service', () => ({ default: ws }))
const getStatus = vi.fn()
vi.mock('@/services/system.service', () => ({ default: { getStatus } }))

const { appendSample, compactSample, useSystemStore } = await import('@/stores/system')
const { formatBytes, formatDuration, perMinute, share, peakOf } = await import('@/models/system')

const sample = (at, extra = {}) => ({
  at,
  intervalMs: 5000,
  process: { cpuPercent: 2.5, rss: 100, heapUsed: 50, uptimeSec: 1 },
  eventLoop: { p99Ms: 3 },
  http: { requests: 10, status5xx: 1 },
  sockets: { connections: 2, users: 1 },
  queueBacklog: 4,
  ...extra
})

const snapshot = {
  version: '1.0.0', node: 'v22', startedAt: '2026-10-22T00:00:00Z', intervalMs: 5000, historyWindowMs: 3600000,
  current: sample('2026-10-22T10:00:00Z'),
  slow: { database: { size: 1 } },
  history: [compactSample(sample('2026-10-22T10:00:00Z'))]
}

describe('system store reducers', () => {
  test('compactSample keeps the chart numbers; a failed socket source is null', () => {
    expect(compactSample(sample('t', { sockets: { error: 'x' } }))).toEqual({
      at: 't', cpu: 2.5, rss: 100, heapUsed: 50, loopP99: 3, requests: 10, errors: 1, sockets: null, backlog: 4, intervalMs: 5000
    })
  })

  test('appendSample drops repeats and points outside the window', () => {
    let history = appendSample([], sample('2026-10-22T10:00:00Z'))
    history = appendSample(history, sample('2026-10-22T10:00:00Z'))
    expect(history).toHaveLength(1)
    history = appendSample(history, sample('2026-10-22T11:00:05Z'))
    expect(history.map((p) => p.at)).toEqual(['2026-10-22T11:00:05Z'])
  })
})

describe('system store subscribe', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  test('joins the socket room and applies the snapshot, then live samples', async () => {
    Object.assign(ws, { socket, connected: true })
    ws.request.mockResolvedValue({ ok: true, snapshot })
    const store = useSystemStore()
    await store.watch()

    expect(ws.request).toHaveBeenCalledWith('subscribe:system-status', null)
    expect(store.mode).toBe('live')
    expect(store.info.version).toBe('1.0.0')
    expect(store.slow.database.size).toBe(1)

    const onSample = socket.on.mock.calls.find(([event]) => event === 'system:status:sample')[1]
    onSample(sample('2026-10-22T10:00:05Z'))
    expect(store.history).toHaveLength(2)
    expect(store.current.at).toBe('2026-10-22T10:00:05Z')

    store.unwatch()
    expect(ws.emit).toHaveBeenCalledWith('unsubscribe:system-status')
    expect(socket.off).toHaveBeenCalled()
  })

  test('falls back to HTTP polling without the socket, and moves over when it connects', async () => {
    Object.assign(ws, { socket: null, connected: false })
    getStatus.mockResolvedValue(snapshot)
    const store = useSystemStore()
    await store.watch()
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(store.mode).toBe('polling')

    Object.assign(ws, { socket, connected: true })
    ws.request.mockResolvedValue({ ok: true, snapshot })
    await vi.advanceTimersByTimeAsync(15000)
    expect(store.mode).toBe('live')
    store.unwatch()
  })

  test('a refused subscribe shows the error and polls', async () => {
    Object.assign(ws, { socket, connected: true })
    ws.request.mockResolvedValue({ ok: false, error: 'Admins only' })
    const store = useSystemStore()
    await store.watch()
    expect(store.error).toBe('Admins only')
    expect(store.mode).toBe('polling')
    store.unwatch()
  })
})

describe('system display helpers', () => {
  test('formatBytes, formatDuration, perMinute, share', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(null)).toBe('—')
    expect(formatDuration(90061)).toBe('1d 1h')
    expect(formatDuration(42)).toBe('42s')
    expect(perMinute(10, 5000)).toBe(120)
    expect(share(1, 4)).toBe(25)
    expect(share(1, 0)).toBeNull()
  })

  it('peakOf finds the highest sample and skips failed reads', () => {
    const points = [{ at: 't1', cpu: 2 }, { at: 't2', cpu: null }, { at: 't3', cpu: 7 }, { at: 't4', cpu: 5 }]
    expect(peakOf(points, 'cpu')).toEqual({ value: 7, at: 't3' })
    expect(peakOf([{ at: 't1', cpu: null }], 'cpu')).toBeNull()
    expect(peakOf([], 'cpu')).toBeNull()
    expect(peakOf(undefined, 'cpu')).toBeNull()
  })
})
