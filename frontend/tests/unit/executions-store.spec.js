import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/services/executions.service', () => ({
  default: { list: vi.fn(), get: vi.fn(), cancel: vi.fn() }
}))

const { default: executionsService } = await import('@/services/executions.service')
const { useExecutionsStore } = await import('@/stores/executions')
const { triggerMeta, formatDuration } = await import('@/models/executions')

describe('executions store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(executionsService).forEach((fn) => fn.mockReset())
  })

  test('fetch drops empty filters and keeps the total', async () => {
    executionsService.list.mockResolvedValue({ executions: [{ id: 'e1', status: 'pending' }], pagination: { total: 7 } })
    const store = useExecutionsStore()
    await store.fetch({ automationId: null, status: '', trigger: 'schedule', page: 1, limit: 25 })
    expect(executionsService.list).toHaveBeenCalledWith({ trigger: 'schedule', page: 1, limit: 25 })
    expect(store.items).toHaveLength(1)
    expect(store.total).toBe(7)
  })

  test('socket events patch a loaded run, or mark the list stale', async () => {
    executionsService.list.mockResolvedValue({ executions: [{ id: 'e1', status: 'pending' }], pagination: { total: 1 } })
    const store = useExecutionsStore()
    await store.fetch()

    store.handleStarted({ executionId: 'e1' })
    expect(store.items[0].status).toBe('running')
    store.handleCompleted({ executionId: 'e1', status: 'failed', error: 'Backup: boom', duration: 1200 })
    expect(store.items[0]).toMatchObject({ status: 'failed', error: 'Backup: boom', duration: 1200 })
    expect(store.staleAt).toBe(0)

    store.handleStarted({ executionId: 'other' })
    expect(store.staleAt).toBeGreaterThan(0)
  })

  test('cancel patches the row', async () => {
    executionsService.list.mockResolvedValue({ executions: [{ id: 'e1', status: 'running' }], pagination: { total: 1 } })
    executionsService.cancel.mockResolvedValue({ id: 'e1', status: 'cancelled', completedAt: 'now', duration: 5 })
    const store = useExecutionsStore()
    await store.fetch()
    await store.cancel('e1')
    expect(store.items[0].status).toBe('cancelled')
  })

  test('display helpers', () => {
    expect(triggerMeta('alert:opened').title).toBe('Alert opened')
    expect(triggerMeta('schedule').title).toBe('Schedule')
    expect(formatDuration(450)).toBe('450 ms')
    expect(formatDuration(65000)).toBe('1 min 5 s')
  })
})
