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

    <v-card elevation="2">
      <v-card-title class="d-flex align-center justify-space-between">
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
        
        <div class="d-flex align-center ga-2">
          <v-text-field
            v-model="searchInput"
            density="compact"
            variant="outlined"
            hide-details
            placeholder="Search devices..."
            prepend-inner-icon="mdi-magnify"
            style="width: 250px; min-width: 250px;"
            clearable
            @input="onSearchInput"
          />
          
          <v-btn
            color="primary"
            prepend-icon="mdi-sync"
            :loading="devicesStore.loading"
            @click="syncDevices"
          >
            Sync
          </v-btn>
          
          <v-btn
            variant="outlined"
            prepend-icon="mdi-filter"
            @click="showFilters = !showFilters"
          >
            Filters
            <v-badge 
              v-if="activeFiltersCount > 0" 
              :content="activeFiltersCount" 
              color="primary" 
              offset-x="-8" 
              offset-y="8"
            />
          </v-btn>
          
          <v-menu>
            <template #activator="{ props }">
              <v-btn
                variant="outlined"
                prepend-icon="mdi-dots-vertical"
                v-bind="props"
              >
                Actions
              </v-btn>
            </template>
            <v-list>
              <v-list-item
                prepend-icon="mdi-export"
                title="Export CSV"
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
      <v-alert
        v-if="devicesStore.error"
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
      
      <!-- Data Table -->
      <v-data-table-server
        v-model="selectedItems"
        v-model:options="tableOptions"
        :headers="headers"
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
              :color="getDeviceTypeColor(item.type)" 
              size="32" 
              class="mr-3"
            >
              <v-icon :icon="getDeviceIcon(item.type)" color="white" size="small"></v-icon>
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
              :color="getDeviceTypeColor(item.type)"
              :icon="getDeviceIcon(item.type)"
              size="small"
              class="mr-2"
            ></v-icon>
            {{ getDeviceTypeLabel(item.type) }}
          </div>
        </template>

        <template #item.managementMode="{ item }">
          <div class="d-flex align-center">
            <v-chip
              :color="getManagementChip(item).color"
              size="small"
              :variant="getManagementChip(item).variant"
            >
              <v-icon
                start
                :icon="getManagementChip(item).icon"
                size="x-small"
              ></v-icon>
              {{ getManagementChip(item).label }}
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
            :last-tested="item.apiCredential?.lastTested || item.apiLastTested"
            :response-time="item.apiResponseTime"
            :error-message="item.apiError"
          />
        </template>

        <template #item.lastSeen="{ item }">
          <div>
            <div class="text-body-2">{{ formatLastSeen(item.lastSeen) }}</div>
            <div class="text-caption text-medium-emphasis">{{ formatUptime(item.uptime) }}</div>
          </div>
        </template>
        
        <template #item.performance="{ item }">
          <div v-if="item.type === 'Access Point'">
            <div class="text-body-2">{{ item.clients }} clients</div>
            <div class="text-caption text-medium-emphasis">{{ item.bandwidth }}</div>
          </div>
          <div v-else-if="item.type === 'Switch'">
            <div class="text-body-2">{{ item.ports }} ports</div>
            <div class="text-caption text-medium-emphasis">{{ item.utilization }} used</div>
          </div>
          <div v-else-if="item.type === 'Gateway'">
            <div class="text-body-2">{{ item.throughput }}</div>
            <div class="text-caption text-medium-emphasis">{{ item.temperature }}</div>
          </div>
          <div v-else>
            <div class="text-caption text-medium-emphasis">—</div>
          </div>
        </template>
        
        <template #item.actions="{ item }">
          <v-btn
            variant="text"
            size="small"
            icon="mdi-eye"
            @click.stop="viewDevice(item)"
          ></v-btn>
          <v-btn
            variant="text"
            size="small"
            icon="mdi-pencil"
            @click.stop="editDevice(item)"
          ></v-btn>
          <v-menu>
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
                prepend-icon="mdi-restart"
                title="Reboot"
                @click="rebootDevice(item)"
              />
              <v-list-item
                prepend-icon="mdi-information"
                title="Device Info"
                @click="showDeviceInfo(item)"
              />
              <v-divider></v-divider>
              <v-list-item
                prepend-icon="mdi-delete"
                title="Remove"
                class="text-error"
                @click="removeDevice(item)"
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
      
      <!-- Bulk Actions Bar -->
      <v-slide-y-transition>
        <v-card-actions v-if="selectedItems.length > 0" class="bulk-actions-bar">
          <div class="d-flex align-center justify-space-between w-100">
            <div class="d-flex align-center">
              <v-icon class="mr-2" color="primary">mdi-checkbox-marked</v-icon>
              <span class="font-weight-medium">{{ selectedItems.length }} devices selected</span>
            </div>
            
            <div class="d-flex align-center ga-2">
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
                prepend-icon="mdi-restart"
                @click="bulkReboot"
              >
                Reboot Selected
              </v-btn>
              <v-btn
                variant="outlined"
                size="small"
                prepend-icon="mdi-download"
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
    </v-card>

    <DeviceMergeDialog
      v-model="mergeDialog"
      :devices="mergeCandidates"
      @merged="onMerged"
    />

    <DeviceCredentialDialog
      v-model="credentialDialog"
      :device-ids="selectedItems"
      @assigned="refreshTable"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import deviceService from '@/services/device.service'
