<template>
  <v-container fluid class="device-detail-view">
    <!-- Header with breadcrumbs and actions -->
    <v-row>
      <v-col cols="12">
        <div class="d-flex flex-wrap align-center justify-space-between ga-3 mb-4">
          <div class="header-title">
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
                Verified {{ verifiedBy }} {{ formatRelativeTime(device.cloudManagedCheckedAt) }}
              </span>
            </div>
          </div>
          <div class="d-flex flex-column align-start align-sm-end gap-2">
            <div class="d-flex flex-wrap justify-sm-end gap-2">
              <ActionButton
                v-if="device && canEdit && (device.managementMode === 'direct' || device.apiCredentialId)"
                color="info"
                variant="outlined"
                icon="mdi-connection"
                label="Test Connection"
                :loading="testingConnection"
                @click="testDirectConnection"
              />
              <ActionButton
                v-if="canEdit && systemPoll?.available"
                color="primary"
                variant="outlined"
                icon="mdi-refresh"
                label="Refresh System Info"
                :loading="systemLoading"
                @click="refreshSystemInfo"
              />
              <ActionButton
                v-if="device && canEdit"
                color="primary"
                variant="outlined"
                icon="mdi-backup-restore"
                label="Back Up Now"
                :loading="backupRunning"
                @click="backUpNow"
              />
              <ActionButton
                v-if="device && canEdit"
                color="primary"
                variant="tonal"
                icon="mdi-pencil"
                label="Edit"
                @click="editDialog = true"
              />
              <ActionButton
                v-if="device && xs"
                variant="outlined"
                icon="mdi-timeline-text-outline"
                label="Activity for this device"
                :to="{ path: '/activity', query: { deviceId: device.id } }"
              />
            </div>
            <div v-if="lastTestResult" class="text-caption text-grey">
              {{ lastTestResult }}
              &middot;
              <a href="#" class="text-primary" @click.prevent="openConnectionTestDialog">Details</a>
            </div>
            <div v-if="lastTestCentralStatus" class="text-caption text-grey">
              Switch reports: {{ lastTestCentralStatus }}
            </div>
            <div v-if="lastTestCloudStatus" class="text-caption text-grey">
              {{ lastTestCloudStatus }}
            </div>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Ping and the cloud disagree about this device (status "warning") -->
    <v-row v-if="device && cloudStatusWarning">
      <v-col cols="12">
        <v-alert type="warning" variant="tonal" prominent :title="cloudStatusWarning.title">
          <template v-if="cloudStatusWarning.answeredBy">
            <router-link :to="`/devices/${cloudStatusWarning.answeredBy.id}`" class="font-weight-medium">
              {{ cloudStatusWarning.answeredBy.name }}
            </router-link>
            has the same IP address ({{ device.ipAddress }}) and
            {{ cloudStatusWarning.answeredBy.why }}, so it is most likely what answers.
            {{ cloudPlaneName }} still lists this device's last known address.
          </template>
          <template v-else>{{ cloudStatusWarning.text }}</template>
          <DeviceAddressLookup v-if="canEdit && cloudStatusWarning.lookup && !cloudStatusWarning.answeredBy" :device-id="device.id" />
          <div v-if="cloudConnectionNote" class="mt-1">{{ cloudConnectionNote }}</div>
        </v-alert>
      </v-col>
    </v-row>
    <!-- Not pinged: the address belongs to another device now (ping monitor) -->
    <v-row v-else-if="device && addressHeldBy">
      <v-col cols="12">
        <v-alert type="info" variant="tonal" icon="mdi-lan-pending">
          NetHelper doesn't ping this device:
          <router-link :to="`/devices/${addressHeldBy.id}`" class="font-weight-medium">{{ addressHeldBy.name }}</router-link>
          has the same IP address ({{ device.ipAddress }}) and {{ addressHeldBy.why }}, so it is what answers.
          {{ cloudPlaneName }} reports this device offline and still lists its last known address.
          <div v-if="cloudConnectionNote" class="mt-1">{{ cloudConnectionNote }}</div>
        </v-alert>
      </v-col>
    </v-row>
    <v-row v-else-if="device && cloudConnectionNote">
      <v-col cols="12">
        <v-alert type="warning" variant="tonal" icon="mdi-cloud-alert">
          {{ cloudConnectionNote }}
        </v-alert>
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

    <!-- Unresolved alerts for this device -->
    <DeviceAlertsBanner v-if="device" :device-id="device.id" />

    <!-- Overview / Live -->
    <div v-if="device" class="d-flex align-center mb-4">
      <!-- Phones: the four tabs fit once restyled (assets/styles/responsive.scss), and
           arrows that appear on a resize would then keep them overflowing, so none -->
      <v-tabs v-model="tab" color="primary" class="tab-row" :show-arrows="!xs">
        <v-tab value="overview">
          <v-icon v-if="!xs" start icon="mdi-information-outline" />
          Overview
        </v-tab>
        <v-tab value="live">
          <v-icon v-if="!xs" start icon="mdi-access-point" />
          Live
        </v-tab>
        <v-tab value="neighbors">
          <v-icon v-if="!xs" start icon="mdi-lan" />
          Neighbors
        </v-tab>
        <v-tab value="history">
          <v-icon v-if="!xs" start icon="mdi-timeline-clock-outline" />
          History
        </v-tab>
      </v-tabs>
      <!-- Outside the tabs' slide group, so it stays in view when the tabs scroll; on phones it joins the header buttons -->
      <v-btn
        v-if="!xs"
        variant="text"
        class="flex-shrink-0"
        prepend-icon="mdi-timeline-text-outline"
        title="Activity for this device"
        :to="{ path: '/activity', query: { deviceId: device.id } }"
      >
        Activity
      </v-btn>
    </div>

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

    <!-- Rate-limited before the device ever loaded: retried automatically -->
    <v-row v-else-if="rateLimitRetryAt && !device">
      <v-col cols="12">
        <v-alert type="warning" variant="tonal">
          <v-alert-title>Too many requests</v-alert-title>
          NetHelper is limiting requests right now. The device loads again automatically in a moment.
        </v-alert>
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

    <!-- Ping/cloud status timelines with backup and restart markers -->
    <DeviceHistoryPanel v-else-if="device && tab === 'history'" :device="device" />

    <!-- Device Content -->
    <template v-else-if="device">
      <!-- Quick Stats Cards -->
      <v-row>
        <v-col cols="6" md="3">
          <v-card>
            <v-card-text>
              <div class="text-overline text-grey">Device Type</div>
              <div class="text-h5 stat-value">{{ device.type ? deviceTypeInfo(device.type).label : 'N/A' }}</div>
              <v-icon class="mt-2" size="large">{{ getDeviceIcon(device.type) }}</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card>
            <v-card-text>
              <div class="text-overline text-grey">IP Address</div>
              <div class="text-h6 stat-value">{{ device.ipAddress || 'N/A' }}</div>
              <div class="text-caption text-grey mt-1">
                {{ device.macAddress || 'MAC: N/A' }}
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card>
            <v-card-text>
              <div class="text-overline text-grey">Location</div>
              <div class="text-h6 stat-value">{{ device.location || 'N/A' }}</div>
              <v-icon size="small" class="text-grey mt-1">mdi-map-marker</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card>
            <v-card-text>
              <div class="d-flex flex-wrap align-center column-gap-2">
                <div class="text-overline text-grey">Last Seen</div>
                <v-spacer />
                <a
                  v-if="lastSeen.ping"
                  href="#"
                  class="text-caption text-warning"
                  title="Open the History tab"
                  @click.prevent="tab = 'history'"
                >
                  {{ lastSeen.ping.at ? `Ping ${formatRelativeTime(lastSeen.ping.at)}` : 'Never answered ping' }}
                </a>
              </div>
              <div class="text-h6 stat-value" :title="lastSeen.at ? formatTimestamp(lastSeen.at) : undefined">
                {{ lastSeen.at ? formatRelativeTime(lastSeen.at) : 'Never' }}
              </div>
              <div v-if="lastSeen.by" class="text-caption mt-1 d-flex align-center">
                <v-icon
                  size="x-small"
                  class="mr-1"
                  :color="lastSeen.current ? 'success' : undefined"
                  :icon="lastSeen.current ? 'mdi-check-circle' : 'mdi-history'"
                />
                <span class="text-medium-emphasis">{{ lastSeen.current ? 'Confirmed by' : 'Last seen by' }} {{ lastSeen.by }}</span>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- System Information Section -->
      <v-row class="mt-4">
        <v-col cols="12">
          <v-card>
            <v-card-title class="d-flex flex-wrap align-center justify-space-between column-gap-4">
              <div>
                <v-icon start>mdi-information</v-icon>
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
                <template v-if="canEdit" #append>
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
                  <v-list density="compact" class="wrap-lines">
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
                  <v-list density="compact" class="wrap-lines">
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
                  <v-chip-group column>
                    <v-chip
                      v-for="(value, key) in systemData.mgmt_intf_status"
                      :key="key"
                      variant="tonal"
                      class="chip-wrap mr-2 mb-2"
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
                  <v-chip-group column>
                    <v-chip
                      v-for="(value, key) in systemData.software_info"
                      :key="key"
                      variant="tonal"
                      class="chip-wrap mr-2 mb-2"
                    >
                      <strong>{{ formatFieldName(key) }}:</strong>&nbsp;{{ formatValue(value) }}
                    </v-chip>
                  </v-chip-group>
                </v-col>
              </v-row>
            </v-card-text>

            <!-- Nothing can poll this device: say why, not a failure -->
            <v-card-text v-else-if="systemPoll && !systemPoll.available">
              <v-alert type="info" variant="tonal" icon="mdi-information-outline">
                {{ systemPollReason }}
              </v-alert>
            </v-card-text>

            <!-- No System Data -->
            <v-card-text v-else class="text-center py-8">
              <v-icon size="64" color="grey-lighten-1">mdi-information-outline</v-icon>
              <p class="text-h6 mt-4 text-grey">No system information available</p>
              <p v-if="canEdit" class="text-body-2 text-grey">
                Click "Refresh System Info" to poll the device for current system information
              </p>
              <v-btn
                v-if="canEdit"
                color="primary"
                variant="tonal"
                class="mt-4"
                @click="refreshSystemInfo"
              >
                <v-icon start>mdi-refresh</v-icon>
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
              <v-icon start>mdi-information-outline</v-icon>
              Device Details
            </v-card-title>
            <v-divider />
            <v-card-text>
              <v-list density="compact" class="wrap-lines">
                <v-list-item v-if="device.serial">
                  <v-list-item-title>Serial Number</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.serial }}
                  </v-list-item-subtitle>
                </v-list-item>

                <v-list-item v-if="device.model">
                  <v-list-item-title>Model</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.model }}
                  </v-list-item-subtitle>
                </v-list-item>

                <v-list-item v-if="device.firmwareVersion">
                  <v-list-item-title>Firmware Version</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.firmwareVersion }}
                  </v-list-item-subtitle>
                </v-list-item>

                <!-- What the device's cloud last reported (at sync) -->
                <template v-if="device.managementMode === 'cloud'">
                  <v-list-item v-if="device.cloudIntegration">
                    <v-list-item-title>Cloud</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ cloudProviderLabel(device.cloudIntegration.provider, { short: false }) }}
                      &middot; {{ device.cloudIntegration.name }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item>
                    <v-list-item-title>Cloud Status</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ device.cloudStatus || 'unknown' }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="cloudInfo.site">
                    <v-list-item-title>Site</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ cloudInfo.site }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="cloudInfo.configStatus">
                    <v-list-item-title>Config Status</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ cloudInfo.configStatus }}
                    </v-list-item-subtitle>
                  </v-list-item>
                  <v-list-item v-if="cloudInfo.uptime">
                    <v-list-item-title>Uptime ({{ device.cloudStatus === 'online' ? 'reported' : 'when last seen' }})</v-list-item-title>
                    <v-list-item-subtitle class="text-body-2 font-weight-medium">
                      {{ cloudInfo.uptime }}
                    </v-list-item-subtitle>
                  </v-list-item>
                </template>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- How NetHelper reaches the device, plus cloud-reported hardware -->
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title>
              <v-icon start>mdi-lan-connect</v-icon>
              Platform &amp; Access
            </v-card-title>
            <v-divider />
            <v-card-text>
              <v-list density="compact" class="wrap-lines">
                <v-list-item>
                  <v-list-item-title>Vendor</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ VendorInfo[device.vendor]?.label || 'Unknown' }}
                  </v-list-item-subtitle>
                </v-list-item>
                <v-list-item>
                  <v-list-item-title>Platform</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ PlatformInfo[device.platform]?.label || 'Not classified' }}
                  </v-list-item-subtitle>
                </v-list-item>
                <v-list-item>
                  <v-list-item-title>Device Credential</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.apiCredential?.name || (device.apiCredentialId ? 'Linked' : 'None linked') }}
                  </v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-if="device.apiLastTested">
                  <v-list-item-title>Last Connection Test</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.apiTestStatus === 'success' ? 'Passed' : 'Failed' }}
                    {{ formatRelativeTime(device.apiLastTested) }}<template v-if="device.apiResponseTime != null"> &middot; {{ device.apiResponseTime }} ms</template>
                  </v-list-item-subtitle>
                  <div v-if="device.apiError" class="text-caption text-error mt-1">{{ device.apiError }}</div>
                </v-list-item>
                <v-list-item v-if="device.deviceGroups?.length">
                  <v-list-item-title>Groups</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ device.deviceGroups.map(g => g.name).join(', ') }}
                  </v-list-item-subtitle>
                </v-list-item>
                <v-list-item v-for="item in cloudHardware" :key="item.label">
                  <v-list-item-title>{{ item.label }}</v-list-item-title>
                  <v-list-item-subtitle class="text-body-2 font-weight-medium">
                    {{ item.value }}
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Automation runs that targeted this device -->
      <DeviceRecentRunsCard :device-id="device.id" />
    </template>

    <!-- Connection Test Dialog -->
    <v-dialog v-model="showConnectionTestDialog" max-width="800px" :fullscreen="$vuetify.display.xs">
      <v-card>
        <v-card-title>
          <v-icon icon="mdi-connection" class="mr-2" />
          Connection Test - {{ device?.name }}
        </v-card-title>

        <v-card-text>
          <DeviceConnectionTest
            mode="stored"
            :device-id="device?.id"
            :result="lastTest"
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

    <DeviceEditDialog
      v-model="editDialog"
      :device="device"
      @saved="onEdited"
    />

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
import { useDisplay } from 'vuetify'
import { useDevicesStore } from '@/stores/devices'
import { useNotificationsStore } from '@/stores/notifications'
import { useAuthStore } from '@/stores/auth'
import { formatDistanceToNow, format, fromUnixTime } from 'date-fns'
import DeviceConnectionTest from '@/components/devices/DeviceConnectionTest.vue'
import DeviceLivePanel from '@/components/devices/DeviceLivePanel.vue'
import DeviceNeighborsPanel from '@/components/devices/DeviceNeighborsPanel.vue'
import DeviceHistoryPanel from '@/components/devices/DeviceHistoryPanel.vue'
import DeviceAddressLookup from '@/components/devices/DeviceAddressLookup.vue'
import DeviceAlertsBanner from '@/components/devices/DeviceAlertsBanner.vue'
import DeviceRecentRunsCard from '@/components/devices/DeviceRecentRunsCard.vue'
import { lastSeenSummary } from '@/models/device-seen'
import DeviceMergeDialog from '@/components/devices/DeviceMergeDialog.vue'
import DeviceEditDialog from '@/components/devices/DeviceEditDialog.vue'
import ActionButton from '@/components/common/ActionButton.vue'
import { useBackupsStore } from '@/stores/backups'
import { useWebSocket } from '@/composables/useWebSocket'
import deviceService from '@/services/device.service'
import deviceApiService from '@/services/deviceApi.service'
import { cloudProviderLabel, VendorInfo, PlatformInfo } from '@/models/vendors'
import { unreachableFromHere, answersPingButCloudOffline, deviceTypeInfo } from '@/models/Device'

