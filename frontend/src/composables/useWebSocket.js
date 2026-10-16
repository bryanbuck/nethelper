import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useAuthStore } from '@/stores/auth'
import webSocketService from '@/services/websocket.service'

// The socket is shared app-wide. Each mounted consumer holds it open; it is
// disconnected only when the last one unmounts, after a grace period so that
// navigating between two pages that both use it doesn't drop the connection
// (the old page can unmount before the new one mounts).
const RELEASE_GRACE_MS = 3000
let consumers = 0
let releaseTimer = null

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
      const wsUrl = import.meta.env.VITE_WS_URL || undefined // service defaults to same origin
      
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

  onMounted(async () => {
    consumers += 1
    clearTimeout(releaseTimer)
    await nextTick()

    connect()

    // Poll connection status
    const statusInterval = setInterval(updateConnectionStatus, 1000)

    onUnmounted(() => {
      clearInterval(statusInterval)
    })
  })

  onUnmounted(() => {
    consumers = Math.max(0, consumers - 1)
    if (consumers === 0) {
      clearTimeout(releaseTimer)
      releaseTimer = setTimeout(() => {
        if (consumers === 0) disconnect()
      }, RELEASE_GRACE_MS)
    }
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