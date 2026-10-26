<template>
  <div class="device-table">
    <!-- WebSocket Disconnection Warning -->
    <v-alert
      v-if="!wsConnected && !wsConnecting"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
      closable
    >
      <div class="d-flex align-center">
        <v-icon start>mdi-wifi-off</v-icon>
        <div>
          <strong>Real-time updates paused</strong>
          <span class="text-caption ml-2">- Attempting to reconnect...</span>
        </div>
      </div>
    </v-alert>

    <v-card elevation="2" class="device-table-card">
      <v-card-title class="d-flex flex-wrap align-center justify-space-between ga-2">
        <div class="d-flex align-center">
          <v-icon class="mr-2" color="primary">mdi-devices</v-icon>
          Network Devices
          <v-chip 
            v-if="devicesStore.pagination.total > 0" 
            class="ml-2" 
            size="small" 
            variant="outlined"
          >
            {{ devicesStore.pagination.total }} devices
          </v-chip>
        </div>
        
        <div class="table-toolbar d-flex flex-wrap flex-sm-nowrap align-center ga-2">
          <v-text-field
            v-model="searchInput"
            density="compact"
            variant="outlined"
            hide-details
            placeholder="Search devices..."
            prepend-inner-icon="mdi-magnify"
            class="table-search"
            clearable
            @update:model-value="onSearchInput"
          />
          
          <ActionButton
            v-if="canEdit"
            color="primary"
            icon="mdi-sync"
            label="Sync"
            :loading="devicesStore.loading"
            @click="syncDevices"
          />
          
          <ActionButton
            variant="outlined"
            icon="mdi-filter"
            label="Filters"
            :badge="activeFiltersCount"
            @click="showFilters = !showFilters"
          />
          
          <v-menu>
            <template #activator="{ props }">
              <ActionButton
                variant="outlined"
                icon="mdi-dots-vertical"
                label="Actions"
                v-bind="props"
              />
            </template>
            <v-list>
              <v-list-item
                prepend-icon="mdi-export"
                title="Export CSV"
                subtitle="Every device matching the search and filters"
                :disabled="exporting"
                @click="exportToCsv"
              />
              <v-list-item
                prepend-icon="mdi-refresh"
                title="Refresh Table"
                @click="refreshTable"
              />
            </v-list>
          </v-menu>
        </div>
      </v-card-title>
      
      <v-divider></v-divider>

      <!-- Error Alert -->
      <!-- Rate limited: keep the rows already shown and retry when allowed -->
      <v-alert
        v-if="devicesStore.error?.type === 'RATE_LIMIT'"
        type="warning"
        variant="tonal"
        class="ma-4"
      >
        <v-alert-title>Too many requests</v-alert-title>
        <div class="mt-1">
          {{ devicesStore.error.userMessage }}
          {{ devicesStore.devices.length ? 'The list below is from the last successful load.' : '' }}
          <template v-if="rateLimitRetryAt">Retrying automatically.</template>
        </div>
        <template #append>
          <v-btn variant="text" size="small" prepend-icon="mdi-refresh" @click="retryLoad">Retry now</v-btn>
        </template>
      </v-alert>

      <v-alert
        v-else-if="devicesStore.error"
        type="error"
        variant="tonal"
        closable
        class="ma-4"
        @click:close="devicesStore.clearError()"
      >
        <v-alert-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-alert-circle</v-icon>
          {{ getErrorTitle(devicesStore.error) }}
        </v-alert-title>
        <div class="mt-2">
          {{ devicesStore.error.userMessage || devicesStore.error.message }}
        </div>
        <div v-if="devicesStore.error.type === 'NETWORK' || devicesStore.error.type === 'CONNECTION'" class="mt-3">
          <v-btn
            color="white"
            variant="outlined"
            size="small"
            prepend-icon="mdi-refresh"
            @click="retryLoad"
          >
            Retry Connection
          </v-btn>
        </div>
      </v-alert>

      <!-- Filters Section -->
      <v-expand-transition>
        <div v-show="showFilters">
          <v-card-text class="border-b">
            <v-row>
              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="filters.status"
                  label="Status"
                  :items="statusOptions"
                  variant="outlined"
                  density="compact"
                  clearable
                  @update:model-value="applyFilters"
                >
                  <template #selection="{ item }">
                    <v-chip :color="getStatusColor(item.value)" size="small">
                      {{ item.title }}
                    </v-chip>
                  </template>
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props">
                      <template #prepend>
                        <v-chip :color="getStatusColor(item.value)" size="small">
                          {{ item.title }}
                        </v-chip>
                      </template>
                    </v-list-item>
                  </template>
                </v-select>
              </v-col>
              
              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="filters.type"
                  label="Device Type"
                  :items="typeOptions"
                  variant="outlined"
                  density="compact"
                  clearable
                  @update:model-value="applyFilters"
                />
              </v-col>
              
              <v-col cols="12" sm="6" md="3">
                <v-combobox
                  v-model="filters.location"
                  label="Location"
                  :items="locationOptions"
                  variant="outlined"
                  density="compact"
                  clearable
                  @update:model-value="applyFilters"
                />
              </v-col>
              
              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="filters.platform"
                  label="Platform"
                  :items="platformFilterOptions"
                  variant="outlined"
                  density="compact"
                  clearable
                  @update:model-value="applyFilters"
                />
              </v-col>

              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="filters.credential"
                  label="Credential"
                  :items="credentialFilterOptions"
                  variant="outlined"
                  density="compact"
                  clearable
                  @update:model-value="applyFilters"
                />
              </v-col>

              <v-col cols="12" sm="6" md="3">
                <v-select
                  v-model="filters.group"
                  label="Group"
                  :items="groupFilterOptions"
                  variant="outlined"
                  density="compact"
                  clearable
                  @update:model-value="applyFilters"
                />
              </v-col>

              <v-col cols="12" sm="6" md="3" class="d-flex align-center">
                <v-btn
                  variant="outlined"
                  prepend-icon="mdi-filter-remove"
                  :disabled="activeFiltersCount === 0"
                  @click="clearFilters"
                >
                  Clear Filters
                </v-btn>
              </v-col>
            </v-row>
          </v-card-text>
          <v-divider></v-divider>
        </div>
      </v-expand-transition>
      
      <!-- Bulk Actions Bar: above the table, pinned under the app bar while the page scrolls -->
      <v-slide-y-transition>
        <v-card-actions v-if="selectedItems.length > 0" class="bulk-actions-bar">
          <div class="d-flex flex-wrap align-center justify-space-between ga-2 w-100">
            <div class="d-flex align-center">
              <v-icon class="mr-2" color="primary">mdi-checkbox-marked</v-icon>
              <span class="font-weight-medium">{{ selectedItems.length }} devices selected</span>
            </div>
            
            <div class="d-flex flex-wrap align-center ga-2">
              <v-menu v-if="canEdit">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    variant="outlined"
                    size="small"
                    prepend-icon="mdi-access-point"
                    :loading="bulkLiveBusy"
                  >
                    Live Monitoring
                  </v-btn>
                </template>
                <v-list density="compact">
                  <v-list-item prepend-icon="mdi-access-point" title="Turn on" @click="bulkLiveMonitoring(true)" />
                  <v-list-item prepend-icon="mdi-access-point-off" title="Turn off" @click="bulkLiveMonitoring(false)" />
                </v-list>
              </v-menu>
              <v-btn
                v-if="canEdit"
                variant="outlined"
                size="small"
                prepend-icon="mdi-key-variant"
                @click="credentialDialog = true"
              >
                Credential
              </v-btn>
              <v-btn
                v-if="canEdit"
                variant="outlined"
                size="small"
                prepend-icon="mdi-folder-plus-outline"
                @click="groupDialog = true"
              >
                Group
              </v-btn>
              <v-btn
                v-if="canEdit && selectedItems.length >= 2"
                variant="outlined"
                size="small"
                prepend-icon="mdi-call-merge"
                :loading="mergeLoading"
                @click="openMerge"
              >
                Merge
              </v-btn>
              <v-btn
                variant="outlined"
                size="small"
                prepend-icon="mdi-download"
                :loading="exporting"
                @click="exportSelected"
              >
                Export Selected
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                @click="selectedItems = []"
              >
                Clear Selection
              </v-btn>
            </div>
          </div>
        </v-card-actions>
      </v-slide-y-transition>

      <!-- Data Table -->
      <v-data-table-server
        v-model="selectedItems"
        v-model:options="tableOptions"
        :headers="shownHeaders"
        :items="devicesStore.devices"
        :items-length="devicesStore.pagination.total"
        :loading="devicesStore.tableLoading"
        item-value="id"
        show-select
        class="device-data-table"
        @update:options="loadItems"
        @click:row="handleRowClick"
      >
        <template #item.name="{ item }">
          <div class="d-flex align-center">
            <v-avatar 
              :color="deviceTypeInfo(item.type).color" 
              size="32" 
              class="mr-3"
            >
              <v-icon :icon="deviceTypeInfo(item.type).icon" color="white" size="small"></v-icon>
            </v-avatar>
            <div>
              <div class="font-weight-medium">
                {{ item.name }}
                <v-tooltip v-if="item.liveMonitoring" location="top">
                  <template #activator="{ props }">
                    <v-icon v-bind="props" icon="mdi-access-point" size="x-small" color="primary" class="ml-1" />
                  </template>
                  Live monitoring: link and PoE changes are recorded
                </v-tooltip>
              </div>
              <div class="text-caption text-medium-emphasis">{{ item.model }}</div>
            </div>
          </div>
        </template>
        
        <template #item.status="{ item }">
          <v-tooltip location="bottom">
            <template #activator="{ props }">
              <v-chip
                v-bind="props"
                :color="getStatusColor(item.status)"
                size="small"
                variant="flat"
              >
                <v-icon
                  start
                  :icon="getStatusIcon(item.status)"
                  size="small"
                ></v-icon>
                {{ item.status }}
              </v-chip>
            </template>
            <div class="text-caption">
              <div v-if="unreachableFromHere(item)" class="mb-1">
                {{ cloudPlaneName(item) }} reports it online, but it doesn't answer ping from NetHelper
                (no route, or ICMP filtered).
              </div>
              <div v-else-if="answersPingButCloudOffline(item)" class="mb-1">
                {{ cloudPlaneName(item) }} reports it offline, but its address answers ping
                (another device may now use this IP).
              </div>
              <div v-if="item.pingLastChecked">
                <strong>Ping Status:</strong> {{ item.pingStatus || 'unknown' }}<br>
                <strong v-if="item.managementMode === 'cloud'">Cloud Status:</strong>
                <template v-if="item.managementMode === 'cloud'"> {{ item.cloudStatus }}<br></template>
                <strong>Last Checked:</strong> {{ formatLastSeen(item.pingLastChecked) }}<br>
                <span v-if="item.pingResponseTime">
                  <strong>Response Time:</strong> {{ item.pingResponseTime }}ms
                </span>
              </div>
              <div v-else>
                Status based on network reachability
              </div>
            </div>
          </v-tooltip>
        </template>
        
        <template #item.type="{ item }">
          <div class="d-flex align-center">
            <v-icon
              :color="deviceTypeInfo(item.type).color"
              :icon="deviceTypeInfo(item.type).icon"
              size="small"
              class="mr-2"
            ></v-icon>
            {{ deviceTypeInfo(item.type).label }}
          </div>
        </template>

        <template #item.managementMode="{ item }">
          <div class="d-flex align-center">
            <v-chip
              :color="getManagementChip(item).color"
              size="small"
              :variant="getManagementChip(item).variant"
              :title="getManagementChip(item).title"
            >
              <v-icon
                start
                :icon="getManagementChip(item).icon"
                size="x-small"
              ></v-icon>
              {{ getManagementChip(item).label }}
              <v-icon v-if="getManagementChip(item).unverified" end icon="mdi-help-circle-outline" size="x-small" />
            </v-chip>
            <v-tooltip v-if="getManagementMismatch(item)" location="top">
              <template #activator="{ props }">
                <v-icon
                  v-bind="props"
                  color="warning"
                  size="small"
                  class="ml-1"
                >
                  mdi-alert
                </v-icon>
              </template>
              <span>{{ getManagementMismatch(item) }}</span>
            </v-tooltip>
          </div>
        </template>

        <template #item.cloudStatus="{ item }">
          <v-tooltip location="bottom">
            <template #activator="{ props }">
              <v-chip
                v-if="item.cloudStatus"
                v-bind="props"
                :color="getStatusColor(item.cloudStatus)"
                size="small"
                variant="tonal"
              >
                <v-icon
                  start
                  :icon="getStatusIcon(item.cloudStatus)"
                  size="x-small"
                ></v-icon>
                {{ item.cloudStatus }}
              </v-chip>
              <span v-else class="text-caption text-medium-emphasis">
                N/A
              </span>
            </template>
            <div class="text-caption">
              <div v-if="item.cloudStatus">
                <strong>{{ cloudPlaneName(item) }} Status:</strong> {{ item.cloudStatus }}<br>
                <span v-if="item.lastSeen">
                  <strong>Last Updated:</strong> {{ formatLastSeen(item.lastSeen) }}
                </span>
              </div>
              <div v-else>
                Not synced from a cloud platform yet
              </div>
            </div>
          </v-tooltip>
        </template>

        <template #item.apiStatus="{ item }">
          <ConnectionStatusBadge
            :status="getApiConnectionStatus(item)"
            :last-tested="item.apiLastTested"
            :response-time="item.apiResponseTime"
            :error-message="item.apiError"
          />
        </template>

        <template #item.lastSeen="{ item }">
          <div class="text-body-2">{{ formatLastSeen(item.lastSeen) }}</div>
        </template>
        
        <template #item.actions="{ item }">
          <v-btn
            variant="text"
            size="small"
            icon="mdi-eye"
            @click.stop="viewDevice(item)"
          ></v-btn>
          <v-btn
            v-if="canEdit"
            variant="text"
            size="small"
            icon="mdi-pencil"
            @click.stop="editDevice(item)"
          ></v-btn>
          <v-menu v-if="authStore.isAdmin">
            <template #activator="{ props }">
              <v-btn
                variant="text"
                size="small"
                icon="mdi-dots-vertical"
                v-bind="props"
                @click.stop
              ></v-btn>
            </template>
            <v-list>
              <v-list-item
                prepend-icon="mdi-delete"
                title="Remove"
                class="text-error"
                @click="confirmRemove(item)"
              />
            </v-list>
          </v-menu>
        </template>
        
        <template #loading>
          <v-skeleton-loader type="table-row@10"></v-skeleton-loader>
        </template>
        
        <template #no-data>
          <div class="text-center pa-8">
            <v-icon size="64" color="grey-lighten-1" class="mb-4">
              mdi-server-off
            </v-icon>
            <div class="text-h6 mb-2">No devices found</div>
            <div class="text-body-2 text-medium-emphasis mb-4">
              Try adjusting your search or filters
            </div>
            <v-btn color="primary" @click="clearFilters">
              Clear All Filters
            </v-btn>
          </div>
        </template>
      </v-data-table-server>
    </v-card>

    <DeviceMergeDialog
      v-model="mergeDialog"
      :devices="mergeCandidates"
      @merged="onMerged"
    />

    <v-dialog v-model="removeDialog" max-width="480">
      <v-card>
        <v-card-title>Remove device</v-card-title>
        <v-card-text>
          Remove <strong>{{ removeTarget?.name }}</strong> from the inventory? Its events,
          alerts and topology links are deleted with it; config backups and automation run
          history are kept.
          <div v-if="removeTarget?.managementMode === 'cloud'" class="mt-2">
            It is synced from {{ cloudPlaneName(removeTarget) }}, so the next sync adds it again
            unless it is removed there too.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="removeDialog = false">Cancel</v-btn>
          <v-btn color="error" :loading="removing" @click="doRemove">Remove</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <DeviceCredentialDialog
      v-model="credentialDialog"
      :device-ids="selectedItems"
      @assigned="refreshTable"
    />

    <DeviceGroupMembershipDialog
      v-model="groupDialog"
      :device-ids="selectedItems"
      @changed="refreshTable"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { useDevicesStore } from '@/stores/devices'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import deviceService from '@/services/device.service'
