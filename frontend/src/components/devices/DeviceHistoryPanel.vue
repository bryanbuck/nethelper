<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex flex-wrap align-center ga-2">
      <v-icon>mdi-timeline-clock-outline</v-icon>
      <span>History</span>
      <v-spacer />
      <v-btn-toggle v-model="range" mandatory density="compact" variant="outlined" divided>
        <v-btn v-for="r in RANGES" :key="r.value" :value="r.value" size="small">{{ xs ? r.short : r.label }}</v-btn>
      </v-btn-toggle>
      <v-btn icon="mdi-refresh" variant="text" size="small" :loading="loading" aria-label="Refresh" @click="load()" />
    </v-card-title>

    <v-card-subtitle class="pb-2 history-subtitle">
      How each point of view saw this device. Ping states are recorded since 22 Oct 2026, and events are kept
      for a limited time, so earlier time shows as no data.
    </v-card-subtitle>

    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

      <div v-if="history" class="history-chart" @mouseleave="hover = null">
        <!-- One row per lane; markers span every row -->
        <div v-for="lane in history.lanes" :key="lane.key" class="history-row">
          <div class="history-label">
            <v-icon size="small" :icon="LANE_ICONS[lane.key] || 'mdi-cloud-outline'" class="mr-1" />
            {{ laneLabel(lane) }}
          </div>
          <div class="history-track">
            <div
              v-for="(seg, i) in lane.segments"
              :key="i"
              class="history-segment"
              :class="[`state-${seg.state}`, lane.key === 'combined' && 'combined']"
              :style="span(seg.from, seg.to)"
              @mousemove="hover = { x: $event.clientX, y: $event.clientY, lines: segmentLines(lane, seg) }"
            />
          </div>
        </div>

        <!-- Config: backups as points, a detected change as the window it happened in -->
        <div class="history-row">
          <div class="history-label">
            <v-icon size="small" icon="mdi-file-cog-outline" class="mr-1" />
            Config
          </div>
          <div class="history-track config-track">
            <div
              v-for="m in changeWindows"
              :key="`w-${m.id}`"
              class="history-change-window"
              :style="span(m.changedSince, m.at)"
              @mousemove="hover = { x: $event.clientX, y: $event.clientY, lines: changeWindowLines(m) }"
            />
          </div>
        </div>

        <div class="history-axis">
          <div class="history-label" />
          <div class="history-track axis-track">
            <span v-for="tick in ticks" :key="tick.t" class="history-tick" :style="{ left: `${tick.pct}%` }">
              {{ tick.label }}
            </span>
          </div>
        </div>

        <!-- Point-in-time markers across all lanes -->
        <div class="history-markers">
          <div class="history-label" />
          <div class="history-track marker-track">
            <div
              v-for="(m, i) in history.markers"
              :key="i"
              class="history-marker"
              :class="markerClass(m)"
              :style="{ left: `${pct(m.at)}%` }"
              @mousemove="hover = { x: $event.clientX, y: $event.clientY, lines: markerLines(m) }"
            >
              <v-icon size="x-small" class="history-marker-icon" :icon="markerIcon(m)" />
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loading" class="text-center py-8">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <!-- Legend -->
      <div v-if="history" class="d-flex flex-wrap align-center ga-4 mt-4 text-caption text-medium-emphasis">
        <span class="legend"><i class="swatch state-online" /> Online</span>
        <span class="legend"><i class="swatch state-offline" /> Offline</span>
        <span v-if="hasCombined" class="legend"><i class="swatch state-warning" /> They disagree</span>
        <span class="legend"><i class="swatch state-unknown" /> No data</span>
        <span class="legend"><i class="line backup" /> Backup</span>
        <span class="legend"><i class="line backup-changed" /> Backup found a change</span>
        <span class="legend"><i class="swatch change-window" /> Config changed in here</span>
        <span class="legend"><i class="line restart" /> Restart</span>
      </div>

      <!-- Totals for the window -->
      <div v-if="totals.length" class="d-flex flex-wrap ga-2 mt-4">
        <v-chip v-for="t in totals" :key="t.label" size="small" variant="tonal" :color="t.color">
          {{ t.label }}: {{ t.value }}
        </v-chip>
      </div>
    </v-card-text>

    <div
      v-if="hover"
      class="history-tooltip"
      :style="tooltipStyle"
    >
      <div v-for="(line, i) in hover.lines" :key="i" :class="i === 0 && 'font-weight-medium'">{{ line }}</div>
    </div>
  </v-card>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useDisplay } from 'vuetify'
