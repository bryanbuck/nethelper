<template>
  <v-container fluid class="device-detail-view">
    <!-- Header with breadcrumbs and actions -->
    <v-row>
      <v-col cols="12">
        <div class="d-flex align-center justify-space-between mb-4">
          <div>
            <v-breadcrumbs
              :items="breadcrumbs"
              divider=">"
              class="pa-0"
            >
              <template v-slot:item="{ item }">
                <v-breadcrumbs-item
                  :to="item.to"
                  :disabled="item.disabled"
                  class="text-body-2"
                >
                  {{ item.text }}
                </v-breadcrumbs-item>
              </template>
            </v-breadcrumbs>
            <h1 class="text-h4 mt-2">
              {{ device?.name || 'Loading...' }}
              <v-chip
                v-if="device"
                :color="getStatusColor(device.status)"
                size="small"
                class="ml-2"
              >
                {{ device.status }}
              </v-chip>
            </h1>
          </div>
          <div class="d-flex gap-2">
            <v-btn
              color="primary"
              variant="outlined"
              :loading="systemLoading"
              @click="refreshSystemInfo"
            >
              <v-icon left>mdi-refresh</v-icon>
              Refresh System Info
            </v-btn>
            <v-btn color="primary" variant="tonal">
              <v-icon left>mdi-cog</v-icon>
              Configure
            </v-btn>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Loading State -->
    <v-row v-if="loading && !device">
      <v-col cols="12" class="text-center py-12">
        <v-progress-circular
          indeterminate
          color="primary"
          size="64"
        />
        <p class="text-h6 mt-4">Loading device details...</p>
      </v-col>
    </v-row>

    <!-- Error State -->
    <v-row v-else-if="error">
      <v-col cols="12">
        <v-alert
          type="error"
          variant="tonal"
          closable
          @click:close="clearError"
        >
          <v-alert-title>Failed to Load Device</v-alert-title>
          {{ error }}
        </v-alert>
      </v-col>
    </v-row>

    <!-- Device Content -->
    <template v-else-if="device">
      <!-- Quick Stats Cards -->
      <v-row>
        <v-col cols="12" md="3">
          <v-card>
            <v-card-text>
              <div class="text-overline text-grey">Device Type</div>
              <div class="text-h5">{{ device.type || 'N/A' }}</div>
              <v-icon class="mt-2" size="large">{{ getDeviceIcon(device.type) }}</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="3">
          <v-card>
            <v-card-text>
              <div class="text-overline text-grey">IP Address</div>
              <div class="text-h6">{{ device.ipAddress || 'N/A' }}</div>
              <div class="text-caption text-grey mt-1">
                {{ device.macAddress || 'MAC: N/A' }}
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="3">
          <v-card>
            <v-card-text>
              <div class="text-overline text-grey">Location</div>
              <div class="text-h6">{{ device.location || 'N/A' }}</div>
              <v-icon left size="small" class="text-grey mt-1">mdi-map-marker</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="3">
          <v-card>
            <v-card-text>
              <div class="text-overline text-grey">Last Seen</div>
              <div class="text-h6">{{ formatTimestamp(device.lastSeen) }}</div>
              <div class="text-caption text-grey mt-1">
                {{ formatRelativeTime(device.lastSeen) }}
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- System Information Section -->
      <v-row class="mt-4">
        <v-col cols="12">
          <v-card>
            <v-card-title class="d-flex align-center justify-space-between">
              <div>
                <v-icon left>mdi-information</v-icon>
                System Information
              </div>
              <div v-if="systemData?.timestamp" class="text-caption text-grey">
                Last updated: {{ formatRelativeTime(systemData.timestamp) }}
              </div>
            </v-card-title>
            <v-divider />

            <!-- System Info Loading -->
            <v-card-text v-if="systemLoading" class="text-center py-8">
              <v-progress-circular indeterminate color="primary" />
              <p class="text-body-2 mt-4">Polling device for system information...</p>
            </v-card-text>

            <!-- System Info Error -->
            <v-card-text v-else-if="systemError">
              <v-alert type="warning" variant="tonal">
                <v-alert-title>Unable to retrieve system information</v-alert-title>
                {{ systemError }}
                <template v-slot:append>
                  <v-btn
                    variant="text"
                    size="small"
                    @click="refreshSystemInfo"
                  >
                    Retry
                  </v-btn>
                </template>
              </v-alert>
            </v-card-text>

            <!-- System Info Content -->
            <v-card-text v-else-if="systemData">
              <v-row>
                <v-col cols="12" md="6">
                  <v-list density="compact">
                    <v-list-item>
                      <template v-slot:prepend>
                        <v-icon>mdi-server</v-icon>
                      </template>
                      <v-list-item-title>Hostname</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.hostname || 'N/A' }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item>
                      <template v-slot:prepend>
                        <v-icon>mdi-chip</v-icon>
                      </template>
                      <v-list-item-title>Platform</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.platform_name || 'N/A' }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item>
                      <template v-slot:prepend>
                        <v-icon>mdi-package-variant</v-icon>
                      </template>
                      <v-list-item-title>Software Version</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.software_version || 'N/A' }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item>
                      <template v-slot:prepend>
                        <v-icon>mdi-clock</v-icon>
                      </template>
                      <v-list-item-title>Boot Time</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ formatBootTime(systemData.boot_time) }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.boot_time">
                      <template v-slot:prepend>
                        <v-icon>mdi-timer</v-icon>
                      </template>
                      <v-list-item-title>Uptime</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ calculateUptime(systemData.boot_time) }}
                      </v-list-item-subtitle>
                    </v-list-item>
                  </v-list>
                </v-col>

                <v-col cols="12" md="6">
                  <v-list density="compact">
                    <v-list-item>
                      <template v-slot:prepend>
                        <v-icon>mdi-earth</v-icon>
                      </template>
                      <v-list-item-title>Timezone</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.timezone || 'N/A' }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.location">
                      <template v-slot:prepend>
                        <v-icon>mdi-map-marker</v-icon>
                      </template>
                      <v-list-item-title>System Location</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.location }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.contact">
                      <template v-slot:prepend>
                        <v-icon>mdi-account</v-icon>
                      </template>
                      <v-list-item-title>System Contact</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.contact }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.description">
                      <template v-slot:prepend>
                        <v-icon>mdi-text</v-icon>
                      </template>
                      <v-list-item-title>Description</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.description }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.usb_status">
                      <template v-slot:prepend>
                        <v-icon>mdi-usb</v-icon>
                      </template>
                      <v-list-item-title>USB Status</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.usb_status }}
                      </v-list-item-subtitle>
                    </v-list-item>
                  </v-list>
                </v-col>
              </v-row>

              <!-- Management Interface Status -->
              <v-row v-if="systemData.mgmt_intf_status" class="mt-4">
                <v-col cols="12">
                  <v-divider class="mb-4" />
                  <h3 class="text-h6 mb-3">Management Interface Status</h3>
                  <v-chip-group>
                    <v-chip
                      v-for="(value, key) in systemData.mgmt_intf_status"
                      :key="key"
                      variant="tonal"
                      class="mr-2 mb-2"
                    >
                      <strong>{{ formatFieldName(key) }}:</strong>&nbsp;{{ value }}
                    </v-chip>
                  </v-chip-group>
                </v-col>
              </v-row>

              <!-- Software Info -->
              <v-row v-if="systemData.software_info" class="mt-4">
                <v-col cols="12">
                  <v-divider class="mb-4" />
                  <h3 class="text-h6 mb-3">Software Information</h3>
                  <v-chip-group>
                    <v-chip
                      v-for="(value, key) in systemData.software_info"
                      :key="key"
                      variant="tonal"
                      class="mr-2 mb-2"
                    >
                      <strong>{{ formatFieldName(key) }}:</strong>&nbsp;{{ formatValue(value) }}
                    </v-chip>
                  </v-chip-group>
                </v-col>
              </v-row>
            </v-card-text>

            <!-- No System Data -->
            <v-card-text v-else class="text-center py-8">
              <v-icon size="64" color="grey-lighten-1">mdi-information-outline</v-icon>
              <p class="text-h6 mt-4 text-grey">No system information available</p>
              <p class="text-body-2 text-grey">
                Click "Refresh System Info" to poll the device for current system information
              </p>
              <v-btn
                color="primary"
                variant="tonal"
                class="mt-4"
                @click="refreshSystemInfo"
              >
                <v-icon left>mdi-refresh</v-icon>
                Refresh System Info
              </v-btn>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Additional Device Information -->
      <v-row class="mt-4">
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title>
              <v-icon left>mdi-information-outline</v-icon>
              Device Details
            </v-card-title>
            <v-divider />
            <v-card-text>
              <v-list density="compact">
                <v-list-item v-if="device.serialNumber">
                  <v-list-item-title>Serial Number</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.serialNumber }}
                  </v-list-item-subtitle>
                </v-list-item>

                <v-list-item v-if="device.model">
                  <v-list-item-title>Model</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.model }}
                  </v-list-item-subtitle>
                </v-list-item>

                <v-list-item v-if="device.firmware">
                  <v-list-item-title>Firmware Version</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.firmware }}
                  </v-list-item-subtitle>
                </v-list-item>

                <v-list-item v-if="device.group_name">
                  <v-list-item-title>Group</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.group_name }}
                  </v-list-item-subtitle>
                </v-list-item>

                <v-list-item v-if="device.site">
                  <v-list-item-title>Site</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.site }}
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Type-specific information -->
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title>
              <v-icon left>{{ getDeviceIcon(device.type) }}</v-icon>
              {{ device.type }} Information
            </v-card-title>
            <v-divider />
            <v-card-text>
              <v-list density="compact">
                <!-- Switch specific -->
                <template v-if="device.type && device.type.toLowerCase().includes('switch')">
                  <v-list-item v-if="device.ports">
                    <v-list-item-title>Port Count</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ device.ports }} ports
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="device.utilization">
                    <v-list-item-title>Utilization</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ device.utilization }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="device.vlanCount">
                    <v-list-item-title>VLAN Count</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ device.vlanCount }} VLANs
                    </v-list-item-subtitle>
                  </v-list-item>
                </template>

                <!-- AP specific -->
                <template v-if="device.type && device.type.toLowerCase().includes('access point')">
                  <v-list-item v-if="device.clients !== undefined">
                    <v-list-item-title>Connected Clients</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ device.clients }} clients
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="device.bandwidth">
                    <v-list-item-title>Bandwidth</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ device.bandwidth }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="device.channel">
                    <v-list-item-title>Channel</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      Channel {{ device.channel }}
                    </v-list-item-subtitle>
                  </v-list-item>
                </template>

                <!-- Gateway specific -->
                <template v-if="device.type && device.type.toLowerCase().includes('gateway')">
                  <v-list-item v-if="device.throughput">
                    <v-list-item-title>Throughput</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ device.throughput }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="device.temperature">
                    <v-list-item-title>Temperature</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ device.temperature }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="device.wanStatus">
                    <v-list-item-title>WAN Status</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      <v-chip
                        :color="device.wanStatus === 'up' ? 'success' : 'error'"
                        size="small"
                      >
                        {{ device.wanStatus }}
                      </v-chip>
                    </v-list-item-subtitle>
                  </v-list-item>
                </template>

                <!-- Fallback if no type-specific data -->
                <v-list-item v-if="device.uptime">
                  <v-list-item-title>Uptime</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.uptime }}
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Actions Section -->
      <v-row class="mt-4">
        <v-col cols="12">
          <v-card>
            <v-card-title>
              <v-icon left>mdi-lightning-bolt</v-icon>
              Quick Actions
            </v-card-title>
            <v-divider />
            <v-card-text>
              <v-row>
                <v-col cols="12" sm="6" md="3">
                  <v-btn
                    block
                    variant="outlined"
                    color="primary"
                    @click="refreshSystemInfo"
                  >
                    <v-icon left>mdi-sync</v-icon>
                    Sync System Info
                  </v-btn>
                </v-col>
                <v-col cols="12" sm="6" md="3">
                  <v-btn
                    block
                    variant="outlined"
                    color="info"
                  >
                    <v-icon left>mdi-chip</v-icon>
                    Check Firmware
                  </v-btn>
                </v-col>
                <v-col cols="12" sm="6" md="3">
                  <v-btn
                    block
                    variant="outlined"
                    color="warning"
                  >
                    <v-icon left>mdi-backup-restore</v-icon>
                    Backup Config
                  </v-btn>
                </v-col>
                <v-col cols="12" sm="6" md="3">
                  <v-btn
                    block
                    variant="outlined"
                    color="secondary"
                  >
                    <v-icon left>mdi-cog</v-icon>
                    Configure
                  </v-btn>
                </v-col>
                <v-col cols="12" sm="6" md="3">
                  <v-btn
                    block
                    variant="outlined"
                    color="success"
                    @click="openConnectionTestDialog"
                  >
                    <v-icon left>mdi-connection</v-icon>
                    Test API Connection
                  </v-btn>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <!-- Connection Test Dialog -->
    <v-dialog v-model="showConnectionTestDialog" max-width="800px">
      <v-card>
        <v-card-title>
          <v-icon icon="mdi-connection" class="mr-2" />
          Test API Connection - {{ device?.name }}
        </v-card-title>

        <v-card-text>
          <DeviceConnectionTest
            mode="stored"
            :device-id="device?.id"
            :auto-test="autoTestOnOpen"
            :show-device-info="true"
            :show-firmware-info="true"
            :show-title="false"
            @test-complete="handleConnectionTestComplete"
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn color="grey" variant="text" @click="closeConnectionTestDialog">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useNotificationsStore } from '@/stores/notifications'
import { formatDistanceToNow, format, fromUnixTime } from 'date-fns'
import DeviceConnectionTest from '@/components/devices/DeviceConnectionTest.vue'

