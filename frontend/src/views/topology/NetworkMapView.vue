<template>
  <div class="network-map">
    <!-- Header -->
    <div class="d-flex flex-wrap align-center ga-2 mb-3">
      <div class="mr-4">
        <h1 class="text-h5 font-weight-bold">Network Map</h1>
        <div class="text-body-2 text-medium-emphasis">
          Links from each device's LLDP/CDP neighbor table.
          <span v-if="lastCollectedText">Last collected {{ lastCollectedText }}.</span>
        </div>
      </div>
      <v-chip size="small" variant="tonal" prepend-icon="mdi-router-wireless">
        {{ stats.devices || 0 }} devices
      </v-chip>
      <v-chip size="small" variant="tonal" prepend-icon="mdi-connection">
        {{ stats.links || 0 }} links
      </v-chip>
      <v-chip size="small" variant="tonal" prepend-icon="mdi-help-network-outline">
        {{ stats.ghosts || 0 }} not in inventory
      </v-chip>
      <v-tooltip location="bottom" text="Devices whose neighbor table was read successfully">
        <template #activator="{ props: tip }">
          <v-chip v-bind="tip" size="small" variant="tonal" prepend-icon="mdi-lan-check">
            {{ stats.collected || 0 }} / {{ stats.devices || 0 }} collected
          </v-chip>
        </template>
      </v-tooltip>
    </div>

    <!-- Toolbar -->
    <v-card variant="outlined" class="mb-3">
      <v-card-text class="d-flex flex-wrap align-center ga-3 py-2">
        <v-select
          v-model="siteModel"
          :items="siteItems"
          label="Site"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 220px; min-width: 160px"
        />
        <v-switch
          v-model="topologyStore.includeDiscovered"
          label="Discovered hosts"
          density="compact"
          color="primary"
          hide-details
          :disabled="!!topologyStore.site"
        />
        <v-autocomplete
          v-model="searchModel"
          :items="searchItems"
          item-title="title"
          item-value="value"
          label="Find a device"
          density="compact"
          variant="outlined"
          prepend-inner-icon="mdi-magnify"
          hide-details
          clearable
          style="max-width: 280px; min-width: 200px"
        />
        <v-spacer />
        <v-btn variant="text" prepend-icon="mdi-history" @click="openChanges">
          Changes
        </v-btn>
        <v-btn
          v-if="canEdit"
          variant="text"
          prepend-icon="mdi-graph-outline"
          :disabled="!graph.nodes.length"
          @click="canvas?.relayout()"
        >
          Auto-arrange
        </v-btn>
        <v-btn
          v-if="canEdit"
          variant="tonal"
          prepend-icon="mdi-content-save"
          :disabled="!topologyStore.layoutDirty"
          :loading="topologyStore.savingLayout"
          @click="saveLayout"
        >
          Save layout
        </v-btn>
        <v-btn
          v-if="canEdit"
          color="primary"
          variant="flat"
          prepend-icon="mdi-refresh"
          :loading="topologyStore.collecting || starting"
          @click="refreshTopology"
        >
          Refresh topology
          <template #loader>
            <v-progress-circular indeterminate size="16" width="2" class="mr-2" />
            {{ progressText }}
          </template>
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Map -->
    <v-card variant="outlined" class="map-card">
      <v-progress-linear v-if="topologyStore.loading" indeterminate color="primary" absolute />

      <div v-if="!topologyStore.loading && !graph.nodes.length" class="empty-state">
        <v-icon size="56" class="mb-3 text-medium-emphasis">mdi-graph-outline</v-icon>
        <div class="text-h6">Nothing to map yet</div>
        <div class="text-body-2 text-medium-emphasis">
          Add devices, or run Discovery, then refresh the topology.
        </div>
      </div>

      <template v-else>
        <v-alert
          v-if="showNoLinksHint"
          type="info"
          variant="tonal"
          density="compact"
          class="map-hint"
        >
          No links yet. Neighbors come from each device's LLDP/CDP table, read with the
          device's linked credential, or from Mist or Central for a cloud-managed device
          the credential doesn't reach<span v-if="canEdit">: use <strong>Refresh topology</strong></span>.
          Devices with no neighbor source show a
          <v-icon size="14">mdi-lan-pending</v-icon> marker.
        </v-alert>
        <TopologyCanvas
          ref="canvas"
          :graph="graph"
          :saved-positions="topologyStore.layout.positions"
          :draggable="canEdit"
          :selected-id="selected?.id || null"
          @node-click="selectNode"
          @pane-click="selected = null"
          @moved="onMoved"
        />
      </template>
    </v-card>

    <!-- Details panel -->
    <v-navigation-drawer
      :model-value="panelOpen"
      location="right"
      width="380"
      temporary
      @update:model-value="(open) => { if (!open) closePanel() }"
    >
      <!-- Device -->
      <template v-if="panel === 'node' && selected?.kind === 'device'">
        <v-list-item class="py-3" :title="selected.data.name" :subtitle="deviceSubtitle(selected.data)">
          <template #prepend>
            <v-icon :color="typeInfo(selected.data.type).color">{{ typeInfo(selected.data.type).icon }}</v-icon>
          </template>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="closePanel" />
          </template>
        </v-list-item>
        <v-divider />
        <v-list density="compact">
          <v-list-item prepend-icon="mdi-ip-network" :title="selected.data.ipAddress || '—'" subtitle="IP address" />
          <v-list-item prepend-icon="mdi-map-marker" :title="selected.data.location || '—'" subtitle="Location" />
          <v-list-item prepend-icon="mdi-lan-check" :title="neighborStatusText(selected.data.topology)" subtitle="Neighbor data">
            <template v-if="selected.data.topology?.collectedAt" #append>
              <span class="text-caption text-medium-emphasis">{{ formatTime(selected.data.topology.collectedAt) }}</span>
            </template>
          </v-list-item>
        </v-list>
        <v-divider />
        <div class="px-4 pt-3 text-subtitle-2">Links</div>
        <v-list density="compact">
          <v-list-item
            v-for="link in selectedLinks"
            :key="link.id"
            :title="link.otherName"
            :subtitle="`${link.localPort || '?'} ↔ ${link.remotePort || '?'}`"
            @click="focus(link.otherId)"
          >
            <template #append>
              <v-icon v-if="link.ghost" size="16" class="text-medium-emphasis">mdi-help-network-outline</v-icon>
            </template>
          </v-list-item>
          <v-list-item v-if="!selectedLinks.length" title="No links" class="text-medium-emphasis" />
        </v-list>
        <template v-if="selectedChanges.length">
          <v-divider />
          <div class="px-4 pt-3 text-subtitle-2">Recent changes</div>
          <v-list density="compact">
            <v-list-item
              v-for="change in selectedChanges"
              :key="change.id"
              :title="changeTitle(change)"
              :subtitle="formatTime(change.occurredAt)"
            >
              <template #prepend>
                <v-icon :color="changeColor(change.type)" size="18">{{ changeIcon(change.type) }}</v-icon>
              </template>
            </v-list-item>
          </v-list>
        </template>
        <div class="d-flex ga-2 pa-4">
          <v-btn variant="tonal" prepend-icon="mdi-open-in-app" :to="`/devices/${selected.data.deviceId}`">
            Open device
          </v-btn>
          <v-btn
            v-if="hasLive(selected.data)"
            variant="text"
            prepend-icon="mdi-pulse"
            :to="`/devices/${selected.data.deviceId}?tab=live`"
          >
            Live
          </v-btn>
        </div>
      </template>

      <!-- Neighbor not in inventory -->
      <template v-else-if="panel === 'node' && selected?.kind === 'ghost'">
        <v-list-item class="py-3" :title="selected.data.name" subtitle="Not in inventory">
          <template #prepend>
            <v-icon>mdi-help-network-outline</v-icon>
          </template>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="closePanel" />
          </template>
        </v-list-item>
        <v-divider />
        <v-list density="compact">
          <v-list-item v-if="selected.data.sysDesc" prepend-icon="mdi-information-outline" :title="selected.data.sysDesc" subtitle="Description" class="wrap-title" />
          <v-list-item prepend-icon="mdi-ip-network" :title="selected.data.mgmtIp || '—'" subtitle="Management IP" />
          <v-list-item prepend-icon="mdi-lan" :title="selected.data.macAddress || selected.data.chassisId" subtitle="MAC / chassis ID" />
        </v-list>
        <div v-if="selected.data.capabilities?.length" class="px-4 pb-2 d-flex flex-wrap ga-1">
          <v-chip v-for="cap in selected.data.capabilities" :key="cap" size="small" variant="tonal">{{ cap }}</v-chip>
        </div>
        <v-divider />
        <div class="px-4 pt-3 text-subtitle-2">Seen by</div>
        <v-list density="compact">
          <v-list-item
            v-for="link in selectedLinks"
            :key="link.id"
            :title="link.otherName"
            :subtitle="`${link.remotePort || '?'} ↔ ${link.localPort || '?'}`"
            @click="focus(link.otherId)"
          />
        </v-list>
        <v-divider />
        <div class="pa-4">
          <template v-if="selected.data.discovered">
            <div class="text-body-2 mb-3">
              Discovery saw this host at {{ selected.data.discovered.ipAddress }}
              <span v-if="selected.data.discovered.vendor">({{ selected.data.discovered.vendor }})</span>.
            </div>
            <v-btn v-if="canEdit" color="primary" variant="flat" prepend-icon="mdi-import" @click="openImport(selected)">
              Import into inventory
            </v-btn>
          </template>
          <div v-else class="text-body-2 text-medium-emphasis">
            Not seen by Discovery. Run a scan of its subnet to import it, or add it on the Devices page.
          </div>
        </div>
      </template>

      <!-- Subnet group -->
      <template v-else-if="panel === 'node' && selected?.kind === 'subnet'">
        <v-list-item class="py-3" :title="selected.data.name" :subtitle="`${selected.data.count} unmanaged hosts from Discovery`">
          <template #prepend>
            <v-icon>mdi-ip-network-outline</v-icon>
          </template>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="closePanel" />
          </template>
        </v-list-item>
        <v-divider />
        <v-list density="compact">
          <v-list-item
            v-for="host in selected.data.hosts"
            :key="host.id"
            :title="host.hostname || host.ipAddress"
            :subtitle="[host.ipAddress, host.vendor].filter(Boolean).join(' · ')"
          />
        </v-list>
        <div class="pa-4">
          <v-btn variant="tonal" prepend-icon="mdi-radar" to="/devices/discovery">Open Discovery</v-btn>
        </div>
      </template>

      <!-- Change history -->
      <template v-else-if="panel === 'changes'">
        <v-list-item class="py-3" title="Topology changes" subtitle="Links that appeared, went away, or changed">
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="closePanel" />
          </template>
        </v-list-item>
        <div class="px-4 pb-2">
          <v-btn-toggle v-model="changesWindow" density="compact" variant="outlined" mandatory divided>
            <v-btn :value="24">24 h</v-btn>
            <v-btn :value="24 * 7">7 days</v-btn>
            <v-btn :value="24 * 30">30 days</v-btn>
          </v-btn-toggle>
        </div>
        <v-divider />
        <v-progress-linear v-if="topologyStore.changesLoading" indeterminate color="primary" />
        <v-list density="compact">
          <v-list-item
            v-for="change in topologyStore.changes"
            :key="change.id"
            :title="`${change.device?.name || 'Device'} ${change.localPort || ''}`"
            :subtitle="`${changeTitle(change)} · ${formatTime(change.occurredAt)}`"
            @click="focus(`device:${change.deviceId}`)"
          >
            <template #prepend>
              <v-icon :color="changeColor(change.type)" size="18">{{ changeIcon(change.type) }}</v-icon>
            </template>
          </v-list-item>
          <v-list-item
            v-if="!topologyStore.changesLoading && !topologyStore.changes.length"
            title="No changes in this window"
            class="text-medium-emphasis"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <ImportDiscoveredDialog
      v-model="showImport"
      :target="importTarget"
      :defaults="importDefaults"
      @imported="onImported"
      @error="(message) => notifications.showError(message)"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useTopologyStore } from '@/stores/topology'
