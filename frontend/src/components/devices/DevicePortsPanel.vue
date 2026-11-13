<template>
  <v-card variant="outlined" class="device-ports-panel">
    <v-card-title class="d-flex flex-wrap align-center ga-2">
      <v-icon>mdi-ethernet</v-icon>
      <span>Ports</span>
      <v-chip v-if="readChip" size="small" variant="tonal" :color="readChip.color">{{ readChip.label }}</v-chip>
      <v-spacer />
      <v-text-field
        v-model="filterText"
        class="ports-filter"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        prepend-inner-icon="mdi-magnify"
        placeholder="Port, label, client, IP"
        aria-label="Filter ports"
      />
      <ActionButton
        v-if="canEdit && availability.canRead"
        color="primary"
        variant="tonal"
        icon="mdi-refresh"
        label="Read now"
        :loading="reading"
        @click="readNow"
      />
    </v-card-title>

    <v-card-subtitle class="pb-2 wrap-subtitle">{{ subtitle }}</v-card-subtitle>

    <v-card-text class="pt-0 pb-2 d-flex flex-wrap align-center ga-2">
      <v-btn-toggle v-model="show" mandatory density="compact" variant="outlined" divided>
        <v-btn value="all" size="small">All</v-btn>
        <v-btn value="connected" size="small">With a device</v-btn>
        <v-btn value="noted" size="small">With a label</v-btn>
      </v-btn-toggle>
      <v-switch
        v-model="showInfra"
        color="primary"
        density="compact"
        hide-details
        label="Uplinks and access points"
      />
    </v-card-text>

    <v-alert v-if="loadError" type="error" variant="tonal" density="compact" class="mx-4 mb-2">{{ loadError }}</v-alert>

    <v-data-table
      v-model:expanded="expanded"
      :headers="shownHeaders"
      :items="rows"
      :loading="loading"
      item-value="port"
      show-expand
      :items-per-page="100"
      :no-data-text="noDataText"
    >
      <template #[`item.label`]="{ item }">
        <span class="d-inline-flex align-center ga-1 text-no-wrap">
          <v-icon size="x-small" :color="linkColor(item)" :title="linkTitle(item)" icon="mdi-circle" />
          <strong>{{ item.label }}</strong>
        </span>
      </template>

      <template #[`item.note`]="{ item }">
        <div v-if="item.note" class="py-1">
          <div class="font-weight-medium">{{ item.note.label || '(no label)' }}</div>
          <div v-if="noteLine(item.note)" class="text-caption text-medium-emphasis">{{ noteLine(item.note) }}</div>
        </div>
        <v-btn
          v-else-if="canEdit"
          size="small"
          variant="text"
          prepend-icon="mdi-tag-plus-outline"
          @click="openNote(item)"
        >
          Add
        </v-btn>
      </template>

      <template #[`item.description`]="{ item }">
        <span class="text-medium-emphasis">{{ item.description || '' }}</span>
      </template>

      <template #[`item.kind`]="{ item }">
        <v-chip
          v-if="kindInfo(item)"
          size="small"
          variant="tonal"
          :color="kindInfo(item).color"
          :title="item.kind.source === 'note' ? 'Set in the port note' : item.kind.reason"
        >
          <v-icon v-if="item.kind.source === 'note'" start size="x-small" icon="mdi-account-edit-outline" />
          {{ kindInfo(item).label }}
        </v-chip>
      </template>

      <template #[`item.clients`]="{ item }">
        <div class="py-1">
          <template v-if="item.uplink || item.ap">
            <div v-if="item.ap" class="d-flex align-center ga-1">
              <v-icon size="16" icon="mdi-access-point" />
              <router-link v-if="apNeighbor(item)?.device" :to="`/devices/${apNeighbor(item).device.id}`">{{ apNeighbor(item).device.name }}</router-link>
              <span v-else>{{ apNeighbor(item)?.sysName || item.ap }}</span>
            </div>
            <div v-if="!item.ap || infraCount(item) !== '0 MACs'" class="text-caption text-medium-emphasis">
              {{ infraCount(item) }} {{ item.ap ? 'behind the access point' : 'through this port' }}
            </div>
          </template>
          <template v-else-if="liveClients(item).length">
            <div v-for="client in liveClients(item).slice(0, 2)" :key="client.id">
              <ClientLine :client="client" />
            </div>
            <div v-if="liveClients(item).length > 2" class="text-caption text-medium-emphasis">
              and {{ liveClients(item).length - 2 }} more
            </div>
          </template>
          <span v-else-if="item.clients.length" class="text-caption text-medium-emphasis">
            Last: {{ clientTitle(item.clients[0]) }}, {{ freshnessText(item.clients[0]) }}
          </span>
          <v-chip
            v-if="item.expected && !item.expected.present"
            size="x-small"
            color="warning"
            variant="tonal"
            class="mt-1"
            title="The device pinned in the note is not on this port"
          >
            Expected device missing
          </v-chip>
        </div>
      </template>

      <template #[`item.vlan`]="{ item }">
        <span v-if="item.vlan" class="text-no-wrap" :title="vlanTitle(item.vlan)">
          {{ item.vlan.mode === 'trunk' ? `trunk${item.vlan.untagged ? ` (${item.vlan.untagged})` : ''}` : item.vlan.untagged ?? item.vlan.mode }}
        </span>
      </template>

      <template #[`item.actions`]="{ item }">
        <v-btn
          :icon="canEdit ? 'mdi-pencil-outline' : 'mdi-eye-outline'"
          size="small"
          variant="text"
          :title="canEdit ? (item.note ? 'Edit the port note' : 'Add a port note') : 'Port details'"
          :aria-label="canEdit ? `Edit note for port ${item.label}` : `Details for port ${item.label}`"
          @click="openNote(item)"
        />
      </template>

      <template #expanded-row="{ columns, item }">
        <tr>
          <td :colspan="columns.length" class="expanded-port">
            <PortDetails :port="item" :can-edit="canEdit" @edit="openNote(item)" />
          </td>
        </tr>
      </template>
    </v-data-table>

    <PortNoteDialog
      v-model="noteOpen"
      :device-id="device.id"
      :port="notePort"
      :can-edit="canEdit"
      @saved="onNoteSaved"
    />
  </v-card>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import portsService from '@/services/ports.service'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { useWebSocket } from '@/composables/useWebSocket'