import { useWebSocket } from '@/composables/useWebSocket'
import { formatDistanceToNow } from 'date-fns'
import { debounce } from 'lodash-es'
import ConnectionStatusBadge from './ConnectionStatusBadge.vue'
import DeviceMergeDialog from './DeviceMergeDialog.vue'
import DeviceCredentialDialog from './DeviceCredentialDialog.vue'
import { cloudProviderLabel, platformOptions } from '@/models/vendors'
import { unreachableFromHere } from '@/models/Device'
import { useSettingsStore } from '@/stores/settings'

const router = useRouter()
const devicesStore = useDevicesStore()
const { connected: wsConnected, connecting: wsConnecting } = useWebSocket()

// Define emits
const emit = defineEmits(['edit-device'])

// Component state
const selectedItems = ref([])
const showFilters = ref(false)
const searchInput = ref('')

// Filters
const filters = ref({
  status: null,
  type: null,
  location: null,
  platform: null,
  credential: null
})

// Table options
const tableOptions = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: []
})

// Table headers
const headers = [
  {
    title: 'Device Name',
    key: 'name',
    sortable: true,
    width: '250px'
  },
  {
    title: 'Type',
    key: 'type',
    sortable: true,
    width: '150px'
  },
  {
    title: 'Managed',
    key: 'managementMode',
    sortable: true,
    width: '120px',
    tooltip: 'How NetHelper reaches this device (a cloud platform, or direct via REST/SSH)'
  },
  {
    title: 'Status',
    key: 'status',
    sortable: true,
    width: '120px',
    tooltip: 'Network reachability status (ICMP ping)'
  },
  {
    title: 'IP Address',
    key: 'ipAddress',
    sortable: true,
    width: '140px'
  },
  {
    title: 'Location',
    key: 'location',
    sortable: true,
    width: '180px'
  },
  {
    title: 'Cloud Status',
    key: 'cloudStatus',
    sortable: true,
    width: '140px',
    tooltip: 'Status as reported by the device\'s cloud platform'
  },
  {
    title: 'API Status',
    key: 'apiStatus',
    sortable: true,
    width: '160px',
    tooltip: 'Device API communication status'
  },
  {
    title: 'Last Seen',
    key: 'lastSeen',
    sortable: true,
    width: '160px'
  },
  {
    title: 'Performance',
    key: 'performance',
    sortable: false,
    width: '140px'
  },
  {
    title: 'Actions',
    key: 'actions',
    sortable: false,
    width: '120px'
  }
]

// Filter options
const statusOptions = [
  { title: 'Online', value: 'online' },
  { title: 'Offline', value: 'offline' },
  { title: 'Warning', value: 'warning' },
  { title: 'Maintenance', value: 'maintenance' }
]

// Keyed by the backend DeviceType enum values.
const deviceTypeInfo = {
  access_point: { label: 'Access Point', icon: 'mdi-wifi', color: 'blue' },
  switch: { label: 'Switch', icon: 'mdi-switch', color: 'green' },
  gateway: { label: 'Gateway', icon: 'mdi-router-wireless', color: 'orange' },
  controller: { label: 'Controller', icon: 'mdi-server', color: 'purple' },
  other: { label: 'Other', icon: 'mdi-help-circle', color: 'grey' }
}