const route = useRoute()
const router = useRouter()
const devicesStore = useDevicesStore()
const notificationStore = useNotificationsStore()

const device = ref(null)
const loading = ref(false)
const error = ref(null)

// Connection test dialog state
const showConnectionTestDialog = ref(false)
const autoTestOnOpen = ref(true)

const systemData = computed(() => devicesStore.systemData)
const systemLoading = computed(() => devicesStore.systemLoading)
const systemError = computed(() => devicesStore.systemError)

const breadcrumbs = [
  { text: 'Devices', to: '/devices', disabled: false },
  { text: device.value?.name || 'Device Details', disabled: true }
]

const getStatusColor = (status) => {
  const colors = {
    online: 'success',
    offline: 'error',
    warning: 'warning',
    maintenance: 'info'
  }
  return colors[status] || 'grey'
}

const getDeviceIcon = (type) => {
  if (!type) return 'mdi-devices'
  const typeLower = type.toLowerCase()
  if (typeLower.includes('switch')) return 'mdi-switch'
  if (typeLower.includes('access point') || typeLower.includes('ap')) return 'mdi-wifi'
  if (typeLower.includes('gateway')) return 'mdi-router'
  if (typeLower.includes('controller')) return 'mdi-server'
  return 'mdi-devices'
}

const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'N/A'
  try {
    return format(new Date(timestamp), 'MMM dd, yyyy HH:mm:ss')
  } catch (e) {
    return 'Invalid date'
  }
}

