<template>
  <div class="device-live-panel">
    <!-- Delivery + monitoring controls -->
    <v-card class="mb-4">
      <v-card-text class="d-flex flex-wrap align-center ga-4">
        <v-chip :color="connection.color" variant="tonal" size="small">
          <v-icon start :icon="connection.icon" size="small" />
          {{ connection.label }}
        </v-chip>
        <span class="text-body-2 text-medium-emphasis">{{ deliveryNote }}</span>
        <v-spacer />
        <v-tooltip location="bottom" max-width="320">
          <template #activator="{ props: tip }">
            <div v-bind="tip">
              <v-switch
                :model-value="Boolean(device.liveMonitoring)"
                :disabled="!canEdit || toggling || !liveCapable"
                :loading="toggling"
                color="primary"
                density="compact"
                hide-details
                label="Always monitor"
                @update:model-value="toggleMonitoring"
              />
            </div>
          </template>
          Watch this device's ports even when nobody has this tab open, and record
          link and PoE changes as events.
          <template v-if="!canEdit"> Operators and admins can change this.</template>
        </v-tooltip>
      </v-card-text>
      <v-alert
        v-if="!liveCapable"
        type="info"
        variant="tonal"
        density="compact"
        class="mx-4 mb-4"
      >
        {{ unavailableReason }}
      </v-alert>
      <v-alert
        v-else-if="live.state === 'error'"
        type="warning"
        variant="tonal"
        density="compact"
        class="mx-4 mb-4"
      >
        {{ live.error }}
      </v-alert>
      <v-alert
        v-else-if="live.monitor.lastError && !live.monitor.connected"
        type="warning"
        variant="tonal"
        density="compact"
        class="mx-4 mb-4"
      >
        Can't reach the device: {{ live.monitor.lastError }}. Retrying.
      </v-alert>
    </v-card>

    <template v-if="liveCapable && live.state !== 'error'">
      <!-- CPU / memory meters -->
      <v-row v-if="live.metrics && (live.metrics.cpu !== null || live.metrics.memory !== null)" class="mb-1">
        <v-col v-for="meter in meters" :key="meter.label" cols="12" sm="6">
          <v-card>
            <v-card-text>
              <div class="d-flex justify-space-between align-baseline mb-2">
                <span class="text-overline text-medium-emphasis">{{ meter.label }}</span>
                <span class="text-h6">{{ meter.value }}%</span>
              </div>
              <v-progress-linear
                :model-value="meter.value"
                :color="meterColor(meter.value)"
                :bg-color="meterColor(meter.value)"
                bg-opacity="0.2"
                height="8"
                rounded
              />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Ports -->
      <v-card class="mb-4">
        <v-card-title class="d-flex align-center">
          <v-icon start icon="mdi-ethernet" />
          Ports
          <v-spacer />
          <span v-if="live.metrics" class="text-caption text-medium-emphasis">
            Counters every {{ Math.round(live.metrics.intervalMs / 1000) }}s
            <template v-if="!live.hasRates"> · collecting rates…</template>
          </span>
        </v-card-title>
        <v-divider />
        <v-table density="compact" class="live-ports">
          <thead>
            <tr>
              <th>Port</th>
              <th>Description</th>
              <th>Link</th>
              <th>PoE</th>
              <th class="text-end">In</th>
              <th class="text-end">Out</th>
              <th>Throughput</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="live.state === 'connecting' && !live.ports.length">
              <td colspan="7" class="text-center text-medium-emphasis py-6">
                <v-progress-circular indeterminate size="20" class="mr-2" />
                Reading port state from the device…
              </td>
            </tr>
            <tr v-else-if="!live.ports.length">
              <td colspan="7" class="text-center text-medium-emphasis py-6">No ports reported yet.</td>
            </tr>
            <tr
              v-for="p in live.ports"
              :key="p.port"
              :class="{ 'recently-changed': recentlyChanged(p.port) }"
            >
              <td class="font-weight-medium">{{ p.port }}</td>
              <td class="text-medium-emphasis">{{ p.description || '' }}</td>
              <td>
                <v-chip :color="linkChip(p).color" size="x-small" variant="tonal">
                  <v-icon start :icon="linkChip(p).icon" size="x-small" />
                  {{ linkChip(p).label }}
                </v-chip>
              </td>
              <td>
                <v-chip v-if="p.poe" :color="poeChip(p).color" size="x-small" variant="tonal">
                  <v-icon start :icon="poeChip(p).icon" size="x-small" />
                  {{ poeChip(p).label }}
                </v-chip>
              </td>
              <td class="text-end tabular">{{ rate(p.port, 'rxBps') }}</td>
              <td class="text-end tabular">{{ rate(p.port, 'txBps') }}</td>
              <td>
                <LiveSparkline
                  v-if="p.linkUp"
                  :points="live.history[p.port] || []"
                  :format="formatBps"
                  :label="`Port ${p.port} throughput`"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>

      <!-- Events -->
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon start icon="mdi-timeline-clock-outline" />
          Recent events
          <v-spacer />
          <span class="text-caption text-medium-emphasis">Raw transitions, newest first</span>
        </v-card-title>
        <v-divider />
        <v-list v-if="live.events.length" density="compact">
          <v-list-item v-for="e in live.events" :key="e.id || `${e.type}-${e.occurredAt}`">
            <template #prepend>
              <v-icon :icon="eventInfo(e).icon" :color="eventInfo(e).color" size="small" />
            </template>
            <v-list-item-title>
              <span v-if="e.port" class="font-weight-medium">{{ e.port }}</span>
              {{ eventInfo(e).label }}
            </v-list-item-title>
            <template #append>
              <span class="text-caption text-medium-emphasis">{{ formatTime(e.occurredAt) }}</span>
            </template>
          </v-list-item>
        </v-list>
        <v-card-text v-else class="text-medium-emphasis">
          No events yet. Link and PoE changes show up here as they happen.
        </v-card-text>
      </v-card>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { format } from 'date-fns'
