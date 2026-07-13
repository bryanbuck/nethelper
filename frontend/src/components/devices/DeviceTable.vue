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
            <template v-slot:activator="{ props }">
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
                  <template v-slot:selection="{ item }">
                    <v-chip :color="getStatusColor(item.value)" size="small">
                      {{ item.title }}
                    </v-chip>
                  </template>
                  <template v-slot:item="{ props, item }">
                    <v-list-item v-bind="props">
                      <template v-slot:prepend>
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
                <v-select
                  v-model="filters.location"
                  label="Location"
                  :items="locationOptions"
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
                  @click="clearFilters"
                  :disabled="activeFiltersCount === 0"
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
        @update:options="loadItems"
        @click:row="handleRowClick"
        class="device-data-table"
      >
        <template v-slot:item.name="{ item }">
          <div class="d-flex align-center">
            <v-avatar 
              :color="getDeviceTypeColor(item.type)" 
              size="32" 
              class="mr-3"
            >
              <v-icon :icon="getDeviceIcon(item.type)" color="white" size="small"></v-icon>
            </v-avatar>
            <div>
              <div class="font-weight-medium">{{ item.name }}</div>
              <div class="text-caption text-medium-emphasis">{{ item.model }}</div>
            </div>
          </div>
        </template>
        
        <template v-slot:item.status="{ item }">
          <v-tooltip location="bottom">
            <template v-slot:activator="{ props }">
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
              <div v-if="item.pingLastChecked">
                <strong>Ping Status:</strong> {{ item.status }}<br>
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
        
        <template v-slot:item.type="{ item }">
          <div class="d-flex align-center">
            <v-icon
              :color="getDeviceTypeColor(item.type)"
              :icon="getDeviceIcon(item.type)"
              size="small"
              class="mr-2"
            ></v-icon>
            {{ item.type }}
          </div>
        </template>

        <template v-slot:item.managementMode="{ item }">
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
              <template v-slot:activator="{ props }">
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

        <template v-slot:item.cloudStatus="{ item }">
          <v-tooltip location="bottom">
            <template v-slot:activator="{ props }">
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

        <template v-slot:item.apiStatus="{ item }">
          <ConnectionStatusBadge
            :status="getApiConnectionStatus(item)"
            :last-tested="item.apiCredential?.lastTested || item.apiLastTested"
            :response-time="item.apiResponseTime"
            :error-message="item.apiError"
          />
        </template>

        <template v-slot:item.lastSeen="{ item }">
          <div>
            <div class="text-body-2">{{ formatLastSeen(item.lastSeen) }}</div>
            <div class="text-caption text-medium-emphasis">{{ formatUptime(item.uptime) }}</div>
          </div>
        </template>
        
        <template v-slot:item.performance="{ item }">
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
        
        <template v-slot:item.actions="{ item }">
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
            <template v-slot:activator="{ props }">
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
        
        <template v-slot:loading>
          <v-skeleton-loader type="table-row@10"></v-skeleton-loader>
        </template>
        
        <template v-slot:no-data>
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
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useWebSocket } from '@/composables/useWebSocket'
import { formatDistanceToNow } from 'date-fns'
import { debounce } from 'lodash-es'
import ConnectionStatusBadge from './ConnectionStatusBadge.vue'
import { cloudProviderLabel } from '@/models/vendors'

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
  location: null
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

const typeOptions = [
  { title: 'Access Point', value: 'Access Point' },
  { title: 'Switch', value: 'Switch' },
  { title: 'Gateway', value: 'Gateway' }
]

const locationOptions = [
  { title: 'Main Office', value: 'Main Office' },
  { title: 'Server Room', value: 'Server Room' },
  { title: 'Conference Room A', value: 'Conference Room A' },
  { title: 'Conference Room B', value: 'Conference Room B' },
  { title: 'Floor 1 IDF', value: 'Floor 1 IDF' },
  { title: 'Floor 2 IDF', value: 'Floor 2 IDF' },
  { title: 'Floor 3 IDF', value: 'Floor 3 IDF' }
]

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
    location: null
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

const getDeviceIcon = (type) => {
  const icons = {
    'Access Point': 'mdi-wifi',
    'Switch': 'mdi-switch',
    'Gateway': 'mdi-router-wireless',
    'Controller': 'mdi-server'
  }
  return icons[type] || 'mdi-help-circle'
}

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

const getDeviceTypeColor = (type) => {
  const colors = {
    'Access Point': 'blue',
    'Switch': 'green',
    'Gateway': 'orange',
    'Controller': 'purple'
  }
  return colors[type] || 'grey'
}

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
  loadItems({
    page: 1,
    itemsPerPage: 10,
    sortBy: []
  })
})
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