import { useWebSocket } from '@/composables/useWebSocket'
import { usePhoneColumns } from '@/composables/usePhoneColumns'
import { timeAgo } from '@/models/activity'
import { debounce } from 'lodash-es'
import ConnectionStatusBadge from './ConnectionStatusBadge.vue'
import DeviceMergeDialog from './DeviceMergeDialog.vue'
import DeviceCredentialDialog from './DeviceCredentialDialog.vue'
import DeviceGroupMembershipDialog from './DeviceGroupMembershipDialog.vue'
import { useGroupsStore } from '@/stores/groups'
import { cloudProviderLabel, platformOptions } from '@/models/vendors'
import { unreachableFromHere, answersPingButCloudOffline, DeviceTypeInfo, deviceTypeInfo } from '@/models/Device'
import { VendorInfo, PlatformInfo } from '@/models/vendors'
import { toCsv, downloadCsv } from '@/utils/csv'
import { useSettingsStore } from '@/stores/settings'
import ActionButton from '@/components/common/ActionButton.vue'

const router = useRouter()
const devicesStore = useDevicesStore()
const { connected: wsConnected, connecting: wsConnecting } = useWebSocket()

const tableProps = defineProps({
  // The status filter, two-way (v-model:status-filter) so the Devices page
  // stat cards can set it and show which one is active
  statusFilter: { type: String, default: null },
  // The group filter, two-way like the status filter: the page's Groups
  // dialog sets it ("Show devices"); 'none' lists devices in no group
  groupFilter: { type: String, default: null }
})
const emit = defineEmits(['edit-device', 'update:statusFilter', 'update:groupFilter'])