import { usePhoneColumns } from '@/composables/usePhoneColumns'
import { timeAgo } from '@/models/activity'
import { PORT_KINDS, clientTitle, freshnessText, portKey, readAvailability, READ_SOURCE_NAMES } from '@/models/port-clients'
import { PlatformInfo } from '@/models/vendors'
import ActionButton from '@/components/common/ActionButton.vue'
import PortNoteDialog from '@/components/devices/PortNoteDialog.vue'
import PortDetails from '@/components/devices/PortDetails.vue'
import ClientLine from '@/components/devices/PortClientLine.vue'

const props = defineProps({
  device: { type: Object, required: true }
})

const route = useRoute()
const authStore = useAuthStore()
const notifications = useNotificationsStore()
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))

const view = ref(null)
const loading = ref(false)
const loadError = ref('')
const reading = ref(false)
const filterText = ref(route.query.port ? String(route.query.port) : '')
const show = ref('all')
const showInfra = ref(true)
const expanded = ref(route.query.port ? [portKey(route.query.port)] : [])
const noteOpen = ref(false)
const notePort = ref(null)

const headers = [
  { title: 'Port', key: 'label', sortable: false },
  { title: 'Your label', key: 'note', sortable: false },
  { title: 'On the switch', key: 'description', sortable: false },
  { title: 'Kind', key: 'kind', sortable: false, cellProps: { class: 'text-no-wrap' } },
  { title: 'Connected', key: 'clients', sortable: false },
  { title: 'VLAN', key: 'vlan', sortable: false, cellProps: { class: 'text-no-wrap' } },
  { title: '', key: 'actions', sortable: false, align: 'end' }
]
const shownHeaders = usePhoneColumns(headers, ['label', 'note', 'clients', 'actions'])

const liveClients = (port) => port.clients.filter((c) => c.state !== 'gone')
// An AP port's AP: the LLDP neighbor that is the AP (its name, and its inventory row when known).
const apNeighbor = (port) => port.neighbors.find((n) => n.mac === port.ap) || port.neighbors[0] || null
function infraCount(port) {
  const n = Math.max(0, (port.macCount ?? 0) - (port.ap ? 1 : 0))
  return `${n} MAC${n === 1 ? '' : 's'}`
}

