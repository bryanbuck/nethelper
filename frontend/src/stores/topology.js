import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import topologyService from '@/services/topology.service'

/**
 * Network Map state: the graph (from LLDP/CDP neighbor tables), the saved
 * layout for the current scope, link-change history, and collection progress.
 * Socket events (topology:progress / topology:updated, device:status:update)
 * arrive through services/websocket.service.js.
 */
export const useTopologyStore = defineStore('topology', () => {
  const graph = ref({ nodes: [], edges: [], sites: [], stats: {} })
  const loading = ref(false)
  const error = ref(null)

  // Scope: null = every site
  const site = ref(null)
  const includeDiscovered = ref(false)

  // Saved positions for the current scope ({ nodeId: { x, y } })
  const layout = ref({ positions: {}, updatedAt: null })
  const layoutDirty = ref(false)
  const savingLayout = ref(false)

  const changes = ref([])
  const changesLoading = ref(false)

  // Collection progress ({ done, total }) while a run is going
  const progress = ref(null)
  const collecting = computed(() => !!progress.value && progress.value.done < progress.value.total)
  const lastRun = ref(null)

  // Bumped when the graph should be refetched (a collection finished)
  const staleAt = ref(0)

  const scope = computed(() => (site.value ? `site:${site.value}` : 'all'))
  const sites = computed(() => graph.value.sites || [])
  const stats = computed(() => graph.value.stats || {})

  async function fetchGraph() {
    loading.value = true
    error.value = null
    try {
      const response = await topologyService.getGraph({
        site: site.value,
        includeDiscovered: includeDiscovered.value
      })
      graph.value = response.data
      return graph.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchLayout() {
    try {
      const response = await topologyService.getLayout(scope.value)
      layout.value = { positions: response.data?.positions || {}, updatedAt: response.data?.updatedAt || null }
    } catch (err) {
      // A missing layout just means auto-layout; don't block the map on it.
      layout.value = { positions: {}, updatedAt: null }
    }
    layoutDirty.value = false
    return layout.value
  }

  async function saveLayout(positions) {
    savingLayout.value = true
    try {
      const response = await topologyService.saveLayout(scope.value, positions)
      layout.value = { positions: response.data?.positions || positions, updatedAt: response.data?.updatedAt || null }
      layoutDirty.value = false
      return layout.value
    } finally {
      savingLayout.value = false
    }
  }

  function markLayoutDirty() {
    layoutDirty.value = true
  }

  async function fetchChanges({ sinceHours = 24 * 7, deviceId = null, limit = 200 } = {}) {
    changesLoading.value = true
    try {
      const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString()
      const response = await topologyService.getChanges({ since, limit, ...(deviceId && { deviceId }) })
      changes.value = response.data || []
      return changes.value
    } finally {
      changesLoading.value = false
    }
  }

  async function collect(deviceIds = null) {
    const response = await topologyService.collect(deviceIds)
    progress.value = { done: 0, total: deviceIds?.length || stats.value.devices || 1 }
    return response
  }

  // --- socket handlers (called by websocket.service) ---

  function handleProgress(data) {
    progress.value = { done: data.done, total: data.total }
  }

  function handleUpdated(data) {
    progress.value = null
    lastRun.value = data
    staleAt.value = Date.now()
  }

  /** Patch a device node's status in place (ping monitor updates). */
  function applyDeviceStatus(deviceId, patch) {
    const node = graph.value.nodes.find((n) => n.id === `device:${deviceId}`)
    if (node) node.data = { ...node.data, ...patch }
  }

  return {
    graph,
    loading,
    error,
    site,
    includeDiscovered,
    layout,
    layoutDirty,
    savingLayout,
    changes,
    changesLoading,
    progress,
    collecting,
    lastRun,
    staleAt,
    scope,
    sites,
    stats,
    fetchGraph,
    fetchLayout,
    saveLayout,
    markLayoutDirty,
    fetchChanges,
    collect,
    handleProgress,
    handleUpdated,
    applyDeviceStatus
  }
})
