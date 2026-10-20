import { defineStore } from 'pinia'
import { ref } from 'vue'
import executionsService from '@/services/executions.service'

/**
 * Automation run history, owned by the server. Socket events
 * (automation:started / automation:completed) patch loaded rows; a run not
 * on the current page marks the list stale so the view can refetch.
 */
export const useExecutionsStore = defineStore('executions', () => {
  const items = ref([])
  const total = ref(0)
  const loading = ref(false)
  const staleAt = ref(0)

  async function fetch(query = {}) {
    loading.value = true
    try {
      const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v != null && v !== ''))
      const { executions, pagination } = await executionsService.list(params)
      items.value = executions
      total.value = pagination.total
    } finally {
      loading.value = false
    }
  }

  function fetchOne(id) {
    return executionsService.get(id)
  }

  async function cancel(id) {
    const row = await executionsService.cancel(id)
    patchRow(id, { status: row.status, completedAt: row.completedAt, duration: row.duration })
    return row
  }

  function patchRow(id, patch) {
    const row = items.value.find((r) => r.id === id)
    if (row) Object.assign(row, patch)
    return !!row
  }

  function handleStarted({ executionId }) {
    if (!patchRow(executionId, { status: 'running', startedAt: new Date().toISOString() })) staleAt.value = Date.now()
  }

  function handleCompleted({ executionId, status, error, duration, output }) {
    const patch = { status, completedAt: new Date().toISOString() }
    if (error !== undefined) patch.error = error
    if (duration !== undefined) patch.duration = duration
    if (output !== undefined) patch.output = output
    if (!patchRow(executionId, patch)) staleAt.value = Date.now()
  }

  return { items, total, loading, staleAt, fetch, fetchOne, cancel, handleStarted, handleCompleted }
})
