/**
 * System Status page (admins). Joins the `system:status` socket room while
 * the page is open: the ack carries a snapshot with the last hour of history,
 * then `system:status:sample` arrives every SYSTEM_SAMPLE_INTERVAL_MS and
 * `system:status:slow` about once a minute. Without the socket the page
 * polls the HTTP snapshot instead. History lives on the server; nothing here
 * is invented.
 *
 * The reducers below are plain functions so they can be unit tested.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import webSocketService from '@/services/websocket.service'
import systemService from '@/services/system.service'

const DEFAULT_WINDOW_MS = 60 * 60 * 1000
const POLL_MS = 15000

/** The chart numbers of one sample (mirrors SystemStatusService.compact). */
export function compactSample(sample) {
  return {
    at: sample.at,
    cpu: sample.process?.cpuPercent ?? null,
    rss: sample.process?.rss ?? null,
    heapUsed: sample.process?.heapUsed ?? null,
    loopP99: sample.eventLoop?.p99Ms ?? null,
    requests: sample.http?.requests ?? null,
    errors: sample.http?.status5xx ?? null,
    sockets: sample.sockets?.error ? null : sample.sockets?.connections ?? null,
    backlog: sample.queueBacklog ?? null,
    intervalMs: sample.intervalMs,
  }
}

/** Append a sample, dropping points older than the window; ignores repeats. */
export function appendSample(history, sample, windowMs = DEFAULT_WINDOW_MS) {
  const last = history[history.length - 1]
  if (last && last.at === sample.at) return history
  const cutoff = new Date(sample.at).getTime() - windowMs
  return [...history, compactSample(sample)].filter((p) => new Date(p.at).getTime() > cutoff)
}

export const useSystemStore = defineStore('system', () => {
  const info = ref(null) // { version, node, startedAt, intervalMs, historyWindowMs }
  const current = ref(null)
  const slow = ref(null)
  const history = ref([])
  const mode = ref('idle') // idle | loading | live | polling | error
  const error = ref(null)

  const ready = computed(() => Boolean(current.value))

  let handlers = null
  let pollTimer = null
  let active = false

  function applySnapshot(snapshot) {
    if (!snapshot) return
    const { current: latest, slow: slowSample, history: points, ...rest } = snapshot
    info.value = rest
    current.value = latest || null
    slow.value = slowSample || null
    history.value = points || []
  }

  function onSample(sample) {
    current.value = sample
    history.value = appendSample(history.value, sample, info.value?.historyWindowMs)
  }

  async function loadHttp() {
    try {
      applySnapshot(await systemService.getStatus())
      error.value = null
    } catch (err) {
      error.value = err.message
      if (!current.value) mode.value = 'error'
    }
  }

  // Poll over HTTP until the socket is up, then move to it.
  async function pollTick() {
    if (webSocketService.socket && webSocketService.connected) {
      bind()
      await subscribeSocket()
      return
    }
    await loadHttp()
  }

  function startPolling() {
    if (pollTimer) return
    mode.value = 'polling'
    pollTimer = setInterval(pollTick, POLL_MS)
  }

  function stopPolling() {
    clearInterval(pollTimer)
    pollTimer = null
  }

  async function subscribeSocket() {
    try {
      const reply = await webSocketService.request('subscribe:system-status', null)
      if (!active) return
      if (!reply?.ok) throw new Error(reply?.error || 'System status is unavailable')
      stopPolling()
      applySnapshot(reply.snapshot)
      mode.value = 'live'
      error.value = null
    } catch (err) {
      if (!active) return
      error.value = err.message
      startPolling()
    }
  }

  function bind() {
    const socket = webSocketService.socket
    if (!socket || handlers) return
    handlers = {
      'system:status:sample': onSample,
      'system:status:slow': (s) => { slow.value = s },
      // Rooms don't survive a reconnect; subscribe again.
      connect: () => subscribeSocket(),
      disconnect: () => active && startPolling(),
    }
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn)
  }

  function unbind() {
    const socket = webSocketService.socket
    if (socket && handlers) {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn)
    }
    handlers = null
  }

  async function watch() {
    if (active) return
    active = true
    mode.value = 'loading'
    error.value = null
    if (webSocketService.socket && webSocketService.connected) {
      bind()
      await subscribeSocket()
    } else {
      // The shared socket may still be connecting; poll until it does.
      await loadHttp()
      if (active) startPolling()
    }
  }

  function unwatch() {
    active = false
    stopPolling()
    unbind()
    if (webSocketService.connected) webSocketService.emit('unsubscribe:system-status')
    mode.value = 'idle'
  }

  return { info, current, slow, history, mode, error, ready, watch, unwatch, refresh: loadHttp }
})