import { useLiveStore } from '@/stores/live'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { useWebSocket } from '@/composables/useWebSocket'
import deviceService from '@/services/device.service'
import { PlatformInfo, liveStateMode } from '@/models/vendors'
import LiveSparkline from '@/components/devices/LiveSparkline.vue'

const props = defineProps({
  device: { type: Object, required: true },
})
const emit = defineEmits(['update'])

const live = useLiveStore()
const authStore = useAuthStore()
const notifications = useNotificationsStore()
// Holds the shared socket open while the Live tab is visible.
useWebSocket()

const toggling = ref(false)
const now = ref(Date.now())
let clock = null

const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))
const platformLabel = computed(() => PlatformInfo[props.device.platform]?.label || 'these')
const mode = computed(() => liveStateMode(props.device.platform))
const liveCapable = computed(() => Boolean(mode.value) && Boolean(props.device.ipAddress))

// Why live state is off for this device: missing data the user can fix
// comes before "this platform isn't supported".
const unavailableReason = computed(() => {
  if (!props.device.platform) {
    return 'This device has no platform set. Edit it and choose its platform (live state supports AOS-CX switches today).'
  }
  if (!mode.value) {
    return `Live state isn't available for ${platformLabel.value} devices yet. AOS-CX switches are supported today.`
  }
  return 'This device has no IP address. Edit it and add one: live state reads the switch directly.'
})

const deliveryNote = computed(() => {
  if (mode.value === 'push') return 'The switch pushes link and PoE changes as they happen (about a second).'
  if (mode.value === 'poll') return 'Link and PoE state is re-read every minute.'
  return ''
})

const connection = computed(() => {
  if (!liveCapable.value) return { label: 'Unavailable', color: 'grey', icon: 'mdi-minus-circle-outline' }
  if (live.state === 'connecting') return { label: 'Connecting', color: 'info', icon: 'mdi-progress-clock' }
  if (live.state === 'error') return { label: 'Unavailable', color: 'warning', icon: 'mdi-alert-outline' }
  if (live.monitor.connected) return { label: 'Live', color: 'success', icon: 'mdi-access-point' }
  return { label: 'Reconnecting', color: 'warning', icon: 'mdi-lan-pending' }
})

const meters = computed(() => [
  { label: 'CPU', value: live.metrics?.cpu },
  { label: 'Memory', value: live.metrics?.memory },
].filter((m) => typeof m.value === 'number'))

function meterColor(value) {
  if (value >= 90) return 'error'
  if (value >= 75) return 'warning'
  return 'primary'
}

