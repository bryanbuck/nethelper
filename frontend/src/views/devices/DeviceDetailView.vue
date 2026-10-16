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
              <template #item="{ item }">
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
              <v-chip
                v-if="device"
                :color="managementChip.color"
                size="small"
                :variant="managementChip.variant"
                class="ml-2"
              >
                <v-icon start :icon="managementChip.icon" size="x-small"></v-icon>
                {{ managementChip.label }}
              </v-chip>
            </h1>
            <div v-if="device" class="text-caption text-grey mt-1">
              <span v-if="device.cloudManagedCheckedAt">
                Verified {{ formatRelativeTime(device.cloudManagedCheckedAt) }}
              </span>
              <span v-if="device.cloudConnectionStatus && device.cloudConnectionStatus !== 'connected'">
                <span v-if="device.cloudManagedCheckedAt"> &middot; </span>
                {{ cloudPlaneName }} connection: {{ device.cloudConnectionStatus }}
              </span>
            </div>
          </div>
          <div class="d-flex flex-column align-end gap-2">
            <div class="d-flex gap-2">
              <v-btn
                v-if="device && device.managementMode === 'direct'"
                color="info"
                variant="outlined"
                :loading="testingConnection"
                @click="testDirectConnection"
              >
                <v-icon left>mdi-connection</v-icon>
                Test Direct Connection
              </v-btn>
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
            <div v-if="lastTestCentralStatus" class="text-caption text-grey">
              Switch reports: {{ lastTestCentralStatus }}
            </div>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Another row looks like the same hardware -->
    <v-row v-if="device && duplicateGroup">
      <v-col cols="12">
        <v-alert type="warning" variant="tonal" icon="mdi-content-duplicate">
          {{ duplicateGroup.devices.length - 1 === 1 ? 'Another device has' : `${duplicateGroup.devices.length - 1} other devices have` }}
          the same {{ { mac: 'MAC address', 'name-ip': 'name and IP address' }[duplicateGroup.reason] || 'IP address' }} and is probably this device,
          for example after a cloud sync found a device that was added by hand.
          <template v-if="canEdit" #append>
            <v-btn variant="tonal" color="warning" @click="mergeDialog = true">Review and merge</v-btn>
          </template>
        </v-alert>
      </v-col>
    </v-row>

    <!-- Central/Direct Management Mismatch Warning -->
    <v-row v-if="device && managementMismatch">
      <v-col cols="12">
        <v-alert type="warning" variant="tonal" icon="mdi-alert">
          {{ managementMismatch }}
        </v-alert>
      </v-col>
    </v-row>

    <!-- Overview / Live -->
    <v-tabs v-if="device" v-model="tab" color="primary" class="mb-4">
      <v-tab value="overview">
        <v-icon start icon="mdi-information-outline" />
        Overview
      </v-tab>
      <v-tab value="live">
        <v-icon start icon="mdi-access-point" />
        Live
      </v-tab>
      <v-tab value="neighbors">
        <v-icon start icon="mdi-lan" />
        Neighbors
      </v-tab>
    </v-tabs>

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

    <!-- Live port/PoE state; subscribes only while this tab is open -->
    <DeviceLivePanel v-else-if="device && tab === 'live'" :device="device" @update="applyDevicePatch" />

    <!-- LLDP/CDP neighbors (Network Map data for this device) -->
    <DeviceNeighborsPanel v-else-if="device && tab === 'neighbors'" :device="device" />

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
                <template #append>
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
                      <template #prepend>
                        <v-icon>mdi-server</v-icon>
                      </template>
                      <v-list-item-title>Hostname</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.hostname || 'N/A' }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item>
                      <template #prepend>
                        <v-icon>mdi-chip</v-icon>
                      </template>
                      <v-list-item-title>Platform</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.platform_name || 'N/A' }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item>
                      <template #prepend>
                        <v-icon>mdi-package-variant</v-icon>
                      </template>
                      <v-list-item-title>Software Version</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.software_version || 'N/A' }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item>
                      <template #prepend>
                        <v-icon>mdi-clock</v-icon>
                      </template>
                      <v-list-item-title>Boot Time</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ formatBootTime(systemData.boot_time) }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.boot_time">
                      <template #prepend>
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
                      <template #prepend>
                        <v-icon>mdi-earth</v-icon>
                      </template>
                      <v-list-item-title>Timezone</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.timezone || 'N/A' }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.location">
                      <template #prepend>
                        <v-icon>mdi-map-marker</v-icon>
                      </template>
                      <v-list-item-title>System Location</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.location }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.contact">
                      <template #prepend>
                        <v-icon>mdi-account</v-icon>
                      </template>
                      <v-list-item-title>System Contact</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.contact }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.description">
                      <template #prepend>
                        <v-icon>mdi-text</v-icon>
                      </template>
                      <v-list-item-title>Description</v-list-item-title>
                      <v-list-item-subtitle class="text-body-2 font-weight-medium">
                        {{ systemData.description }}
                      </v-list-item-subtitle>
                    </v-list-item>

                    <v-list-item v-if="systemData.usb_status">
                      <template #prepend>
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

    <DeviceMergeDialog
      v-if="duplicateGroup"
      v-model="mergeDialog"
      :devices="duplicateGroup.devices"
      :preferred-id="route.params.id"
      @merged="onMerged"
    />
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useNotificationsStore } from '@/stores/notifications'
import { useAuthStore } from '@/stores/auth'
import { formatDistanceToNow, format, fromUnixTime } from 'date-fns'
import DeviceConnectionTest from '@/components/devices/DeviceConnectionTest.vue'
import DeviceLivePanel from '@/components/devices/DeviceLivePanel.vue'
import DeviceNeighborsPanel from '@/components/devices/DeviceNeighborsPanel.vue'
import DeviceMergeDialog from '@/components/devices/DeviceMergeDialog.vue'
import deviceService from '@/services/device.service'
import deviceApiService from '@/services/deviceApi.service'
import { cloudProviderLabel } from '@/models/vendors'