// Component state
const selectedItems = ref([])
const showFilters = ref(false)
const searchInput = ref('')

// Filters
const filters = ref({
  status: tableProps.statusFilter || null,
  type: null,
  location: null,
  platform: null,
  credential: null,
  group: tableProps.groupFilter || null
})

// Table options
const tableOptions = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: []
})

// Table headers
// No fixed widths: they added up past a laptop screen and squeezed cells into
// wrapping. Short values stay on one line; the name and location may wrap.
const headers = [
  {
    title: 'Device Name',
    key: 'name',
    sortable: true
  },
  {
    title: 'Type',
    key: 'type',
    cellProps: { class: 'text-no-wrap' },
    sortable: true
  },
  {
    title: 'Managed',
    key: 'managementMode',
    cellProps: { class: 'text-no-wrap' },
    sortable: true,
    tooltip: 'How NetHelper reaches this device (a cloud platform, or direct via REST/SSH)'
  },
  {
    title: 'Status',
    key: 'status',
    cellProps: { class: 'text-no-wrap' },
    sortable: true,
    tooltip: 'Network reachability status (ICMP ping)'
  },
  {
    title: 'IP Address',
    key: 'ipAddress',
    cellProps: { class: 'text-no-wrap' },
    sortable: true
  },
  {
    title: 'Location',
    key: 'location',
    sortable: true
  },
  {
    title: 'Cloud Status',
    key: 'cloudStatus',
    cellProps: { class: 'text-no-wrap' },
    sortable: true,
    tooltip: 'Status as reported by the device\'s cloud platform'
  },
  {
    title: 'API Status',
    key: 'apiStatus',
    cellProps: { class: 'text-no-wrap' },
    sortable: false,
    tooltip: 'Device API communication status'
  },
  {
    title: 'Last Seen',
    key: 'lastSeen',
    cellProps: { class: 'text-no-wrap' },
    sortable: true
  },
  {
    title: 'Actions',
    key: 'actions',
    cellProps: { class: 'text-no-wrap' },
    sortable: false,
    // Pinned to the right edge, so the row actions stay in reach when the
    // columns are wider than the screen.
    fixed: 'end',
    width: 120
  }
]

