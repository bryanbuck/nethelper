<template>
  <div class="device-discovery-view">
    <v-container fluid class="pa-4">
      <!-- Header Section -->
      <div class="d-flex align-center justify-space-between mb-6">
        <div>
          <h1 class="text-h4 font-weight-bold mb-1">Device Discovery</h1>
          <p class="text-subtitle-1 text-medium-emphasis mb-0">
            Scan your network for Aruba devices and import them into the inventory
          </p>
        </div>

        <div class="d-flex align-center ga-2">
          <v-chip
            :color="connectionStatus.color"
            variant="flat"
            size="small"
            prepend-icon="mdi-circle"
          >
            {{ connectionStatus.text }}
          </v-chip>

          <v-btn
            variant="outlined"
            prepend-icon="mdi-refresh"
            :loading="discoveryStore.scansLoading"
            @click="refreshScans"
          >
            Refresh
          </v-btn>

          <v-btn
            color="secondary"
            prepend-icon="mdi-radar"
            :disabled="discoveryStore.isScanning"
            @click="openScanDialog"
          >
            New Scan
          </v-btn>
        </div>
      </div>

      <!-- Active Scan Progress -->
      <v-card v-if="discoveryStore.isScanning" class="mb-6" variant="tonal" color="info">
        <v-card-text>
          <div class="d-flex align-center justify-space-between mb-2">
            <div class="d-flex align-center">
              <v-progress-circular
                indeterminate
                size="20"
                width="2"
                color="info"
                class="mr-3"
              />
              <span class="text-subtitle-1 font-weight-medium">Discovery scan in progress</span>
              <v-chip v-if="scanPhase" size="small" variant="flat" color="info" class="ml-3">
                {{ scanPhase }}
              </v-chip>
            </div>
            <span class="text-h6 font-weight-bold">{{ scanProgressValue }}%</span>
          </div>

          <v-progress-linear
            :model-value="scanProgressValue"
            color="info"
            height="8"
            rounded
          />

          <div v-if="scanMessage" class="text-body-2 text-medium-emphasis mt-2">
            {{ scanMessage }}
          </div>
        </v-card-text>
      </v-card>

      <!-- Scan History -->
      <v-card class="mb-6">
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-history</v-icon>
          Scan History
        </v-card-title>

        <v-data-table
          :headers="scanHeaders"
          :items="discoveryStore.scans"
          :loading="discoveryStore.scansLoading"
          item-value="id"
          density="comfortable"
          :items-per-page="10"
          no-data-text="No discovery scans yet. Start a new scan to find devices on your network."
        >
          <template #item.status="{ item }">
            <v-chip
              :color="getScanStatusColor(item.status)"
              size="small"
              variant="flat"
            >
              {{ item.status }}
            </v-chip>
          </template>

          <template #item.subnets="{ item }">
            <span class="text-body-2">{{ formatSubnets(item.subnets) }}</span>
          </template>

          <template #item.discovered="{ item }">
            {{ item._count?.discoveredDevices ?? 0 }}
          </template>

          <template #item.createdAt="{ item }">
            {{ formatDate(item.createdAt) }}
          </template>

          <template #item.actions="{ item }">
            <v-btn
              icon="mdi-eye"
              size="small"
              variant="text"
              :loading="discoveryStore.activeScanLoading && discoveryStore.activeScan?.id === item.id"
              @click="viewScan(item)"
            >
              <v-icon>mdi-eye</v-icon>
              <v-tooltip activator="parent" location="top">View Results</v-tooltip>
            </v-btn>
            <v-btn
              v-if="isAdmin"
              icon="mdi-delete"
              size="small"
              variant="text"
              color="error"
              @click="confirmDeleteScan(item)"
            >
              <v-icon>mdi-delete</v-icon>
              <v-tooltip activator="parent" location="top">Delete Scan</v-tooltip>
            </v-btn>
          </template>
        </v-data-table>
      </v-card>

      <!-- Scan Results -->
      <v-card v-if="discoveryStore.activeScan">
        <v-card-title class="d-flex align-center flex-wrap">
          <v-icon class="mr-2">mdi-lan-connect</v-icon>
          Scan Results
          <v-chip size="small" variant="tonal" class="ml-3">
            {{ formatDate(discoveryStore.activeScan.createdAt) }}
          </v-chip>

          <v-spacer />

          <v-chip size="small" variant="tonal" color="primary" class="mr-2">
            {{ discoveryStore.activeScan.totalHosts }} hosts
          </v-chip>
          <v-chip size="small" variant="tonal" color="success" class="mr-2">
            {{ discoveryStore.activeScan.arubaHosts }} Aruba
          </v-chip>
          <v-chip size="small" variant="tonal" color="info">
            {{ discoveryStore.newDevices.length }} new
          </v-chip>
        </v-card-title>

        <v-card-text v-if="discoveryStore.activeScan.status === 'failed'" class="pt-0">
          <v-alert type="error" variant="tonal" density="compact">
            Scan failed: {{ discoveryStore.activeScan.error || 'Unknown error' }}
          </v-alert>
        </v-card-text>

        <v-card-text class="pb-0">
          <div class="d-flex align-center flex-wrap ga-4">
            <v-btn-toggle
              v-model="resultsFilter"
              color="primary"
              variant="outlined"
              density="compact"
              mandatory
            >
              <v-btn value="all">All</v-btn>
              <v-btn value="aruba">Aruba Only</v-btn>
              <v-btn value="new">New Only</v-btn>
            </v-btn-toggle>

            <v-text-field
              v-model="resultsSearch"
              label="Search results"
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              style="max-width: 300px"
            />
          </div>
        </v-card-text>

        <v-data-table
          :headers="resultHeaders"
          :items="filteredResults"
          :loading="discoveryStore.activeScanLoading"
          :search="resultsSearch"
          item-value="id"
          density="comfortable"
          :items-per-page="25"
          no-data-text="No devices found in this scan"
        >
          <template #item.ipAddress="{ item }">
            <span class="font-weight-medium">{{ item.ipAddress }}</span>
          </template>

          <template #item.vendor="{ item }">
            <div class="d-flex align-center">
              <v-icon
                v-if="item.isArubaVendor"
                color="success"
                size="small"
                class="mr-1"
              >
                mdi-check-decagram
              </v-icon>
              {{ item.vendor || '—' }}
            </div>
          </template>

          <template #item.openPorts="{ item }">
            <span class="text-body-2">{{ (item.openPorts || []).join(', ') || '—' }}</span>
          </template>

          <template #item.suggestedType="{ item }">
            <v-chip
              v-if="item.suggestedType"
              size="small"
              variant="tonal"
              color="primary"
            >
              {{ formatDeviceType(item.suggestedType) }}
            </v-chip>
            <span v-else class="text-medium-emphasis">—</span>
          </template>

          <template #item.centralMatch="{ item }">
            <v-chip
              v-if="item.centralMatch"
              size="small"
              variant="tonal"
              color="success"
            >
              {{ item.centralMatch.deviceName || item.centralMatch.serial }}
              <v-tooltip activator="parent" location="top">
                Matched in Aruba Central:
                {{ item.centralMatch.model || 'Unknown model' }}
                ({{ item.centralMatch.status || 'unknown status' }})
              </v-tooltip>
            </v-chip>
            <span v-else class="text-medium-emphasis">—</span>
          </template>

          <template #item.conflictType="{ item }">
            <v-chip
              v-if="item.conflictType"
              size="small"
              variant="tonal"
              color="warning"
            >
              {{ formatConflict(item.conflictType) }}
            </v-chip>
            <span v-else class="text-medium-emphasis">—</span>
          </template>

          <template #item.status="{ item }">
            <v-chip
              :color="getDiscoveredStatusColor(item.status)"
              size="small"
              variant="flat"
            >
              {{ item.status }}
            </v-chip>
          </template>

          <template #item.actions="{ item }">
            <template v-if="item.status === 'new'">
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                class="mr-2"
                @click="openImportDialog(item)"
              >
                Import
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                :loading="ignoringId === item.id"
                @click="ignoreDevice(item)"
              >
                Ignore
              </v-btn>
            </template>
            <span v-else class="text-medium-emphasis text-body-2">—</span>
          </template>
        </v-data-table>
      </v-card>
    </v-container>

    <!-- New Scan Dialog -->
    <v-dialog
      v-model="showScanDialog"
      max-width="600px"
      persistent
    >
      <v-card>
        <v-card-title class="text-h5">
          Start Discovery Scan
        </v-card-title>

        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12">
                <v-switch
                  v-model="autoDetectSubnets"
                  label="Auto-detect subnets from server interfaces"
                  color="primary"
                  hide-details
                />
              </v-col>

              <v-col v-if="!autoDetectSubnets" cols="12">
                <v-combobox
                  v-model="selectedSubnets"
                  :items="suggestedSubnetItems"
                  :loading="discoveryStore.subnetsLoading"
                  label="Subnets to Scan"
                  variant="outlined"
                  multiple
                  chips
                  closable-chips
                  clearable
                  hint="Select suggested subnets or type CIDR ranges (e.g. 192.168.1.0/24) and press Enter"
                  persistent-hint
                  :rules="[rules.subnetList]"
                />
              </v-col>

              <v-col cols="12">
                <v-alert type="info" variant="tonal" density="compact">
                  The scan performs a ping sweep followed by port fingerprinting.
                  Larger subnets take longer to complete. Progress is reported in real time.
                </v-alert>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="closeScanDialog"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="discoveryStore.starting"
            @click="startScan"
          >
            Start Scan
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Import Device Dialog -->
    <v-dialog
      v-model="showImportDialog"
      max-width="600px"
      persistent
    >
      <v-card>
        <v-card-title class="text-h5">
          Import Discovered Device
        </v-card-title>

        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12">
                <v-alert
                  v-if="importTarget?.conflictType"
                  type="warning"
                  variant="tonal"
                  density="compact"
                >
                  This device conflicts with an existing inventory device
                  ({{ formatConflict(importTarget.conflictType) }}).
                  Enable "Update existing device" below to merge the scanned
                  IP/MAC into the existing record instead of creating a new one.
                </v-alert>

                <v-alert
                  v-if="importConflictMessage"
                  type="warning"
                  variant="tonal"
                  density="compact"
                  class="mt-2"
                >
                  {{ importConflictMessage }}
                </v-alert>
              </v-col>

              <v-col v-if="importTarget?.conflictType || importConflictMessage" cols="12">
                <v-checkbox
                  v-model="importForm.updateExisting"
                  label="Update existing device (merge scan data)"
                  color="warning"
                  hide-details
                />
              </v-col>

              <template v-if="!importForm.updateExisting">
                <v-col cols="12" sm="6">
                  <v-text-field
                    v-model="importForm.name"
                    label="Device Name"
                    variant="outlined"
                    :hint="importTarget?.suggestedName ? 'Suggested from scan' : ''"
                    persistent-hint
                  />
                </v-col>

                <v-col cols="12" sm="6">
                  <v-select
                    v-model="importForm.type"
                    label="Device Type"
                    :items="deviceTypeItems"
                    item-title="title"
                    item-value="value"
                    variant="outlined"
                    :rules="importTarget?.suggestedType ? [] : [rules.required]"
                    :hint="importTarget?.suggestedType ? 'Detected from scan' : 'Required (not auto-detected)'"
                    persistent-hint
                  />
                </v-col>

                <v-col cols="12" sm="6">
                  <v-text-field
                    v-model="importForm.serial"
                    label="Serial Number"
                    variant="outlined"
                    :hint="serialHint"
                    persistent-hint
                  />
                </v-col>

                <v-col cols="12" sm="6">
                  <v-text-field
                    v-model="importForm.model"
                    label="Model"
                    variant="outlined"
                  />
                </v-col>

                <v-col cols="12">
                  <v-text-field
                    v-model="importForm.location"
                    label="Location"
                    variant="outlined"
                  />
                </v-col>
              </template>

              <v-col cols="12">
                <v-list density="compact" class="bg-transparent">
                  <v-list-item prepend-icon="mdi-ip-network" :title="importTarget?.ipAddress || '—'" subtitle="IP Address" />
                  <v-list-item prepend-icon="mdi-lan" :title="importTarget?.macAddress || 'Not detected'" subtitle="MAC Address" />
                  <v-list-item
                    v-if="importTarget?.centralMatch"
                    prepend-icon="mdi-cloud-check"
                    :title="`${importTarget.centralMatch.deviceName || importTarget.centralMatch.serial} (${importTarget.centralMatch.model || 'Unknown model'})`"
                    subtitle="Aruba Central Match"
                  />
                </v-list>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="closeImportDialog"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="importing"
            @click="importDevice"
          >
            {{ importForm.updateExisting ? 'Merge Into Existing' : 'Import Device' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Scan Confirmation Dialog -->
    <v-dialog
      v-model="showDeleteDialog"
      max-width="450px"
    >
      <v-card>
        <v-card-title class="text-h5">
          Delete Scan
        </v-card-title>

        <v-card-text>
          Are you sure you want to delete this scan and all of its results?
          This action cannot be undone.
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="showDeleteDialog = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="deleting"
            @click="deleteScan"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar for notifications -->
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="snackbar.timeout"
      location="bottom right"
    >
      {{ snackbar.message }}
      <template #actions>
        <v-btn
          icon="mdi-close"
          variant="text"
          @click="snackbar.show = false"
        >
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useDiscoveryStore } from '@/stores/discovery'
import { useWebSocket } from '@/composables/useWebSocket'

const authStore = useAuthStore()
const discoveryStore = useDiscoveryStore()
const { connected, connecting } = useWebSocket()

// Component state
const showScanDialog = ref(false)
const showImportDialog = ref(false)
const showDeleteDialog = ref(false)
const autoDetectSubnets = ref(true)
const selectedSubnets = ref([])
const resultsFilter = ref('all')
const resultsSearch = ref('')
const importing = ref(false)
const deleting = ref(false)
const ignoringId = ref(null)
const importTarget = ref(null)
const importConflictMessage = ref('')
const scanToDelete = ref(null)

const importForm = ref({
  name: '',
  type: null,
  serial: '',
  model: '',
  location: '',
  updateExisting: false
})

const snackbar = ref({
  show: false,
  message: '',
  color: 'success',
  timeout: 4000
})

// Form validation rules
const cidrPattern = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/
const rules = {
  required: value => !!value || 'This field is required',
  subnetList: value => {
    if (!value || value.length === 0) return 'Select at least one subnet or enable auto-detect'
    const invalid = value.find(subnet => !cidrPattern.test(subnet))
    return invalid ? `"${invalid}" is not a valid CIDR range (e.g. 192.168.1.0/24)` : true
  }
}

// Device types (backend values with display labels)
const deviceTypeItems = [
  { title: 'Access Point', value: 'access_point' },
  { title: 'Switch', value: 'switch' },
  { title: 'Gateway', value: 'gateway' }
]

// Table headers
const scanHeaders = [
  { title: 'Started', key: 'createdAt' },
  { title: 'Status', key: 'status' },
  { title: 'Subnets', key: 'subnets', sortable: false },
  { title: 'Hosts', key: 'totalHosts' },
  { title: 'Aruba', key: 'arubaHosts' },
  { title: 'Discovered', key: 'discovered', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' }
]

const resultHeaders = [
  { title: 'IP Address', key: 'ipAddress' },
  { title: 'MAC Address', key: 'macAddress' },
  { title: 'Vendor', key: 'vendor' },
  { title: 'Hostname', key: 'hostname' },
  { title: 'Open Ports', key: 'openPorts', sortable: false },
  { title: 'Suggested Type', key: 'suggestedType' },
  { title: 'Central Match', key: 'centralMatch', sortable: false },
  { title: 'Conflict', key: 'conflictType' },
  { title: 'Status', key: 'status' },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' }
]

// Computed properties
const connectionStatus = computed(() => {
  if (connected.value) {
    return { text: 'Connected', color: 'success' }
  } else if (connecting.value) {
    return { text: 'Connecting...', color: 'warning' }
  } else {
    return { text: 'Disconnected', color: 'error' }
  }
})

const isAdmin = computed(() => authStore.user?.role === 'admin')

const scanProgressValue = computed(() => discoveryStore.scanProgress?.progress ?? discoveryStore.runningScan?.progress ?? 0)
const scanPhase = computed(() => discoveryStore.scanProgress?.phase || null)
const scanMessage = computed(() => discoveryStore.scanProgress?.message || null)

const suggestedSubnetItems = computed(() =>
  discoveryStore.subnets.map(entry => entry.subnet)
)

const filteredResults = computed(() => {
  const devices = discoveryStore.discoveredDevices
  if (resultsFilter.value === 'aruba') {
    return devices.filter(device => device.isArubaVendor)
  }
  if (resultsFilter.value === 'new') {
    return devices.filter(device => device.status === 'new')
  }
  return devices
})

const serialHint = computed(() => {
  if (importTarget.value?.centralSerial) return 'Detected from Aruba Central'
  if (importTarget.value?.macAddress) return 'Defaults to MAC address if left blank'
  return 'Required (not auto-detected)'
})

// Formatters
const formatDate = (value) => {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const formatSubnets = (subnets) => {
  if (!subnets || subnets.length === 0) return '—'
  return Array.isArray(subnets) ? subnets.join(', ') : String(subnets)
}

const formatDeviceType = (type) => {
  const labels = {
    access_point: 'Access Point',
    switch: 'Switch',
    gateway: 'Gateway'
  }
  return labels[type] || type
}

const formatConflict = (conflictType) => {
  const labels = {
    ip_conflict: 'IP Conflict',
    mac_conflict: 'MAC Conflict',
    serial_conflict: 'Serial Conflict',
    central_managed: 'Central Managed'
  }
  return labels[conflictType] || conflictType
}

const getScanStatusColor = (status) => {
  const colors = {
    pending: 'grey',
    running: 'info',
    completed: 'success',
    failed: 'error'
  }
  return colors[status] || 'grey'
}

const getDiscoveredStatusColor = (status) => {
  const colors = {
    new: 'info',
    imported: 'success',
    ignored: 'grey'
  }
  return colors[status] || 'grey'
}

const showSnackbar = (message, color = 'success') => {
  snackbar.value = {
    show: true,
    message,
    color,
    timeout: 4000
  }
}

// Methods
const refreshScans = async () => {
  try {
    await discoveryStore.fetchScans()
    if (discoveryStore.activeScan) {
      await discoveryStore.fetchScan(discoveryStore.activeScan.id)
    }
  } catch (error) {
    showSnackbar(error.userMessage || 'Failed to refresh scans', 'error')
  }
}

const openScanDialog = async () => {
  showScanDialog.value = true
  try {
    await discoveryStore.fetchSubnets()
  } catch (error) {
    console.error('Failed to load suggested subnets:', error)
  }
}

const closeScanDialog = () => {
  showScanDialog.value = false
  autoDetectSubnets.value = true
  selectedSubnets.value = []
}

const startScan = async () => {
  if (!autoDetectSubnets.value) {
    const validation = rules.subnetList(selectedSubnets.value)
    if (validation !== true) {
      showSnackbar(validation, 'error')
      return
    }
  }

  try {
    await discoveryStore.startScan(autoDetectSubnets.value ? null : selectedSubnets.value)
    showSnackbar('Discovery scan started', 'success')
    closeScanDialog()
  } catch (error) {
    if (error.statusCode === 409) {
      showSnackbar(error.userMessage || 'A discovery scan is already running', 'warning')
    } else {
      showSnackbar(error.userMessage || 'Failed to start discovery scan', 'error')
    }
  }
}

const viewScan = async (scan) => {
  try {
    await discoveryStore.fetchScan(scan.id)
  } catch (error) {
    showSnackbar(error.userMessage || 'Failed to load scan results', 'error')
  }
}

const confirmDeleteScan = (scan) => {
  scanToDelete.value = scan
  showDeleteDialog.value = true
}

const deleteScan = async () => {
  if (!scanToDelete.value) return

  deleting.value = true
  try {
    await discoveryStore.deleteScan(scanToDelete.value.id)
    showSnackbar('Scan deleted', 'success')
    showDeleteDialog.value = false
    scanToDelete.value = null
  } catch (error) {
    showSnackbar(error.userMessage || 'Failed to delete scan', 'error')
  } finally {
    deleting.value = false
  }
}

const openImportDialog = (device) => {
  importTarget.value = device
  importConflictMessage.value = ''
  importForm.value = {
    name: device.suggestedName || device.hostname || device.ipAddress || '',
    type: device.suggestedType || null,
    serial: device.centralSerial || '',
    model: device.centralMatch?.model || '',
    location: '',
    updateExisting: false
  }
  showImportDialog.value = true
}

const closeImportDialog = () => {
  showImportDialog.value = false
  importTarget.value = null
  importConflictMessage.value = ''
  importForm.value = {
    name: '',
    type: null,
    serial: '',
    model: '',
    location: '',
    updateExisting: false
  }
}

const importDevice = async () => {
  if (!importTarget.value) return

  importing.value = true
  try {
    const payload = {}
    if (importForm.value.updateExisting) {
      payload.updateExisting = true
    } else {
      if (importForm.value.name) payload.name = importForm.value.name
      if (importForm.value.type) payload.type = importForm.value.type
      if (importForm.value.serial) payload.serial = importForm.value.serial
      if (importForm.value.model) payload.model = importForm.value.model
      if (importForm.value.location) payload.location = importForm.value.location
    }

    const response = await discoveryStore.importDevice(importTarget.value.id, payload)
    showSnackbar(
      response.merged
        ? 'Scan data merged into existing device'
        : 'Device imported successfully',
      'success'
    )
    closeImportDialog()
  } catch (error) {
    if (error.statusCode === 409) {
      // Conflict - surface the message and offer the merge option
      importConflictMessage.value = error.userMessage || 'This device conflicts with an existing device.'
    } else {
      showSnackbar(error.userMessage || 'Failed to import device', 'error')
    }
  } finally {
    importing.value = false
  }
}

const ignoreDevice = async (device) => {
  ignoringId.value = device.id
  try {
    await discoveryStore.ignoreDevice(device.id)
    showSnackbar('Device ignored', 'success')
  } catch (error) {
    showSnackbar(error.userMessage || 'Failed to ignore device', 'error')
  } finally {
    ignoringId.value = null
  }
}

// Initialize
onMounted(async () => {
  try {
    const scans = await discoveryStore.fetchScans()

    // Auto-load the most recent completed scan's results
    const latestCompleted = scans.find(scan => scan.status === 'completed')
    if (latestCompleted && !discoveryStore.activeScan) {
      await discoveryStore.fetchScan(latestCompleted.id)
    }
  } catch (error) {
    console.error('Failed to initialize discovery view:', error)
  }
})
</script>

<style scoped>
.device-discovery-view {
  background-color: rgb(var(--v-theme-background));
  min-height: 100vh;
}
</style>
