<template>
  <div class="devices-view">
    <v-container fluid class="pa-4">
      <!-- Header Section -->
      <div class="d-flex align-center justify-space-between mb-6">
        <div>
          <h1 class="text-h4 font-weight-bold mb-1">Device Management</h1>
          <p class="text-subtitle-1 text-medium-emphasis mb-0">
            Monitor and manage your network infrastructure devices
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
            color="secondary"
            prepend-icon="mdi-plus"
            @click="addDevice"
          >
            Add Device
          </v-btn>
        </div>
      </div>
      
      <!-- Quick Stats Cards -->
      <v-row class="mb-6">
        <v-col cols="12" sm="6" md="3">
          <v-card variant="tonal" color="success">
            <v-card-text class="d-flex align-center">
              <div class="flex-grow-1">
                <div class="text-h5 font-weight-bold">{{ devicesStore.stats.online }}</div>
                <div class="text-body-2">Online Devices</div>
              </div>
              <v-icon size="32" color="success">mdi-check-circle</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
        
        <v-col cols="12" sm="6" md="3">
          <v-card variant="tonal" color="error">
            <v-card-text class="d-flex align-center">
              <div class="flex-grow-1">
                <div class="text-h5 font-weight-bold">{{ devicesStore.stats.offline }}</div>
                <div class="text-body-2">Offline Devices</div>
              </div>
              <v-icon size="32" color="error">mdi-close-circle</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
        
        <v-col cols="12" sm="6" md="3">
          <v-card variant="tonal" color="warning">
            <v-card-text class="d-flex align-center">
              <div class="flex-grow-1">
                <div class="text-h5 font-weight-bold">{{ devicesStore.stats.warning }}</div>
                <div class="text-body-2">Warning Devices</div>
              </div>
              <v-icon size="32" color="warning">mdi-alert-circle</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
        
        <v-col cols="12" sm="6" md="3">
          <v-card variant="tonal" color="primary">
            <v-card-text class="d-flex align-center">
              <div class="flex-grow-1">
                <div class="text-h5 font-weight-bold">{{ devicesStore.stats.total }}</div>
                <div class="text-body-2">Total Devices</div>
              </div>
              <v-icon size="32" color="primary">mdi-devices</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
      
      <!-- Device Table -->
      <DeviceTable @edit-device="handleEditDevice" />
    </v-container>
    
    <!-- Add Device Dialog -->
    <v-dialog 
      v-model="showAddDialog" 
      max-width="600px"
      persistent
    >
      <v-card>
        <v-card-title class="text-h5">
          Add New Device
        </v-card-title>
        
        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.name"
                  label="Device Name"
                  variant="outlined"
                  required
                  :rules="[rules.required]"
                />
              </v-col>
              
              <v-col cols="12" sm="6">
                <v-select
                  v-model="newDevice.type"
                  label="Device Type"
                  :items="deviceTypes"
                  variant="outlined"
                  required
                  :rules="[rules.required]"
                />
              </v-col>
              
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.ipAddress"
                  label="IP Address"
                  variant="outlined"
                  required
                  :rules="[rules.required, rules.ipAddress]"
                  hint="Required for device API queries"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.macAddress"
                  label="MAC Address"
                  variant="outlined"
                  :rules="[rules.macAddress]"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.location"
                  label="Location"
                  variant="outlined"
                  required
                  :rules="[rules.required]"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.serialNumber"
                  label="Serial Number"
                  variant="outlined"
                  hint="Optional"
                  persistent-hint
                />
              </v-col>
              
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.model"
                  label="Model"
                  variant="outlined"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="newDevice.managementMode"
                  :items="managementModeOptions"
                  label="Management Mode"
                  variant="outlined"
                  hint="How NetHelper reaches this device"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="newDevice.apiCredentialId"
                  :items="availableCredentials"
                  item-title="name"
                  item-value="id"
                  label="Device Credential"
                  variant="outlined"
                  clearable
                  hint="Required for direct (REST/SSH) access"
                  persistent-hint
                  :disabled="newDevice.managementMode === 'central'"
                />
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="closeAddDialog"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            @click="saveDevice"
            :loading="saving"
          >
            Add Device
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Edit Device Dialog -->
    <v-dialog
      v-model="showEditDialog"
      max-width="600px"
      persistent
    >
      <v-card>
        <v-card-title class="text-h5">
          Edit Device
        </v-card-title>

        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="editingDevice.name"
                  label="Device Name"
                  variant="outlined"
                  required
                  :rules="[rules.required]"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="editingDevice.type"
                  label="Device Type"
                  :items="deviceTypes"
                  variant="outlined"
                  required
                  :rules="[rules.required]"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="editingDevice.ipAddress"
                  label="IP Address"
                  variant="outlined"
                  required
                  :rules="[rules.required, rules.ipAddress]"
                  hint="Required for device API queries"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="editingDevice.macAddress"
                  label="MAC Address"
                  variant="outlined"
                  :rules="[rules.macAddress]"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="editingDevice.location"
                  label="Location"
                  variant="outlined"
                  required
                  :rules="[rules.required]"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="editingDevice.serialNumber"
                  label="Serial Number"
                  variant="outlined"
                  hint="Optional"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="editingDevice.model"
                  label="Model"
                  variant="outlined"
                />
              </v-col>

              <v-col cols="12">
                <v-divider class="my-2"></v-divider>
                <h3 class="text-subtitle-1 mb-3">API Configuration</h3>
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="editingDevice.managementMode"
                  :items="managementModeOptions"
                  label="Management Mode"
                  variant="outlined"
                  prepend-inner-icon="mdi-server-network"
                  hint="Central pulls config from Aruba Central; Direct uses REST/SSH"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="editingDevice.apiCredentialId"
                  :items="availableCredentials"
                  item-title="name"
                  item-value="id"
                  label="API Credential"
                  variant="outlined"
                  prepend-inner-icon="mdi-key-variant"
                  clearable
                  :loading="loadingCredentials"
                  hint="Select the API credentials to use for this device"
                  persistent-hint
                >
                  <template v-slot:item="{ props, item }">
                    <v-list-item
                      v-bind="props"
                      :subtitle="`${item.raw.type} - ${item.raw.username || 'No username'}`"
                    >
                      <template v-slot:append v-if="item.raw.lastTestStatus">
                        <v-chip
                          :color="item.raw.lastTestStatus === 'success' ? 'success' : 'error'"
                          size="x-small"
                          variant="flat"
                        >
                          {{ item.raw.lastTestStatus }}
                        </v-chip>
                      </template>
                    </v-list-item>
                  </template>

                  <template v-slot:selection="{ item }">
                    <div class="d-flex align-center">
                      <span>{{ item.title }}</span>
                      <v-chip
                        v-if="item.raw.lastTestStatus === 'success'"
                        color="success"
                        size="x-small"
                        variant="flat"
                        class="ml-2"
                      >
                        Tested
                      </v-chip>
                    </div>
                  </template>

                  <template v-slot:prepend-item>
                    <v-list-item
                      title="Manage Credentials"
                      prepend-icon="mdi-cog"
                      :to="{ path: '/settings', query: { tab: 'credentials' } }"
                      target="_blank"
                    >
                    </v-list-item>
                    <v-divider class="mb-2"></v-divider>
                  </template>
                </v-select>

                <v-alert
                  v-if="!editingDevice.apiCredentialId"
                  type="info"
                  variant="tonal"
                  density="compact"
                  class="mt-2"
                >
                  No credential assigned. Direct device polling will not be available.
                </v-alert>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="closeEditDialog"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            @click="updateDevice"
            :loading="saving"
          >
            Save Changes
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
      <template v-slot:actions>
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
import { useRouter, useRoute } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useSettingsStore } from '@/stores/settings'
import { useWebSocket } from '@/composables/useWebSocket'
import DeviceTable from '@/components/devices/DeviceTable.vue'