const route = useRoute()
const router = useRouter()
const devicesStore = useDevicesStore()
const notificationStore = useNotificationsStore()
const authStore = useAuthStore()
const backupsStore = useBackupsStore()
const { on: onSocket, off: offSocket } = useWebSocket()
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))
// Phones: icon-only header buttons (Activity joins them), icon-free tabs.
const { xs } = useDisplay()

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
// What the device's cloud said when a direct test couldn't reach it.
const lastTestCloudStatus = ref(null)
// Outcome of the last header test, with a link to the details dialog, which
// shows the full result (lastTest) without testing again.
const lastTestResult = ref(null)
const lastTest = ref(null)

// Selected tab, kept in the URL (?tab=live) so a live view can be linked.
const TABS = ['live', 'neighbors', 'history']
const tab = computed({
  get: () => (TABS.includes(route.query.tab) ? route.query.tab : 'overview'),
  set: (value) => router.replace({ query: { ...route.query, tab: TABS.includes(value) ? value : undefined } }),
})

// Connection test dialog state
const showConnectionTestDialog = ref(false)

const systemData = computed(() => devicesStore.systemData)
const systemLoading = computed(() => devicesStore.systemLoading)
const systemError = computed(() => devicesStore.systemError)

// Whether polling the device itself can work (GET /devices/:id systemPoll):
// { available, reason }. Kept apart from the row, which list fetches replace
// with rows that don't carry it.
const systemPollState = ref(null)
// Other devices with this one's IP (GET /devices/:id sameIpDevices), kept
// apart from the row for the same reason.
const sameIpState = ref(null)
const sameIpDevices = computed(() =>
  sameIpState.value?.id === route.params.id ? sameIpState.value.value : []
)
const systemPoll = computed(() =>
  systemPollState.value?.id === route.params.id ? systemPollState.value.value : null
)
const systemPollReason = computed(() => {
  switch (systemPoll.value?.reason) {
    case 'cloud-only':
      return `${cloudPlaneName.value} is the only way NetHelper reaches this device, so it isn't polled directly. Its firmware and status come from cloud sync (Device Details below).`
    case 'no-transport':
      return `NetHelper has no direct way to read ${PlatformInfo[device.value?.platform]?.label || 'this platform'}. What it knows comes from inventory and ping.`
    case 'no-ip':
      return 'No IP address is set, so the device can\'t be polled.'
    case 'no-credential':
      return 'No device credential is linked. Link one (Edit, or Credential on the Devices page) to read system information from the device.'
    default:
      return ''
  }
})

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
// Who confirmed the device's cloud ownership (Device.cloudManagedSource).
const verifiedBy = computed(() => {
  const source = device.value?.cloudManagedSource
  if (source === 'switch-rest') return 'by the switch'
  if (source === 'cloud-inventory' || source === 'cloud-config') return `by ${cloudPlaneName.value}`
  return ''
})

