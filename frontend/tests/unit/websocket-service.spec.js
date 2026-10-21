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

describe('websocket service', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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

  test('the status bar logs a lost connection once and replaces it on reconnect', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    sockets[0].fire('connect')
    expect(log.connection).toBe('connected')
    expect(log.entries).toHaveLength(0) // the first connect only lights the dot

    sockets[0].fire('disconnect', 'transport close')
    expect(log.connection).toBe('reconnecting')
    expect(log.current.title).toBe('Connection Lost')
    sockets[0].fire('connect')
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0].title).toBe('Connection Restored')
    expect(log.entries[0].pinned).toBe(false)
  })

  test('a critical alert pops up with a stored route action', async () => {
    await service.connect('http://x')
    const log = service.stores.notifications
    log.clearHistory()
    service.handleNewAlert({ alert: { id: 'a1', severity: 'critical', title: 'Switch down', message: 'core-1' } })
    expect(log.popup.title).toBe('Switch down')
    expect(log.entries[0].actions).toEqual([{ label: 'View', to: '/alerts' }])
    service.handleNewAlert({ alert: { id: 'a2', severity: 'warning', title: 'PoE fault', message: 'ap-3' } })
    expect(log.current.title).toBe('PoE fault')
    expect(log.popup.title).toBe('Switch down') // warnings stay in the bar
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
})