const router = useRouter()
const route = useRoute()
const devicesStore = useDevicesStore()
const settingsStore = useSettingsStore()
const { connected, connecting } = useWebSocket()

// Credentials state
const loadingCredentials = ref(false)
const availableCredentials = computed(() => settingsStore.apiCredentials || [])

// Component state
const showAddDialog = ref(false)
const showEditDialog = ref(false)
const saving = ref(false)
const managementModeOptions = [
  { title: 'Direct (REST/SSH)', value: 'direct' },
  { title: 'Aruba Central', value: 'central' }
]
const newDevice = ref({
  name: '',
  type: '',
  ipAddress: '',
  macAddress: '',
  location: '',
  serialNumber: '',
  model: '',
  managementMode: 'direct',
  apiCredentialId: null
})
const editingDevice = ref({
  id: '',
  name: '',
  type: '',
  ipAddress: '',
  macAddress: '',
  location: '',
  serialNumber: '',
  model: '',
  managementMode: 'direct',
  apiCredentialId: null
})

const snackbar = ref({
  show: false,
  message: '',
  color: 'success',
  timeout: 4000
})

// Form validation rules
const rules = {
  required: value => !!value || 'This field is required',
  ipAddress: value => {
    if (!value) return true
    const pattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    return pattern.test(value) || 'Invalid IP address format'
  },
  macAddress: value => {
    if (!value) return true
    const pattern = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/
    return pattern.test(value) || 'Invalid MAC address format'
  }
}