import topologyService from '@/services/topology.service'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { useWebSocket } from '@/composables/useWebSocket'
import { DeviceTypeInfo } from '@/models/Device'
import { VendorInfo, liveStateMode } from '@/models/vendors'
import TopologyCanvas from '@/components/topology/TopologyCanvas.vue'
import ImportDiscoveredDialog from '@/components/discovery/ImportDiscoveredDialog.vue'

const topologyStore = useTopologyStore()
const authStore = useAuthStore()
const notifications = useNotificationsStore()
// Holds the shared socket open: topology progress and ping status arrive on it.
useWebSocket()

const canvas = ref(null)
const selected = ref(null)
const panel = ref(null) // 'node' | 'changes' | null
const panelOpen = computed(() => !!panel.value)
const starting = ref(false)
const pendingPositions = ref(null)
const changesWindow = ref(24 * 7)
const selectedChanges = ref([])
const searchModel = ref(null)

const showImport = ref(false)
const importTarget = ref(null)
const importDefaults = ref({})

const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))
const graph = computed(() => topologyStore.graph)
const stats = computed(() => topologyStore.stats)

const siteItems = computed(() => [
  { title: 'All sites', value: null },
  ...topologyStore.sites.map((s) => ({ title: s, value: s }))
])

const siteModel = computed({
  get: () => topologyStore.site,
  set: (value) => { topologyStore.site = value }
})

