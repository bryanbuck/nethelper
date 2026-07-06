import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useDevicesStore } from '@/stores/devices'
import { useExecutionsStore } from '@/stores/executions'
import { useNotificationsStore } from '@/stores/notifications'
import webSocketService from '@/services/websocket.service'

export function useWebSocket() {
  const connected = ref(false)
  const connecting = ref(false)
  const error = ref(null)
  const reconnectAttempts = ref(0)
  
  const authStore = useAuthStore()

  const connect = async () => {
    if (connecting.value || connected.value) return
    
    connecting.value = true
    error.value = null
    
    try {
      const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000'
      
      await webSocketService.connect(wsUrl, {
        auth: {
          token: authStore.token
        }
      })
      
      // Update reactive refs based on service status
      updateConnectionStatus()
      
    } catch (err) {
      connecting.value = false
      error.value = err.message
      console.error('WebSocket connection failed:', err)
    }
  }

  const disconnect = () => {
    webSocketService.disconnect()
    updateConnectionStatus()
  }

  const emit = (event, data) => {
    return webSocketService.emit(event, data)
  }

  const on = (event, callback) => {
    webSocketService.on(event, callback)
  }

  const off = (event, callback) => {
    webSocketService.off(event, callback)
  }

  const updateConnectionStatus = () => {
    const status = webSocketService.getStatus()
    connected.value = status.connected
    connecting.value = status.connecting
    reconnectAttempts.value = status.reconnectAttempts
  }

  // Simulation for development mode
  const simulateRealTimeUpdates = () => {
    const devicesStore = useDevicesStore()
    const executionsStore = useExecutionsStore()
    const notificationsStore = useNotificationsStore()
    
    const deviceIds = ['1', '2', '3', '4', '5', '6']
    const statuses = ['online', 'offline', 'warning']
    const automationIds = ['auto-1', 'auto-2', 'auto-3']
    
    // Simulate device updates
    setInterval(() => {
      if (Math.random() > 0.7) {
        const randomDevice = deviceIds[Math.floor(Math.random() * deviceIds.length)]
        const randomStatus = statuses[Math.floor(Math.random() * statuses.length)]
        
        // Simulate device update event
        webSocketService.handleDeviceUpdate({
          deviceId: randomDevice,
          changes: { status: randomStatus },
          device: {
            id: randomDevice,
            name: `Device ${randomDevice}`,
            status: randomStatus,
            type: 'access_point',
            lastSeen: new Date().toISOString()
          }
        })
        
        console.log(`Simulated device update: Device ${randomDevice} -> ${randomStatus}`)
      }
    }, 15000)
    
    // Simulate automation events
    setInterval(() => {
      if (Math.random() > 0.8) {
        const randomAutomation = automationIds[Math.floor(Math.random() * automationIds.length)]
        const executionId = `exec-${Date.now()}`
        
        // Simulate automation started
        webSocketService.handleAutomationStarted({
          executionId,
          automationId: randomAutomation,
          automation: {
            name: `Test Automation ${randomAutomation}`,
            id: randomAutomation
          }
        })
        
        // Simulate progress updates
        setTimeout(() => {
          webSocketService.handleAutomationProgress({
            executionId,
            automationId: randomAutomation,
            progress: 50,
            currentStep: 'Processing devices',
            totalSteps: 4,
            automation: { name: `Test Automation ${randomAutomation}` }
          })
        }, 2000)
        
        // Simulate completion
        setTimeout(() => {
          const success = Math.random() > 0.3
          webSocketService.handleAutomationCompleted({
            executionId,
            automationId: randomAutomation,
            status: success ? 'success' : 'failed',
            error: success ? null : 'Simulated failure',
            duration: 5000,
            automation: { name: `Test Automation ${randomAutomation}` }
          })
        }, 5000)
        
        console.log(`Simulated automation started: ${randomAutomation}`)
      }
    }, 30000)
    
    // Simulate alerts
    setInterval(() => {
      if (Math.random() > 0.9) {
        const alertTypes = ['device', 'automation', 'system']
        const severities = ['low', 'medium', 'high']
        const alertType = alertTypes[Math.floor(Math.random() * alertTypes.length)]
        const severity = severities[Math.floor(Math.random() * severities.length)]
        
        webSocketService.handleNewAlert({
          id: `alert-${Date.now()}`,
          type: alertType,
          severity,
          title: `${alertType.charAt(0).toUpperCase() + alertType.slice(1)} Alert`,
          message: `Simulated ${severity} severity ${alertType} alert`,
          source: 'simulator'
        })
        
        console.log(`Simulated alert: ${alertType} - ${severity}`)
      }
    }, 45000)
  }

  onMounted(async () => {
    await nextTick()

    // Check if we should use real WebSocket even in dev mode
    const useRealWebSocket = import.meta.env.VITE_USE_REAL_WEBSOCKET === 'true'

    if (import.meta.env.DEV && !useRealWebSocket) {
      console.log('Development mode: simulating WebSocket events')
      simulateRealTimeUpdates()

      // Set connected to true for development simulation
      connected.value = true
    } else {
      // Use real WebSocket connection (production or dev with override)
      connect()
    }

    // Poll connection status
    const statusInterval = setInterval(updateConnectionStatus, 1000)

    onUnmounted(() => {
      clearInterval(statusInterval)
    })
  })

  onUnmounted(() => {
    disconnect()
  })

  return {
    connected,
    connecting,
    error,
    reconnectAttempts,
    connect,
    disconnect,
    emit,
    on,
    off,
    getStatus: () => webSocketService.getStatus()
  }
}