const route = useRoute()
const router = useRouter()
const devicesStore = useDevicesStore()
const notificationStore = useNotificationsStore()
const authStore = useAuthStore()
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))

// The row shown is the store's own object whenever the store holds it, so
// changes made elsewhere (live monitoring toggle, socket status updates) show
// here. The store's array is replaced by every list fetch and holds only one
// table page, so keep a by-id copy as the fallback; never cache the store
// object itself (that copy goes stale the moment the array is replaced).
const fetchedDevice = ref(null)
const device = computed(() =>
  devicesStore.devices.find(d => d.id === route.params.id)
  || (fetchedDevice.value?.id === route.params.id ? fetchedDevice.value : null)
)
const loading = ref(false)
const error = ref(null)
const testingConnection = ref(false)
const lastTestCentralStatus = ref(null)

// Selected tab, kept in the URL (?tab=live) so a live view can be linked.
const TABS = ['live', 'neighbors']
const tab = computed({
  get: () => (TABS.includes(route.query.tab) ? route.query.tab : 'overview'),
  set: (value) => router.replace({ query: { ...route.query, tab: TABS.includes(value) ? value : undefined } }),
})

// Connection test dialog state
const showConnectionTestDialog = ref(false)
const autoTestOnOpen = ref(true)

const systemData = computed(() => devicesStore.systemData)
const systemLoading = computed(() => devicesStore.systemLoading)
const systemError = computed(() => devicesStore.systemError)

const breadcrumbs = computed(() => [
  { text: 'Devices', to: '/devices', disabled: false },
  { text: device.value?.name || 'Device Details', disabled: true }
])

/** Apply a change to the shown device, wherever that object lives. */
const applyDevicePatch = (patch) => {
  devicesStore.updateDeviceLocally(route.params.id, patch)
  if (fetchedDevice.value?.id === route.params.id) Object.assign(fetchedDevice.value, patch)
}

// Another row that looks like the same hardware (e.g. added by hand, then
// synced from the cloud). Offer to merge them.
const mergeDialog = ref(false)
const duplicateGroup = computed(() =>
  (devicesStore.duplicateGroups || []).find(g => g.devices.some(d => d.id === route.params.id)) || null
)
const onMerged = (merged) => {
  mergeDialog.value = false
  if (merged.id !== route.params.id) router.replace({ path: `/devices/${merged.id}`, query: route.query })
  else fetchDevice()
}

const getStatusColor = (status) => {
  const colors = {
    online: 'success',
    offline: 'error',
    warning: 'warning',
    maintenance: 'info'
  }
  return colors[status] || 'grey'
}

