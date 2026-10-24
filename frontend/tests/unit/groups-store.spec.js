// Device groups store: loads once on demand, sorts by name, and keeps a
// group's device count in step with a membership change.
import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/services/device.service', () => ({
  default: {
    getDeviceGroups: vi.fn(),
    createDeviceGroup: vi.fn(),
    updateDeviceGroup: vi.fn(),
    deleteDeviceGroup: vi.fn(),
    updateGroupMembers: vi.fn()
  }
}))

const { default: deviceService } = await import('@/services/device.service')
const { useGroupsStore } = await import('@/stores/groups')

const GROUPS = [
  { id: 'g2', name: 'Edge', _count: { devices: 1, automations: 0 } },
  { id: 'g1', name: 'Core', _count: { devices: 2, automations: 1 } }
]

describe('groups store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    deviceService.getDeviceGroups.mockResolvedValue(GROUPS.map((g) => ({ ...g, _count: { ...g._count } })))
  })

  test('ensureGroups loads once and sorts by name', async () => {
    const store = useGroupsStore()
    await store.ensureGroups()
    await store.ensureGroups()
    expect(deviceService.getDeviceGroups).toHaveBeenCalledTimes(1)
    expect(store.sorted.map((g) => g.name)).toEqual(['Core', 'Edge'])
  })

  test('changeMembers sends the change and updates the count', async () => {
    deviceService.updateGroupMembers.mockResolvedValue({ id: 'g1', name: 'Core', deviceCount: 5 })
    const store = useGroupsStore()
    await store.fetchGroups()
    const result = await store.changeMembers('g1', { add: ['d1', 'd2', 'd3'] })
    expect(deviceService.updateGroupMembers).toHaveBeenCalledWith('g1', { add: ['d1', 'd2', 'd3'] })
    expect(result.deviceCount).toBe(5)
    expect(store.byId.get('g1')._count).toEqual({ devices: 5, automations: 1 })
  })

  test('deleteGroup drops the row without a reload', async () => {
    deviceService.deleteDeviceGroup.mockResolvedValue()
    const store = useGroupsStore()
    await store.fetchGroups()
    await store.deleteGroup('g2')
    expect(store.groups.map((g) => g.id)).toEqual(['g1'])
    expect(deviceService.getDeviceGroups).toHaveBeenCalledTimes(1)
  })
})
