import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Notification types
export const NotificationType = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
}

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref([])
  const unreadCount = ref(0)
  const maxNotifications = ref(100) // Limit to prevent memory issues

  // Computed properties
  const unreadNotifications = computed(() => 
    notifications.value.filter(notification => !notification.read)
  )

  // Actions
  function addNotification(notification) {
    const newNotification = {
      id: notification.id || Date.now().toString(),
      type: notification.type || NotificationType.INFO,
      title: notification.title || '',
      message: notification.message || '',
      read: false,
      persistent: notification.persistent || false,
      timeout: notification.timeout || 5000,
      actions: notification.actions || [],
      createdAt: new Date(),
      ...notification
    }

    notifications.value.unshift(newNotification)
    
    // Limit notifications to prevent memory issues
    if (notifications.value.length > maxNotifications.value) {
      notifications.value = notifications.value.slice(0, maxNotifications.value)
    }
    
    updateUnreadCount()

    // Auto-remove non-persistent notifications
    if (!newNotification.persistent && newNotification.timeout > 0) {
      setTimeout(() => {
        removeNotification(newNotification.id)
      }, newNotification.timeout)
    }

    return newNotification.id
  }

  function removeNotification(notificationId) {
    const index = notifications.value.findIndex(n => n.id === notificationId)
    if (index > -1) {
      notifications.value.splice(index, 1)
      updateUnreadCount()
    }
  }

  function markAsRead(notificationId) {
    const notification = notifications.value.find(n => n.id === notificationId)
    if (notification && !notification.read) {
      notification.read = true
      updateUnreadCount()
    }
  }

  function markAllAsRead() {
    notifications.value.forEach(notification => {
      notification.read = true
    })
    updateUnreadCount()
  }

  function clearNotifications() {
    notifications.value = []
    updateUnreadCount()
  }

  function clearReadNotifications() {
    notifications.value = notifications.value.filter(n => !n.read)
    updateUnreadCount()
  }

  function updateUnreadCount() {
    unreadCount.value = unreadNotifications.value.length
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
    notifications,
    unreadCount,
    unreadNotifications,
    addNotification,
    removeNotification,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    clearReadNotifications,
    addAutomationNotification,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    NotificationType
  }
})