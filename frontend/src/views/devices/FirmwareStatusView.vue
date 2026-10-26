<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon start>mdi-chip</v-icon>
            Firmware Status
            <v-spacer></v-spacer>
            <v-btn
              v-if="canEdit"
              color="primary"
              :loading="loading"
              :disabled="loading"
              @click="pollFirmware"
            >
              <v-icon start>mdi-refresh</v-icon>
              Poll All Switches
            </v-btn>
          </v-card-title>

          <v-card-text>
            <!-- Error Alert -->
            <v-alert
              v-if="firmwareError"
              type="error"
              closable
              class="mb-4"
              @click:close="firmwareError = null"
            >
              {{ firmwareError }}
            </v-alert>

            <!-- Summary -->
            <v-row v-if="firmwareData.length > 0" class="mb-4">
              <v-col cols="4" md="3">
                <v-card color="primary" variant="tonal">
                  <v-card-text>
                    <div class="text-h4">{{ summary.total }}</div>
                    <div class="text-subtitle-1">Total Devices</div>
                  </v-card-text>
                </v-card>
              </v-col>
              <v-col cols="4" md="3">
                <v-card color="success" variant="tonal">
                  <v-card-text>
                    <div class="text-h4">{{ summary.successful }}</div>
                    <div class="text-subtitle-1">Successful</div>
                  </v-card-text>
                </v-card>
              </v-col>
              <v-col cols="4" md="3">
                <v-card color="error" variant="tonal">
                  <v-card-text>
                    <div class="text-h4">{{ summary.failed }}</div>
                    <div class="text-subtitle-1">Failed</div>
                  </v-card-text>
                </v-card>
              </v-col>
              <v-col cols="12" sm="12" md="3">
                <v-card variant="outlined">
                  <v-card-text>
                    <div class="text-caption">Last Poll</div>
                    <div class="text-subtitle-2">{{ lastPollTime }}</div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>

            <!-- Data Table -->
            <v-data-table
              :headers="shownHeaders"
              :items="firmwareData"
              :loading="loading"
              :search="search"
              class="elevation-1"
              item-value="deviceId"
            >
              <template #top>
                <v-toolbar flat>
                  <v-text-field
                    v-model="search"
                    append-inner-icon="mdi-magnify"
                    label="Search"
                    single-line
                    hide-details
                    clearable
                    class="mr-4"
                  ></v-text-field>
                  <v-spacer></v-spacer>
                  <v-btn
                    color="primary"
                    variant="text"
                    :disabled="firmwareData.length === 0"
                    @click="exportToCSV"
                  >
                    <v-icon start>mdi-download</v-icon>
                    Export CSV
                  </v-btn>
                </v-toolbar>
              </template>

              <template #item.deviceName="{ item }">
                <router-link
                  :to="`/devices/${item.deviceId}`"
                  class="text-decoration-none"
                >
                  {{ item.deviceName }}
                </router-link>
              </template>

              <template #item.success="{ item }">
                <v-chip
                  :color="item.success ? 'success' : 'error'"
                  size="small"
                  variant="flat"
                >
                  {{ item.success ? 'Success' : 'Failed' }}
                </v-chip>
              </template>

              <template #item.booted="{ item }">
                <v-chip
                  v-if="item.success && item.booted"
                  :color="item.booted === 'primary' ? 'primary' : 'secondary'"
                  size="small"
                  variant="outlined"
                >
                  {{ item.booted }}
                </v-chip>
                <span v-else class="text-grey">{{ item.error ? 'N/A' : '-' }}</span>
              </template>

              <template #item.current="{ item }">
                <v-chip
                  v-if="item.success && item.current"
                  :color="item.current === 'primary' ? 'primary' : 'secondary'"
                  size="small"
                  variant="outlined"
                >
                  {{ item.current }}
                </v-chip>
                <span v-else class="text-grey">{{ item.error ? 'N/A' : '-' }}</span>
              </template>

              <template #item.default="{ item }">
                <v-chip
                  v-if="item.success && item.default"
                  :color="item.default === 'primary' ? 'primary' : 'secondary'"
                  size="small"
                  variant="outlined"
                >
                  {{ item.default }}
                </v-chip>
                <span v-else class="text-grey">{{ item.error ? 'N/A' : '-' }}</span>
              </template>

              <template #item.primary="{ item }">
                <span v-if="item.success && item.primary">{{ item.primary }}</span>
                <span v-else class="text-grey">{{ item.error ? 'N/A' : '-' }}</span>
              </template>

              <template #item.secondary="{ item }">
                <span v-if="item.success && item.secondary">{{ item.secondary }}</span>
                <span v-else class="text-grey">{{ item.error ? 'N/A' : '-' }}</span>
              </template>

              <template #item.error="{ item }">
                <v-tooltip v-if="item.error" location="top">
                  <template #activator="{ props }">
                    <v-icon v-bind="props" color="error" size="small">
                      mdi-alert-circle
                    </v-icon>
                  </template>
                  {{ item.error }}
                </v-tooltip>
                <span v-else>-</span>
              </template>

              <template #no-data>
                <v-container class="text-center py-8">
                  <v-icon size="64" color="grey-lighten-1">mdi-chip</v-icon>
                  <div class="text-h6 mt-4 mb-2">No Firmware Data Available</div>
                  <div v-if="canEdit" class="text-body-2 text-grey mb-4">
                    Click "Poll All Switches" to retrieve firmware information from your devices
                  </div>
                </v-container>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>

        <!-- What sync and earlier polls recorded (Device.firmwareVersion); no device is contacted -->
        <v-card class="mt-4">
          <v-card-title class="d-flex align-center">
            <v-icon start>mdi-history</v-icon>
            Recorded versions
          </v-card-title>
          <v-card-subtitle class="text-wrap">
            The firmware each device last reported: cloud devices at every sync and status refresh,
            direct devices when they are polled. Polling above reads the switches' images now.
          </v-card-subtitle>
          <v-card-text>
            <div v-if="versionCounts.length" class="d-flex flex-wrap ga-2 mb-4">
              <v-chip
                v-for="v in versionCounts"
                :key="v.version"
                size="small"
                :variant="recordedSearch === v.version ? 'flat' : 'tonal'"
                :color="v.version === UNKNOWN ? undefined : 'primary'"
                @click="recordedSearch = recordedSearch === v.version ? '' : v.version"
              >
                {{ v.version }} · {{ v.count }}
              </v-chip>
            </div>
            <v-data-table
              :headers="recordedHeaders"
              :items="recordedRows"
              :search="recordedSearch"
              :loading="devicesStore.loading && !recordedRows.length"
              density="compact"
              item-value="id"
            >
              <template #item.name="{ item }">
                <router-link :to="`/devices/${item.id}`" class="text-decoration-none">{{ item.name }}</router-link>
              </template>
              <template #no-data>
                <div class="text-center text-medium-emphasis py-4">No devices yet</div>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import { toCsv, downloadCsv } from '@/utils/csv'