const searchItems = computed(() => graph.value.nodes
  .filter((n) => n.kind !== 'subnet')
  .map((n) => ({
    title: [n.data.name, n.data.ipAddress || n.data.mgmtIp].filter(Boolean).join(' · '),
    value: n.id
  })))

const progressText = computed(() => {
  const p = topologyStore.progress
  return p ? `${p.done}/${p.total}` : ''
})

const showNoLinksHint = computed(() => !topologyStore.loading && graph.value.nodes.length > 0 && !graph.value.edges.length)

const lastCollectedText = computed(() => {
  const times = graph.value.nodes
    .map((n) => n.data.topology?.lastSuccessAt)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
  return times.length ? formatTime(new Date(Math.max(...times))) : ''
})

const nodesById = computed(() => new Map(graph.value.nodes.map((n) => [n.id, n])))

// Links touching the selected node, from its point of view.
const selectedLinks = computed(() => {
  if (!selected.value) return []
  const id = selected.value.id
  return graph.value.edges
    .filter((e) => e.source === id || e.target === id)
    .map((e) => {
      const mine = e.source === id
      const otherId = mine ? e.target : e.source
      const other = nodesById.value.get(otherId)
      return {
        id: e.id,
        otherId,
        otherName: other?.data.name || otherId,
        ghost: other?.kind === 'ghost',
        localPort: mine ? e.sourcePort : e.targetPort,
        remotePort: mine ? e.targetPort : e.sourcePort
      }
    })
    .sort((a, b) => String(a.localPort).localeCompare(String(b.localPort), undefined, { numeric: true }))
})