import { format, formatDistanceStrict } from 'date-fns'
import deviceService from '@/services/device.service'
import { useWebSocket } from '@/composables/useWebSocket'

const props = defineProps({
  device: { type: Object, required: true }
})

// `short` on a phone, so the toggle fits beside the title.
const RANGES = [
  { value: '24h', label: '24 h', short: '24h' },
  { value: '7d', label: '7 days', short: '7d' },
  { value: '30d', label: '30 days', short: '30d' },
]
const LANE_ICONS = { ping: 'mdi-lan-connect', cloud: 'mdi-cloud-outline', combined: 'mdi-set-center' }
const STATE_LABELS = { online: 'Online', offline: 'Offline', warning: 'Warning', maintenance: 'Maintenance', unknown: 'No data' }

const range = ref('24h')
const history = ref(null)
const loading = ref(false)
const error = ref(null)
const hover = ref(null)
const { xs, width: viewportWidth } = useDisplay()
// Beside the pointer, but never past the right edge (a tap near it on a phone).
const tooltipStyle = computed(() => hover.value && {
  left: `${Math.max(8, Math.min(hover.value.x + 12, viewportWidth.value - 328))}px`,
  top: `${hover.value.y + 12}px`
})

// The range the shown history was loaded for: labels follow the data, not
// the toggle, while a new range loads.
const loadedRange = ref(range.value)
const lastLoaded = ref(0)