const { xs } = useDisplay()
// Phones: name (with model), type, status, address and actions per row; rows
// stack there, so nothing is pinned.
const shownHeaders = usePhoneColumns(
  computed(() => xs.value ? headers.map((h) => ({ ...h, fixed: undefined })) : headers),
  ['name', 'type', 'status', 'ipAddress', 'actions']
)

// Filter options
const statusOptions = [
  { title: 'Online', value: 'online' },
  { title: 'Offline', value: 'offline' },
  { title: 'Warning', value: 'warning' },
  { title: 'Maintenance', value: 'maintenance' }
]

const typeOptions = Object.entries(DeviceTypeInfo).map(([value, info]) => ({ title: info.label, value }))

const platformFilterOptions = platformOptions()

// Credential filter: 'none' / 'any' or a specific credential. "No credential"
// plus a platform, then select-all, is the quick way to link a fleet.
const settingsStore = useSettingsStore()
const credentialFilterOptions = computed(() => [
  { title: 'No credential', value: 'none' },
  { title: 'Any credential', value: 'any' },
  ...(settingsStore.apiCredentials || []).map((c) => ({ title: c.name, value: c.id }))
])

// Group filter: devices in no group, or in one group
const groupsStore = useGroupsStore()
const groupFilterOptions = computed(() => [
  { title: 'No group', value: 'none' },
  ...groupsStore.sorted.map((g) => ({ title: g.name, value: g.id }))
])

