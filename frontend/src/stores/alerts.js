import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import alertsService from '@/services/alerts.service'

const emptySummary = () => ({
  open: 0,
  acknowledged: 0,
  bySeverity: { critical: 0, warning: 0, info: 0 },
  openBySeverity: { critical: 0, warning: 0, info: 0 }
})

/**
 * Server-side alerts (backend services/alert.service.js). Socket events
 * alert:new / alert:updated arrive through services/websocket.service.js and
 * carry the fresh summary, so the badge never needs polling.
 */
export const useAlertsStore = defineStore('alerts', () => {
  const items = ref([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref(null)
  const summary = ref(emptySummary())
  const rules = ref([])

  // The list's current query, so socket updates know whether a row belongs
  const query = ref({ status: 'active', severity: [], rule: null, q: '', page: 1, limit: 25 })

  // Bumped when a new alert arrives that may belong on the current page
  const staleAt = ref(0)

  // Unacknowledged critical + warning: what the app-bar badge counts
  const badgeCount = computed(() => (summary.value.openBySeverity?.critical || 0) + (summary.value.openBySeverity?.warning || 0))
  const unresolvedCount = computed(() => (summary.value.open || 0) + (summary.value.acknowledged || 0))

  async function fetch(params = {}) {
    query.value = { ...query.value, ...params }
    loading.value = true
    error.value = null
    try {
      const response = await alertsService.list(query.value)
      items.value = response.data || []
      total.value = response.total || 0
      return items.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchSummary() {
    try {
      const response = await alertsService.summary()
      summary.value = { ...emptySummary(), ...response.data }
    } catch {
      // The badge is a convenience; a failed count must not break the page.
    }
    return summary.value
  }

  async function fetchRules() {
    const response = await alertsService.getRules()
    rules.value = response.data || []
    return rules.value
  }

  async function updateRule(key, patch) {
    const response = await alertsService.updateRule(key, patch)
    const index = rules.value.findIndex((r) => r.key === key)
    if (index >= 0) rules.value[index] = response.data
    return response.data
  }

  async function acknowledge(ids) {
    const response = await alertsService.acknowledge(ids)
    patchRows(response.data || [])
    return response.data
  }

  async function resolve(ids) {
    const response = await alertsService.resolve(ids)
    patchRows(response.data || [])
    return response.data
  }

  /** Replace loaded rows with fresh copies, dropping ones that left the current status filter. */
  function patchRows(alerts) {
    for (const alert of alerts) {
      const index = items.value.findIndex((a) => a.id === alert.id)
      if (index < 0) continue
      if (matchesStatus(alert, query.value.status)) {
        items.value[index] = alert
      } else {
        items.value.splice(index, 1)
        total.value = Math.max(0, total.value - 1)
      }
    }
  }

  function matchesStatus(alert, status) {
    if (!status || status === 'all') return true
    if (status === 'active') return alert.status !== 'resolved'
    return alert.status === status
  }

  // Socket handlers ----------------------------------------------------------

  function handleNew({ alert, summary: next } = {}) {
    if (next) summary.value = { ...emptySummary(), ...next }
    if (alert) staleAt.value = Date.now()
  }

  function handleUpdated({ alerts = [], summary: next } = {}) {
    if (next) summary.value = { ...emptySummary(), ...next }
    patchRows(alerts)
    // An empty list means rows went away in bulk (device deleted or merged).
    if (!alerts.length) staleAt.value = Date.now()
  }

  return {
    items,
    total,
    loading,
    error,
    summary,
    rules,
    query,
    staleAt,
    badgeCount,
    unresolvedCount,
    fetch,
    fetchSummary,
    fetchRules,
    updateRule,
    acknowledge,
    resolve,
    handleNew,
    handleUpdated
  }
})
