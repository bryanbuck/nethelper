/**
 * WebSocket Service
 * Centralized WebSocket event handling for the NetHelper Automation Platform
 */

import { io } from 'socket.io-client'
import { useDevicesStore } from '@/stores/devices'
import { useExecutionsStore } from '@/stores/executions'
import { useNotificationsStore } from '@/stores/notifications'
import { useAutomationsStore } from '@/stores/automations'
import { useDiscoveryStore } from '@/stores/discovery'
import { useBackupsStore } from '@/stores/backups'
import { useTopologyStore } from '@/stores/topology'
import { useAlertsStore } from '@/stores/alerts'

// One activity-log slot for the socket state: lost/restored/failed replace each other.
const CONNECTION_ENTRY_ID = 'socket-connection'

class WebSocketService {
  constructor() {
    // Exactly one socket at a time. Connection state is read from it, never
    // cached: a cached flag outlived replaced sockets and left `connected`
    // true with no socket.
    this.socket = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 1000
    this.eventHandlers = new Map()
    this.stores = {}
  }

  get connected() {
    return Boolean(this.socket?.connected)
  }

  /** A socket exists and is trying to (re)connect. */
  get connecting() {
    return Boolean(this.socket && !this.socket.connected && this.socket.active)
  }

  /**
   * Initialize stores (called when service is used)
   */
  initializeStores() {
    if (Object.keys(this.stores).length === 0) {
      this.stores = {
        devices: useDevicesStore(),
        executions: useExecutionsStore(),
        notifications: useNotificationsStore(),
        automations: useAutomationsStore(),
        discovery: useDiscoveryStore(),
        backups: useBackupsStore(),
        topology: useTopologyStore(),
        alerts: useAlertsStore()
      }
    }
  }

  /**
   * Connect to WebSocket server
   * @param {string} url - WebSocket server URL
   * @param {Object} options - Connection options
   */
  async connect(url, options = {}) {
    // A live socket (connected, or reconnecting on its own) is reused.
    // Socket.io's built-in reconnection is the only retry path.
    if (this.socket?.active) return
    this.closeSocket()
    this.initializeStores()

    // Same origin by default: nginx (prod) or the Vite proxy (dev) forwards /socket.io
    const wsUrl = url || import.meta.env.VITE_WS_URL || window.location.origin
    
    const defaultOptions = {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      forceNew: true,
      reconnection: true,
      reconnectionDelay: this.reconnectDelay,
      reconnectionAttempts: this.maxReconnectAttempts
    }

    try {
      this.socket = io(wsUrl, { ...defaultOptions, ...options })
      
      this.setupConnectionHandlers()
      this.setupEventHandlers()
      
    } catch (error) {
      this.closeSocket()
      console.error('WebSocket connection setup failed:', error)
      throw error
    }
  }

  /**
   * Setup connection event handlers
   */
  setupConnectionHandlers() {
    const socket = this.socket

    socket.on('connect', () => {
      this.reconnectAttempts = 0
      console.log('WebSocket connected')

      // The first connect only lights the status bar; a reconnect replaces the
      // pinned "Connection Lost" entry (same id) so the log doesn't stack them.
      const notifications = this.stores.notifications
      if (notifications.connection !== 'idle' && notifications.connection !== 'connected') {
        notifications.addNotification({
          id: CONNECTION_ENTRY_ID,
          type: 'success',
          title: 'Connection Restored',
          message: 'Real-time updates are active again',
          timeout: 3000
        })
      }
      notifications.setConnection('connected')
    })

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason)
      
      this.stores.notifications.setConnection('reconnecting')
      this.stores.notifications.addNotification({
        id: CONNECTION_ENTRY_ID,
        type: 'warning',
        title: 'Connection Lost',
        message: 'Attempting to reconnect...',
        persistent: true
      })
      
