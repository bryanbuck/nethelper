// The status bar's activity log: history kept, the bar's current message,
// pins, unseen counts, the critical pop-up, and sessionStorage persistence.
import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'
import { useNotificationsStore, MAX_ENTRIES } from '@/stores/notifications'
import { ACTIVITY_LOG_KEY } from '@/utils/activity-log-storage'

const stored = () => JSON.parse(sessionStorage.getItem(ACTIVITY_LOG_KEY) || '[]')

describe('notifications store (activity log)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  test('a message leaves the bar after its timeout but stays in the history', () => {
    const store = useNotificationsStore()
    store.showSuccess('Backed up 3 devices', 'Backup Run Complete')
    expect(store.current.message).toBe('Backed up 3 devices')
    vi.advanceTimersByTime(3000)
    expect(store.current).toBeNull()
    expect(store.entries).toHaveLength(1)
    expect(store.unseenCount).toBe(1)
  })

  test('a persistent message is pinned until dismissed, behind newer messages', () => {
    const store = useNotificationsStore()
    const pinned = store.addNotification({ type: 'warning', title: 'Connection Lost', persistent: true })
    store.showInfo('Something else')
    expect(store.current.message).toBe('Something else')
    vi.advanceTimersByTime(3000)
    expect(store.current.id).toBe(pinned)
    store.dismissCurrent()
    expect(store.current).toBeNull()
    expect(store.entries).toHaveLength(2)
  })

  test('re-adding an id replaces the entry instead of stacking it', () => {
    const store = useNotificationsStore()
    store.addNotification({ id: 'socket-connection', type: 'warning', title: 'Connection Lost', persistent: true })
    store.addNotification({ id: 'socket-connection', type: 'success', title: 'Connection Restored' })
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].title).toBe('Connection Restored')
    vi.advanceTimersByTime(5000)
    expect(store.current).toBeNull() // the old pin went with the replaced entry
  })

  test('ids are unique for messages added in the same millisecond', () => {
    const store = useNotificationsStore()
    store.showInfo('a')
    store.showInfo('b')
    expect(store.entries).toHaveLength(2)
  })

  test('history is capped, newest first', () => {
    const store = useNotificationsStore()
    for (let i = 0; i < MAX_ENTRIES + 5; i++) store.showInfo(`m${i}`)
    expect(store.entries).toHaveLength(MAX_ENTRIES)
    expect(store.entries[0].message).toBe(`m${MAX_ENTRIES + 4}`)
  })

  test('unseen counts track problems separately and reset when seen', () => {
    const store = useNotificationsStore()
    store.showInfo('fine')
    store.showError('broke')
    store.showWarning('hmm')
    expect(store.unseenCount).toBe(3)
    expect(store.unseenProblemCount).toBe(2)
    store.markAllSeen()
    expect(store.unseenCount).toBe(0)
    expect(store.unseenProblemCount).toBe(0)
  })

  test('only popup messages set the pop-up, which hides after its timeout', () => {
    const store = useNotificationsStore()
    store.showError('not critical')
    expect(store.popup).toBeNull()
    store.addNotification({ type: 'error', title: 'Switch down', popup: true, persistent: true, timeout: 8000 })
    expect(store.popup.title).toBe('Switch down')
    vi.advanceTimersByTime(8000)
    expect(store.popup).toBeNull()
    expect(store.current.title).toBe('Switch down') // still pinned in the bar
  })

  test('history survives a reload with route actions only, unpinned', () => {
    const store = useNotificationsStore()
    store.addNotification({
      title: 'Alert',
      persistent: true,
      actions: [{ label: 'View', to: '/alerts' }, { label: 'Run', action: () => {} }]
    })
    expect(stored()[0].actions).toEqual([{ label: 'View', to: '/alerts' }])

    setActivePinia(createPinia())
    const reloaded = useNotificationsStore()
    expect(reloaded.entries).toHaveLength(1)
    expect(reloaded.entries[0].actions).toEqual([{ label: 'View', to: '/alerts' }])
    expect(reloaded.current).toBeNull()
  })

  test('corrupt storage starts an empty log', () => {
    sessionStorage.setItem(ACTIVITY_LOG_KEY, '{not json')
    expect(useNotificationsStore().entries).toEqual([])
    setActivePinia(createPinia())
    sessionStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify([{ nope: true }, 'x']))
    expect(useNotificationsStore().entries).toEqual([])
  })

  test('clearHistory empties the log, the bar, the pop-up and storage', () => {
    const store = useNotificationsStore()
    store.addNotification({ title: 'x', persistent: true, popup: true })
    store.clearHistory()
    expect(store.entries).toEqual([])
    expect(store.current).toBeNull()
    expect(store.popup).toBeNull()
    expect(sessionStorage.getItem(ACTIVITY_LOG_KEY)).toBeNull()
  })
})