// Name of the cloud plane managing this device ("Central", "Mist", ...).
const cloudPlaneName = computed(() =>
  cloudProviderLabel(device.value?.cloudIntegration?.provider)
)

// Three-state management chip: prefers the device-reported cloudManaged
// truth over the record-keeping managementMode field, falling back to the
// latter (marked "unverified") when the device has never been probed.
const managementChip = computed(() => {
  if (!device.value) {
    return { label: '', color: 'grey', variant: 'tonal', icon: 'mdi-help-circle' }
  }
  const plane = cloudPlaneName.value
  if (device.value.cloudManaged === true) {
    return { label: `${plane}-managed`, color: 'info', variant: 'tonal', icon: 'mdi-cloud' }
  }
  if (device.value.cloudManaged === false) {
    return { label: 'Locally managed', color: 'success', variant: 'tonal', icon: 'mdi-lan-connect' }
  }
  if (device.value.managementMode === 'cloud') {
    return { label: `${plane} (unverified)`, color: 'grey', variant: 'outlined', icon: 'mdi-cloud-outline' }
  }
  return { label: 'Direct (unverified)', color: 'grey', variant: 'outlined', icon: 'mdi-lan-connect' }
})

// Warns when the device's own view of cloud ownership disagrees with how
// the device record was added to inventory.
const managementMismatch = computed(() => {
  if (!device.value) return null
  const { cloudManaged, managementMode } = device.value
  const plane = cloudPlaneName.value
  if (cloudManaged === true && managementMode === 'direct') {
    return `Device reports it is ${plane}-managed but was added as directly managed — direct config changes will be rejected by the device.`
  }
  if (cloudManaged === false && managementMode === 'cloud') {
    return `Device reports it is locally managed but was added as ${plane}-managed — configuration may not be pushed via ${plane} as expected.`
  }
  return null
})

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

/** Fetch the current row by id and refresh the store's copy too. */
const fetchDevice = async () => {
  const id = route.params.id
  const response = await deviceService.getDevice(id)
  if (route.params.id !== id || !response?.data) return
  fetchedDevice.value = response.data
  devicesStore.updateDeviceLocally(id, response.data)
}

const loadDevice = async () => {
  const id = route.params.id
  loading.value = true
  error.value = null
  devicesStore.clearSystemData()

  try {
    await fetchDevice()
    if (route.params.id !== id) return
    if (!device.value) {
      error.value = 'Device not found'
      return
    }
    devicesStore.fetchDuplicates().catch(() => {})

    // Automatically poll system info on load
    await refreshSystemInfo()
  } catch (err) {
    console.error('Failed to load device:', err)
    error.value = err.userMessage || err.message || 'Failed to load device details'
  } finally {
    if (route.params.id === id) loading.value = false
  }
}

// The same view is reused when navigating from one device to another.
watch(() => route.params.id, (id, previous) => {
  if (id && id !== previous) loadDevice()
})

// A cloud sync may have changed this device (or merged it by MAC).
watch(() => devicesStore.lastSyncResult, () => {
  fetchDevice().catch(() => {})
})

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

// Test the direct (REST/SSH) path for a directly-managed device. The backend
// routes AOS-CX to REST and other devices to SSH automatically.
const testDirectConnection = async () => {
  if (!device.value) return
  testingConnection.value = true
  lastTestCentralStatus.value = null
  try {
    const response = await deviceApiService.testDeviceConnection(device.value.id)
    const result = response?.data || response
    if (result?.centralStatus) {
      const { centralManaged, connectionStatus } = result.centralStatus
      const label = centralManaged === true ? 'Central-managed' : centralManaged === false ? 'Locally managed' : 'Unknown'
      lastTestCentralStatus.value = connectionStatus ? `${label} (${connectionStatus})` : label
    }
    if (result?.success) {
      const via = result.transport ? ` (via ${result.transport.toUpperCase()})` : ''
      notificationStore.showSuccess(`Direct connection successful${via}`, 'Connection Test')
    } else {
      notificationStore.showError(result?.message || 'Direct connection failed', 'Connection Test')
    }
  } catch (err) {
    notificationStore.showError(err.userMessage || err.message || 'Direct connection failed', 'Connection Test')
  } finally {
    testingConnection.value = false
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
