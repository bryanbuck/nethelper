import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/services/backup.service', () => ({
  default: {
    getBackups: vi.fn(),
    getSchedules: vi.fn(),
    deleteBackup: vi.fn(),
    createSchedule: vi.fn(),
    diffBackups: vi.fn(),
    getBackupContent: vi.fn(),
    getScopeBackups: vi.fn(),
    deleteScopeBackup: vi.fn()
  }
}))

const { default: backupService } = await import('@/services/backup.service')
const { useBackupsStore } = await import('@/stores/backups')

describe('backups store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  test('fetchBackups turns page and filters into API params', async () => {
    backupService.getBackups.mockResolvedValue({ data: [{ id: 'b1', status: 'failed' }], total: 60 })
    const store = useBackupsStore()

    await store.fetchBackups({ page: 3, itemsPerPage: 25, filters: { deviceId: 'd1', status: 'failed' } })

    expect(backupService.getBackups).toHaveBeenCalledWith({ limit: 25, offset: 50, deviceId: 'd1', status: 'failed' })
    expect(store.total).toBe(60)
    expect(store.failedBackups.map((b) => b.id)).toEqual(['b1'])
  })

  test('deleteBackup removes the row and decrements the total', async () => {
    backupService.getBackups.mockResolvedValue({ data: [{ id: 'b1' }, { id: 'b2' }], total: 2 })
    backupService.deleteBackup.mockResolvedValue({})
    const store = useBackupsStore()
    await store.fetchBackups()

    await store.deleteBackup('b1')

    expect(store.backups.map((b) => b.id)).toEqual(['b2'])
    expect(store.total).toBe(1)
  })

  test('applyBackupEvent updates a loaded row from socket events', async () => {
    backupService.getBackups.mockResolvedValue({ data: [{ id: 'b1', status: 'running' }, { id: 'b2', status: 'running' }], total: 2 })
    const store = useBackupsStore()
    await store.fetchBackups()

    store.applyBackupEvent({ backupId: 'b1', hasChanges: true })
    store.applyBackupEvent({ backupId: 'b2', error: 'Mist configures APs through templates' })
    store.applyBackupEvent({ backupId: 'not-loaded', hasChanges: false })

    expect(store.backups[0]).toMatchObject({ status: 'success', hasChanges: true })
    expect(store.backups[1]).toMatchObject({ status: 'failed', error: 'Mist configures APs through templates' })
  })

  test('diff errors are surfaced, not swallowed', async () => {
    const failure = new Error('403 Insufficient permissions')
    backupService.diffBackups.mockRejectedValue(failure)
    const store = useBackupsStore()

    await expect(store.diffBackups('a', 'b')).rejects.toBe(failure)
    expect(store.error).toBe(failure)
  })

  test('content and diff pass the artifact kind through', async () => {
    backupService.getBackupContent.mockResolvedValue({ data: { content: '{}', artifact: { kind: 'structured' } } })
    backupService.diffBackups.mockResolvedValue({ data: { kind: 'structured' } })
    const store = useBackupsStore()

    expect((await store.fetchBackupContent('b1', 'structured')).artifact.kind).toBe('structured')
    await store.diffBackups('a', 'b', 'structured')

    expect(backupService.getBackupContent).toHaveBeenCalledWith('b1', 'structured')
    expect(backupService.diffBackups).toHaveBeenCalledWith('a', 'b', 'structured')
  })

  test('scope events update scope rows, not device rows', async () => {
    backupService.getBackups.mockResolvedValue({ data: [{ id: 'x', status: 'running' }], total: 1 })
    backupService.getScopeBackups.mockResolvedValue({ data: [{ id: 'x', status: 'running' }], total: 1 })
    const store = useBackupsStore()
    await Promise.all([store.fetchBackups(), store.fetchScopeBackups()])

    store.applyBackupEvent({ scope: true, scopeBackupId: 'x', hasChanges: true })

    expect(store.scopeBackups[0]).toMatchObject({ status: 'success', hasChanges: true })
    expect(store.backups[0].status).toBe('running')
  })

  test('deleteScopeBackup removes the row', async () => {
    backupService.getScopeBackups.mockResolvedValue({ data: [{ id: 's1' }, { id: 's2' }], total: 2 })
    backupService.deleteScopeBackup.mockResolvedValue({})
    const store = useBackupsStore()
    await store.fetchScopeBackups()

    await store.deleteScopeBackup('s1')

    expect(store.scopeBackups.map((b) => b.id)).toEqual(['s2'])
    expect(store.scopeTotal).toBe(1)
  })

  test('activeSchedules filters on active', async () => {
    backupService.getSchedules.mockResolvedValue({ data: [{ id: 's1', active: true }, { id: 's2', active: false }] })
    const store = useBackupsStore()

    await store.fetchSchedules()

    expect(store.activeSchedules.map((s) => s.id)).toEqual(['s1'])
  })
})
