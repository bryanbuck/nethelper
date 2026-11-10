import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { readActivityLog, writeActivityLog, clearActivityLog } from '@/utils/activity-log-storage'

// Notification types
export const NotificationType = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
}

export const MAX_ENTRIES = 200
const DEFAULT_TIMEOUT = 5000
const PROBLEM_TYPES = [NotificationType.WARNING, NotificationType.ERROR]

let idCounter = 0
const newId = () => globalThis.crypto?.randomUUID?.() ?? `n${Date.now()}_${++idCounter}`

// The session's activity log, shown by the status bar (components/common/StatusBar.vue).
// `timeout` is how long a message holds the bar. Persistent messages are pinned:
// the bar falls back to the newest pinned one until it is dismissed. Only
// `popup: true` messages overlay the page.
//
// `history: false` is a flash: shown in the bar for its timeout and then gone,
// never in the history list or the unseen count. For what the user just did and
// is looking at (saved, deleted, queued). Keep in the history (the default)
// what matters and could have been missed: errors, warnings, and the results
// of work that ran in the background. showSuccess/showInfo flash unless asked
// to keep; showError/showWarning keep.
//
// `transient: true` marks a kept, pinned message about a condition that is true
// right now (a lost connection, an open critical alert): it is never stored and
// stays until its condition ends (the caller calls remove(id), or a flash or
// entry under the same id replaces it) or the user dismisses it.
export const useNotificationsStore = defineStore('notifications', () => {
  // A pin is about this page load (a lost connection, an unread critical alert);
  // after a reload the entry is history only.
  const entries = ref(readActivityLog().map((e) => ({ ...e, pinned: false })))
  const flashId = ref(null)
  // The current flash-only message, which is in no list.
  const flash = ref(null)
  const popup = ref(null)
  // Real-time socket state for the status bar: idle (no socket) | connecting
  // (first connect) | connected | reconnecting | failed
  const connection = ref('idle')

  let flashTimer = null
  let popupTimer = null

  const current = computed(() =>
    (flash.value && flash.value.id === flashId.value ? flash.value : null) ||
    entries.value.find((e) => e.id === flashId.value) ||
    entries.value.find((e) => e.pinned) ||
    null
  )
  const unseenCount = computed(() => entries.value.filter((e) => !e.seen).length)
  const unseenProblemCount = computed(() =>
    entries.value.filter((e) => !e.seen && PROBLEM_TYPES.includes(e.type)).length
  )

  const persist = () => writeActivityLog(entries.value.filter((e) => !e.transient))

  // Actions
  function addNotification(notification) {
    const { popup: wantsPopup, history = true, ...fields } = notification
    const entry = {
      type: NotificationType.INFO,
      title: '',
      message: '',
      persistent: false,
      transient: false,
      actions: [],
      ...fields,
      id: notification.id || newId(),
      timeout: notification.timeout || DEFAULT_TIMEOUT,
      createdAt: new Date().toISOString(),
      seen: false
    }
    // A flash can't be pinned: it would stay in the bar with no history entry.
    if (!history) entry.persistent = false
    entry.pinned = entry.persistent

    // Re-adding an id (an alert, the socket state, a queued backup) replaces the
    // old entry, also when the newcomer is only a flash.
    const hadEntry = entries.value.some((e) => e.id === entry.id)
    const others = entries.value.filter((e) => e.id !== entry.id)
    if (history) {
      flash.value = null // superseded in the bar, and may share this id
      entries.value = [entry, ...others].slice(0, MAX_ENTRIES)
      persist()
    } else {
      flash.value = entry
      if (hadEntry) {
        entries.value = others
        persist()
      }
    }

    clearTimeout(flashTimer)
    flashId.value = entry.id
    if (!entry.persistent) {
      flashTimer = setTimeout(() => {
        if (flashId.value === entry.id) flashId.value = null
        if (flash.value?.id === entry.id) flash.value = null
      }, entry.timeout)
    }

    if (wantsPopup) {
      clearTimeout(popupTimer)
      popup.value = entry
      popupTimer = setTimeout(() => { popup.value = null }, entry.timeout)
    }

    return entry.id
  }

  // Stop showing the message in the bar. A kept one stays in the history; a
  // transient one is about now and has nothing to keep.
  function dismissCurrent() {
    const entry = current.value
    if (!entry) return
    if (entry === flash.value) {
      flash.value = null
      flashId.value = null
      return
    }
    if (entry.transient) {
      remove(entry.id)
      return
    }
    entry.pinned = false
    entry.seen = true
    if (flashId.value === entry.id) flashId.value = null
    persist()
  }

  function dismissPopup() {
    clearTimeout(popupTimer)
    popup.value = null
  }

  // Also the end of a transient message's condition: its pop-up closes too.
  function remove(id) {
    if (flash.value?.id === id) flash.value = null
    if (flashId.value === id) flashId.value = null
    if (popup.value?.id === id) dismissPopup()
    if (!entries.value.some((e) => e.id === id)) return
    entries.value = entries.value.filter((e) => e.id !== id)
    persist()
  }

  function markAllSeen() {
    if (!unseenCount.value) return
    entries.value.forEach((e) => { e.seen = true })
    persist()
  }

  // Sign-out: the next user on this tab starts with an empty log.
  function clearHistory() {
    clearTimeout(flashTimer)
    entries.value = []
    flash.value = null
    flashId.value = null
    dismissPopup()
    clearActivityLog()
  }

  function setConnection(state) {
    connection.value = state
  }

  // Automation-related notifications
  function addAutomationNotification(type, automationData) {
    const messages = {
      started: `Automation "${automationData.name}" has started`,
      completed: `Automation "${automationData.name}" completed successfully`,
      failed: `Automation "${automationData.name}" failed`,
      progress: `Automation "${automationData.name}" is ${automationData.progress}% complete`
    }

    const notificationTypes = {
      started: NotificationType.INFO,
      completed: NotificationType.SUCCESS,
      failed: NotificationType.ERROR,
      progress: NotificationType.INFO
    }

    // One message per run: "started" only flashes; the result is kept.
    const runId = automationData.executionId ? `automation-run-${automationData.executionId}` : undefined
    return addNotification({
      id: runId,
      type: notificationTypes[type] || NotificationType.INFO,
      title: 'Automation Update',
      message: messages[type] || `Automation "${automationData.name}" updated`,
      persistent: type === 'failed',
      history: type !== 'started' && type !== 'progress',
      metadata: {
        automationId: automationData.id,
        executionId: automationData.executionId
      }
    })
  }

  // Convenience methods. Successes and info flash (the user is looking at what
  // they just did) unless `{ history: true }`: a result they may have missed,
  // e.g. background work they started. Errors and warnings are kept.
  function showSuccess(message, title = 'Success', { history = false } = {}) {
    return addNotification({
      type: NotificationType.SUCCESS,
      title,
      message,
      timeout: 3000,
      history
    })
  }

  function showError(message, title = 'Error') {
    return addNotification({
      type: NotificationType.ERROR,
      title,
      message,
      persistent: false,
      timeout: 5000
    })
  }

  function showWarning(message, title = 'Warning') {
    return addNotification({
      type: NotificationType.WARNING,
      title,
      message,
      timeout: 4000
    })
  }

  function showInfo(message, title = 'Info', { history = false } = {}) {
    return addNotification({
      type: NotificationType.INFO,
      title,
      message,
      timeout: 3000,
      history
    })
  }

  return {
    entries,
    flash,
    current,
    popup,
    connection,
    unseenCount,
    unseenProblemCount,
    addNotification,
    dismissCurrent,
    dismissPopup,
    remove,
    markAllSeen,
    clearHistory,
    setConnection,
    addAutomationNotification,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    NotificationType
  }
})
