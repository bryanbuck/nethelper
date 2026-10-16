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
import { Device, Execution, ExecutionStatus } from '@/models'

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
        backups: useBackupsStore()
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
      
      this.stores.notifications.addNotification({
        type: 'success',
        title: 'Connection Established',
        message: 'Real-time updates are now active',
        timeout: 3000
      })
    })

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason)
      
      this.stores.notifications.addNotification({
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
    // Device update events
    this.socket.on('device:update', (data) => this.handleDeviceUpdate(data))
    this.socket.on('device:status:update', (data) => this.handleDeviceStatusUpdate(data))
    this.socket.on('device:api:status', (data) => this.handleDeviceApiStatus(data))
    this.socket.on('device:sync:completed', (data) => this.handleDeviceSyncCompleted(data))
    this.socket.on('device:sync:failed', (data) => this.handleDeviceSyncFailed(data))

    // Automation lifecycle events
    this.socket.on('automation:started', (data) => this.handleAutomationStarted(data))
    this.socket.on('automation:progress', (data) => this.handleAutomationProgress(data))
    this.socket.on('automation:completed', (data) => this.handleAutomationCompleted(data))

    // Discovery scan events
    this.socket.on('discovery:progress', (data) => this.handleDiscoveryProgress(data))
    this.socket.on('discovery:completed', (data) => this.handleDiscoveryCompleted(data))
    this.socket.on('discovery:failed', (data) => this.handleDiscoveryFailed(data))

    // Config backup events
    this.socket.on('backup:completed', (data) => this.handleBackupCompleted(data))
    this.socket.on('backup:failed', (data) => this.handleBackupFailed(data))
    this.socket.on('backup:run:completed', (data) => this.handleBackupRunCompleted(data))

    // Alert events
    this.socket.on('alert:new', (data) => this.handleNewAlert(data))

    // Additional system events
    this.socket.on('metrics:update', (data) => this.handleMetricsUpdate(data))
    this.socket.on('system:maintenance', (data) => this.handleSystemMaintenance(data))

    console.log('WebSocket event handlers registered')
  }

  /**
   * Handle device update events
   * @param {Object} data - Device update data
   */
  handleDeviceUpdate(data) {
    console.log('Device update received:', data)

    try {
      const { deviceId, device, changes } = data

      if (device) {
        // Full device update
        const deviceInstance = Device.fromApiResponse(device)
        this.stores.devices.updateDevice(deviceId, deviceInstance.toJSON())

        // Add notification for significant status changes
        if (changes?.status) {
          this.stores.notifications.addDeviceAlert({
            id: deviceId,
            name: device.name,
            status: device.status,
            previousStatus: changes.status.from,
            type: device.type,
            location: device.location
          })
        }
      } else if (changes) {
        // Partial update
        this.stores.devices.updateDevice(deviceId, changes)

        // Handle status changes
        if (changes.status) {
          this.stores.devices.updateDeviceStatus(deviceId, changes.status)
        }
      }

    } catch (error) {
      console.error('Error handling device update:', error)
    }
  }

  /**
   * Handle device ping status update events
   * @param {Object} data - Ping status data
   */
  handleDeviceStatusUpdate(data) {
    console.log('Device ping status update:', data)

    try {
      const { deviceId, status, pingStatus, pingResponseTime, pingLastChecked } = data

      // Use local update (no API call) to avoid unnecessary requests
      this.stores.devices.updateDeviceLocally(deviceId, {
        status: pingStatus || status,
        pingStatus,
        pingResponseTime,
        pingLastChecked
      })

      // Optionally show notification for offline status
      if (status === 'offline' || pingStatus === 'offline') {
        // Could add a notification here if desired
      }

    } catch (error) {
      console.error('Error handling device status update:', error)
    }
  }

  /**
   * Handle cloud inventory sync completion (the sync runs as a queued job)
   * @param {Object} data - { created, updated, adopted, total, possibleDuplicates, integrations }
   */
  handleDeviceSyncCompleted(data) {
    try {
      this.stores.devices.applySyncResult(data)
      const parts = [`${data.total ?? 0} device(s)`, `${data.created ?? 0} new`]
      if (data.adopted) parts.push(`${data.adopted} matched to existing devices by MAC`)
      const failed = (data.integrations || []).filter((i) => i.error)
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
      this.stores.notifications.showError(`Cloud sync failed: ${data.error || 'Unknown error'}`, 'Device Sync')
    } catch (error) {
      console.error('Error handling device sync failed:', error)
    }
  }

  /**
   * Handle device API status update events
   * @param {Object} data - API status data
   */
  handleDeviceApiStatus(data) {
    console.log('Device API status update:', data)

    try {
      const {
        deviceId,
        status,
        lastCommunication,
        responseTime,
        successRate,
        consecutiveFailures,
        error
      } = data

      // Use local update (no API call) to avoid unnecessary requests
      this.stores.devices.updateDeviceLocally(deviceId, {
        apiStatus: status,
        apiLastCommunication: lastCommunication,
        apiResponseTime: responseTime,
        apiSuccessRate: successRate,
        apiConsecutiveFailures: consecutiveFailures,
        apiError: error
      })

    } catch (error) {
      console.error('Error handling device API status:', error)
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
   * @param {Object} data - { scanId, totalHosts, arubaHosts }
   */
  handleDiscoveryCompleted(data) {
    console.log('Discovery completed:', data)

    try {
      const { totalHosts, arubaHosts } = data

      this.stores.discovery.handleScanCompleted(data)

      this.stores.notifications.showSuccess(
        `Found ${totalHosts} host(s), ${arubaHosts} Aruba device(s)`,
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

  /** What a backup event is about: a device, or a cloud scope (Mist org/site). */
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
      const { hasChanges } = data

      this.stores.backups.applyBackupEvent(data)

      this.stores.notifications.showSuccess(
        `Configuration backup for ${this.backupSubject(data)} completed${hasChanges ? ' (configuration changed)' : ''}`,
        'Backup Complete'
      )
    } catch (error) {
      console.error('Error handling backup completed:', error)
    }
  }

  /**
   * Handle config backup failed events (per device)
   * @param {Object} data - { backupId, deviceId, deviceName, error }
   */
  handleBackupFailed(data) {
    console.log('Backup failed:', data)

    try {
      const { error: errorMessage } = data

      this.stores.backups.applyBackupEvent(data)

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
   * @param {Object} data - { scheduleId, total, succeeded, failed }
   */
  handleBackupRunCompleted(data) {
    console.log('Backup run completed:', data)

    try {
      const { total, succeeded, failed } = data

      this.stores.backups.handleRunCompleted(data)

      if (failed > 0) {
        this.stores.notifications.showWarning(
          `Backup run finished: ${succeeded}/${total} succeeded, ${failed} failed`,
          'Backup Run Complete'
        )
      } else {
        this.stores.notifications.showSuccess(
          `Backup run finished: ${succeeded}/${total} ${data.scope ? 'cloud scope(s)' : 'device(s)'} backed up`,
          'Backup Run Complete'
        )
      }
    } catch (error) {
      console.error('Error handling backup run completed:', error)
    }
  }

  /**
   * Handle automation started events
   * @param {Object} data - Automation start data
   */
  handleAutomationStarted(data) {
    console.log('Automation started:', data)
    
    try {
      const { executionId, automationId, automation, execution, deviceId } = data
      
      // Add execution to store
      if (execution) {
        const executionInstance = Execution.fromApiResponse(execution)
        this.stores.executions.addExecution(executionInstance)
      } else {
        // Create basic execution record
        const newExecution = new Execution({
          id: executionId,
          automationId,
          deviceId,
          status: ExecutionStatus.RUNNING,
          startedAt: new Date()
        })
        this.stores.executions.addExecution(newExecution)
      }
      
      // Add notification
      this.stores.notifications.addAutomationNotification('started', {
        id: automationId,
        name: automation?.name || 'Unknown Automation',
        executionId
      })
      
    } catch (error) {
      console.error('Error handling automation started:', error)
    }
  }

  /**
   * Handle automation progress events
   * @param {Object} data - Automation progress data
   */
  handleAutomationProgress(data) {
    console.log('Automation progress:', data)
    
    try {
      const { 
        executionId, 
        automationId, 
        progress, 
        currentStep, 
        totalSteps, 
        message,
        automation 
      } = data
      
      // Update execution progress
      this.stores.executions.updateExecutionProgress(executionId, {
        progress,
        currentStep,
        totalSteps,
        message
      })
      
      // Add progress notification for significant milestones
      if (progress && (progress % 25 === 0 || progress === 100)) {
        this.stores.notifications.addAutomationNotification('progress', {
          id: automationId,
          name: automation?.name || 'Unknown Automation',
          executionId,
          progress
        })
      }
      
    } catch (error) {
      console.error('Error handling automation progress:', error)
    }
  }

  /**
   * Handle automation completed events
   * @param {Object} data - Automation completion data
   */
  handleAutomationCompleted(data) {
    console.log('Automation completed:', data)
    
    try {
      const { 
        executionId, 
        automationId, 
        status, 
        output, 
        error, 
        duration,
        automation 
      } = data
      
      // Update execution status
      this.stores.executions.updateExecutionStatus(executionId, status, {
        output,
        error,
        duration,
        completedAt: new Date()
      })
      
      // Add completion notification
      const notificationType = status === ExecutionStatus.SUCCESS ? 'completed' : 'failed'
      this.stores.notifications.addAutomationNotification(notificationType, {
        id: automationId,
        name: automation?.name || 'Unknown Automation',
        executionId,
        status,
        error
      })
      
      // Add alert for failed automations
      if (status === ExecutionStatus.FAILED) {
        this.stores.notifications.addAlert({
          type: 'automation',
          severity: 'high',
          title: 'Automation Failed',
          message: `Automation "${automation?.name || automationId}" failed: ${error || 'Unknown error'}`,
          automationId,
          metadata: {
            executionId,
            duration,
            output
          }
        })
      }
      
    } catch (error) {
      console.error('Error handling automation completed:', error)
    }
  }

  /**
   * Handle new alert events
   * @param {Object} data - Alert data
   */
  handleNewAlert(data) {
    console.log('New alert received:', data)
    
    try {
      const { 
        id,
        type,
        severity,
        title,
        message,
        source,
        deviceId,
        automationId,
        metadata 
      } = data
      
      // Add alert to notifications store
      this.stores.notifications.addAlert({
        id,
        type,
        severity,
        title,
        message,
        source,
        deviceId,
        automationId,
        metadata
      })
      
      // For critical alerts, also show browser notification if permitted
      if (severity === 'critical' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title, {
            body: message,
            icon: '/favicon.ico',
            tag: `alert-${id}`
          })
        }
      }
      
    } catch (error) {
      console.error('Error handling new alert:', error)
    }
  }

  /**
   * Handle metrics update events
   * @param {Object} data - Metrics data
   */
  handleMetricsUpdate(data) {
    console.log('Metrics update received:', data)
    
    try {
      // Update device statistics if included
      if (data.deviceMetrics) {
        this.stores.devices.updateStats()
      }
      
      // Update execution statistics if included
      if (data.executionMetrics) {
        // This would update execution stats in the store
        // Implementation depends on specific metrics structure
      }
      
    } catch (error) {
      console.error('Error handling metrics update:', error)
    }
  }

  /**
   * Handle system maintenance events
   * @param {Object} data - Maintenance data
   */
  handleSystemMaintenance(data) {
    console.log('System maintenance event:', data)
    
    try {
      const { type, message, scheduledAt, duration } = data
      
      this.stores.notifications.addNotification({
        type: 'warning',
        title: 'System Maintenance',
        message: message || 'System maintenance scheduled',
        persistent: true,
        metadata: {
          maintenanceType: type,
          scheduledAt,
          duration
        }
      })
      
    } catch (error) {
      console.error('Error handling system maintenance:', error)
    }
  }

  notifyConnectionFailed() {
    this.stores.notifications.addNotification({
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