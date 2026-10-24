import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import deviceService from '@/services/device.service'

/**
 * Device groups: named sets of devices that automation triggers and targets
 * use (Manual/Schedule targets, Alert and Configuration Change filters).
 * Rows carry member counts in `_count` ({ devices, automations }).
 */
export const useGroupsStore = defineStore('groups', () => {
  const groups = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(null)

  const byId = computed(() => new Map(groups.value.map((g) => [g.id, g])))
  const sorted = computed(() => [...groups.value].sort((a, b) => a.name.localeCompare(b.name)))

  async function fetchGroups() {
    loading.value = true
    error.value = null
    try {
      groups.value = await deviceService.getDeviceGroups()
      loaded.value = true
      return groups.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  async function ensureGroups() {
    if (!loaded.value) await fetchGroups()
    return groups.value
  }

  async function createGroup(data) {
    const group = await deviceService.createDeviceGroup(data)
    await fetchGroups()
    return group
  }

  async function updateGroup(groupId, data) {
    const group = await deviceService.updateDeviceGroup(groupId, data)
    await fetchGroups()
    return group
  }

  async function deleteGroup(groupId) {
    await deviceService.deleteDeviceGroup(groupId)
    groups.value = groups.value.filter((g) => g.id !== groupId)
  }

  /** @returns {Promise<{ id, name, deviceCount }>} */
  async function changeMembers(groupId, change) {
    const result = await deviceService.updateGroupMembers(groupId, change)
    const group = groups.value.find((g) => g.id === groupId)
    if (group) group._count = { ...(group._count || {}), devices: result.deviceCount }
    return result
  }

  return { groups, loading, loaded, error, byId, sorted, fetchGroups, ensureGroups, createGroup, updateGroup, deleteGroup, changeMembers }
})