// Only the newest request's reply is shown: switching 30 days → 24 h quickly
// (or a socket reload racing a range change) must not draw the slower reply.
let requestSeq = 0
const load = async () => {
  const seq = ++requestSeq
  const requested = range.value
  loading.value = true
  error.value = null
  try {
    const data = await deviceService.getDeviceHistory(props.device.id, { range: requested })
    if (seq !== requestSeq) return
    history.value = data
    loadedRange.value = requested
    lastLoaded.value = Date.now()
  } catch (err) {
    if (seq === requestSeq) error.value = err.userMessage || err.message || 'Failed to load history'
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

watch(range, load)
watch(() => props.device.id, load)
onMounted(load)

// The window ends at load time, so reload every few minutes while the page is
// visible (and on return to a tab hidden that long) to keep "now" at the right edge.
const REFRESH_MS = 5 * 60 * 1000
const refreshIfStale = () => {
  if (document.visibilityState === 'visible' && !loading.value && Date.now() - lastLoaded.value >= REFRESH_MS) load()
}
const refreshTimer = setInterval(refreshIfStale, REFRESH_MS)
document.addEventListener('visibilitychange', refreshIfStale)

// New states and backups arrive over the socket; reload (debounced) so the
// lanes stay current while the tab is open.
const { on: onSocket, off: offSocket } = useWebSocket()
let reloadTimer = null
const reloadSoon = () => {
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(load, 2000)
}
const onDeviceEvent = (e) => {
  if (e?.deviceId === props.device.id && /^(ping|cloud)\.|^device\.restarted$/.test(e.type)) reloadSoon()
}
const onBackup = (e) => {
  if (e?.deviceId === props.device.id) reloadSoon()
}
onSocket('device:event', onDeviceEvent)
onSocket('backup:completed', onBackup)
onSocket('backup:failed', onBackup)
onUnmounted(() => {
  clearTimeout(reloadTimer)
  clearInterval(refreshTimer)
  document.removeEventListener('visibilitychange', refreshIfStale)
  offSocket('device:event', onDeviceEvent)
  offSocket('backup:completed', onBackup)
  offSocket('backup:failed', onBackup)
})

const start = computed(() => new Date(history.value?.from).getTime())
const end = computed(() => new Date(history.value?.to).getTime())
const pct = (t) => {
  const v = ((new Date(t).getTime() - start.value) / (end.value - start.value)) * 100
  return Math.min(100, Math.max(0, v))
}
const span = (from, to) => {
  const left = pct(from)
  return { left: `${left}%`, width: `${Math.max(pct(to) - left, 0.15)}%` }
}

const hasCombined = computed(() => history.value?.lanes.some((l) => l.key === 'combined'))
const cloudLane = computed(() => history.value?.lanes.find((l) => l.key === 'cloud'))
const laneLabel = (lane) => (lane.key === 'combined' ? 'Both agree?' : lane.label)

const fmt = (t) => format(new Date(t), loadedRange.value === '24h' ? 'HH:mm' : 'MMM d, HH:mm')
const duration = (from, to) => formatDistanceStrict(new Date(from), new Date(to))

const segmentLines = (lane, seg) => {
  const when = `${fmt(seg.from)} – ${fmt(seg.to)} (${duration(seg.from, seg.to)})`
  if (lane.key === 'combined') {
    const cloud = cloudLane.value?.label || 'The cloud'
    if (seg.reason === 'ping-only') return [`Answers ping, ${cloud} says offline`, when, 'The address may belong to another device.']
    if (seg.reason === 'cloud-only') return [`${cloud} sees it, ping doesn't`, when, 'Up, but NetHelper can\'t reach it.']
    if (seg.state === 'unknown') return ['No data', when]
    return [seg.state === 'online' ? 'Both see it online' : 'Both see it offline', when]
  }
  return [`${lane.label}: ${STATE_LABELS[seg.state] || seg.state}`, when]
}

const changeWindows = computed(() =>
  (history.value?.markers || []).filter((m) => m.kind === 'backup' && m.changed && m.changedSince)
)
const changeWindowLines = (m) => [
  'Config changed on the device',
  `Some time between ${fmt(m.changedSince)} and ${fmt(m.at)}`,
  'Found by comparing two backups; who changed it is not known.',
]

const markerClass = (m) => {
  if (m.kind === 'restart') return 'restart'
  if (m.status === 'failed') return 'backup-failed'
  return m.changed ? 'backup-changed' : 'backup'
}
const markerIcon = (m) => {
  if (m.kind === 'restart') return 'mdi-restart'
  if (m.status === 'failed') return 'mdi-alert-circle'
  return m.changed ? 'mdi-file-document-edit' : 'mdi-content-save'
}
const markerLines = (m) => {
  if (m.kind === 'restart') {
    return ['Restarted', fmt(m.at), ...(m.source === 'cloud' ? [`Reported by ${cloudLane.value?.label || 'the cloud'}`] : [])]
  }
  const lines = [`${m.trigger === 'manual' ? 'Manual' : 'Scheduled'} backup`, fmt(m.at)]
  if (m.status === 'failed') lines.push(`Failed: ${m.error || 'unknown error'}`)
  else if (m.changed) lines.push('Config changed since the previous backup')
  else lines.push('No change')
  if (m.warning) lines.push(m.warning)
  return lines
}

const ticks = computed(() => {
  if (!history.value) return []
  // Fewer labels on a phone's narrow track, or they overlap.
  const count = xs.value ? 3 : 6
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = start.value + ((end.value - start.value) * i) / count
    return { t, pct: (i / count) * 100, label: fmt(t) }
  })
})

// Time spent in each notable state in the window.
const totals = computed(() => {
  if (!history.value) return []
  const sum = (lane, test) => (lane?.segments || [])
    .filter(test)
    .reduce((ms, s) => ms + (new Date(s.to) - new Date(s.from)), 0)
  const human = (ms) => (ms ? formatDistanceStrict(0, ms) : 'none')
  const out = []
  const ping = history.value.lanes.find((l) => l.key === 'ping')
  const combined = history.value.lanes.find((l) => l.key === 'combined')
  out.push({ label: 'No ping reply', value: human(sum(ping, (s) => s.state === 'offline')), color: 'error' })
  if (combined) {
    const cloud = cloudLane.value?.label || 'cloud'
    out.push({ label: `Ping only (${cloud} offline)`, value: human(sum(combined, (s) => s.reason === 'ping-only')), color: 'warning' })
    out.push({ label: `${cloud} only (no ping)`, value: human(sum(combined, (s) => s.reason === 'cloud-only')), color: 'warning' })
  }
  const changes = changeWindows.value.length
  out.push({ label: 'Config changes found', value: String(changes), color: changes ? 'primary' : undefined })
  return out
})
</script>

