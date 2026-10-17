import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/services/alerts.service', () => ({
  default: {
    list: vi.fn(),
    summary: vi.fn(),
    acknowledge: vi.fn(),
    resolve: vi.fn(),
    getRules: vi.fn(),
    updateRule: vi.fn()
  }
}))

const { default: alertsService } = await import('@/services/alerts.service')
const { useAlertsStore } = await import('@/stores/alerts')
const { alertLink } = await import('@/models/alerts')

const summary = (over = {}) => ({
  open: 2,
  acknowledged: 1,
  bySeverity: { critical: 1, warning: 2, info: 0 },
  openBySeverity: { critical: 1, warning: 1, info: 0 },
  ...over
})

describe('alerts store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(alertsService).forEach((fn) => fn.mockReset())
  })

  test('fetch merges the query and keeps it for later updates', async () => {
    alertsService.list.mockResolvedValue({ data: [{ id: 'a1', status: 'open' }], total: 1 })
    const store = useAlertsStore()
    await store.fetch({ status: 'open', severity: ['critical'] })
    expect(alertsService.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'open', severity: ['critical'], page: 1 }))
    expect(store.items).toHaveLength(1)
    expect(store.query.status).toBe('open')
  })

  test('badge counts unacknowledged critical + warning', () => {
    const store = useAlertsStore()
    store.handleNew({ alert: { id: 'a1' }, summary: summary() })
    expect(store.badgeCount).toBe(2)
    expect(store.unresolvedCount).toBe(3)
    expect(store.staleAt).toBeGreaterThan(0)
  })

  test('updates patch loaded rows and drop ones that left the status filter', async () => {
    alertsService.list.mockResolvedValue({
      data: [{ id: 'a1', status: 'open', occurrences: 1 }, { id: 'a2', status: 'open' }],
      total: 2
    })
    const store = useAlertsStore()
    await store.fetch({ status: 'open' })

    store.handleUpdated({ alerts: [{ id: 'a1', status: 'open', occurrences: 3 }], summary: summary() })
    expect(store.items.find((a) => a.id === 'a1').occurrences).toBe(3)

    store.handleUpdated({ alerts: [{ id: 'a2', status: 'acknowledged' }], summary: summary({ open: 1 }) })
    expect(store.items.map((a) => a.id)).toEqual(['a1'])
    expect(store.total).toBe(1)
    expect(store.summary.open).toBe(1)
  })

  test('the unresolved view keeps acknowledged rows; resolve removes them', async () => {
    alertsService.list.mockResolvedValue({ data: [{ id: 'a1', status: 'open' }], total: 1 })
    const store = useAlertsStore()
    await store.fetch({ status: 'active' })

    alertsService.acknowledge.mockResolvedValue({ data: [{ id: 'a1', status: 'acknowledged' }] })
    await store.acknowledge(['a1'])
    expect(store.items[0].status).toBe('acknowledged')

    alertsService.resolve.mockResolvedValue({ data: [{ id: 'a1', status: 'resolved' }] })
    await store.resolve(['a1'])
    expect(store.items).toHaveLength(0)
  })

  test('a bulk update with no rows marks the list stale', () => {
    const store = useAlertsStore()
    store.handleUpdated({ alerts: [], summary: summary() })
    expect(store.staleAt).toBeGreaterThan(0)
  })

  test('a failed summary fetch keeps the old counts', async () => {
    alertsService.summary.mockRejectedValue(new Error('down'))
    const store = useAlertsStore()
    await store.fetchSummary()
    expect(store.badgeCount).toBe(0)
  })
})

describe('alertLink', () => {
  test('live rules open the device Live tab; others the device page or feature page', () => {
    expect(alertLink({ rule: 'live.poe-fault', deviceId: 'd1' })).toEqual({ path: '/devices/d1', query: { tab: 'live' } })
    expect(alertLink({ rule: 'device.offline', deviceId: 'd1' })).toEqual({ path: '/devices/d1' })
    expect(alertLink({ rule: 'backup.failed', deviceId: null })).toEqual({ path: '/devices/backups' })
    expect(alertLink({ rule: 'sync.failed', deviceId: null })).toEqual({ path: '/settings' })
  })
})
