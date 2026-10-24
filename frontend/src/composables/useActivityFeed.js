import { ref, watch, onUnmounted } from 'vue'
import activityService from '@/services/activity.service'
import { useWebSocket } from '@/composables/useWebSocket'

// Events and backups arrive in bursts (a sync, a scheduled backup run), so
// a live update refetches the newest page once the burst settles.
const LIVE_REFRESH_DELAY_MS = 3000

function categoryOfEvent(type = '') {
  if (type === 'device.restarted') return 'restart'
  if (type.startsWith('ping.') || type.startsWith('cloud.')) return 'status'
  return 'port'
}

/**
 * The Activity feed for one view: its own filters, paging by `before`, and
 * a refetch of the newest page when the socket reports something it shows.
 * Per view rather than a store: the dashboard card and the page show
 * different slices at once.
 * @param {{ categories: Ref<string[]>, deviceId?: Ref<string|null>, vendor?: Ref<string|null>, limit?: number }} filters
 */
export function useActivityFeed({ categories, deviceId = ref(null), vendor = ref(null), limit = 50 }) {
  const items = ref([])
  const nextBefore = ref(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref(null)
  let requestSeq = 0

  const params = () => ({
    categories: categories.value,
    deviceId: deviceId.value,
    vendor: vendor.value,
    limit,
  })

  async function load() {
    const seq = ++requestSeq
    loading.value = true
    error.value = null
    try {
      const result = await activityService.list(params())
      if (seq !== requestSeq) return
      items.value = result.data || []
      nextBefore.value = result.nextBefore || null
    } catch (err) {
      if (seq === requestSeq) error.value = err.message
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  async function loadMore() {
    if (!nextBefore.value || loadingMore.value) return
    const seq = requestSeq
    loadingMore.value = true
    try {
      const result = await activityService.list({ ...params(), before: nextBefore.value })
      if (seq !== requestSeq) return
      const seen = new Set(items.value.map((i) => i.id))
      items.value = [...items.value, ...(result.data || []).filter((i) => !seen.has(i.id))]
      nextBefore.value = result.nextBefore || null
    } catch (err) {
      error.value = err.message
    } finally {
      loadingMore.value = false
    }
  }

  // Refetch the newest page and keep whatever older pages were loaded.
  async function refreshTop() {
    const seq = requestSeq
    try {
      const result = await activityService.list(params())
      if (seq !== requestSeq) return
      const fresh = result.data || []
      if (!fresh.length) return
      if (!nextBefore.value || items.value.length <= fresh.length) {
        items.value = fresh
        nextBefore.value = result.nextBefore || null
        return
      }
      const oldest = new Date(fresh[fresh.length - 1].at).getTime()
      const seen = new Set(fresh.map((i) => i.id))
      items.value = [...fresh, ...items.value.filter((i) => !seen.has(i.id) && new Date(i.at).getTime() < oldest)]
    } catch {
      // A failed live refresh leaves the list as it was; the next one retries.
    }
  }

  let refreshTimer = null
  function scheduleRefresh() {
    if (refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refreshTop()
    }, LIVE_REFRESH_DELAY_MS)
  }

  const wanted = (category, eventDeviceId) =>
    categories.value.includes(category) && (!deviceId.value || !eventDeviceId || eventDeviceId === deviceId.value)

  const onDeviceEvent = (e) => { if (wanted(categoryOfEvent(e?.type), e?.deviceId)) scheduleRefresh() }
  const onBackup = (e) => { if (!e?.scope && e?.hasChanges && wanted('config', e?.deviceId)) scheduleRefresh() }
  const onAlert = () => { if (wanted('alert')) scheduleRefresh() }
  const onCloudAlarms = () => { if (wanted('cloud-alarm')) scheduleRefresh() }

  const { on, off } = useWebSocket()
  on('device:event', onDeviceEvent)
  on('backup:completed', onBackup)
  on('alert:new', onAlert)
  on('alert:updated', onAlert)
  on('cloud:alarms', onCloudAlarms)
  onUnmounted(() => {
    clearTimeout(refreshTimer)
    off('device:event', onDeviceEvent)
    off('backup:completed', onBackup)
    off('alert:new', onAlert)
    off('alert:updated', onAlert)
    off('cloud:alarms', onCloudAlarms)
  })

  watch([categories, deviceId, vendor], load, { deep: true, immediate: true })

  return { items, nextBefore, loading, loadingMore, error, load, loadMore }
}
