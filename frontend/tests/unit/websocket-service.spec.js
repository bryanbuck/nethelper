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

  test('request() rejects when there is no connected socket', async () => {
    await expect(service.request('subscribe:device-live', 'id')).rejects.toThrow('Real-time connection is not available')
  })
})