// Device types
const deviceTypes = [
  'Access Point',
  'Switch',
  'Gateway'
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

// Methods
const addDevice = async () => {
  if (settingsStore.apiCredentials.length === 0) {
    loadingCredentials.value = true
    try {
      await settingsStore.fetchApiCredentials()
    } catch (error) {
      console.error('Failed to load API credentials:', error)
    } finally {
      loadingCredentials.value = false
    }
  }
  showAddDialog.value = true
}

const closeAddDialog = () => {
  showAddDialog.value = false
  newDevice.value = {
    name: '',
    type: '',
    ipAddress: '',
    macAddress: '',
    location: '',
    serialNumber: '',
    model: '',
    managementMode: 'direct',
    apiCredentialId: null
  }
}

const saveDevice = async () => {
  // Validate required fields
  if (!newDevice.value.name || !newDevice.value.type ||
      !newDevice.value.ipAddress || !newDevice.value.location) {
    showSnackbar('Please fill in all required fields', 'error')
    return
  }

  saving.value = true

  try {
    // Map frontend device type to backend format
    const typeMap = {
      'Access Point': 'access_point',
      'Switch': 'switch',
      'Gateway': 'gateway'
    }

    // Prepare device data for backend
    const deviceData = {
      name: newDevice.value.name,
      type: typeMap[newDevice.value.type] || 'gateway',
      ipAddress: newDevice.value.ipAddress, // Required
      macAddress: newDevice.value.macAddress || generateRandomMac(),
      location: newDevice.value.location,
      serial: newDevice.value.serialNumber || '', // Optional - send empty string if not provided
      model: newDevice.value.model || '',
      managementMode: newDevice.value.managementMode || 'direct',
      apiCredentialId: newDevice.value.managementMode === 'central'
        ? null
        : (newDevice.value.apiCredentialId || null)
    }

    // Create device via API
    await devicesStore.createDevice(deviceData)

    showSnackbar('Device added successfully', 'success')
    closeAddDialog()

  } catch (error) {
    console.error('Failed to add device:', error)
    const errorMessage = error.userMessage || error.message || 'Failed to add device'
    showSnackbar(errorMessage, 'error')
  } finally {
    saving.value = false
  }
}

const generateRandomMac = () => {
  const hex = '0123456789ABCDEF'
  let mac = ''
  for (let i = 0; i < 6; i++) {
    if (i > 0) mac += ':'
    mac += hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)]
  }
  return mac
}

