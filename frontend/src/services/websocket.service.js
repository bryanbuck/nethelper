/**
 * WebSocket Service
 * Centralized WebSocket event handling for the Aruba Central Automation Platform
 */

import { io } from 'socket.io-client'
import { useDevicesStore } from '@/stores/devices'
import { useExecutionsStore } from '@/stores/executions'
import { useNotificationsStore } from '@/stores/notifications'
import { useAutomationsStore } from '@/stores/automations'
import { Device, Execution, ExecutionStatus } from '@/models'

class WebSocketService {
  constructor() {
    this.socket = null
    this.connected = false
    this.connecting = false
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 1000
    this.eventHandlers = new Map()
    this.stores = {}
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
        automations: useAutomationsStore()
      }
    }
  }

  /**
   * Connect to WebSocket server
   * @param {string} url - WebSocket server URL
   * @param {Object} options - Connection options
   */
  async connect(url, options = {}) {
    if (this.connecting || this.connected) return

    this.connecting = true
    this.initializeStores()

    const wsUrl = url || import.meta.env.VITE_WS_URL || 'ws://localhost:3000'
    
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
      this.connecting = false
      console.error('WebSocket connection setup failed:', error)
      throw error
    }
  }

  /**
   * Setup connection event handlers
   */
  setupConnectionHandlers() {
    this.socket.on('connect', () => {
      this.connected = true
      this.connecting = false
      this.reconnectAttempts = 0
      console.log('WebSocket connected')
      
      this.stores.notifications.addNotification({
        type: 'success',
        title: 'Connection Established',
        message: 'Real-time updates are now active',
        timeout: 3000
      })
    })

    this.socket.on('disconnect', (reason) => {
      this.connected = false
      this.connecting = false
      console.log('WebSocket disconnected:', reason)
      
      this.stores.notifications.addNotification({
        type: 'warning',
        title: 'Connection Lost',
        message: 'Attempting to reconnect...',
        persistent: true
      })
      
      // Handle reconnection
      if (reason === 'io server disconnect') {
        this.scheduleReconnect()
      }
    })

    this.socket.on('connect_error', (error) => {
      this.connected = false
      this.connecting = false
      this.reconnectAttempts++
      
      console.error('WebSocket connection error:', error)
      
      if (this.reconnectAttempts <= this.maxReconnectAttempts) {
        this.scheduleReconnect()
      } else {
        this.stores.notifications.addNotification({
          type: 'error',
          title: 'Connection Failed',
          message: 'Unable to establish real-time connection. Please refresh the page.',
          persistent: true
        })
      }
    })
  }

  /**
   * Setup all WebSocket event handlers
   */
  setupEventHandlers() {
    // Device update events
    this.socket.on('device:update', (data) => this.handleDeviceUpdate(data))
    
    // Automation lifecycle events
    this.socket.on('automation:started', (data) => this.handleAutomationStarted(data))
    this.socket.on('automation:progress', (data) => this.handleAutomationProgress(data))
    this.socket.on('automation:completed', (data) => this.handleAutomationCompleted(data))
    
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

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    setTimeout(() => {
      if (!this.connected && this.reconnectAttempts <= this.maxReconnectAttempts) {
        console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`)
        this.connect()
      }
    }, this.reconnectDelay * this.reconnectAttempts)
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
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.connected = false
    this.connecting = false
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