/** Uptime as days/hours/minutes from seconds. */
const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes}m`].filter(Boolean).join(' ')
}

// Cloud-reported extras kept in Device.metadata by sync. Central reports
// uptime in milliseconds (uptimeMs), Mist in seconds (uptime).
const cloudInfo = computed(() => {
  const meta = device.value?.metadata || {}
  const seconds = meta.uptimeMs != null ? meta.uptimeMs / 1000 : meta.uptime
  return {
    site: meta.siteName || device.value?.location || null,
    configStatus: meta.configStatus || null,
    uptime: formatDuration(Number(seconds)),
  }
})

// Hardware details some clouds report at sync (Central: part number, persona,
// role, deployment; Mist: SKU, hardware revision). Shown only when present.
const cloudHardware = computed(() => {
  const meta = device.value?.metadata || {}
  return [
    { label: 'Part Number', value: meta.partNumber || meta.sku },
    { label: 'Hardware Revision', value: meta.hwRev },
    { label: 'Persona', value: meta.persona },
    { label: 'Role', value: meta.role },
    { label: 'Deployment', value: meta.deployment },
  ].filter(item => item.value)
})

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

// When the device was last confirmed alive, and by whom (Last Seen card).
const lastSeen = computed(() => lastSeenSummary(device.value || {}, { cloudName: cloudPlaneName.value }))

// Ping and the cloud disagree (what makes effectiveStatus() 'warning').
const cloudStatusWarning = computed(() => {
  if (!device.value) return null
  const plane = cloudPlaneName.value
  if (unreachableFromHere(device.value)) {
    return {
      title: `${plane} reports it online, but it doesn't answer ping`,
      text: `NetHelper can't reach this device from here. Check routing and firewalls between NetHelper and ${device.value.ipAddress || 'its address'}, or whether its IP has changed.`
    }
  }
  if (answersPingButCloudOffline(device.value)) {
    return {
      title: `${plane} reports it offline, but its address answers ping`,
      text: 'Another device may now use this IP address.',
      lookup: true,
      answeredBy: answeringDevice(),
    }
  }
  return null
})

