// Display metadata for automation runs (backend Execution rows).

export const EXECUTION_STATUSES = [
  { value: 'pending', title: 'Queued', color: 'grey', icon: 'mdi-clock-outline' },
  { value: 'running', title: 'Running', color: 'info', icon: 'mdi-progress-clock' },
  { value: 'success', title: 'Succeeded', color: 'success', icon: 'mdi-check-circle' },
  { value: 'failed', title: 'Failed', color: 'error', icon: 'mdi-alert-circle' },
  { value: 'cancelled', title: 'Cancelled', color: 'warning', icon: 'mdi-cancel' }
]

export const EXECUTION_TRIGGERS = [
  { value: 'manual', title: 'Run now', icon: 'mdi-play' },
  { value: 'schedule', title: 'Schedule', icon: 'mdi-clock' },
  { value: 'alert', title: 'Alert', icon: 'mdi-bell-alert' }
]

// Per-step result statuses (engine output)
export const STEP_STATUSES = {
  ok: { title: 'OK', color: 'success', icon: 'mdi-check' },
  failed: { title: 'Failed', color: 'error', icon: 'mdi-close' },
  skipped: { title: 'Not reached', color: 'grey', icon: 'mdi-minus' },
  disabled: { title: 'Disabled', color: 'grey', icon: 'mdi-pause' },
  cancelled: { title: 'Cancelled', color: 'warning', icon: 'mdi-cancel' }
}

export const executionStatusMeta = (status) =>
  EXECUTION_STATUSES.find((s) => s.value === status) || EXECUTION_STATUSES[0]

/** 'alert:opened' -> { title: 'Alert opened', ... } */
export function triggerMeta(trigger) {
  if (!trigger) return { title: '—', icon: 'mdi-help' }
  if (trigger.startsWith('alert:')) {
    return { title: `Alert ${trigger.slice(6)}`, icon: 'mdi-bell-alert' }
  }
  return EXECUTION_TRIGGERS.find((t) => t.value === trigger) || { title: trigger, icon: 'mdi-help' }
}

export function formatDuration(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}
