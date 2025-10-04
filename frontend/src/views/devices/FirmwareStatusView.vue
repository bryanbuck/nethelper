<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon left>mdi-chip</v-icon>
            Firmware Status
            <v-spacer></v-spacer>
            <v-btn
              color="primary"
              @click="pollFirmware"
              :loading="loading"
              :disabled="loading"
            >
              <v-icon left>mdi-refresh</v-icon>
              Poll All Switches
            </v-btn>
          </v-card-title>

          <v-card-text>
            <!-- Error Alert -->
            <v-alert
              v-if="firmwareError"
              type="error"
              dismissible
              @click:close="firmwareError = null"
              class="mb-4"
            >
              {{ firmwareError }}
            </v-alert>

            <!-- Summary -->
            <v-row v-if="firmwareData.length > 0" class="mb-4">
              <v-col cols="12" sm="4" md="3">
                <v-card color="primary" variant="tonal">
                  <v-card-text>
                    <div class="text-h4">{{ summary.total }}</div>
                    <div class="text-subtitle-1">Total Devices</div>
                  </v-card-text>
                </v-card>
              </v-col>
              <v-col cols="12" sm="4" md="3">
                <v-card color="success" variant="tonal">
                  <v-card-text>
                    <div class="text-h4">{{ summary.successful }}</div>
                    <div class="text-subtitle-1">Successful</div>
                  </v-card-text>
                </v-card>
              </v-col>
              <v-col cols="12" sm="4" md="3">
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
              :headers="headers"
              :items="firmwareData"
              :loading="loading"
              :search="search"
              class="elevation-1"
              item-value="deviceId"
            >
              <template v-slot:top>
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
                    @click="exportToCSV"
                    :disabled="firmwareData.length === 0"
                  >
                    <v-icon left>mdi-download</v-icon>
                    Export CSV
                  </v-btn>
                </v-toolbar>
              </template>

              <template v-slot:item.deviceName="{ item }">
                <router-link
                  :to="`/devices/${item.deviceId}`"
                  class="text-decoration-none"
                >
                  {{ item.deviceName }}
                </router-link>
              </template>

              <template v-slot:item.success="{ item }">
                <v-chip
                  :color="item.success ? 'success' : 'error'"
                  size="small"
                  variant="flat"
                >
                  {{ item.success ? 'Success' : 'Failed' }}
                </v-chip>
              </template>

              <template v-slot:item.booted="{ item }">
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

              <template v-slot:item.current="{ item }">
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

              <template v-slot:item.default="{ item }">
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

              <template v-slot:item.primary="{ item }">
                <span v-if="item.success && item.primary">{{ item.primary }}</span>
                <span v-else class="text-grey">{{ item.error ? 'N/A' : '-' }}</span>
              </template>

              <template v-slot:item.secondary="{ item }">
                <span v-if="item.success && item.secondary">{{ item.secondary }}</span>
                <span v-else class="text-grey">{{ item.error ? 'N/A' : '-' }}</span>
              </template>

              <template v-slot:item.error="{ item }">
                <v-tooltip v-if="item.error" location="top">
                  <template v-slot:activator="{ props }">
                    <v-icon v-bind="props" color="error" size="small">
                      mdi-alert-circle
                    </v-icon>
                  </template>
                  {{ item.error }}
                </v-tooltip>
                <span v-else>-</span>
              </template>

              <template v-slot:no-data>
                <v-container class="text-center py-8">
                  <v-icon size="64" color="grey-lighten-1">mdi-chip</v-icon>
                  <div class="text-h6 mt-4 mb-2">No Firmware Data Available</div>
                  <div class="text-body-2 text-grey mb-4">
                    Click "Poll All Switches" to retrieve firmware information from your devices
                  </div>
                </v-container>
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
import { format } from 'date-fns'

const devicesStore = useDevicesStore()

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

const summary = computed(() => {
  const total = firmwareData.value.length
  const successful = firmwareData.value.filter(d => d.success).length
  const failed = total - successful
  return { total, successful, failed }
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

  const csvContent = [
    csvHeaders.join(','),
    ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', `firmware-status-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

onMounted(async () => {
  // Load devices if not already loaded
  if (devicesStore.devices.length === 0) {
    await devicesStore.fetchDevices()
  }
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
