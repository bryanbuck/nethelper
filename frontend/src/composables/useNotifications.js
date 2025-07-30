import { computed } from 'vue'
import { useNotificationsStore, NotificationType, AlertSeverity } from '@/stores/notifications'

export function useNotifications() {
  const notificationsStore = useNotificationsStore()

  // Reactive computed properties
  const notifications = computed(() => notificationsStore.notifications)
  const alerts = computed(() => notificationsStore.alerts)
  const unreadCount = computed(() => notificationsStore.unreadCount)
  const unreadNotifications = computed(() => notificationsStore.unreadNotifications)
  const criticalAlerts = computed(() => notificationsStore.criticalAlerts)
  const recentAlerts = computed(() => notificationsStore.recentAlerts)

  // Notification methods
  const showNotification = (notification) => {
    return notificationsStore.addNotification(notification)
  }

  const showSuccess = (title, message, options = {}) => {
    return showNotification({
      type: NotificationType.SUCCESS,
      title,
      message,
      timeout: 4000,
      ...options
    })
  }

  const showError = (title, message, options = {}) => {
    return showNotification({
      type: NotificationType.ERROR,
      title,
      message,
      persistent: true,
      ...options
    })
  }

  const showWarning = (title, message, options = {}) => {
    return showNotification({
      type: NotificationType.WARNING,
      title,
      message,
      timeout: 6000,
      ...options
    })
  }

  const showInfo = (title, message, options = {}) => {
    return showNotification({
      type: NotificationType.INFO,
      title,
      message,
      timeout: 5000,
      ...options
    })
  }

  // Alert methods
  const showAlert = (alert) => {
    return notificationsStore.addAlert(alert)
  }

  const showDeviceAlert = (deviceData) => {
    return notificationsStore.addDeviceAlert(deviceData)
  }

  const showAutomationNotification = (type, automationData) => {
    return notificationsStore.addAutomationNotification(type, automationData)
  }

  // Management methods
  const removeNotification = (notificationId) => {
    notificationsStore.removeNotification(notificationId)
  }

  const markAsRead = (notificationId) => {
    notificationsStore.markAsRead(notificationId)
  }

  const markAllAsRead = () => {
    notificationsStore.markAllAsRead()
  }

  const acknowledgeAlert = (alertId) => {
    notificationsStore.acknowledgeAlert(alertId)
  }

  const clearNotifications = () => {
    notificationsStore.clearNotifications()
  }

  const clearReadNotifications = () => {
    notificationsStore.clearReadNotifications()
  }

  // Quick notification helpers for common use cases
  const notifyDeviceStatusChange = (deviceName, newStatus, previousStatus) => {
    const messages = {
      online: `${deviceName} is now online`,
      offline: `${deviceName} has gone offline`,
      warning: `${deviceName} has warnings`,
      maintenance: `${deviceName} is under maintenance`
    }

    const types = {
      online: NotificationType.SUCCESS,
      offline: NotificationType.ERROR,
      warning: NotificationType.WARNING,
      maintenance: NotificationType.INFO
    }

    return showNotification({
      type: types[newStatus] || NotificationType.INFO,
      title: 'Device Status Change',
      message: messages[newStatus] || `${deviceName} status changed to ${newStatus}`,
      metadata: {
        deviceName,
        newStatus,
        previousStatus
      }
    })
  }

  const notifyAutomationStarted = (automationName) => {
    return showInfo(
      'Automation Started',
      `${automationName} has started running`
    )
  }

  const notifyAutomationCompleted = (automationName, success = true, error = null) => {
    if (success) {
      return showSuccess(
        'Automation Completed',
        `${automationName} completed successfully`
      )
    } else {
      return showError(
        'Automation Failed',
        `${automationName} failed: ${error || 'Unknown error'}`,
        { persistent: true }
      )
    }
  }

  const notifyAutomationProgress = (automationName, progress) => {
    return showInfo(
      'Automation Progress',
      `${automationName} is ${progress}% complete`,
      { timeout: 2000 }
    )
  }

  // System notification helpers
  const notifyConnectionStatus = (connected) => {
    if (connected) {
      return showSuccess(
        'Connected',
        'Real-time updates are active',
        { timeout: 3000 }
      )
    } else {
      return showWarning(
        'Connection Lost',
        'Attempting to reconnect...',
        { persistent: true }
      )
    }
  }

  const notifySystemMaintenance = (message, scheduledAt) => {
    return showWarning(
      'System Maintenance',
      message,
      { 
        persistent: true,
        metadata: { scheduledAt }
      }
    )
  }

  // Browser notification permission
  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission()
      return permission === 'granted'
    }
    return false
  }

  const hasNotificationPermission = () => {
    return 'Notification' in window && Notification.permission === 'granted'
  }

  // Show browser notification for critical alerts
  const showBrowserNotification = (title, message, options = {}) => {
    if (hasNotificationPermission()) {
      return new Notification(title, {
        body: message,
        icon: '/favicon.ico',
        ...options
      })
    }
    return null
  }

  return {
    // State
    notifications,
    alerts,
    unreadCount,
    unreadNotifications,
    criticalAlerts,
    recentAlerts,
    
    // Basic notifications
    showNotification,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    
    // Alerts
    showAlert,
    showDeviceAlert,
    showAutomationNotification,
    
    // Management
    removeNotification,
    markAsRead,
    markAllAsRead,
    acknowledgeAlert,
    clearNotifications,
    clearReadNotifications,
    
    // Quick helpers
    notifyDeviceStatusChange,
    notifyAutomationStarted,
    notifyAutomationCompleted,
    notifyAutomationProgress,
    notifyConnectionStatus,
    notifySystemMaintenance,
    
    // Browser notifications
    requestNotificationPermission,
    hasNotificationPermission,
    showBrowserNotification,
    
    // Constants
    NotificationType,
    AlertSeverity
  }
}