const typeOptions = Object.entries(deviceTypeInfo).map(([value, info]) => ({ title: info.label, value }))

const platformFilterOptions = platformOptions()

// Credential filter: 'none' / 'any' or a specific credential. "No credential"
// plus a platform, then select-all, is the quick way to link a fleet.
const settingsStore = useSettingsStore()
const credentialFilterOptions = computed(() => [
  { title: 'No credential', value: 'none' },
  { title: 'Any credential', value: 'any' },
  ...(settingsStore.apiCredentials || []).map((c) => ({ title: c.name, value: c.id }))
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
    credential: null
  }
  searchInput.value = ''
  loadItems({
    ...tableOptions.value,
    page: 1
  })
}

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

const rebootDevice = (device) => {
  console.log('Rebooting device:', device.name)
}

const removeDevice = (device) => {
  console.log('Removing device:', device.name)
}

const showDeviceInfo = (device) => {
  console.log('Showing device info:', device)
}

// Bulk actions
const authStore = useAuthStore()
const notifications = useNotificationsStore()
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))
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

const bulkReboot = () => {
  console.log('Bulk rebooting devices:', selectedItems.value)
}

const exportSelected = () => {
  console.log('Exporting selected devices:', selectedItems.value)
}

const exportToCsv = () => {
  console.log('Exporting all devices to CSV')
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

const getDeviceIcon = (type) => deviceTypeInfo[type]?.icon || 'mdi-help-circle'

const getDeviceTypeLabel = (type) => deviceTypeInfo[type]?.label || type || 'Unknown'

// Name of the cloud plane managing a device ("Central", "Mist", ...), for
// labels and tooltips. Falls back to the generic "Cloud" when unknown.
const cloudPlaneName = (item) =>
  cloudProviderLabel(item.cloudIntegration?.provider)

// Three-state "Managed" chip: prefers the device-reported cloudManaged truth
// over the record-keeping managementMode field, falling back to the latter
// (marked "unverified") when the device has never been probed.
const getManagementChip = (item) => {
  const plane = cloudPlaneName(item)
  if (item.cloudManaged === true) {
    return { label: `${plane}-managed`, color: 'info', variant: 'tonal', icon: 'mdi-cloud' }
  }
  if (item.cloudManaged === false) {
    return { label: 'Locally managed', color: 'success', variant: 'tonal', icon: 'mdi-lan-connect' }
  }
  // cloudManaged is null/undefined - fall back to managementMode, unverified
  if (item.managementMode === 'cloud') {
    return { label: `${plane} (unverified)`, color: 'grey', variant: 'outlined', icon: 'mdi-cloud-outline' }
  }
  return { label: 'Direct (unverified)', color: 'grey', variant: 'outlined', icon: 'mdi-lan-connect' }
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

const getDeviceTypeColor = (type) => deviceTypeInfo[type]?.color || 'grey'

const formatLastSeen = (lastSeen) => {
  if (!lastSeen) return 'Unknown'
  
  try {
    return formatDistanceToNow(new Date(lastSeen), { addSuffix: true })
  } catch (error) {
    return 'Unknown'
  }
}

const formatUptime = (uptime) => {
  return uptime || 'Unknown'
}

const getApiConnectionStatus = (device) => {
  // If device has credentials configured
  if (device.apiCredentialId) {
    // Check if we have the credential object with test status
    const lastTested = device.apiCredential?.lastTested || device.apiLastTested
    const testStatus = device.apiCredential?.lastTestStatus || device.apiTestStatus

    // If test was performed
    if (lastTested) {
      // Check test result
      if (testStatus === 'success') {
        return 'connected'
      } else {
        return 'failed'
      }
    } else {
      // Has credentials but never tested
      return 'untested'
    }
  } else {
    // No credentials configured
    return 'no-credentials'
  }
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

// Initialize table
onMounted(() => {
  if (canEdit.value && !settingsStore.apiCredentials?.length) {
    settingsStore.fetchApiCredentials().catch(() => {})
  }
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

.bulk-actions-bar {
  background-color: rgba(var(--v-theme-primary), 0.1);
  border-top: 1px solid rgba(var(--v-theme-primary), 0.2);
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