// Locations seen on loaded rows (the backend matches "contains", so a typed
// value works too). Remembered across loads so filtering doesn't shrink the list.
const knownLocations = ref(new Set())
watch(() => devicesStore.devices, (rows) => {
  for (const d of rows || []) if (d.location) knownLocations.value.add(d.location)
}, { immediate: true })
const locationOptions = computed(() => [...knownLocations.value].sort((a, b) => a.localeCompare(b)))

// Computed properties
const activeFiltersCount = computed(() => {
  return Object.values(filters.value).filter(value => value !== null && value !== '').length
})

// Methods
const loadItems = async (options) => {
  const { page, itemsPerPage, sortBy } = options
  
  await devicesStore.fetchDevicesWithPagination({
    page,
    itemsPerPage,
    sortBy,
    search: searchInput.value,
    filters: filters.value
  })
}

const onSearchInput = debounce(() => {
  loadItems({
    ...tableOptions.value,
    page: 1
  })
}, 500)

const applyFilters = () => {
  emit('update:statusFilter', filters.value.status || null)
  emit('update:groupFilter', filters.value.group || null)
  loadItems({
    ...tableOptions.value,
    page: 1
  })
}

const clearFilters = () => {
  filters.value = {
    status: null,
    type: null,
    location: null,
    platform: null,
    credential: null,
    group: null
  }
  searchInput.value = ''
  emit('update:statusFilter', null)
  emit('update:groupFilter', null)
  loadItems({
    ...tableOptions.value,
    page: 1
  })
}