function linkChip(p) {
  if (p.adminUp === false) return { label: 'Disabled', color: 'grey', icon: 'mdi-cancel' }
  if (p.linkUp) return { label: p.speedMbps ? speedLabel(p.speedMbps) : 'Up', color: 'success', icon: 'mdi-arrow-up-bold' }
  return { label: 'Down', color: 'grey', icon: 'mdi-arrow-down-bold' }
}

function speedLabel(mbps) {
  return mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`
}

function poeChip(p) {
  const status = p.poe?.status
  const watts = live.metrics?.ports?.[p.port]?.poeW ?? p.poe?.powerW
  if (status === 'delivering') {
    return { label: watts ? `${watts.toFixed(1)} W` : 'Delivering', color: 'success', icon: 'mdi-flash' }
  }
  if (status && /fault|denied|error|overload|short/i.test(status)) {
    return { label: 'Fault', color: 'error', icon: 'mdi-flash-alert' }
  }
  if (status === 'searching') return { label: 'Searching', color: 'grey', icon: 'mdi-flash-outline' }
  return { label: 'Off', color: 'grey', icon: 'mdi-flash-off' }
}

function formatBps(bps) {
  if (bps == null) return '—'
  const units = ['b/s', 'kb/s', 'Mb/s', 'Gb/s']
  let value = bps
  let i = 0
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000
    i += 1
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

function rate(port, key) {
  if (!live.hasRates) return '—'
  return formatBps(live.metrics?.ports?.[port]?.[key])
}

function recentlyChanged(port) {
  const at = live.changedAt[port]
  return at && now.value - at < 3000
}

const EVENTS = {
  'port.link.up': { label: 'link up', icon: 'mdi-arrow-up-bold', color: 'success' },
  'port.link.down': { label: 'link down', icon: 'mdi-arrow-down-bold', color: 'medium-emphasis' },
  'port.admin.up': { label: 'enabled', icon: 'mdi-check-circle-outline', color: 'success' },
  'port.admin.down': { label: 'disabled', icon: 'mdi-cancel', color: 'medium-emphasis' },
  'port.poe.up': { label: 'PoE delivering', icon: 'mdi-flash', color: 'success' },
  'port.poe.down': { label: 'PoE stopped', icon: 'mdi-flash-off', color: 'medium-emphasis' },
  'port.poe.fault': { label: 'PoE fault', icon: 'mdi-flash-alert', color: 'error' },
  'monitor.connected': { label: 'Monitoring reconnected', icon: 'mdi-lan-connect', color: 'success' },
  'monitor.disconnected': { label: 'Monitoring lost contact', icon: 'mdi-lan-disconnect', color: 'warning' },
}

function eventInfo(e) {
  const info = EVENTS[e.type] || { label: e.type, icon: 'mdi-information-outline', color: 'medium-emphasis' }
  if (e.type === 'port.link.up' && e.data?.speedMbps) return { ...info, label: `link up at ${speedLabel(e.data.speedMbps)}` }
  if (e.type === 'port.poe.up' && e.data?.pdClass) return { ...info, label: `PoE delivering (${e.data.pdClass})` }
  return info
}

function formatTime(at) {
  try {
    return format(new Date(at), 'MMM d, HH:mm:ss')
  } catch {
    return ''
  }
}

async function toggleMonitoring(enabled) {
  toggling.value = true
  try {
    const response = await deviceService.setLiveMonitoring(props.device.id, enabled)
    // The parent owns the device object (it may not be the store's copy).
    emit('update', { liveMonitoring: response?.data?.liveMonitoring ?? enabled })
    notifications.showSuccess(enabled
      ? `Always monitoring ${props.device.name}`
      : `Stopped always-on monitoring of ${props.device.name}`)
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not change live monitoring')
  } finally {
    toggling.value = false
  }
}

function start() {
  if (liveCapable.value) live.watch(props.device.id)
}

watch(() => props.device.id, () => start())
// Platform or IP fixed while the tab is open: start (or stop) without a reload.
watch(liveCapable, (capable) => (capable ? start() : live.unwatch()))

onMounted(() => {
  start()
  clock = setInterval(() => { now.value = Date.now() }, 1000)
})

onUnmounted(() => {
  clearInterval(clock)
  live.unwatch()
})
</script>

<style scoped>
.tabular {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.live-ports tr.recently-changed td {
  background: rgba(var(--v-theme-primary), 0.08);
  transition: background 0.3s;
}

.live-ports td {
  transition: background 1.5s;
}
</style>