      // The one case Socket.io doesn't retry by itself.
      if (reason === 'io server disconnect') socket.connect()
    })

    // Built-in reconnection gave up (reconnectionAttempts exhausted).
    socket.io.on('reconnect_failed', () => this.notifyConnectionFailed())

    socket.on('connect_error', (error) => {
      this.reconnectAttempts++
      console.error('WebSocket connection error:', error)

      // socket.active is false when the server refused the handshake (e.g. a
      // bad token); the next connect() starts a new socket.
      if (!socket.active) this.notifyConnectionFailed()
    })
  }

  /**
   * Setup all WebSocket event handlers
   */
  setupEventHandlers() {
    // Device status and sync events
    this.socket.on('device:status:update', (data) => this.handleDeviceStatusUpdate(data))
    this.socket.on('cloud:status:checked', (data) => this.handleCloudStatusChecked(data))
    this.socket.on('device:sync:completed', (data) => this.handleDeviceSyncCompleted(data))
    this.socket.on('device:sync:failed', (data) => this.handleDeviceSyncFailed(data))

    // Automation lifecycle events
    this.socket.on('automation:started', (data) => this.handleAutomationStarted(data))
    this.socket.on('automation:completed', (data) => this.handleAutomationCompleted(data))

    // Discovery scan events
    this.socket.on('discovery:progress', (data) => this.handleDiscoveryProgress(data))
    this.socket.on('discovery:completed', (data) => this.handleDiscoveryCompleted(data))
    this.socket.on('discovery:failed', (data) => this.handleDiscoveryFailed(data))

    // Config backup events
    this.socket.on('backup:completed', (data) => this.handleBackupCompleted(data))
    this.socket.on('backup:failed', (data) => this.handleBackupFailed(data))
    this.socket.on('backup:run:completed', (data) => this.handleBackupRunCompleted(data))

    // Network Map neighbor collection
    this.socket.on('topology:progress', (data) => this.stores.topology?.handleProgress(data))
    this.socket.on('topology:updated', (data) => this.stores.topology?.handleUpdated(data))

    // Alert events
    this.socket.on('alert:new', (data) => this.handleNewAlert(data))
    this.socket.on('alert:updated', (data) => this.handleAlertUpdated(data))

    console.log('WebSocket event handlers registered')
  }

  /**
   * Handle device ping status update events
   * @param {Object} data - Ping status data
   */
  handleDeviceStatusUpdate(data) {
    try {
      // From the ping monitor (pingStatus, pingLastSeen, ...) or the cloud
      // status refresh (cloudStatus, lastSeen, cloudLastSeen, cloudCheckedAt).
      // `status` is the displayed one (it accounts for both). Patch only what
      // the event carries; the device page's Last Seen card reads the *Seen ones.
      const { deviceId } = data
      const fields = [
        'status', 'pingStatus', 'pingResponseTime', 'pingLastChecked', 'pingLastSeen',
        'cloudStatus', 'lastSeen', 'cloudLastSeen', 'cloudCheckedAt'
      ]
      const patch = Object.fromEntries(fields.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]))
      if (!patch.status && patch.pingStatus) patch.status = patch.pingStatus

      // Use local update (no API call) to avoid unnecessary requests.
      this.stores.devices.updateDeviceLocally(deviceId, patch)
      const mapPatch = Object.fromEntries(['pingStatus', 'cloudStatus'].filter((key) => key in patch).map((key) => [key, patch[key]]))
      if (Object.keys(mapPatch).length) this.stores.topology?.applyDeviceStatus(deviceId, mapPatch)
    } catch (error) {
      console.error('Error handling device status update:', error)
    }
  }

  /**
   * A cloud status refresh finished: one event per integration instead of a
   * cloudCheckedAt per device, so "Confirmed by <cloud>" stays current.
   */
  handleCloudStatusChecked(data) {
    try {
      this.stores.devices.applyCloudCheck(data.integrationId, data.checkedAt)
    } catch (error) {
      console.error('Error handling cloud status check:', error)
    }
  }

  handleDeviceSyncCompleted(data) {
    try {
      this.stores.devices.applySyncResult(data)
      const parts = [`${data.total ?? 0} device(s)`, `${data.created ?? 0} new`]
      if (data.adopted) parts.push(`${data.adopted} matched to existing devices by MAC`)
      const failed = (data.integrations || []).filter((i) => i.error)
      // The hourly sync is unattended: only a failure is worth a status bar entry.
      if (data.trigger === 'scheduled' && !failed.length) return
      const message = `Cloud sync finished: ${parts.join(', ')}.`
        + (data.possibleDuplicates ? ` ${data.possibleDuplicates} possible duplicate(s) to review on the Devices page.` : '')
        + (failed.length ? ` Failed: ${failed.map((i) => i.name).join(', ')}.` : '')
      if (data.possibleDuplicates || failed.length) this.stores.notifications.showWarning(message, 'Device Sync')
      else this.stores.notifications.showSuccess(message, 'Device Sync')
    } catch (error) {
      console.error('Error handling device sync completed:', error)
    }
  }

  handleDeviceSyncFailed(data) {
    try {
      const what = data.trigger === 'scheduled' ? 'Scheduled cloud sync' : 'Cloud sync'
      this.stores.notifications.showError(`${what} failed: ${data.error || 'Unknown error'}`, 'Device Sync')
    } catch (error) {
      console.error('Error handling device sync failed:', error)
    }
  }

  /**
   * Handle discovery scan progress events
   * @param {Object} data - { scanId, progress, phase, message }
   */
  handleDiscoveryProgress(data) {
    console.log('Discovery progress:', data)

    try {
      this.stores.discovery.updateScanProgress(data)
    } catch (error) {
      console.error('Error handling discovery progress:', error)
    }
  }

  /**
   * Handle discovery scan completed events
   * @param {Object} data - { scanId, totalHosts, vendorHosts }
   */
  handleDiscoveryCompleted(data) {
    console.log('Discovery completed:', data)

    try {
      const { totalHosts, vendorHosts } = data

      this.stores.discovery.handleScanCompleted(data)

      this.stores.notifications.showSuccess(
        `Found ${totalHosts} host(s), ${vendorHosts} from a known vendor`,
        'Discovery Scan Complete'
      )
    } catch (error) {
      console.error('Error handling discovery completed:', error)
    }
  }

  /**
   * Handle discovery scan failed events
   * @param {Object} data - { scanId, error }
   */
  handleDiscoveryFailed(data) {
    console.log('Discovery failed:', data)

    try {
      this.stores.discovery.handleScanFailed(data)

      this.stores.notifications.showError(
        data.error || 'The discovery scan failed',
        'Discovery Scan Failed'
      )
    } catch (error) {
      console.error('Error handling discovery failed:', error)
    }
  }

  /** What a backup event is about: a device, or a cloud scope (a Mist org/site, a Central scope). */
  backupSubject(data) {
    return data.scope ? `${data.scopeType} "${data.scopeName}"` : `"${data.deviceName}"`
  }

  /**
   * Handle config backup completed events (per device or cloud scope)
   * @param {Object} data - { backupId, deviceId, deviceName, hasChanges }
   */
  handleBackupCompleted(data) {
    console.log('Backup completed:', data)

    try {
      const { hasChanges, warning } = data

      this.stores.backups.applyBackupEvent(data)

      const message = `Configuration backup for ${this.backupSubject(data)} completed${hasChanges ? ' (configuration changed)' : ''}`
      if (warning) {
        this.stores.notifications.showWarning(`${message}. ${warning}`, 'Backup Incomplete')
      } else {
        this.stores.notifications.showSuccess(message, 'Backup Complete')
      }
    } catch (error) {
      console.error('Error handling backup completed:', error)
    }
  }

  /**
   * Handle config backup failed events (per device)
   * @param {Object} data - { backupId, deviceId, deviceName, error, unsupported? }
   */
  handleBackupFailed(data) {
    console.log('Backup failed:', data)

    try {
      const { error: errorMessage } = data

      this.stores.backups.applyBackupEvent(data)

      // A platform with no per-device config (Mist APs): expected on an "all
      // devices" run, so only the run summary counts it.
      if (data.unsupported) return

      this.stores.notifications.showError(
        `Configuration backup for ${this.backupSubject(data)} failed: ${errorMessage || 'Unknown error'}`,
        'Backup Failed'
      )
    } catch (error) {
      console.error('Error handling backup failed:', error)
    }
  }

  /**
   * Handle config backup run completed events (whole batch)
   * @param {Object} data - { scheduleId, total, succeeded, failed, unsupported? }
   */
  handleBackupRunCompleted(data) {
    console.log('Backup run completed:', data)

    try {
      const { total, succeeded, failed } = data
      // Device runs count devices with no per-device config apart (a number;
      // scope runs send a list of integrations).
      const skipped = typeof data.unsupported === 'number' ? data.unsupported : 0
      const skippedNote = skipped > 0
        ? `, ${skipped} skipped (no per-device config; see Cloud Scopes)`
        : ''

      this.stores.backups.handleRunCompleted(data)

      if (failed > 0) {
        this.stores.notifications.showWarning(
          `Backup run finished: ${succeeded}/${total - skipped} succeeded, ${failed} failed${skippedNote}`,
          'Backup Run Complete'
        )
      } else {
        this.stores.notifications.showSuccess(
          `Backup run finished: ${succeeded}/${total - skipped} ${data.scope ? 'cloud scope(s)' : 'device(s)'} backed up${skippedNote}`,
          'Backup Run Complete'
        )
      }
    } catch (error) {
      console.error('Error handling backup run completed:', error)
    }
  }

  /**
   * An automation run started (backend jobs/automation.job.js).
   * @param {Object} data - { executionId, automationId, automation, deviceId, trigger }
   */
  handleAutomationStarted(data) {
    try {
      this.stores.executions.handleStarted(data)
      // Only runs someone started by hand announce themselves; schedules,
      // alert and config change triggers run unattended and speak up only
      // when they fail.
      if (data.trigger === 'manual') {
        this.stores.notifications.addAutomationNotification('started', {
          id: data.automationId,
          name: data.automation?.name || 'Automation',
          executionId: data.executionId
        })
      }
    } catch (error) {
      console.error('Error handling automation started:', error)
    }
  }

  /**
   * An automation run finished: success, failed or cancelled.
   * @param {Object} data - { executionId, automationId, automation, status, output, error, duration, trigger }
   */
  handleAutomationCompleted(data) {
    try {
      this.stores.executions.handleCompleted(data)
      if (data.status === 'cancelled') return
      if (data.status === 'failed' || data.trigger === 'manual') {
        this.stores.notifications.addAutomationNotification(data.status === 'success' ? 'completed' : 'failed', {
          id: data.automationId,
          name: data.automation?.name || 'Automation',
          executionId: data.executionId,
          status: data.status,
          error: data.error
        })
      }
    } catch (error) {
      console.error('Error handling automation completed:', error)
    }
  }

  /**
   * A server-side alert opened (services/alert.service.js on the backend).
   * @param {Object} data - { alert, summary }
   */
  handleNewAlert(data) {
    try {
      const { alert } = data
      this.stores.alerts.handleNew(data)
      if (!alert) return

      this.stores.notifications.addNotification({
        id: `alert_${alert.id}`,
        type: alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warning' : 'info',
        title: alert.title,
        message: alert.message,
        persistent: alert.severity === 'critical',
        popup: alert.severity === 'critical',
        timeout: 8000,
        actions: [{ label: 'View', to: '/alerts' }]
      })

      // Critical alerts also raise a browser notification when permitted
      if (alert.severity === 'critical' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(alert.title, { body: alert.message, tag: `alert-${alert.id}` })
      }
    } catch (error) {
      console.error('Error handling new alert:', error)
    }
  }

  /**
   * Alerts changed (bumped, acknowledged, resolved, or removed with a device).
   * @param {Object} data - { alerts, summary }
   */
  handleAlertUpdated(data) {
    this.stores.alerts.handleUpdated(data)
  }

  notifyConnectionFailed() {
    this.stores.notifications.setConnection('failed')
    this.stores.notifications.addNotification({
      id: CONNECTION_ENTRY_ID,
      type: 'error',
      title: 'Connection Failed',
      message: 'Unable to establish real-time connection. Please refresh the page.',
      persistent: true
    })
  }

  /**
   * Emit event to server
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @returns {boolean} Success status
   */
  emit(event, data) {
    if (this.socket && this.connected) {
      this.socket.emit(event, data)
      return true
    }
    console.warn('Cannot emit event - WebSocket not connected:', event)
    return false
  }

  /**
   * Emit and wait for the server's acknowledgement.
   * @returns {Promise<*>} the ack payload; rejects when not connected or on timeout
   */
  request(event, data, timeoutMs = 15000) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error('Real-time connection is not available'))
    }
    return new Promise((resolve, reject) => {
      this.socket.timeout(timeoutMs).emit(event, data, (err, response) => {
        if (err) reject(new Error('The server did not respond in time'))
        else resolve(response)
      })
    })
  }

  /**
   * Add custom event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  on(event, handler) {
    if (this.socket) {
      this.socket.on(event, handler)
      this.eventHandlers.set(event, handler)
    }
  }

  /**
   * Remove event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  off(event, handler) {
    if (this.socket) {
      this.socket.off(event, handler)
      this.eventHandlers.delete(event)
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    this.closeSocket()
  }

  /** Close the current socket for good: no listeners left behind, no retries. */
  closeSocket() {
    if (!this.socket) return
    this.socket.io.removeAllListeners()
    this.socket.removeAllListeners()
    this.socket.disconnect()
    this.socket = null
    this.stores.notifications?.setConnection('idle')
  }

  /**
   * Get connection status
   * @returns {Object} Connection status
   */
  getStatus() {
    return {
      connected: this.connected,
      connecting: this.connecting,
      reconnectAttempts: this.reconnectAttempts
    }
  }
}

// Create singleton instance
const webSocketService = new WebSocketService()

export default webSocketService