const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'N/A'
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
  } catch (e) {
    return 'Invalid date'
  }
}

const formatBootTime = (bootTime) => {
  if (!bootTime) return 'N/A'
  try {
    return format(fromUnixTime(bootTime), 'MMM dd, yyyy HH:mm:ss')
  } catch (e) {
    return 'Invalid timestamp'
  }
}

const calculateUptime = (bootTime) => {
  if (!bootTime) return 'N/A'
  try {
    const bootDate = fromUnixTime(bootTime)
    const now = new Date()
    const diffMs = now - bootDate

    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

    return `${days}d ${hours}h ${minutes}m`
  } catch (e) {
    return 'N/A'
  }
}

const formatFieldName = (fieldName) => {
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const formatValue = (value) => {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value)
  }
  return String(value)
}

const refreshSystemInfo = async () => {
  try {
    await devicesStore.pollDeviceSystem(route.params.id)
  } catch (err) {
    console.error('Failed to refresh system info:', err)
  }
}

const clearError = () => {
  error.value = null
  devicesStore.clearError()
}

const loadDevice = async () => {
  loading.value = true
  error.value = null

  try {
    // First check if device is in store
    const storeDevice = devicesStore.devices.find(d => d.id === route.params.id)

    if (storeDevice) {
      device.value = storeDevice
    } else {
      // Fetch from API
      const response = await devicesStore.fetchDevices()
      device.value = devicesStore.devices.find(d => d.id === route.params.id)

      if (!device.value) {
        error.value = 'Device not found'
        return
      }
    }

    // Automatically poll system info on load
    await refreshSystemInfo()
  } catch (err) {
    console.error('Failed to load device:', err)
    error.value = err.userMessage || err.message || 'Failed to load device details'
  } finally {
    loading.value = false
  }
}

const openConnectionTestDialog = () => {
  showConnectionTestDialog.value = true
}

const closeConnectionTestDialog = () => {
  showConnectionTestDialog.value = false
}

const handleConnectionTestComplete = (result) => {
  if (result.success) {
    notificationStore.showSuccess('API connection test successful')
  }
}

onMounted(() => {
  loadDevice()
})

onUnmounted(() => {
  // Clear system data when leaving the page
  devicesStore.clearSystemData()
})
</script>

<style scoped>
.device-detail-view {
  max-width: 1400px;
  margin: 0 auto;
}

.gap-2 {
  gap: 0.5rem;
}
</style>
