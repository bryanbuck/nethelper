<template>
  <!-- This device's unresolved alerts; nothing when there are none -->
  <v-row v-if="alerts.length">
    <v-col cols="12">
      <v-alert :type="worst.type" variant="tonal" :icon="worst.icon">
        <div class="font-weight-medium">
          {{ total === 1 ? '1 unresolved alert' : `${total} unresolved alerts` }}
        </div>
        <div v-for="alert in alerts.slice(0, SHOWN)" :key="alert.id" class="text-body-2">
          <v-icon size="x-small" :color="severityMeta(alert.severity).color" :icon="severityMeta(alert.severity).icon" class="mr-1" />
          {{ alert.title }}
          <span class="text-medium-emphasis">
            &middot; {{ ALERT_RULE_LABELS[alert.rule] || alert.rule }}
            &middot; since {{ since(alert.firstSeenAt) }}
            <template v-if="alert.status === 'acknowledged'">&middot; acknowledged</template>
          </span>
        </div>
        <div v-if="total > SHOWN" class="text-caption text-medium-emphasis">
          and {{ total - SHOWN }} more
        </div>
        <template #append>
          <v-btn variant="tonal" :color="worst.type" :to="{ path: '/alerts', query: { deviceId } }">
            View alerts
          </v-btn>
        </template>
      </v-alert>
    </v-col>
  </v-row>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { formatDistanceToNow } from 'date-fns'
import alertsService from '@/services/alerts.service'
import { useWebSocket } from '@/composables/useWebSocket'
import { ALERT_SEVERITIES, ALERT_RULE_LABELS, severityMeta } from '@/models/alerts'

const props = defineProps({
  deviceId: { type: String, required: true }
})

const SHOWN = 3
const alerts = ref([])
const total = ref(0)

// Vuetify alert type per severity (critical alerts render as errors)
const TYPES = { critical: 'error', warning: 'warning', info: 'info' }

const worst = computed(() => {
  const sev = ALERT_SEVERITIES.find((s) => alerts.value.some((a) => a.severity === s.value)) || ALERT_SEVERITIES[2]
  return { type: TYPES[sev.value], icon: sev.icon }
})

let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  try {
    const response = await alertsService.list({ deviceId: props.deviceId, status: 'active', limit: 10 })
    if (seq !== loadSeq) return
    alerts.value = response.data || []
    total.value = response.total || alerts.value.length
  } catch {
    // A convenience on the device page; the Alerts page reports its own errors.
  }
}

function since(value) {
  return value ? formatDistanceToNow(new Date(value), { addSuffix: true }) : '—'
}

// Alerts open and resolve over the socket; reload when one concerns this device.
const { on: onSocket, off: offSocket } = useWebSocket()
let reloadTimer = null
const reloadSoon = () => {
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(load, 1000)
}
const onNew = ({ alert } = {}) => {
  if (alert?.deviceId === props.deviceId) reloadSoon()
}
const onUpdated = ({ alerts: changed = [] } = {}) => {
  // An empty list means rows went away in bulk (device deleted or merged).
  if (!changed.length || changed.some((a) => a.deviceId === props.deviceId)) reloadSoon()
}
onSocket('alert:new', onNew)
onSocket('alert:updated', onUpdated)
onUnmounted(() => {
  clearTimeout(reloadTimer)
  offSocket('alert:new', onNew)
  offSocket('alert:updated', onUpdated)
})

watch(() => props.deviceId, () => {
  alerts.value = []
  total.value = 0
  load()
}, { immediate: true })
</script>