const rows = computed(() => {
  const all = view.value?.ports || []
  const q = (filterText.value || '').trim().toLowerCase()
  return all.filter((p) => {
    if (!showInfra.value && (p.uplink || p.ap) && !q) return false
    if (show.value === 'connected' && !liveClients(p).length) return false
    if (show.value === 'noted' && !p.note) return false
    if (!q) return true
    const hay = [
      p.port, p.label, p.description, p.note?.label, p.note?.location, p.note?.owner, p.note?.notes,
      ...p.clients.flatMap((c) => [c.mac, c.ip, c.hostname, c.username, c.vendor, c.profile?.os, c.lldp?.sysName]),
      ...p.neighbors.map((n) => n.sysName)
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
})

const availability = computed(() => readAvailability(view.value?.sources, PlatformInfo[props.device.platform]?.label))

const noDataText = computed(() => {
  if (loading.value) return 'Loading ports'
  if (!view.value?.ports?.length) {
    if (availability.value.message) return availability.value.message
    return 'No ports read yet. Ports are read from the switch (AOS-CX) or its cloud every 30 minutes.'
  }
  return 'No port matches'
})

const readChip = computed(() => {
  const reads = view.value?.reads || []
  if (!reads.length) return null
  if (reads.some((r) => r.lastSuccessAt && !r.error)) return { label: 'Read', color: 'success' }
  if (reads.some((r) => r.lastSuccessAt)) return { label: 'Read with errors', color: 'warning' }
  return { label: 'Read failed', color: 'error' }
})

const subtitle = computed(() => {
  const v = view.value
  if (!v) return ''
  const { message, notes } = availability.value
  if (v.sources && !v.sources.supported) return message
  if (!v.reads.length) {
    return message || 'Not read yet. Connected devices come from the switch\'s own MAC and ARP tables (AOS-CX, with a linked credential) or from its cloud.'
  }
  const parts = []
  const good = v.reads.filter((r) => r.lastSuccessAt).sort((a, b) => new Date(b.lastSuccessAt) - new Date(a.lastSuccessAt))[0]
  if (good) parts.push(`Read from ${READ_SOURCE_NAMES[good.source] || good.source} ${timeAgo(good.lastSuccessAt)}`)
  for (const r of v.reads.filter((x) => x.error)) parts.push(`${READ_SOURCE_NAMES[r.source] || r.source}: ${r.error}`)
  parts.push(...notes)
  const live = v.ports.reduce((n, p) => n + (p.uplink ? 0 : liveClients(p).length), 0)
  parts.push(`${live} connected device${live === 1 ? '' : 's'}`)
  return `${parts.join(' · ')}.`
})

function kindInfo(port) {
  return PORT_KINDS[port.kind?.kind] || null
}
function linkColor(port) {
  if (port.linkUp === true) return 'success'
  if (port.linkUp === false) return 'grey'
  return 'grey-lighten-1'
}
function linkTitle(port) {
  if (port.linkUp === true) return 'Link up'
  if (port.linkUp === false) return 'Link down'
  return 'Link state unknown'
}
function noteLine(note) {
  return [note.location, note.owner].filter(Boolean).join(' · ')
}
function vlanTitle(vlan) {
  const tagged = vlan.allTagged ? 'all' : (vlan.tagged || []).join(', ')
  return `${vlan.mode}${vlan.untagged ? `, untagged ${vlan.untagged}` : ''}${tagged ? `, tagged ${tagged}` : ''}`
}

async function load() {
  loading.value = true
  try {
    view.value = await portsService.getPorts(props.device.id)
    loadError.value = ''
  } catch (error) {
    loadError.value = error.userMessage || 'Failed to load ports'
  } finally {
    loading.value = false
  }
}

async function readNow() {
  reading.value = true
  try {
    await portsService.readNow(props.device.id)
  } catch (error) {
    reading.value = false
    notifications.showError(error.userMessage || 'Failed to start the port read')
  }
}

function openNote(port) {
  notePort.value = port
  noteOpen.value = true
}
function onNoteSaved() {
  load()
}

// Sightings change on reads (ports:updated per switch) and at the end of a run.
const { on: onSocket, off: offSocket } = useWebSocket()
let reloadTimer = null
const reloadSoon = () => {
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(load, 1500)
}
const onPortsUpdated = (e) => {
  if (e?.deviceId === props.device.id) reloadSoon()
}
const onCollected = async () => {
  if (!reading.value) return
  reading.value = false
  await load()
  const own = view.value?.reads?.find((r) => r.error)
  if (own && !view.value.reads.some((r) => r.lastSuccessAt && !r.error)) notifications.showError(`Could not read ports: ${own.error}`)
  else notifications.showSuccess('Ports updated')
}
onSocket('ports:updated', onPortsUpdated)
onSocket('ports:collected', onCollected)
onUnmounted(() => {
  clearTimeout(reloadTimer)
  offSocket('ports:updated', onPortsUpdated)
  offSocket('ports:collected', onCollected)
})

watch(() => props.device.id, load)
onMounted(load)

</script>

<style scoped>
.ports-filter {
  max-width: 260px;
  min-width: 180px;
}
.expanded-port {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
@media (max-width: 599.98px) {
  .ports-filter {
    max-width: none;
    flex-basis: 100%;
  }
}
</style>