import { PlatformInfo } from '@/models/vendors'
import { usePhoneColumns } from '@/composables/usePhoneColumns'

const devicesStore = useDevicesStore()
const authStore = useAuthStore()
// Polling (POST /devices/poll) is operator+
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))

const search = ref('')
const lastPollTime = ref(null)

const firmwareData = computed(() => devicesStore.firmwareData)
const loading = computed(() => devicesStore.firmwareLoading)
const firmwareError = computed({
  get: () => devicesStore.firmwareError,
  set: (value) => devicesStore.firmwareError = value
})

const headers = [
  { title: 'Device Name', key: 'deviceName', sortable: true },
  { title: 'Type', key: 'deviceType', sortable: true },
  { title: 'IP Address', key: 'deviceIp', sortable: true },
  { title: 'Location', key: 'deviceLocation', sortable: true },
  { title: 'Status', key: 'success', sortable: true },
  { title: 'Booted', key: 'booted', sortable: true },
  { title: 'Current', key: 'current', sortable: true },
  { title: 'Default', key: 'default', sortable: true },
  { title: 'Primary Version', key: 'primary', sortable: true },
  { title: 'Secondary Version', key: 'secondary', sortable: true },
  { title: 'Error', key: 'error', sortable: false, align: 'center' }
]
const shownHeaders = usePhoneColumns(headers, ['deviceName', 'success', 'current', 'primary', 'secondary', 'error'])

const summary = computed(() => {
  const total = firmwareData.value.length
  const successful = firmwareData.value.filter(d => d.success).length
  const failed = total - successful
  return { total, successful, failed }
})

// Recorded versions, from the inventory (loaded on mount)
const UNKNOWN = 'Not reported'
const recordedSearch = ref('')
const recordedHeaders = [
  { title: 'Device', key: 'name', sortable: true },
  { title: 'Platform', key: 'platformLabel', sortable: true },
  { title: 'Model', key: 'model', sortable: true },
  { title: 'Firmware', key: 'firmware', sortable: true }
]
const recordedRows = computed(() => (devicesStore.devicesComplete ? devicesStore.devices : []).map((d) => ({
  id: d.id,
  name: d.name,
  platformLabel: PlatformInfo[d.platform]?.label || d.platform || '',
  model: d.model || '',
  firmware: d.firmwareVersion || UNKNOWN
})))
const versionCounts = computed(() => {
  const counts = new Map()
  for (const row of recordedRows.value) counts.set(row.firmware, (counts.get(row.firmware) || 0) + 1)
  return [...counts].map(([version, count]) => ({ version, count }))
    .sort((a, b) => (a.version === UNKNOWN) - (b.version === UNKNOWN) || b.count - a.count)
})

async function pollFirmware() {
  try {
    await devicesStore.fetchDevices()
    await devicesStore.pollAllSwitchesFirmware()
    lastPollTime.value = format(new Date(), 'MMM dd, yyyy HH:mm:ss')
  } catch (error) {
    console.error('Failed to poll firmware:', error)
  }
}

function exportToCSV() {
  const csvHeaders = [
    'Device Name',
    'Type',
    'IP Address',
    'Location',
    'Status',
    'Booted Image',
    'Current Image',
    'Default Image',
    'Primary Version',
    'Secondary Version',
    'Error'
  ]

  const csvRows = firmwareData.value.map(item => [
    item.deviceName,
    item.deviceType,
    item.deviceIp,
    item.deviceLocation,
    item.success ? 'Success' : 'Failed',
    item.booted || 'N/A',
    item.current || 'N/A',
    item.default || 'N/A',
    item.primary || 'N/A',
    item.secondary || 'N/A',
    item.error || ''
  ])

  downloadCsv(`firmware-status-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`, toCsv(csvHeaders, csvRows))
}

onMounted(async () => {
  await devicesStore.ensureAllDevices()
})
</script>

<style scoped>
.v-data-table {
  font-size: 0.875rem;
}

.text-grey {
  color: #9e9e9e;
}
</style>
