import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/services/device.service', () => ({
  default: {
    getDevices: vi.fn(),
    getDevicesWithPagination: vi.fn(),
    getStatusSummary: vi.fn(),
    createDevice: vi.fn(),
    deleteDevice: vi.fn()
  }
}))

const { default: deviceService } = await import('@/services/device.service')
const { useDevicesStore } = await import('@/stores/devices')

const DEVICES = [
  { id: '1', name: 'a', type: 'switch', status: 'online', lastSeen: '2026-09-25T10:00:00Z' },
  { id: '2', name: 'b', type: 'switch', status: 'offline', lastSeen: '2026-09-25T12:00:00Z' },
  { id: '3', name: 'c', type: 'access_point', status: 'warning', lastSeen: null },
  { id: '4', name: 'd', type: 'gateway', status: 'unknown' }
]

describe('devices store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  test('fetchDevices loads devices and derives stats', async () => {
    deviceService.getDevices.mockResolvedValue({ data: DEVICES })
    const store = useDevicesStore()

    await store.fetchDevices()

    expect(store.devices).toHaveLength(4)
    expect(store.stats).toEqual({ total: 4, online: 1, offline: 1, warning: 1 })
    expect(store.devicesByType.switch.map((d) => d.id)).toEqual(['1', '2'])
    expect(store.loading).toBe(false)
    expect(store.lastSync).toBeInstanceOf(Date)
  })

  test('fetchStatusSummary sets the fleet counts and leaves the held rows alone (#51)', async () => {
    deviceService.getStatusSummary.mockResolvedValue({ total: 900, online: 850, offline: 30, warning: 20 })
    const store = useDevicesStore()
    store.devices = DEVICES.slice(0, 2)

    await store.fetchStatusSummary()

    expect(store.stats).toEqual({ total: 900, online: 850, offline: 30, warning: 20 })
    expect(store.devices.map((d) => d.id)).toEqual(['1', '2'])
    expect(deviceService.getDevices).not.toHaveBeenCalled()
    expect(store.loading).toBe(false)
  })

  test('fetchDevices records and rethrows errors', async () => {
    const failure = new Error('network down')
    deviceService.getDevices.mockRejectedValue(failure)
    const store = useDevicesStore()

    await expect(store.fetchDevices()).rejects.toBe(failure)
    expect(store.error).toBe(failure)
    expect(store.loading).toBe(false)
  })

  test('paginated fetch failure yields an empty page, never fake data', async () => {
    deviceService.getDevicesWithPagination.mockRejectedValue(new Error('500'))
    const store = useDevicesStore()

    const result = await store.fetchDevicesWithPagination({ page: 2 })

    expect(result.data).toEqual([])
    expect(result.pagination.total).toBe(0)
    expect(store.devices).toEqual([])
  })

  test('createDevice adds to the list and updates stats', async () => {
    deviceService.getDevices.mockResolvedValue({ data: DEVICES.slice(0, 1) })
    deviceService.createDevice.mockResolvedValue({ data: { id: '9', name: 'new', status: 'offline' } })
    const store = useDevicesStore()
    await store.fetchDevices()

    await store.createDevice({ name: 'new' })

    expect(store.devices.map((d) => d.id)).toEqual(['1', '9'])
    expect(store.stats).toMatchObject({ total: 2, online: 1, offline: 1 })
  })

  test('a table page takes the fleet-wide stats from the server summary', async () => {
    deviceService.getDevicesWithPagination.mockResolvedValue({
      data: DEVICES.slice(0, 2),
      summary: { total: 40, online: 30, offline: 7, warning: 3 },
      pagination: { page: 1, itemsPerPage: 2, total: 40, totalPages: 20 }
    })
    const store = useDevicesStore()

    await store.fetchDevicesWithPagination({ page: 1, itemsPerPage: 2 })
    expect(store.stats).toEqual({ total: 40, online: 30, offline: 7, warning: 3 })

    // A live status change on a page row doesn't recount the page
    store.updateDeviceStatus('1', 'offline')
    expect(store.stats).toEqual({ total: 40, online: 30, offline: 7, warning: 3 })
  })

  test('ensureAllDevices fetches after a table page, not after a full fetch', async () => {
    deviceService.getDevices.mockResolvedValue({ data: DEVICES })
    deviceService.getDevicesWithPagination.mockResolvedValue({
      data: DEVICES.slice(0, 1),
      summary: null,
      pagination: { page: 1, itemsPerPage: 1, total: 4, totalPages: 4 }
    })
    const store = useDevicesStore()

    await store.fetchDevicesWithPagination({ page: 1, itemsPerPage: 1 })
    await store.ensureAllDevices()
    expect(deviceService.getDevices).toHaveBeenCalledTimes(1)
    expect(store.devices).toHaveLength(4)

    await store.ensureAllDevices()
    expect(deviceService.getDevices).toHaveBeenCalledTimes(1)
  })

  test('deleteDevice removes the row after the API confirms', async () => {
    deviceService.getDevices.mockResolvedValue({ data: DEVICES })
    deviceService.deleteDevice.mockResolvedValue({ success: true })
    const store = useDevicesStore()
    await store.fetchDevices()

    await store.deleteDevice('2')

    expect(deviceService.deleteDevice).toHaveBeenCalledWith('2')
    expect(store.devices.map((d) => d.id)).toEqual(['1', '3', '4'])
  })
})