watch(() => tableProps.groupFilter, (group) => {
  if ((group || null) === (filters.value.group || null)) return
  filters.value.group = group || null
  if (group) showFilters.value = true
  applyFilters()
})

watch(() => tableProps.statusFilter, (status) => {
  if ((status || null) === (filters.value.status || null)) return
  filters.value.status = status || null
  applyFilters()
})

const refreshTable = () => {
  loadItems(tableOptions.value)
}

const syncDevices = async () => {
  try {
    await devicesStore.syncDevices()
    await refreshTable()
  } catch (error) {
    // Error is already stored in devicesStore.error and will be displayed
    console.error('Sync failed:', error)
  }
}

// Device actions
const handleRowClick = (event, { item }) => {
  if (!event.target.closest('.v-btn') && !event.target.closest('.v-checkbox')) {
    router.push(`/devices/${item.id}`)
  }
}

const viewDevice = (device) => {
  router.push(`/devices/${device.id}`)
}

const editDevice = (device) => {
  emit('edit-device', device)
}

const authStore = useAuthStore()
const notifications = useNotificationsStore()
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))

// Remove (admin only, like DELETE /devices/:id)
const removeDialog = ref(false)
const removeTarget = ref(null)
const removing = ref(false)

const confirmRemove = (device) => {
  removeTarget.value = device
  removeDialog.value = true
}

const doRemove = async () => {
  const device = removeTarget.value
  removing.value = true
  try {
    await devicesStore.deleteDevice(device.id)
    selectedItems.value = selectedItems.value.filter((id) => id !== device.id)
    notifications.showSuccess(`Removed ${device.name}`)
    removeDialog.value = false
    refreshTable()
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not remove the device')
  } finally {
    removing.value = false
  }
}

// Bulk actions
const bulkLiveBusy = ref(false)

// Each device is checked server-side (platform, IP, credential); report the
// ones that couldn't be changed by name and reason instead of failing silently.
const bulkLiveMonitoring = async (enabled) => {
  bulkLiveBusy.value = true
  const failures = []
  let changed = 0
  for (const id of selectedItems.value) {
    const device = devicesStore.devices.find((d) => d.id === id)
    try {
      await deviceService.setLiveMonitoring(id, enabled)
      devicesStore.updateDeviceLocally(id, { liveMonitoring: enabled })
      changed += 1
    } catch (err) {
      failures.push(`${device?.name || id}: ${err.userMessage || err.message}`)
    }
  }
  bulkLiveBusy.value = false
  const verb = enabled ? 'on' : 'off'
  if (changed) notifications.showSuccess(`Live monitoring turned ${verb} for ${changed} device(s)`)
  if (failures.length) {
    notifications.showWarning(failures.join('\n'), `${failures.length} device(s) not changed`)
  }
}

// Merge: the selection can span table pages, so fetch rows not on this one.
const credentialDialog = ref(false)
const groupDialog = ref(false)
const mergeDialog = ref(false)
const mergeCandidates = ref([])
const mergeLoading = ref(false)

const openMerge = async () => {
  mergeLoading.value = true
  try {
    mergeCandidates.value = await Promise.all(selectedItems.value.map(async (id) =>
      devicesStore.devices.find((d) => d.id === id) || (await deviceService.getDevice(id)).data
    ))
    mergeDialog.value = true
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not load the selected devices')
  } finally {
    mergeLoading.value = false
  }
}

const onMerged = () => {
  mergeDialog.value = false
  selectedItems.value = []
  refreshTable()
}

// A cloud sync job finished (device:sync:completed): show what it changed.
watch(() => devicesStore.lastSyncResult, () => refreshTable())

