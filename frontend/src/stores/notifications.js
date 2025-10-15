import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Notification types
export const NotificationType = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  ALERT: 'alert'
}

// Alert severity levels
export const AlertSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
}

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref([])
  const alerts = ref([])
  const unreadCount = ref(0)
  const maxNotifications = ref(100) // Limit to prevent memory issues

  // Computed properties
  const unreadNotifications = computed(() => 
    notifications.value.filter(notification => !notification.read)
  )

  const criticalAlerts = computed(() => 
    alerts.value.filter(alert => alert.severity === AlertSeverity.CRITICAL)
  )

  const recentAlerts = computed(() => 
    alerts.value
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
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

  function addAlert(alertData) {
    const alert = {
      id: alertData.id || Date.now().toString(),
      type: alertData.type || 'system',
      severity: alertData.severity || AlertSeverity.MEDIUM,
      title: alertData.title || 'System Alert',
      message: alertData.message || '',
      source: alertData.source || 'system',
      deviceId: alertData.deviceId || null,
      automationId: alertData.automationId || null,
      acknowledged: false,
      read: false,
      metadata: alertData.metadata || {},
      createdAt: new Date(),
      ...alertData
    }

    alerts.value.unshift(alert)
    
    // Also add as notification for UI display
    const notificationId = addNotification({
      id: `alert_${alert.id}`,
      type: getNotificationTypeFromSeverity(alert.severity),
      title: `${alert.severity.toUpperCase()}: ${alert.title}`,
      message: alert.message,
      persistent: alert.severity === AlertSeverity.CRITICAL,
      actions: [
        {
          label: 'View Details',
          action: () => viewAlertDetails(alert.id)
        },
        {
          label: 'Acknowledge',
          action: () => acknowledgeAlert(alert.id)
        }
      ]
    })

    return alert.id
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

  function acknowledgeAlert(alertId) {
    const alert = alerts.value.find(a => a.id === alertId)
    if (alert) {
      alert.acknowledged = true
      alert.acknowledgedAt = new Date()
    }
  }

  function viewAlertDetails(alertId) {
    const alert = alerts.value.find(a => a.id === alertId)
    if (alert) {
      alert.read = true
      // Emit event or navigate to alert details
      // This would be handled by the component using this store
    }
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

  function getNotificationTypeFromSeverity(severity) {
    const typeMap = {
      [AlertSeverity.LOW]: NotificationType.INFO,
      [AlertSeverity.MEDIUM]: NotificationType.WARNING,
      [AlertSeverity.HIGH]: NotificationType.WARNING,
      [AlertSeverity.CRITICAL]: NotificationType.ERROR
    }
    return typeMap[severity] || NotificationType.INFO
  }

  // Device-related notifications
  function addDeviceAlert(deviceData) {
    return addAlert({
      type: 'device',
      title: 'Device Status Change',
      message: `Device ${deviceData.name || deviceData.id} is now ${deviceData.status}`,
      severity: deviceData.status === 'offline' ? AlertSeverity.HIGH : AlertSeverity.MEDIUM,
      deviceId: deviceData.id,
      source: 'device_monitor',
      metadata: {
        previousStatus: deviceData.previousStatus,
        deviceType: deviceData.type,
        location: deviceData.location
      }
    })
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
    alerts,
    unreadCount,
    unreadNotifications,
    criticalAlerts,
    recentAlerts,
    addNotification,
    addAlert,
    removeNotification,
    markAsRead,
    markAllAsRead,
    acknowledgeAlert,
    viewAlertDetails,
    clearNotifications,
    clearReadNotifications,
    addDeviceAlert,
    addAutomationNotification,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    NotificationType,
    AlertSeverity
  }
})