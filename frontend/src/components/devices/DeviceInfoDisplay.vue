<template>
  <div class="device-info-display">
    <!-- Loading State -->
    <v-skeleton-loader v-if="loading" type="card" />

    <!-- Device Information -->
    <div v-else-if="deviceInfo">
      <v-card v-if="deviceInfo" class="mb-4">
        <v-card-title class="bg-primary text-white">
          <v-icon icon="mdi-information" class="mr-2" />
          Device Information
        </v-card-title>

        <v-card-text>
          <v-list density="compact">
            <v-list-item v-if="deviceInfo.hostname">
              <template v-slot:prepend>
                <v-icon icon="mdi-server" />
              </template>
              <v-list-item-title>Hostname</v-list-item-title>
              <v-list-item-subtitle>{{ deviceInfo.hostname }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="deviceInfo.model">
              <template v-slot:prepend>
                <v-icon icon="mdi-router-network" />
              </template>
              <v-list-item-title>Model</v-list-item-title>
              <v-list-item-subtitle>{{ deviceInfo.model }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="deviceInfo.version">
              <template v-slot:prepend>
                <v-icon icon="mdi-code-tags" />
              </template>
              <v-list-item-title>Software Version</v-list-item-title>
              <v-list-item-subtitle>{{ deviceInfo.version }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="deviceInfo.serialNumber">
              <template v-slot:prepend>
                <v-icon icon="mdi-barcode" />
              </template>
              <v-list-item-title>Serial Number</v-list-item-title>
              <v-list-item-subtitle>{{ deviceInfo.serialNumber }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="deviceInfo.macAddress">
              <template v-slot:prepend>
                <v-icon icon="mdi-network" />
              </template>
              <v-list-item-title>MAC Address</v-list-item-title>
              <v-list-item-subtitle>{{ deviceInfo.macAddress }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="deviceInfo.uptime">
              <template v-slot:prepend>
                <v-icon icon="mdi-clock-outline" />
              </template>
              <v-list-item-title>Uptime</v-list-item-title>
              <v-list-item-subtitle>{{ deviceInfo.uptime }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="deviceInfo.timezone">
              <template v-slot:prepend>
                <v-icon icon="mdi-earth" />
              </template>
              <v-list-item-title>Timezone</v-list-item-title>
              <v-list-item-subtitle>{{ deviceInfo.timezone }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <!-- Show Raw Data Option -->
          <v-expansion-panels v-if="deviceInfo.fullData && showRawData" class="mt-3">
            <v-expansion-panel>
              <v-expansion-panel-title>
                <v-icon icon="mdi-code-json" class="mr-2" />
                Raw Device Data
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <pre class="raw-data-pre">{{ JSON.stringify(deviceInfo.fullData, null, 2) }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-card-text>
      </v-card>

      <!-- Firmware Information -->
      <v-card v-if="firmwareInfo">
        <v-card-title class="bg-secondary text-white">
          <v-icon icon="mdi-chip" class="mr-2" />
          Firmware Information
        </v-card-title>

        <v-card-text>
          <v-list density="compact">
            <v-list-item v-if="firmwareInfo.currentVersion">
              <template v-slot:prepend>
                <v-icon icon="mdi-application-cog" />
              </template>
              <v-list-item-title>Current Version</v-list-item-title>
              <v-list-item-subtitle>{{ firmwareInfo.currentVersion }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="firmwareInfo.primaryVersion">
              <template v-slot:prepend>
                <v-icon icon="mdi-numeric-1-circle" />
              </template>
              <v-list-item-title>Primary Partition</v-list-item-title>
              <v-list-item-subtitle>
                {{ firmwareInfo.primaryVersion }}
                <v-chip
                  v-if="firmwareInfo.bootedImage === 'primary'"
                  color="success"
                  size="x-small"
                  class="ml-2"
                >
                  Booted
                </v-chip>
              </v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="firmwareInfo.secondaryVersion">
              <template v-slot:prepend>
                <v-icon icon="mdi-numeric-2-circle" />
              </template>
              <v-list-item-title>Secondary Partition</v-list-item-title>
              <v-list-item-subtitle>
                {{ firmwareInfo.secondaryVersion }}
                <v-chip
                  v-if="firmwareInfo.bootedImage === 'secondary'"
                  color="success"
                  size="x-small"
                  class="ml-2"
                >
                  Booted
                </v-chip>
              </v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="firmwareInfo.bootedImage">
              <template v-slot:prepend>
                <v-icon icon="mdi-restart" />
              </template>
              <v-list-item-title>Booted From</v-list-item-title>
              <v-list-item-subtitle class="text-capitalize">
                {{ firmwareInfo.bootedImage }} Partition
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <!-- Show Raw Firmware Data Option -->
          <v-expansion-panels v-if="firmwareInfo.fullData && showRawData" class="mt-3">
            <v-expansion-panel>
              <v-expansion-panel-title>
                <v-icon icon="mdi-code-json" class="mr-2" />
                Raw Firmware Data
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <pre class="raw-data-pre">{{ JSON.stringify(firmwareInfo.fullData, null, 2) }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-card-text>
      </v-card>
    </div>

    <!-- No Data Message -->
    <v-alert v-else type="info" variant="tonal">
      No device information available
    </v-alert>
  </div>
</template>

<script setup>
const props = defineProps({
  deviceInfo: {
    type: Object,
    default: null
  },
  firmwareInfo: {
    type: Object,
    default: null
  },
  loading: {
    type: Boolean,
    default: false
  },
  showRawData: {
    type: Boolean,
    default: false
  }
})
</script>

<style scoped>
.device-info-display {
  width: 100%;
}

.raw-data-pre {
  background-color: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.4;
}

.v-theme--dark .raw-data-pre {
  background-color: #1e1e1e;
  color: #d4d4d4;
}
</style>