// A device here with the same IP that is up explains a ping reply.
function answeringDevice() {
  const others = sameIpDevices.value
  const other = others.find((d) => d.cloudStatus === 'online' && d.managementMode === 'cloud')
    || others.find((d) => d.status === 'online')
  return other && {
    id: other.id,
    name: other.name,
    why: other.managementMode === 'cloud' && other.cloudStatus === 'online'
      ? `${cloudProviderLabel(other.cloudIntegration?.provider)} reports it online`
      : 'it is online',
  }
}

// The ping monitor gave its address to another device (no ping result while
// its cloud reports it offline and a device with its IP can be answering).
const addressHeldBy = computed(() => {
  const d = device.value
  if (!d || d.managementMode !== 'cloud' || d.cloudStatus !== 'offline' || d.pingStatus) return null
  return answeringDevice() || null
})

const cloudConnectionNote = computed(() => {
  const status = device.value?.cloudConnectionStatus
  if (!status || status === 'connected') return null
  return `${cloudPlaneName.value} connection: ${status}`
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

const getDeviceIcon = (type) => deviceTypeInfo(type).icon

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
  systemPollState.value = { id, value: response.data.systemPoll || null }
  sameIpState.value = { id, value: response.data.sameIpDevices || [] }
  devicesStore.updateDeviceLocally(id, response.data)
}

// A rate-limited load keeps the page (and any row already held) and retries
// once the API takes requests again (Retry-After, capped at 2 minutes), as
// the Devices table does.
const rateLimitRetryAt = ref(null)
let rateLimitTimer = null
const retryAfterRateLimit = (err, id) => {
  const waitMs = Math.min((err.retryAfter || 30) * 1000 + 500, 120000)
  rateLimitRetryAt.value = Date.now() + waitMs
  clearTimeout(rateLimitTimer)
  rateLimitTimer = setTimeout(() => {
    rateLimitRetryAt.value = null
    if (route.params.id === id) loadDevice()
  }, waitMs)
}

const loadDevice = async () => {
  const id = route.params.id
  clearTimeout(rateLimitTimer)
  rateLimitRetryAt.value = null
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

    // Poll system info on load only when something can answer: each poll
    // opens a device session (POST /devices/poll is operator+)
    if (canEdit.value && systemPoll.value?.available) await refreshSystemInfo()
  } catch (err) {
    if (err?.type === 'RATE_LIMIT') {
      if (route.params.id === id) retryAfterRateLimit(err, id)
      return
    }
    console.error('Failed to load device:', err)
    error.value = err.userMessage || err.message || 'Failed to load device details'
  } finally {
    if (route.params.id === id) loading.value = false
  }
}

