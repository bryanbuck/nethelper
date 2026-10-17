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
// Every message stays in the history; `timeout` is only how long it holds the
// bar. Persistent messages are pinned: the bar falls back to the newest pinned
// one until it is dismissed. Only `popup: true` messages overlay the page.
export const useNotificationsStore = defineStore('notifications', () => {
  // A pin is about this page load (a lost connection, an unread critical alert);
  // after a reload the entry is history only.
  const entries = ref(readActivityLog().map((e) => ({ ...e, pinned: false })))
  const flashId = ref(null)
  const popup = ref(null)
  // Real-time socket state for the status bar: idle | connected | reconnecting | failed
  const connection = ref('idle')

  let flashTimer = null
  let popupTimer = null

  const current = computed(() =>
    entries.value.find((e) => e.id === flashId.value) || entries.value.find((e) => e.pinned) || null
  )
  const unseenCount = computed(() => entries.value.filter((e) => !e.seen).length)
  const unseenProblemCount = computed(() =>
    entries.value.filter((e) => !e.seen && PROBLEM_TYPES.includes(e.type)).length
  )

  const persist = () => writeActivityLog(entries.value)

  // Actions
  function addNotification(notification) {
    const { popup: wantsPopup, ...fields } = notification
    const entry = {
      type: NotificationType.INFO,
      title: '',
      message: '',
      persistent: false,
      actions: [],
      ...fields,
      id: notification.id || newId(),
      timeout: notification.timeout || DEFAULT_TIMEOUT,
      createdAt: new Date().toISOString(),
      seen: false
    }
    entry.pinned = entry.persistent

    // Re-adding an id (an alert, the socket state) replaces the old entry.
    entries.value = [entry, ...entries.value.filter((e) => e.id !== entry.id)].slice(0, MAX_ENTRIES)
    persist()

    clearTimeout(flashTimer)
    flashId.value = entry.id
    if (!entry.persistent) {
      flashTimer = setTimeout(() => {
        if (flashId.value === entry.id) flashId.value = null
      }, entry.timeout)
    }

    if (wantsPopup) {
      clearTimeout(popupTimer)
      popup.value = entry
      popupTimer = setTimeout(() => { popup.value = null }, entry.timeout)
    }

    return entry.id
  }

  // Unpin (and stop showing) the message in the bar; it stays in the history.
  function dismissCurrent() {
    const entry = current.value
    if (!entry) return
    entry.pinned = false
    entry.seen = true
    if (flashId.value === entry.id) flashId.value = null
    persist()
  }

  function dismissPopup() {
    clearTimeout(popupTimer)
    popup.value = null
  }

  function remove(id) {
    entries.value = entries.value.filter((e) => e.id !== id)
    if (flashId.value === id) flashId.value = null
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

    return addNotification({
      type: notificationTypes[type] || NotificationType.INFO,
      title: 'Automation Update',
      message: messages[type] || `Automation "${automationData.name}" updated`,
      persistent: type === 'failed',
      metadata: {
        automationId: automationData.id,
        executionId: automationData.executionId
      }
    })
  }

  // Convenience methods for common notification patterns
  function showSuccess(message, title = 'Success') {
    return addNotification({
      type: NotificationType.SUCCESS,
      title,
      message,
      timeout: 3000
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

  function showInfo(message, title = 'Info') {
    return addNotification({
      type: NotificationType.INFO,
      title,
      message,
      timeout: 3000
    })
  }

  return {
    entries,
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