// CSV export: every matching device (not just this page), or the selection
const exporting = ref(false)
const API_STATUS_LABELS = { connected: 'Connected', failed: 'Failed', untested: 'Untested', 'no-credentials': 'No credential' }
const CSV_HEADERS = [
  'Name', 'Type', 'Vendor', 'Platform', 'Model', 'Serial', 'MAC Address', 'IP Address', 'Location',
  'Status', 'Ping Status', 'Cloud Status', 'Managed', 'Cloud Integration', 'Firmware', 'Credential',
  'API Status', 'API Last Tested', 'Last Seen'
]
const csvRow = (d) => [
  d.name, deviceTypeInfo(d.type).label, VendorInfo[d.vendor]?.label || d.vendor,
  PlatformInfo[d.platform]?.label || d.platform, d.model, d.serial, d.macAddress, d.ipAddress, d.location,
  d.status, d.pingStatus, d.managementMode === 'cloud' ? d.cloudStatus : '', getManagementChip(d).label,
  d.cloudIntegration?.name, d.firmwareVersion, d.apiCredential?.name,
  API_STATUS_LABELS[getApiConnectionStatus(d)], d.apiLastTested, d.lastSeen
]

const exportRows = async (rows, label) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  downloadCsv(`devices-${label}-${stamp}.csv`, toCsv(CSV_HEADERS, rows.map(csvRow)))
  notifications.showSuccess(`Exported ${rows.length} device(s)`)
}

const exportToCsv = async () => {
  exporting.value = true
  try {
    // itemsPerPage -1 = no limit: every row matching the search and filters
    const { data } = await deviceService.getDevicesWithPagination({
      itemsPerPage: -1,
      sortBy: tableOptions.value.sortBy,
      search: searchInput.value,
      filters: filters.value
    })
    await exportRows(data, 'all')
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Export failed')
  } finally {
    exporting.value = false
  }
}

// The selection can span table pages, so fetch rows not on this one (as Merge does)
const exportSelected = async () => {
  exporting.value = true
  try {
    const rows = await Promise.all(selectedItems.value.map(async (id) =>
      devicesStore.devices.find((d) => d.id === id) || (await deviceService.getDevice(id)).data
    ))
    await exportRows(rows, 'selected')
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Export failed')
  } finally {
    exporting.value = false
  }
}

// Utility functions
const getStatusColor = (status) => {
  const colors = {
    online: 'success',
    offline: 'error',
    warning: 'warning',
    maintenance: 'info'
  }
  return colors[status] || 'grey'
}

const getStatusIcon = (status) => {
  const icons = {
    online: 'mdi-check-circle',
    offline: 'mdi-close-circle',
    warning: 'mdi-alert-circle',
    maintenance: 'mdi-wrench'
  }
  return icons[status] || 'mdi-help-circle'
}

// Name of the cloud plane managing a device ("Central", "Mist", ...), for
// labels and tooltips. Falls back to the generic "Cloud" when unknown.
const cloudPlaneName = (item) =>
  cloudProviderLabel(item.cloudIntegration?.provider)

// Three-state "Managed" chip: prefers the device-reported cloudManaged truth
// over the record-keeping managementMode field, falling back to the latter
// (outlined, with a "?") when the device has never been probed. Short labels
// so the column stays narrow; the tooltip says it in full.
const getManagementChip = (item) => {
  const plane = cloudPlaneName(item)
  if (item.cloudManaged === true) {
    return { label: plane, title: `${plane}-managed`, color: 'info', variant: 'tonal', icon: 'mdi-cloud' }
  }
  if (item.cloudManaged === false) {
    return { label: 'Local', title: 'Locally managed', color: 'success', variant: 'tonal', icon: 'mdi-lan-connect' }
  }
  // cloudManaged is null/undefined - fall back to managementMode, unverified
  if (item.managementMode === 'cloud') {
    return { label: plane, title: `${plane} (unverified: not yet probed)`, unverified: true, color: 'grey', variant: 'outlined', icon: 'mdi-cloud-outline' }
  }
  return { label: 'Direct', title: 'Direct (unverified: not yet probed)', unverified: true, color: 'grey', variant: 'outlined', icon: 'mdi-lan-connect' }
}