// --- helpers ---

const typeInfo = (type) => DeviceTypeInfo[type] || { icon: 'mdi-help-network', color: 'grey' }

function deviceSubtitle(data) {
  const vendor = VendorInfo[data.vendor]?.label
  return [data.model, vendor].filter(Boolean).join(' · ')
}

function neighborStatusText(t) {
  if (!t) return 'Not collected yet'
  if (t.status === 'ok') return `${t.neighborCount} neighbor${t.neighborCount === 1 ? '' : 's'} via ${t.source}`
  return t.reason || t.status
}

const hasLive = (data) => !!liveStateMode(data.platform)

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  if (diff < 60 * 1000) return 'just now'
  if (diff < 3600 * 1000) return `${Math.round(diff / 60000)} min ago`
  if (diff < 24 * 3600 * 1000) return `${Math.round(diff / 3600000)} h ago`
  return date.toLocaleString()
}

function changeTitle(change) {
  const remote = (r) => (r ? `${r.sysName || r.chassisId}${r.portId ? ` (${r.portId})` : ''}` : '?')
  if (change.type === 'link.added') return `Link up to ${remote(change.data?.remote)}`
  if (change.type === 'link.removed') return `Link gone: ${remote(change.data?.remote)}`
  return `Now ${remote(change.data?.after)}, was ${remote(change.data?.before)}`
}

