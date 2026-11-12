// Socket lifecycle of the shared WebSocket service: one socket at a time,
// state read from it, replaced sockets closed for good.
import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

const sockets = []

function fakeSocket() {
  const listeners = {}
  const managerListeners = {}
  const socket = {
    connected: false,
    active: true,
    on: vi.fn((event, fn) => { listeners[event] = fn }),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(() => { socket.connected = false; socket.active = false }),
    removeAllListeners: vi.fn(),
    io: { on: vi.fn((event, fn) => { managerListeners[event] = fn }), removeAllListeners: vi.fn() },
    fire: (event, ...args) => listeners[event]?.(...args),
  }
  return socket
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const socket = fakeSocket()
    sockets.push(socket)
    return socket
  }),
}))

const { default: service } = await import('@/services/websocket.service')
const { useBackupsStore } = await import('@/stores/backups')

describe('websocket service', () => {
  let backupsRefresh

  beforeEach(() => {
    setActivePinia(createPinia())
    service.stores = {} // the service keeps its stores: take this test's
    // A finished backup run makes the backups store refetch over HTTP; the
    // refetch itself is the store's business (backups-store.spec.js).
    backupsRefresh = vi.fn(async () => {})
    useBackupsStore().handleRunCompleted = backupsRefresh
    service.closeSocket()
    sockets.length = 0
  })

  test('connected reflects the current socket, not a cached flag', async () => {
    await service.connect('http://x')
    expect(service.connected).toBe(false)
    expect(service.connecting).toBe(true)
    sockets[0].connected = true
    expect(service.connected).toBe(true)
    service.disconnect()
    expect(service.socket).toBeNull()
    expect(service.connected).toBe(false)
  })

  test('a socket that is still (re)connecting is reused, not duplicated', async () => {
    await service.connect('http://x')
    sockets[0].fire('connect_error', new Error('server restarting'))
    await service.connect('http://x')
    expect(sockets).toHaveLength(1)
  })

  test('a refused socket is closed before a new one starts', async () => {
    await service.connect('http://x')
    const refused = sockets[0]
    refused.active = false // server rejected the handshake
    refused.fire('connect_error', new Error('Invalid token'))
    await service.connect('http://x')
    expect(sockets).toHaveLength(2)
    expect(refused.removeAllListeners).toHaveBeenCalled()
    expect(refused.disconnect).toHaveBeenCalled()
    expect(service.socket).toBe(sockets[1])
  })

  test('a server-side disconnect reconnects the same socket', async () => {
    await service.connect('http://x')
    sockets[0].fire('disconnect', 'io server disconnect')
    expect(sockets[0].connect).toHaveBeenCalled()
    expect(sockets).toHaveLength(1)
  })

  test('the status bar logs a lost connection once and drops it after reconnecting', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    sockets[0].fire('connect')
    expect(log.connection).toBe('connected')
    expect(log.entries).toHaveLength(0) // the first connect only lights the dot

    sockets[0].fire('disconnect', 'transport close')
    expect(log.connection).toBe('reconnecting')
    expect(log.current.title).toBe('Connection Lost')
    expect(log.entries).toHaveLength(1)
    sockets[0].fire('connect')
    expect(log.current.title).toBe('Connection Restored') // a flash in the bar
    expect(log.entries).toHaveLength(0) // the outage is over: nothing left in the history
  })

  test('the dot is never green before the first connect, and the first connect says nothing', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    expect(log.connection).toBe('connecting')
    sockets[0].fire('connect_error', new Error('server down')) // still retrying
    expect(log.connection).toBe('connecting')
    sockets[0].fire('connect')
    expect(log.connection).toBe('connected')
    expect(log.current).toBeNull()
    service.closeSocket()
    expect(log.connection).toBe('idle')
  })

  test('a failed connection leaves the log when the socket is closed', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    service.notifyConnectionFailed()
    expect(log.current.title).toBe('Connection Failed')
    service.closeSocket()
    expect(log.entries).toHaveLength(0)
  })

  test('a critical alert pops up and stays pinned only while it is open', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    service.handleNewAlert({ alert: { id: 'a1', severity: 'critical', title: 'Switch down', message: 'core-1' } })
    expect(log.popup.title).toBe('Switch down')
    expect(log.current.title).toBe('Switch down')
    expect(log.entries[0].actions).toEqual([{ label: 'View', to: '/alerts' }])

    service.handleAlertUpdated({ alerts: [{ id: 'a1', status: 'open', occurrences: 2 }] }) // a bump
    expect(log.entries).toHaveLength(1)
    service.handleAlertUpdated({ alerts: [{ id: 'a1', status: 'resolved' }] })
    expect(log.entries).toHaveLength(0)
    expect(log.popup).toBeNull()
    expect(log.current).toBeNull()
  })

  test('warning and info alerts flash in the bar but stay out of the history (bell, Alerts page, Activity)', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    service.handleNewAlert({ alert: { id: 'a2', severity: 'warning', title: 'sw-1 is offline in the cloud', message: '' } })
    expect(log.current.title).toBe('sw-1 is offline in the cloud')
    expect(log.current.actions).toEqual([{ label: 'View', to: '/alerts' }])
    expect(log.popup).toBeNull()
    service.handleNewAlert({ alert: { id: 'a3', severity: 'info', title: 'Note', message: '' } })
    expect(log.entries).toHaveLength(0)
    expect(log.unseenCount).toBe(0)
  })

  test('unattended backups speak only through a failed run summary', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    service.handleBackupCompleted({ backupId: 'b1', deviceId: 'd1', deviceName: 'sw-1', trigger: 'scheduled', batch: true })
    service.handleBackupFailed({ backupId: 'b2', deviceId: 'd2', deviceName: 'sw-2', trigger: 'scheduled', batch: true, error: 'timed out' })
    service.handleBackupCompleted({ backupId: 'b3', deviceId: 'd3', deviceName: 'sw-3', trigger: 'automation' })
    service.handleBackupRunCompleted({ trigger: 'scheduled', total: 2, succeeded: 2, failed: 0 })
    expect(log.entries).toHaveLength(0)
    expect(backupsRefresh).toHaveBeenCalledTimes(1) // the Config Backups page still refreshes
    service.handleBackupRunCompleted({ trigger: 'scheduled', total: 2, succeeded: 1, failed: 1 })
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0].type).toBe('warning')
  })

  test('a manual run logs its summary and failures, not each success', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    service.handleBackupCompleted({ backupId: 'b1', deviceId: 'd1', deviceName: 'sw-1', trigger: 'manual', batch: true })
    service.handleBackupCompleted({ backupId: 'b2', deviceId: 'd2', deviceName: 'sw-2', trigger: 'manual', batch: true, warning: 'NETCONF refused' })
    service.handleBackupFailed({ backupId: 'b3', deviceId: 'd3', deviceName: 'sw-3', trigger: 'manual', batch: true, error: 'timed out' })
    service.handleBackupRunCompleted({ trigger: 'manual', total: 3, succeeded: 2, failed: 1 })
    expect(log.entries.map((e) => e.title)).toEqual(['Backup Run Complete', 'Backup Failed', 'Backup Incomplete'])
  })

  test('a single-device backup replaces its queued entry', async () => {
    const { backupEntryId } = await import('@/services/websocket.service')
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    log.addNotification({ id: backupEntryId('d1'), title: 'Config Backup', message: 'Backup of sw-1 queued', history: false })
    expect(log.entries).toHaveLength(0)
    service.handleBackupCompleted({ backupId: 'b1', deviceId: 'd1', deviceName: 'sw-1', trigger: 'manual', batch: false })
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0].title).toBe('Backup Complete')
    expect(log.current.title).toBe('Backup Complete')
  })

  test('a manual automation run is one entry: started, then its result', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    const data = { executionId: 'e1', automationId: 'au1', automation: { name: 'Nightly' }, trigger: 'manual' }
    service.handleAutomationStarted(data)
    expect(log.current.message).toBe('Automation "Nightly" has started')
    expect(log.entries).toHaveLength(0)
    service.handleAutomationCompleted({ ...data, status: 'success' })
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0].message).toBe('Automation "Nightly" completed successfully')
  })

  test('a device with no per-device config stays out of the status bar', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    service.handleBackupFailed({ backupId: 'b1', deviceId: 'd1', deviceName: 'ap-1', error: 'AP config lives in the site', unsupported: true })
    expect(log.entries).toHaveLength(0)
    service.handleBackupFailed({ backupId: 'b2', deviceId: 'd2', deviceName: 'sw-1', error: 'timed out' })
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0].message).toContain('"sw-1" failed: timed out')
  })

  test('the run summary counts skipped devices apart from failures', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    service.handleBackupRunCompleted({ total: 82, succeeded: 2, failed: 0, unsupported: 80 })
    expect(log.entries[0].type).toBe('success')
    expect(log.entries[0].message).toBe('Backup run finished: 2/2 device(s) backed up, 80 skipped (no per-device config; see Cloud Scopes)')
    service.handleBackupRunCompleted({ scope: true, total: 3, succeeded: 3, failed: 0, unsupported: ['Central (aruba_central)'] })
    expect(log.entries[0].message).toBe('Backup run finished: 3/3 cloud scope(s) backed up')
  })

  test('request() rejects when there is no connected socket', async () => {
    await expect(service.request('subscribe:device-live', 'id')).rejects.toThrow('Real-time connection is not available')
  })

  test('a status update patches the Last Seen fields it carries, and nothing else', () => {
    const updateDeviceLocally = vi.fn()
    service.stores = { ...service.stores, devices: { updateDeviceLocally }, topology: null }
    service.handleDeviceStatusUpdate({
      deviceId: 'd1', status: 'online', cloudStatus: 'online', cloudLastSeen: 'a', cloudCheckedAt: 'b', pingLastSeen: 'c', extra: 1
    })
    expect(updateDeviceLocally).toHaveBeenCalledWith('d1', {
      status: 'online', cloudStatus: 'online', cloudLastSeen: 'a', cloudCheckedAt: 'b', pingLastSeen: 'c'
    })
  })

  test('a cloud status check stamps that integration\'s online cloud devices only', async () => {
    const { useDevicesStore } = await import('@/stores/devices')
    const store = useDevicesStore()
    store.devices = [
      { id: 'a', managementMode: 'cloud', cloudStatus: 'online', cloudIntegrationId: 'i1', cloudCheckedAt: 'old' },
      { id: 'b', managementMode: 'cloud', cloudStatus: 'offline', cloudIntegrationId: 'i1', cloudCheckedAt: 'old' },
      { id: 'c', managementMode: 'cloud', cloudStatus: 'online', cloudIntegrationId: 'i2', cloudCheckedAt: 'old' },
      { id: 'd', managementMode: 'cloud', cloudStatus: 'online', cloudIntegrationId: null, cloudCheckedAt: 'old' },
    ]
    service.stores = { ...service.stores, devices: store }
    service.handleCloudStatusChecked({ integrationId: 'i1', checkedAt: 'new' })
    service.handleCloudStatusChecked({ integrationId: null, checkedAt: 'env' })
    expect(store.devices.map((d) => d.cloudCheckedAt)).toEqual(['new', 'old', 'old', 'env'])
  })
})