<style scoped>
.history-subtitle {
  white-space: normal;
}
.history-chart {
  position: relative;
}
.history-row,
.history-axis,
.history-markers {
  display: flex;
  align-items: center;
}
.history-markers {
  position: absolute;
  inset: 16px 0 28px 0;
  pointer-events: none;
}
.history-label {
  flex: 0 0 150px;
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 8px;
}
.history-track {
  position: relative;
  flex: 1 1 auto;
  height: 28px;
  margin: 4px 0;
}
.history-row .history-track {
  border-radius: 4px;
  overflow: hidden;
  background: rgba(var(--v-border-color), var(--v-border-opacity));
}
.marker-track {
  height: 100%;
  margin: 0;
}
.axis-track {
  height: 20px;
}
.history-tick {
  position: absolute;
  transform: translateX(-50%);
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  white-space: nowrap;
}
.history-tick:first-child {
  transform: none;
}
.history-tick:last-child {
  transform: translateX(-100%);
}
.history-segment {
  position: absolute;
  top: 0;
  bottom: 0;
}
.history-segment.combined {
  top: 6px;
  bottom: 6px;
}
.state-online {
  background: rgb(var(--v-theme-success));
}
.state-offline {
  background: rgb(var(--v-theme-error));
}
.state-warning {
  background: rgb(var(--v-theme-warning));
}
.state-maintenance {
  background: rgba(var(--v-theme-on-surface), 0.4);
}
.state-unknown {
  background: repeating-linear-gradient(
    135deg,
    transparent 0 6px,
    rgba(var(--v-theme-on-surface), 0.12) 6px 12px
  );
}
.config-track {
  background: transparent !important;
  border: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));
}
.history-change-window,
.swatch.change-window {
  background: rgba(var(--v-theme-primary), 0.25);
  border-left: 2px solid rgb(var(--v-theme-primary));
  border-right: 2px solid rgb(var(--v-theme-primary));
}
.history-change-window {
  position: absolute;
  top: 0;
  bottom: 0;
}
.history-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px dashed rgba(var(--v-theme-on-surface), 0.45);
  pointer-events: auto;
  cursor: default;
}
.history-marker::after {
  /* a wider invisible hit area */
  content: '';
  position: absolute;
  inset: 0 -5px;
}
.history-marker-icon {
  position: absolute;
  top: -14px;
  left: -8px;
}
.history-marker.backup-changed {
  border-left: 2px solid rgb(var(--v-theme-primary));
}
.history-marker.backup-changed .history-marker-icon {
  color: rgb(var(--v-theme-primary-text));
}
.history-marker.backup-failed {
  border-left-color: rgb(var(--v-theme-error));
}
.history-marker.backup-failed .history-marker-icon {
  color: rgb(var(--v-theme-error));
}
.history-marker.restart {
  border-left: 2px dotted rgb(var(--v-theme-warning));
}
.history-marker.restart .history-marker-icon {
  color: rgb(var(--v-theme-warning-text));
}
.history-chart {
  padding-top: 16px;
}
.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
.line {
  display: inline-block;
  width: 0;
  height: 12px;
  border-left: 2px dashed rgba(var(--v-theme-on-surface), 0.45);
}
.line.backup-changed {
  border-left: 2px solid rgb(var(--v-theme-primary));
}
.line.restart {
  border-left: 2px dotted rgb(var(--v-theme-warning));
}
.history-tooltip {
  position: fixed;
  z-index: 2000;
  max-width: min(320px, calc(100vw - 16px));
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 0.8125rem;
  pointer-events: none;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
@media (max-width: 599.98px) {
  .history-label {
    flex-basis: 90px;
    font-size: 0.75rem;
    line-height: 1.15;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
</style>
