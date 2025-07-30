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
      <DeviceTable />
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
              
              <v-col cols="12">
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
                />
              </v-col>
              
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.model"
                  label="Model"
                  variant="outlined"
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
          variant="text" 
          @click="snackbar.show = false"
        >
          Close
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useWebSocket } from '@/composables/useWebSocket'
import DeviceTable from '@/components/devices/DeviceTable.vue'

const router = useRouter()
const route = useRoute()
const devicesStore = useDevicesStore()
const { connected, connecting } = useWebSocket()

// Component state
const showAddDialog = ref(false)
const saving = ref(false)
const newDevice = ref({
  name: '',
  type: '',
  ipAddress: '',
  macAddress: '',
  location: '',
  serialNumber: '',
  model: ''
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
  'Gateway',
  'Controller',
  'Router',
  'Firewall'
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
const addDevice = () => {
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
    model: ''
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
    // Generate mock device data
    const deviceToAdd = {
      id: Date.now().toString(),
      ...newDevice.value,
      status: 'online',
      lastSeen: new Date().toISOString(),
      uptime: '0m',
      firmware: '10.0.0',
      macAddress: newDevice.value.macAddress || generateRandomMac()
    }
    
    // Add type-specific properties
    if (deviceToAdd.type === 'Access Point') {
      deviceToAdd.clients = 0
      deviceToAdd.bandwidth = '0 Mbps'
      deviceToAdd.channel = 1
    } else if (deviceToAdd.type === 'Switch') {
      deviceToAdd.ports = 24
      deviceToAdd.utilization = '0%'
      deviceToAdd.vlanCount = 1
    } else if (deviceToAdd.type === 'Gateway') {
      deviceToAdd.throughput = '0 Mbps'
      deviceToAdd.temperature = '65°C'
      deviceToAdd.wanStatus = 'up'
    }
    
    // Add to store
    devicesStore.addDevice(deviceToAdd)
    
    showSnackbar('Device added successfully', 'success')
    closeAddDialog()
    
  } catch (error) {
    console.error('Failed to add device:', error)
    showSnackbar('Failed to add device', 'error')
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
</style>