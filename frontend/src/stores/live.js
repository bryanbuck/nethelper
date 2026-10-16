/**
 * Live device state (Live tab on the device page).
 *
 * Subscribes to one device's `device:live:<id>` room while the tab is open:
 * a port/PoE snapshot, per-port changes, and counter samples every
 * LIVE_VIEW_POLL_INTERVAL. Everything shown comes from the device; until two
 * counter samples have arrived there are no rates, and the view says so.
 *
 * The reducers below are plain functions so they can be unit tested.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import webSocketService from '@/services/websocket.service'
import deviceService from '@/services/device.service'

/** Points kept per port for sparklines (~10 minutes at the default 15s). */
export const HISTORY_POINTS = 40
export const EVENT_LIMIT = 50

export function applyPortUpdate(ports, port) {
  const index = ports.findIndex((p) => p.port === port.port)
  if (index === -1) return ports
  const next = ports.slice()
  next[index] = port
  return next
}

/** Append one metrics sample to the per-port throughput history. */
export function applyMetrics(history, metrics) {
  if (!metrics?.hasRates) return history
  const next = { ...history }
  for (const [port, sample] of Object.entries(metrics.ports || {})) {
    if (sample.rxBps == null && sample.txBps == null) continue
    const point = { at: metrics.at, bps: (sample.rxBps || 0) + (sample.txBps || 0) }
    next[port] = [...(history[port] || []), point].slice(-HISTORY_POINTS)
  }
  return next
}

/** Prepend an event for this device (newest first), ignoring duplicates. */
export function applyEvent(events, event) {
  if (event.id && events.some((e) => e.id === event.id)) return events
  return [event, ...events].slice(0, EVENT_LIMIT)
}

export const useLiveStore = defineStore('live', () => {
  const deviceId = ref(null)
  const state = ref('idle') // idle | connecting | live | error
  const error = ref(null)
  const monitor = ref({ connected: false, mode: null, lastError: null, updatedAt: null })
  const ports = ref([])
  const metrics = ref(null)
  const history = ref({})
  const events = ref([])
  const changedAt = ref({}) // port -> timestamp of last change, for a brief highlight

  const hasRates = computed(() => Boolean(metrics.value?.hasRates))

  let handlers = null

  function reset() {
    state.value = 'idle'
    error.value = null
    monitor.value = { connected: false, mode: null, lastError: null, updatedAt: null }
    ports.value = []
    metrics.value = null
    history.value = {}
    events.value = []
    changedAt.value = {}
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return
    monitor.value = {
      connected: snapshot.connected,
      mode: snapshot.mode || null,
      lastError: snapshot.lastError || null,
      updatedAt: snapshot.updatedAt || null,
    }
    ports.value = snapshot.ports || []
  }

  function bind(id) {
    const socket = webSocketService.socket
    if (!socket) return false
    handlers = {
      'device:live:snapshot': (s) => s.deviceId === id && applySnapshot(s),
      'device:live:port': ({ deviceId: d, port }) => {
        if (d !== id) return
        ports.value = applyPortUpdate(ports.value, port)
        changedAt.value = { ...changedAt.value, [port.port]: Date.now() }
      },
      'device:live:metrics': (m) => {
        if (m.deviceId !== id) return
        metrics.value = m
        history.value = applyMetrics(history.value, m)
      },
      'device:live:status': (s) => {
        if (s.deviceId !== id) return
        monitor.value = { ...monitor.value, connected: s.connected, lastError: s.lastError }
      },
      'device:event': (e) => e.deviceId === id && (events.value = applyEvent(events.value, e)),
      // Rooms don't survive a reconnect; subscribe again.
      connect: () => subscribe(id),
    }
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn)
    return true
  }

  function unbind() {
    const socket = webSocketService.socket
    if (socket && handlers) {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn)
    }
    handlers = null
  }

  async function subscribe(id) {
    try {
      const reply = await webSocketService.request('subscribe:device-live', id)
      if (deviceId.value !== id) return
      if (!reply?.ok) throw new Error(reply?.error || 'Live state is unavailable for this device')
      applySnapshot(reply.snapshot)
      state.value = 'live'
      error.value = null
    } catch (err) {
      if (deviceId.value !== id) return
      state.value = 'error'
      error.value = err.message
    }
  }

  async function loadEvents(id) {
    try {
      const response = await deviceService.getDeviceEvents(id, { limit: EVENT_LIMIT })
      if (deviceId.value === id) events.value = response.data || []
    } catch {
      // The live view still works without history.
    }
  }

  /** The shared socket connects on mount (useWebSocket); give it a moment. */
  async function socketReady(timeoutMs = 10000) {
    const started = Date.now()
    while (!(webSocketService.socket && webSocketService.connected)) {
      if (Date.now() - started > timeoutMs) return false
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return true
  }

  async function watch(id) {
    if (deviceId.value === id && state.value !== 'idle') return
    await unwatch()
    deviceId.value = id
    state.value = 'connecting'
    const ready = await socketReady()
    if (deviceId.value !== id) return
    if (!ready || !bind(id)) {
      state.value = 'error'
      error.value = 'Real-time connection is not available'
      return
    }
    await Promise.all([subscribe(id), loadEvents(id)])
  }

  async function unwatch() {
    const id = deviceId.value
    unbind()
    if (id && webSocketService.connected) webSocketService.emit('unsubscribe:device-live', id)
    deviceId.value = null
    reset()
  }

  return {
    deviceId,
    state,
    error,
    monitor,
    ports,
    metrics,
    history,
    events,
    changedAt,
    hasRates,
    watch,
    unwatch,
  }
})
