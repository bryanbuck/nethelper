<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex flex-wrap align-center ga-2">
      <v-icon>mdi-lan</v-icon>
      <span>Neighbors</span>
      <v-chip v-if="state" size="small" variant="tonal" :color="stateColor">
        {{ stateLabel }}
      </v-chip>
      <v-spacer />
      <ActionButton variant="text" icon="mdi-graph-outline" label="Network Map" to="/map" />
      <ActionButton
        v-if="canEdit"
        color="primary"
        variant="tonal"
        icon="mdi-refresh"
        label="Read now"
        :loading="reading"
        @click="readNow"
      />
    </v-card-title>

    <v-card-subtitle class="pb-2">
      <template v-if="state?.status === 'ok'">
        {{ state.neighborCount }} neighbor{{ state.neighborCount === 1 ? '' : 's' }} via {{ state.source }},
        {{ formatTime(state.collectedAt) }}.
      </template>
      <template v-else-if="state">
        Last attempt {{ formatTime(state.collectedAt) }}: {{ state.reason || state.status }}
        <span v-if="state.lastSuccessAt"> (last good read {{ formatTime(state.lastSuccessAt) }})</span>
      </template>
      <template v-else>
        Not collected yet. Neighbors are read from the device's LLDP/CDP table with its linked credential,
        or from its cloud when the device is cloud-managed.
      </template>
    </v-card-subtitle>

    <v-data-table
      :headers="shownHeaders"
      :items="links"
      :loading="loading"
      density="compact"
      :items-per-page="50"
      no-data-text="No neighbors recorded"
    >
      <template #[`item.remote`]="{ item }">
        <router-link v-if="item.remoteDevice" :to="`/devices/${item.remoteDevice.id}`">
          {{ item.remoteDevice.name }}
        </router-link>
        <span v-else>
          {{ item.remoteSysName || item.remoteChassisId }}
          <v-chip v-if="item.discovered" size="x-small" variant="tonal" class="ml-1">in Discovery</v-chip>
        </span>
      </template>
      <template #[`item.remoteCapabilities`]="{ item }">
        <span class="text-medium-emphasis">{{ (item.remoteCapabilities || []).join(', ') }}</span>
      </template>
      <template #[`item.source`]="{ item }">
        {{ PROTOCOL_LABELS[item.source] || String(item.source || '').toUpperCase() }}
      </template>
      <template #[`item.lastSeen`]="{ item }">
        <span :class="{ 'text-medium-emphasis': !item.active }">
          {{ item.active ? formatTime(item.lastSeen) : `gone, last seen ${formatTime(item.lastSeen)}` }}
        </span>
      </template>
    </v-data-table>
  </v-card>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import topologyService from '@/services/topology.service'
import { useTopologyStore } from '@/stores/topology'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { useWebSocket } from '@/composables/useWebSocket'
import { usePhoneColumns } from '@/composables/usePhoneColumns'
import ActionButton from '@/components/common/ActionButton.vue'

const props = defineProps({
  device: { type: Object, required: true }
})

const topologyStore = useTopologyStore()
const authStore = useAuthStore()
const notifications = useNotificationsStore()
// The "read now" result arrives as a topology:updated socket event.
useWebSocket()

const links = ref([])
const state = ref(null)
const loading = ref(false)
const reading = ref(false)

const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))

const headers = [
  { title: 'Local port', key: 'localPort' },
  { title: 'Neighbor', key: 'remote', sortable: false },
  { title: 'Remote port', key: 'remotePortId' },
  { title: 'Management IP', key: 'remoteMgmtIp' },
  { title: 'Capabilities', key: 'remoteCapabilities', sortable: false },
  { title: 'Protocol', key: 'source' },
  { title: 'Last seen', key: 'lastSeen' }
]
const shownHeaders = usePhoneColumns(headers, ['localPort', 'remote', 'remotePortId', 'remoteMgmtIp'])

// `cloud`: a link the cloud computed (Central's site topology), not one LLDP table.
const PROTOCOL_LABELS = { lldp: 'LLDP', cdp: 'CDP', cloud: 'Cloud topology' }

const stateLabel = computed(() => ({
  ok: 'Collected',
  skipped: 'Skipped',
  unsupported: 'Not supported',
  failed: 'Failed'
}[state.value?.status] || state.value?.status))

const stateColor = computed(() => ({ ok: 'success', failed: 'error', skipped: 'warning' }[state.value?.status] || 'grey'))

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  if (diff < 60 * 1000) return 'just now'
  if (diff < 3600 * 1000) return `${Math.round(diff / 60000)} min ago`
  if (diff < 24 * 3600 * 1000) return `${Math.round(diff / 3600000)} h ago`
  return date.toLocaleString()
}

async function load() {
  loading.value = true
  try {
    const response = await topologyService.getDeviceNeighbors(props.device.id)
    links.value = response.data?.links || []
    state.value = response.data?.state || null
  } catch (error) {
    notifications.showError(error.userMessage || 'Failed to load neighbors')
  } finally {
    loading.value = false
  }
}

async function readNow() {
  reading.value = true
  try {
    await topologyStore.collect([props.device.id])
  } catch (error) {
    reading.value = false
    notifications.showError(error.userMessage || 'Failed to start the neighbor read')
  }
}

// The collection finished (this one, or a scheduled run): reload.
watch(() => topologyStore.staleAt, async () => {
  await load()
  if (reading.value) {
    reading.value = false
    if (state.value?.status === 'ok') notifications.showSuccess('Neighbors updated')
    else if (state.value) notifications.showError(state.value.reason || 'Could not read neighbors')
  }
})

watch(() => props.device.id, load)
onMounted(load)
</script>