const changeIcon = (type) => ({
  'link.added': 'mdi-link-variant-plus',
  'link.removed': 'mdi-link-variant-off',
  'link.changed': 'mdi-swap-horizontal'
}[type] || 'mdi-link-variant')

const changeColor = (type) => ({ 'link.added': 'success', 'link.removed': 'error', 'link.changed': 'warning' }[type] || 'grey')

// --- actions ---

async function load() {
  try {
    await Promise.all([topologyStore.fetchLayout(), topologyStore.fetchGraph()])
  } catch (error) {
    notifications.showError(error.userMessage || 'Failed to load the network map')
  }
}

async function selectNode(node) {
  selected.value = nodesById.value.get(node.id) || null
  panel.value = selected.value ? 'node' : null
  selectedChanges.value = []
  if (selected.value?.kind === 'device') {
    const deviceId = selected.value.data.deviceId
    try {
      const response = await topologyService.getChanges({
        deviceId,
        since: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
        limit: 10
      })
      if (selected.value?.data.deviceId === deviceId) selectedChanges.value = response.data || []
    } catch {
      // The panel works without history.
    }
  }
}

function closePanel() {
  panel.value = null
  selected.value = null
}

function focus(nodeId) {
  if (!nodesById.value.has(nodeId)) return
  canvas.value?.focusNode(nodeId)
  selectNode({ id: nodeId })
}

async function openChanges() {
  selected.value = null
  panel.value = 'changes'
  await topologyStore.fetchChanges({ sinceHours: changesWindow.value }).catch(() => {})
}

function onMoved(positions) {
  pendingPositions.value = positions
  topologyStore.markLayoutDirty()
}

async function saveLayout() {
  if (!pendingPositions.value) return
  try {
    await topologyStore.saveLayout(pendingPositions.value)
    notifications.showSuccess('Layout saved')
  } catch (error) {
    notifications.showError(error.userMessage || 'Failed to save the layout')
  }
}

async function refreshTopology() {
  starting.value = true
  try {
    await topologyStore.collect()
  } catch (error) {
    notifications.showError(error.userMessage || 'Failed to start the topology refresh')
  } finally {
    starting.value = false
  }
}

function openImport(ghost) {
  const linkedDevice = selectedLinks.value
    .map((l) => nodesById.value.get(l.otherId))
    .find((n) => n?.kind === 'device')
  importTarget.value = ghost.data.discovered
  importDefaults.value = {
    name: ghost.data.sysName || '',
    type: ghost.data.guessedType,
    location: linkedDevice?.data.location || ''
  }
  showImport.value = true
}

async function onImported(response) {
  notifications.showSuccess(response?.merged ? 'Scan data merged into the existing device' : 'Device imported')
  closePanel()
  await topologyStore.fetchGraph().catch(() => {})
}

// --- watchers ---

watch(() => [topologyStore.site, topologyStore.includeDiscovered], () => {
  closePanel()
  pendingPositions.value = null
  load()
})

watch(changesWindow, (hours) => topologyStore.fetchChanges({ sinceHours: hours }).catch(() => {}))

watch(searchModel, (id) => {
  if (id) focus(id)
})

// A collection finished: refetch, and say what it found.
watch(() => topologyStore.staleAt, async () => {
  const run = topologyStore.lastRun
  await topologyStore.fetchGraph().catch(() => {})
  if (run && run.trigger === 'manual') {
    const parts = [`${run.ok} of ${run.total} devices read`]
    if (run.changes) parts.push(`${run.changes} link change${run.changes === 1 ? '' : 's'}`)
    if (run.failed) parts.push(`${run.failed} failed`)
    notifications.showSuccess(parts.join(', '), 'Topology refreshed')
  }
  if (panel.value === 'changes') topologyStore.fetchChanges({ sinceHours: changesWindow.value }).catch(() => {})
})

onMounted(load)
</script>

<style scoped>
.network-map {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
  min-height: 480px;
}

.map-card {
  position: relative;
  flex: 1 1 auto;
  min-height: 400px;
  overflow: hidden;
}

.map-hint {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 5;
  max-width: 720px;
}

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
}

.wrap-title :deep(.v-list-item-title) {
  white-space: normal;
}
</style>