const showSnackbar = (message, color = 'success') => {
  snackbar.value = {
    show: true,
    message,
    color,
    timeout: 4000
  }
}

// Handle edit device event from DeviceTable
const handleEditDevice = async (device) => {
  // Map backend device type to frontend format if needed
  const typeMap = {
    'access_point': 'Access Point',
    'switch': 'Switch',
    'gateway': 'Gateway',
    'Access Point': 'Access Point',
    'Switch': 'Switch',
    'Gateway': 'Gateway'
  }

  editingDevice.value = {
    id: device.id,
    name: device.name || '',
    type: typeMap[device.type] || device.type || '',
    ipAddress: device.ipAddress || '',
    macAddress: device.macAddress || '',
    location: device.location || '',
    serialNumber: device.serialNumber || device.serial || '',
    model: device.model || '',
    managementMode: device.managementMode || 'direct',
    apiCredentialId: device.apiCredentialId || null
  }

  // Load API credentials if not already loaded
  if (settingsStore.apiCredentials.length === 0) {
    loadingCredentials.value = true
    try {
      await settingsStore.fetchApiCredentials()
    } catch (error) {
      console.error('Failed to load API credentials:', error)
    } finally {
      loadingCredentials.value = false
    }
  }

  showEditDialog.value = true
}

const closeEditDialog = () => {
  showEditDialog.value = false
  editingDevice.value = {
    id: '',
    name: '',
    type: '',
    ipAddress: '',
    macAddress: '',
    location: '',
    serialNumber: '',
    model: '',
    managementMode: 'direct',
    apiCredentialId: null
  }
}

const updateDevice = async () => {
  // Validate required fields
  if (!editingDevice.value.name || !editingDevice.value.type ||
      !editingDevice.value.ipAddress || !editingDevice.value.location) {
    showSnackbar('Please fill in all required fields', 'error')
    return
  }

  saving.value = true

  try {
    // Map frontend device type to backend format
    const typeMap = {
      'Access Point': 'access_point',
      'Switch': 'switch',
      'Gateway': 'gateway'
    }

    // Prepare device data for backend
    const deviceData = {
      name: editingDevice.value.name,
      type: typeMap[editingDevice.value.type] || 'gateway',
      ipAddress: editingDevice.value.ipAddress,
      macAddress: editingDevice.value.macAddress || '',
      location: editingDevice.value.location,
      serial: editingDevice.value.serialNumber || '',
      model: editingDevice.value.model || '',
      managementMode: editingDevice.value.managementMode || 'direct',
      apiCredentialId: editingDevice.value.apiCredentialId || null
    }

    // Update device via API
    await devicesStore.updateDevice(editingDevice.value.id, deviceData)

    showSnackbar('Device updated successfully', 'success')
    closeEditDialog()

  } catch (error) {
    console.error('Failed to update device:', error)
    const errorMessage = error.userMessage || error.message || 'Failed to update device'
    showSnackbar(errorMessage, 'error')
  } finally {
    saving.value = false
  }
}

// Handle query parameters for filtering
const handleQueryParams = () => {
  if (route.query.status) {
    // The DeviceTable component will handle the initial filtering
    // based on store state updates
  }
}

// Initialize
onMounted(() => {
  handleQueryParams()
})
</script>

<style scoped>
.devices-view {
  background-color: rgb(var(--v-theme-background));
  min-height: 100vh;
}

.stats-card {
  transition: all 0.3s ease;
}

.stats-card:hover {
  transform: translateY(-1px);
}

/* Style the snackbar action button to be bold and match notification text color */
.snackbar-action-btn {
  font-weight: bold !important;
  opacity: 1 !important;
}
</style>