// The same view is reused when navigating from one device to another.
watch(() => route.params.id, (id, previous) => {
  if (id && id !== previous) {
    stopBackupWait()
    lastTestResult.value = null
    lastTest.value = null
    lastTestCentralStatus.value = null
    lastTestCloudStatus.value = null
    loadDevice()
  }
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

// Test Again in the dialog: the header follows the newest result.
const handleConnectionTestComplete = (result) => {
  applyTestResult(result)
  fetchDevice().catch(() => {})
}

/** Show a test result beside the button; returns the summary line. */
const applyTestResult = (result) => {
  lastTest.value = result
  lastTestCentralStatus.value = null
  lastTestCloudStatus.value = null
  if (result?.centralStatus) {
    const { centralManaged, connectionStatus } = result.centralStatus
    const label = centralManaged === true ? `${cloudPlaneName.value}-managed` : centralManaged === false ? 'Locally managed' : 'Unknown'
    lastTestCentralStatus.value = connectionStatus ? `${label} (${connectionStatus})` : label
  }
  if (result?.cloudStatus) {
    const { provider, status, lastSeen } = result.cloudStatus
    lastTestCloudStatus.value = `${provider} reports it ${status}${lastSeen ? `, last seen ${formatRelativeTime(lastSeen)}` : ''}`
  }
  if (result?.success) {
    const via = result.transport ? ` (via ${result.transport.toUpperCase()})` : ''
    lastTestResult.value = `Direct connection successful${via}`
  } else {
    // A cloud-only result's message says there is nothing to test directly
    lastTestResult.value = result?.message || 'Direct connection failed'
  }
  return lastTestResult.value
}

// Test the direct (REST/SSH) path for a directly-managed device. The backend
// routes AOS-CX to REST and other devices to SSH automatically.
const testDirectConnection = async () => {
  if (!device.value) return
  testingConnection.value = true
  lastTestCentralStatus.value = null
  lastTestCloudStatus.value = null
  lastTestResult.value = null
  lastTest.value = null
  try {
    const result = await deviceApiService.testDeviceConnection(device.value.id)
    const summary = applyTestResult(result)
    if (result?.success) {
      notificationStore.showSuccess(summary, 'Connection Test')
    } else if (result?.cloudOnly) {
      // Nothing to test directly (a cloud-managed AP): not a failure.
      notificationStore.showInfo(summary, 'Connection Test')
    } else {
      notificationStore.showError(summary, 'Connection Test')
    }
  } catch (err) {
    const message = err.userMessage || err.message || 'Direct connection failed'
    applyTestResult({ success: false, message, details: err.message, testedAt: new Date().toISOString() })
    notificationStore.showError(message, 'Connection Test')
  } finally {
    testingConnection.value = false
    // The test is recorded on the device (API Status in the Devices table)
    fetchDevice().catch(() => {})
  }
}

const editDialog = ref(false)
const onEdited = (updated) => {
  if (updated) applyDevicePatch(updated)
  fetchDevice().catch(() => {})
}

// Back Up Now: queue a backup of this device and wait for its result. The
// websocket service already reports the outcome in the status bar; the page
// only tracks when its own run is done.
const BACKUP_WAIT_MS = 5 * 60 * 1000
const backupRunning = ref(false)
let backupWait = null

const stopBackupWait = () => {
  if (!backupWait) return
  offSocket('backup:completed', backupWait.handler)
  offSocket('backup:failed', backupWait.handler)
  clearTimeout(backupWait.timer)
  backupWait = null
  backupRunning.value = false
}

const backUpNow = async () => {
  if (!device.value || backupRunning.value) return
  const deviceId = device.value.id
  backupRunning.value = true
  const handler = (data) => {
    if (data?.deviceId === deviceId) stopBackupWait()
  }
  backupWait = { handler, timer: setTimeout(stopBackupWait, BACKUP_WAIT_MS) }
  onSocket('backup:completed', handler)
  onSocket('backup:failed', handler)
  try {
    await backupsStore.runBackup([deviceId])
    notificationStore.showInfo(`Backup of ${device.value?.name || 'this device'} queued`, 'Config Backup')
  } catch (err) {
    stopBackupWait()
    notificationStore.showError(err.userMessage || err.message || 'Failed to queue the backup', 'Config Backup')
  }
}

onMounted(() => {
  loadDevice()
})

onUnmounted(() => {
  stopBackupWait()
  clearTimeout(rateLimitTimer)
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

.header-title {
  min-width: 0;
}

/* Tabs take the row's remaining width and scroll (with arrows) inside it. */
.tab-row {
  flex: 1 1 auto;
  min-width: 0;
}

@media (max-width: 599.98px) {
  /* Two cards per row: the headline values drop to body size. */
  .stat-value {
    font-size: 1rem !important;
    line-height: 1.5rem !important;
    overflow-wrap: anywhere;
  }
}
</style>
