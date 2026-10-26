<template>
  <div>
    <v-container fluid class="pa-4">
      <!-- Header -->
      <div class="d-flex align-center flex-wrap mb-4 ga-2">
        <div>
          <h1 class="text-h4 font-weight-bold">System Status</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            How this NetHelper server is doing. Charts cover the last hour the server has kept in memory.
          </p>
        </div>
        <v-spacer />
        <v-chip :color="modeChip.color" size="small" variant="tonal" :prepend-icon="modeChip.icon">
          {{ modeChip.label }}
        </v-chip>
        <span v-if="current" class="text-caption text-medium-emphasis" :title="fullTime(current.at)">
          sampled {{ ago(current.at) }}
        </span>
      </div>

      <v-alert v-if="store.error" type="warning" variant="tonal" density="compact" class="mb-4">
        {{ store.error }}<template v-if="store.mode === 'polling'"> · refreshing over HTTP every 15 s</template>
      </v-alert>

      <div v-if="!store.ready && store.mode !== 'error'" class="d-flex justify-center py-12">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <template v-else-if="store.ready">
        <!-- Identity -->
        <div class="identity text-body-2 mb-4">
          <span><strong>NetHelper</strong> {{ info?.version }}</span>
          <span><strong>Node</strong> {{ info?.node }}</span>
          <span><strong>Up</strong> {{ formatDuration(current.process.uptimeSec) }}</span>
          <span :title="fullTime(info?.startedAt)"><strong>Started</strong> {{ shortTime(info?.startedAt) }}</span>
          <span><strong>Host</strong> {{ current.host.hostname }} · {{ current.host.platform }}</span>
          <span><strong>PID</strong> {{ current.process.pid }}</span>
        </div>

        <!-- Tiles -->
        <v-row dense class="mb-2">
          <v-col v-for="tile in tiles" :key="tile.key" cols="12" sm="6" md="4" xl="2">
            <v-card variant="outlined" class="tile">
              <div class="text-caption text-medium-emphasis">{{ tile.label }}</div>
              <div class="d-flex flex-wrap align-baseline ga-2">
                <span class="text-h5 font-weight-medium">{{ tile.value }}</span>
                <span v-if="tile.detail" class="text-caption text-medium-emphasis">{{ tile.detail }}</span>
              </div>
              <div class="d-flex flex-wrap align-center ga-2">
                <LiveSparkline
                  :points="tile.points"
                  :value-key="tile.key"
                  :format="tile.format"
                  :label="tile.label"
                  :width="200"
                  :height="32"
                />
                <span
                  v-if="tile.peak"
                  class="peak text-subtitle-1"
                  :title="`Highest in the last hour, at ${shortClock(tile.peak.at)}`"
                >
                  peak <span class="font-weight-medium">{{ tile.format(tile.peak.value) }}</span>
                </span>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <v-row dense>
          <!-- Queues -->
          <v-col cols="12" lg="7">
            <v-card variant="outlined" class="h-100">
              <v-card-title class="text-subtitle-1">Job queues</v-card-title>
              <SectionError :value="current.queues" />
              <v-table v-if="Array.isArray(current.queues)" density="compact" class="table-stack">
                <thead>
                  <tr>
                    <th>Queue</th>
                    <th class="text-end">Waiting</th>
                    <th class="text-end">Active</th>
                    <th class="text-end">Delayed</th>
                    <th class="text-end">Failed</th>
                    <th class="text-end" title="Jobs this process finished in the last interval, per minute">Done/min</th>
                    <th>Next scheduled</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="q in current.queues" :key="q.name">
                    <td>
                      {{ queueLabel(q.name) }}
                      <v-chip v-if="q.paused" size="x-small" color="warning" variant="tonal" class="ml-1">paused</v-chip>
                    </td>
                    <template v-if="q.error">
                      <td colspan="5" class="text-error" data-label="Error">{{ q.error }}</td>
                    </template>
                    <template v-else>
                      <td class="text-end" data-label="Waiting">{{ formatNumber(q.waiting) }}</td>
                      <td class="text-end" data-label="Active">{{ formatNumber(q.active) }}</td>
                      <td class="text-end" data-label="Delayed">{{ formatNumber(q.delayed) }}</td>
                      <td class="text-end" :class="{ 'text-error': q.failed }" data-label="Failed">{{ formatNumber(q.failed) }}</td>
                      <td class="text-end" data-label="Done/min">
                        {{ rate(q.completedInInterval) }}
                        <span v-if="q.failedInInterval" class="text-error">· {{ rate(q.failedInInterval) }} failed</span>
                      </td>
                    </template>
                    <td class="text-no-wrap" data-label="Next scheduled">{{ nextRun(q.name) }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
          </v-col>

          <!-- Process & host -->
          <v-col cols="12" lg="5">
            <v-card variant="outlined" class="h-100">
              <v-card-title class="text-subtitle-1">Process &amp; host</v-card-title>
              <v-card-text>
                <dl class="facts">
                  <dt>Heap</dt><dd>{{ formatBytes(current.process.heapUsed) }} of {{ formatBytes(current.process.heapTotal) }}</dd>
                  <dt>External</dt><dd>{{ formatBytes(current.process.external) }}</dd>
                  <dt>Event loop</dt><dd>p50 {{ formatMs(current.eventLoop.p50Ms) }} · p99 {{ formatMs(current.eventLoop.p99Ms) }} · max {{ formatMs(current.eventLoop.maxMs) }}</dd>
                  <dt>Requests</dt><dd>{{ httpLine }}</dd>
                  <dt>Load</dt><dd>{{ current.host.load1.toFixed(2) }} · {{ current.host.load5.toFixed(2) }} · {{ current.host.load15.toFixed(2) }} on {{ current.host.cpus }} CPUs</dd>
                  <dt>Host memory</dt><dd>{{ formatBytes(current.host.totalMem - current.host.freeMem) }} of {{ formatBytes(current.host.totalMem) }} used ({{ formatPercent(share(current.host.totalMem - current.host.freeMem, current.host.totalMem)) }})</dd>
                  <dt>Host up</dt><dd>{{ formatDuration(current.host.uptimeSec) }}</dd>
                </dl>
                <template v-if="storage && !storage.error">
                  <div class="text-overline mt-2">Storage</div>
                  <dl class="facts">
                    <template v-for="v in storage.volumes" :key="v.label">
                      <dt :title="v.path">{{ v.label }}</dt>
                      <dd v-if="v.error" class="text-medium-emphasis">{{ v.error }}</dd>
                      <dd v-else>
                        {{ formatBytes(v.free) }} free of {{ formatBytes(v.total) }}
                        <v-progress-linear
                          :model-value="share(v.total - v.free, v.total)"
                          :color="share(v.total - v.free, v.total) > 90 ? 'error' : 'primary'"
                          height="4"
                          rounded
                          class="mt-1"
                        />
                      </dd>
                    </template>
                    <dt>Config backups</dt><dd>{{ formatBytes(storage.configBackupBytes) }} in {{ formatNumber(storage.configBackupFiles) }} files</dd>
                    <dt>Scope backups</dt><dd>{{ formatBytes(storage.scopeBackupBytes) }} in {{ formatNumber(storage.scopeBackups) }}</dd>
                  </dl>
                </template>
                <SectionError :value="storage" />
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Database -->
          <v-col cols="12" md="6" lg="4">
            <v-card variant="outlined" class="h-100">
              <v-card-title class="text-subtitle-1">PostgreSQL</v-card-title>
              <v-card-text>
                <SectionError :value="database" />
                <template v-if="database && !database.error">
                  <dl class="facts">
                    <dt>Size</dt><dd>{{ formatBytes(database.size) }}</dd>
                    <dt>Connections</dt><dd>{{ database.connections }} ({{ database.activeConnections }} active) of {{ database.maxConnections }}</dd>
                    <dt>Version</dt><dd>{{ database.version }}</dd>
                  </dl>
                  <v-table density="compact" class="table-stack mt-2">
                    <thead><tr><th>Largest tables</th><th class="text-end">Size</th><th class="text-end">~Rows</th></tr></thead>
                    <tbody>
                      <tr v-for="t in database.tables" :key="t.name">
                        <td>{{ t.name }}</td>
                        <td class="text-end" data-label="Size">{{ formatBytes(t.bytes) }}</td>
                        <td class="text-end" data-label="~Rows">{{ t.rows == null ? '—' : formatNumber(t.rows) }}</td>
                      </tr>
                    </tbody>
                  </v-table>
                </template>
                <div v-if="!slow" class="text-medium-emphasis">Reading…</div>
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Redis -->
          <v-col cols="12" md="6" lg="4">
            <v-card variant="outlined" class="h-100">
              <v-card-title class="text-subtitle-1">Redis</v-card-title>
              <v-card-text>
                <SectionError :value="redis" />
                <dl v-if="redis && !redis.error" class="facts">
                  <dt>Memory</dt><dd>{{ formatBytes(redis.usedMemory) }} (peak {{ formatBytes(redis.peakMemory) }})<template v-if="redis.maxMemory"> of {{ formatBytes(redis.maxMemory) }}</template></dd>
                  <dt>Clients</dt><dd>{{ formatNumber(redis.clients) }}</dd>
                  <dt>Ops/s</dt><dd>{{ formatNumber(redis.opsPerSec) }}</dd>
                  <dt>Version</dt><dd>{{ redis.version }}</dd>
                  <dt>Up</dt><dd>{{ formatDuration(redis.uptimeSec) }}</dd>
                </dl>
                <div v-if="!slow" class="text-medium-emphasis">Reading…</div>
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Subsystems -->
          <v-col cols="12" md="6" lg="4">
            <v-card variant="outlined" class="h-100">
              <v-card-title class="text-subtitle-1">Real-time &amp; monitors</v-card-title>
              <v-card-text>
                <dl class="facts">
                  <template v-if="!current.sockets.error">
                    <dt>Sockets</dt><dd>{{ current.sockets.connections }} from {{ current.sockets.users }} user(s)</dd>
                    <dt>Watching this page</dt><dd>{{ current.sockets.watchers }}</dd>
                  </template>
                  <template v-if="subsystems && !subsystems.error">
                    <dt>Live monitor</dt>
                    <dd v-if="!subsystems.liveMonitor.enabled" class="text-medium-emphasis">Disabled</dd>
                    <dd v-else>
                      {{ subsystems.liveMonitor.connected }} of {{ subsystems.liveMonitor.monitors }} connected
                      · {{ subsystems.liveMonitor.always }} always-on · limit {{ subsystems.liveMonitor.limit }}
                    </dd>
                    <dt>Live tabs</dt><dd>{{ subsystems.liveView.devices }} device(s), {{ subsystems.liveView.viewers }} viewer(s)</dd>
                    <dt>Alert settles</dt><dd>{{ subsystems.alertSettles }} pending</dd>
                  </template>
                </dl>
                <SectionError :value="current.sockets" />
                <SectionError :value="subsystems" />
                <template v-if="subsystems && !subsystems.error">
                  <div class="text-overline mt-2">Cloud event streams</div>
                  <div v-if="!subsystems.cloudStreams.enabled" class="text-medium-emphasis">Disabled (CLOUD_STREAM_ENABLED)</div>
                  <div v-else-if="!subsystems.cloudStreams.streams.length" class="text-medium-emphasis">None open</div>
                  <div v-for="s in subsystems.cloudStreams.streams" :key="s.integrationId" class="d-flex flex-wrap align-center ga-2 py-1">
                    <v-chip :color="STREAM_STATE_COLORS[s.state] || 'grey'" size="x-small" variant="tonal">{{ s.state }}</v-chip>
                    <span class="text-body-2">{{ s.label }}</span>
                    <v-spacer />
                    <span class="text-caption text-medium-emphasis" :title="s.lastError || ''">
                      {{ s.devices }} devices<template v-if="s.lastMessageAt"> · {{ ago(s.lastMessageAt) }}</template>
                    </span>
                  </div>
                </template>
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Usage -->
          <v-col cols="12">
            <v-card variant="outlined">
              <v-card-title class="text-subtitle-1">Usage</v-card-title>
              <v-card-text>
                <SectionError :value="usage" />
                <div v-if="!slow" class="text-medium-emphasis">Reading…</div>
                <v-row v-if="usage && !usage.error" dense>
                  <v-col cols="12" sm="6" md="3">
                    <div class="text-overline">Devices</div>
                    <div class="text-h5">{{ formatNumber(usage.devices.total) }}</div>
                    <div class="text-body-2">
                      <span class="text-success">{{ usage.devices.online }} online</span> ·
                      <span class="text-error">{{ usage.devices.offline }} offline</span> ·
                      <span class="text-warning">{{ usage.devices.warning }} warning</span>
                    </div>
                    <div class="text-caption text-medium-emphasis">{{ vendorLine }}</div>
                  </v-col>
                  <v-col cols="12" sm="6" md="3">
                    <div class="text-overline">Users</div>
                    <div class="text-h5">{{ formatNumber(sum(usage.users)) }}</div>
                    <div class="text-body-2">{{ countsLine(usage.users) }}</div>
                    <div class="text-caption text-medium-emphasis">{{ usage.automations }} automation(s)</div>
                  </v-col>
                  <v-col cols="12" sm="6" md="3">
                    <div class="text-overline">Unresolved alerts</div>
                    <div class="text-h5">{{ formatNumber((usage.alerts.open || 0) + (usage.alerts.acknowledged || 0)) }}</div>
                    <div class="text-body-2">{{ usage.alerts.open || 0 }} open · {{ usage.alerts.acknowledged || 0 }} acknowledged</div>
                    <router-link to="/alerts" class="text-caption">View alerts</router-link>
                  </v-col>
                  <v-col cols="12" sm="6" md="3">
                    <div class="text-overline">Last 24 hours</div>
                    <div class="text-body-2">Automation runs: {{ countsLine(usage.last24h.executions) || 'none' }}</div>
                    <div class="text-body-2">Config backups: {{ countsLine(usage.last24h.backups) || 'none' }}</div>
                    <div class="text-body-2">Device events: {{ formatNumber(usage.last24h.deviceEvents) }}</div>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </template>
    </v-container>
  </div>
</template>

<script setup>
import { computed, h, ref, onMounted, onBeforeUnmount } from 'vue'
import { useSystemStore } from '@/stores/system'
import { useWebSocket } from '@/composables/useWebSocket'
import LiveSparkline from '@/components/devices/LiveSparkline.vue'
import {
  formatBytes, formatDuration, formatNumber, formatPercent, formatMs,
  perMinute, peakOf, share, queueLabel, STREAM_STATE_COLORS
} from '@/models/system'

useWebSocket()
const store = useSystemStore()

const info = computed(() => store.info)
const current = computed(() => store.current)
const slow = computed(() => store.slow)
const database = computed(() => slow.value?.database)
const redis = computed(() => slow.value?.redis)
const storage = computed(() => slow.value?.storage)
const usage = computed(() => slow.value?.usage)
const subsystems = computed(() => slow.value?.subsystems)

// A section whose source failed shows why, in place of its numbers.
const SectionError = (props) => props.value?.error
  ? h('div', { class: 'text-error text-body-2 px-4 pb-2' }, `Unavailable: ${props.value.error}`)
  : null
SectionError.props = ['value']

const MODE_CHIPS = {
  live: { label: 'Live', color: 'success', icon: 'mdi-access-point' },
  polling: { label: 'Polling', color: 'warning', icon: 'mdi-refresh' },
  loading: { label: 'Connecting', color: 'info', icon: 'mdi-timer-sand' },
  error: { label: 'Unavailable', color: 'error', icon: 'mdi-alert-circle' },
  idle: { label: 'Idle', color: 'grey', icon: 'mdi-pause' }
}
const modeChip = computed(() => MODE_CHIPS[store.mode] || MODE_CHIPS.idle)

const intervalMs = computed(() => current.value?.intervalMs || info.value?.intervalMs || 5000)
const rate = (count) => {
  const value = perMinute(count, intervalMs.value)
  return value == null ? '—' : (value >= 10 ? Math.round(value) : value.toFixed(1))
}

const tiles = computed(() => {
  const c = current.value
  const points = store.history
  const perMin = (p) => perMinute(p, intervalMs.value)
  return [
    { key: 'cpu', label: 'CPU (of one core)', value: formatPercent(c.process.cpuPercent, 1), points, format: (v) => formatPercent(v, 1) },
    { key: 'rss', label: 'Memory (RSS)', value: formatBytes(c.process.rss), detail: `heap ${formatBytes(c.process.heapUsed)}`, points, format: formatBytes },
    { key: 'loopP99', label: 'Event-loop lag p99', value: formatMs(c.eventLoop.p99Ms), points, format: formatMs },
    {
      key: 'rpm',
      label: 'API requests / min',
      value: rate(c.http.requests),
      detail: c.http.status5xx ? `${c.http.status5xx} errors` : (c.http.p95Ms != null ? `p95 ${formatMs(c.http.p95Ms)}` : ''),
      points: points.map((p) => ({ at: p.at, rpm: perMin(p.requests) })),
      format: (v) => `${Math.round(v)}/min`
    },
    {
      key: 'sockets',
      label: 'Connected sockets',
      value: c.sockets.error ? '—' : formatNumber(c.sockets.connections),
      detail: c.sockets.error ? '' : `${c.sockets.users} user(s)`,
      points,
      format: formatNumber
    },
    { key: 'backlog', label: 'Queue backlog', value: formatNumber(c.queueBacklog), detail: 'waiting + active + delayed', points, format: formatNumber }
  ].map((tile) => ({ ...tile, peak: peakOf(tile.points, tile.key) }))
})

const httpLine = computed(() => {
  const http = current.value.http
  const parts = [`${rate(http.requests)}/min`]
  if (http.p50Ms != null) parts.push(`p50 ${formatMs(http.p50Ms)}`, `p95 ${formatMs(http.p95Ms)}`)
  parts.push(`${http.status4xx} 4xx`, `${http.status5xx} 5xx`)
  if (http.rateLimited) parts.push(`${http.rateLimited} rate-limited`)
  return `${parts.join(' · ')} (last ${Math.round(intervalMs.value / 1000)} s)`
})

const sum = (counts) => Object.values(counts || {}).reduce((a, b) => a + b, 0)
const countsLine = (counts) => Object.entries(counts || {}).map(([k, n]) => `${n} ${k}`).join(' · ')
const vendorLine = computed(() => countsLine(usage.value?.devices?.byVendor))

function nextRun(name) {
  const schedules = slow.value?.schedules
  if (!Array.isArray(schedules)) return '—'
  const entry = schedules.find((s) => s.name === name)
  if (!entry || entry.error) return entry?.error ? 'unavailable' : '—'
  if (!entry.nextRunAt) return '—'
  return `${shortTime(entry.nextRunAt)}${entry.repeatable > 1 ? ` (${entry.repeatable} schedules)` : ''}`
}

// Relative times tick while the page is open.
const now = ref(Date.now())
let ticker = null
onMounted(() => {
  store.watch()
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
})
onBeforeUnmount(() => {
  clearInterval(ticker)
  store.unwatch()
})

function ago(iso) {
  if (!iso) return '—'
  const seconds = Math.max(0, Math.round((now.value - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  return `${formatDuration(seconds)} ago`
}
const shortTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const shortClock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')
const fullTime = (iso) => (iso ? new Date(iso).toLocaleString() : '')
</script>

<style scoped>
.identity {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.identity strong {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 500;
}

.tile {
  padding: 12px 14px 8px;
  overflow: hidden;
}
/* Peak over the history window: accent color, a step smaller than the value. */
.peak {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  white-space: nowrap;
}
.peak > span {
  color: rgb(var(--v-theme-primary-text));
}

.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
  font-size: 0.875rem;
}
.facts dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.facts dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