// Returns a warning string when the device's own view of cloud ownership
// disagrees with how the device record was added to inventory, or null.
const getManagementMismatch = (item) => {
  const plane = cloudPlaneName(item)
  if (item.cloudManaged === true && item.managementMode === 'direct') {
    return `Device reports it is ${plane}-managed but was added as directly managed - direct config changes will be rejected by the device.`
  }
  if (item.cloudManaged === false && item.managementMode === 'cloud') {
    return `Device reports it is locally managed but was added as ${plane}-managed - configuration may not be pushed via ${plane} as expected.`
  }
  return null
}

const formatLastSeen = (lastSeen) => {
  if (!lastSeen) return 'Unknown'
  
  try {
    return timeAgo(lastSeen)
  } catch (error) {
    return 'Unknown'
  }
}

// The device's own last connection test (Device.api*), not the shared
// credential's status, which every device using it would echo.
const getApiConnectionStatus = (device) => {
  if (!device.apiCredentialId) return 'no-credentials'
  if (!device.apiLastTested) return 'untested'
  return device.apiTestStatus === 'success' ? 'connected' : 'failed'
}

const getErrorTitle = (error) => {
  if (!error) return 'Error'

  const titles = {
    NETWORK: 'Network Connection Error',
    CONNECTION: 'Connection Failed',
    TIMEOUT: 'Request Timeout',
    UNAUTHORIZED: 'Authentication Required',
    FORBIDDEN: 'Access Denied',
    NOT_FOUND: 'Not Found',
    SERVER_ERROR: 'Server Error',
    BAD_REQUEST: 'Invalid Request',
    VALIDATION_ERROR: 'Validation Error',
    RATE_LIMIT: 'Rate Limit Exceeded'
  }

  return titles[error.type] || 'Error Loading Devices'
}

const retryLoad = () => {
  devicesStore.clearError()
  refreshTable()
}

// A rate-limited load retries once the API takes requests again (its
// Retry-After, capped so a long window still gets a try every 2 minutes).
const rateLimitRetryAt = ref(null)
let rateLimitTimer = null
watch(() => devicesStore.error, (error) => {
  clearTimeout(rateLimitTimer)
  rateLimitRetryAt.value = null
  if (error?.type !== 'RATE_LIMIT') return
  const waitMs = Math.min((error.retryAfter || 30) * 1000 + 500, 120000)
  rateLimitRetryAt.value = Date.now() + waitMs
  rateLimitTimer = setTimeout(() => {
    rateLimitRetryAt.value = null
    if (devicesStore.error?.type === 'RATE_LIMIT') retryLoad()
  }, waitMs)
})
onUnmounted(() => clearTimeout(rateLimitTimer))

// Initialize table
onMounted(() => {
  if (canEdit.value && !settingsStore.apiCredentials?.length) {
    settingsStore.fetchApiCredentials().catch(() => {})
  }
  groupsStore.ensureGroups().catch(() => {})
  if (filters.value.group) showFilters.value = true
  loadItems({
    page: 1,
    itemsPerPage: 10,
    sortBy: []
  })
})

// DevicesView refreshes the table after merging from its duplicate prompt.
defineExpose({ refreshTable })
</script>

<style scoped>
.device-table {
  height: 100%;
}

.device-data-table :deep(.v-table__wrapper) {
  height: calc(100vh - 400px);
  min-height: 400px;
}

.table-search {
  width: 250px;
  min-width: 250px;
}

/* Phones: rows stack, so the table grows with the page instead of scrolling
   inside a box; the toolbar takes its own line with a full-width search. */
@media (max-width: 599.98px) {
  .device-data-table :deep(.v-table__wrapper) {
    height: auto;
    min-height: 0;
  }

  .table-toolbar {
    width: 100%;
  }

  .table-search {
    flex: 1 1 100%;
    width: auto;
    min-width: 0;
  }
}

/* v-card's overflow: hidden would make the card the sticky container; clip keeps the rounded corners without that. */
.device-table-card {
  overflow: clip;
}

.bulk-actions-bar {
  position: sticky;
  top: var(--v-layout-top);
  z-index: 2;
  /* Opaque so rows don't show through while it's pinned. */
  background:
    linear-gradient(rgba(var(--v-theme-primary), 0.1), rgba(var(--v-theme-primary), 0.1)),
    rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.2);
}

.device-data-table :deep(.v-data-table__tr:hover) {
  background-color: rgba(var(--v-theme-primary), 0.04);
  cursor: pointer;
}

.device-data-table :deep(.v-data-table__tr:hover .v-btn) {
  opacity: 1;
}

.device-data-table :deep(.v-btn) {
  opacity: 0.6;
  transition: opacity 0.2s ease;
}
</style>