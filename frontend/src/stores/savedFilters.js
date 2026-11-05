import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import savedFilterService from '@/services/saved-filter.service'
import { useAuthStore } from '@/stores/auth'
import { savedPart, sameFilterSet } from '@/models/device-view'

/**
 * The signed-in user's saved Devices-page filters. Loaded once per user:
 * signing in as someone else reloads them rather than showing the last
 * user's list.
 */
export const useSavedFiltersStore = defineStore('savedFilters', () => {
  const filters = ref([])
  const loadedFor = ref(null)
  const loading = ref(false)
  const error = ref(null)

  const sorted = computed(() => [...filters.value].sort((a, b) => a.name.localeCompare(b.name)))

  /** The saved filter whose filters, search and sort match this view, if any. */
  const matching = (view) => sorted.value.find((f) => sameFilterSet(f.view, view)) || null

  const currentUserId = () => useAuthStore().user?.id || null

  async function fetchFilters() {
    const userId = currentUserId()
    loading.value = true
    error.value = null
    try {
      filters.value = await savedFilterService.list()
      loadedFor.value = userId
      return filters.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  async function ensureLoaded() {
    if (loadedFor.value !== currentUserId() || !loadedFor.value) await fetchFilters()
    return filters.value
  }

  const replace = (row) => {
    filters.value = [...filters.value.filter((f) => f.id !== row.id), row]
    return row
  }

  async function create(name, view) {
    return replace(await savedFilterService.create({ name, view: savedPart(view) }))
  }

  /** Replace a saved filter's view with this one (its name stays). */
  async function overwrite(id, view) {
    return replace(await savedFilterService.update(id, { view: savedPart(view) }))
  }

  async function rename(id, name) {
    return replace(await savedFilterService.update(id, { name }))
  }

  async function remove(id) {
    await savedFilterService.remove(id)
    filters.value = filters.value.filter((f) => f.id !== id)
  }

  return { filters, sorted, loading, error, loadedFor, matching, fetchFilters, ensureLoaded, create, overwrite, rename, remove }
})
