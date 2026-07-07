<template>
  <div>
    <v-container fluid class="pa-4">
      <!-- Header -->
      <div class="d-flex align-center flex-wrap mb-4">
        <div>
          <h1 class="text-h4 font-weight-bold">Configuration Backups</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Scheduled and on-demand device configuration backups with change detection
          </p>
        </div>
        <v-spacer />
        <v-chip
          :color="connected ? 'success' : 'warning'"
          size="small"
          variant="tonal"
          :prepend-icon="connected ? 'mdi-lan-connect' : 'mdi-lan-disconnect'"
        >
          {{ connected ? 'Live' : (connecting ? 'Connecting…' : 'Offline') }}
        </v-chip>
      </div>

      <v-tabs v-model="activeTab" color="primary" class="mb-4">
        <v-tab value="backups" prepend-icon="mdi-history">Backups</v-tab>
        <v-tab value="schedules" prepend-icon="mdi-calendar-clock">Schedules</v-tab>
      </v-tabs>

      <v-window v-model="activeTab">
        <!-- ============ BACKUPS TAB ============ -->
        <v-window-item value="backups">
          <v-card>
            <v-card-title class="d-flex align-center flex-wrap ga-2">
              <span>Backup History</span>
              <v-spacer />
              <v-select
                v-model="statusFilter"
                :items="statusFilterItems"
                label="Status"
                density="compact"
                hide-details
                clearable
                style="max-width: 180px"
                @update:model-value="reloadBackups"
              />
              <v-btn
                v-if="canManage"
                color="primary"
                prepend-icon="mdi-play"
                @click="openRunDialog"
              >
                Run Backup Now
              </v-btn>
            </v-card-title>

            <v-data-table-server
              v-model:page="page"
              v-model:items-per-page="itemsPerPage"
              :headers="backupHeaders"
              :items="backupsStore.backups"
              :items-length="backupsStore.total"
              :loading="backupsStore.backupsLoading"
              @update:options="onTableOptions"
            >
              <template #[`item.deviceName`]="{ item }">
                <div class="font-weight-medium">{{ item.deviceName }}</div>
                <div class="text-caption text-medium-emphasis">{{ item.deviceSerial }}</div>
              </template>

              <template #[`item.status`]="{ item }">
                <v-chip :color="statusColor(item.status)" size="small" variant="tonal">
                  {{ item.status }}
                </v-chip>
              </template>

              <template #[`item.trigger`]="{ item }">
                <v-icon size="small" class="mr-1">
                  {{ item.trigger === 'scheduled' ? 'mdi-calendar-clock' : 'mdi-gesture-tap' }}
                </v-icon>
                {{ item.trigger }}
              </template>

              <template #[`item.hasChanges`]="{ item }">
                <v-chip
                  v-if="item.status === 'success'"
                  :color="item.hasChanges ? 'warning' : 'default'"
                  size="x-small"
                  variant="tonal"
                >
                  {{ item.hasChanges ? 'Changed' : 'No change' }}
                </v-chip>
                <span v-else>—</span>
              </template>

              <template #[`item.sizeBytes`]="{ item }">
                {{ item.sizeBytes ? formatBytes(item.sizeBytes) : '—' }}
              </template>

              <template #[`item.createdAt`]="{ item }">
                {{ formatDate(item.createdAt) }}
              </template>

              <template #[`item.actions`]="{ item }">
                <v-tooltip text="View" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-eye"
                      size="small"
                      variant="text"
                      :disabled="item.status !== 'success'"
                      @click="viewBackup(item)"
                    />
                  </template>
                </v-tooltip>
                <v-tooltip text="Download" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-download"
                      size="small"
                      variant="text"
                      :disabled="item.status !== 'success'"
                      @click="download(item)"
                    />
                  </template>
                </v-tooltip>
                <v-tooltip text="Compare" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-file-compare"
                      size="small"
                      variant="text"
                      :disabled="item.status !== 'success'"
                      @click="openCompareDialog(item)"
                    />
                  </template>
                </v-tooltip>
                <v-tooltip v-if="isAdmin" text="Delete" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-delete"
                      size="small"
                      variant="text"
                      color="error"
                      @click="confirmDeleteBackup(item)"
                    />
                  </template>
                </v-tooltip>
              </template>

              <template #no-data>
                <div class="text-center pa-6 text-medium-emphasis">
                  No backups yet. Run a backup or create a schedule to get started.
                </div>
              </template>
            </v-data-table-server>
          </v-card>
        </v-window-item>

        <!-- ============ SCHEDULES TAB ============ -->
        <v-window-item value="schedules">
          <v-card>
            <v-card-title class="d-flex align-center">
              <span>Backup Schedules</span>
              <v-spacer />
              <v-btn
                v-if="canManage"
                color="primary"
                prepend-icon="mdi-plus"
                @click="openScheduleDialog()"
              >
                New Schedule
              </v-btn>
            </v-card-title>

            <v-data-table
              :headers="scheduleHeaders"
              :items="backupsStore.schedules"
              :loading="backupsStore.schedulesLoading"
            >
              <template #[`item.name`]="{ item }">
                <div class="font-weight-medium">{{ item.name }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ deviceSelectionSummary(item.deviceSelection) }}
                </div>
              </template>

              <template #[`item.cronExpression`]="{ item }">
                <code>{{ item.cronExpression }}</code>
                <div class="text-caption text-medium-emphasis">{{ item.timezone }}</div>
              </template>

              <template #[`item.active`]="{ item }">
                <v-switch
                  :model-value="item.active"
                  color="success"
                  density="compact"
                  hide-details
                  :disabled="!canManage"
                  @update:model-value="toggleSchedule(item)"
                />
              </template>

              <template #[`item.nextRun`]="{ item }">
                {{ item.nextRun ? formatDate(item.nextRun) : '—' }}
              </template>

              <template #[`item.retention`]="{ item }">
                {{ retentionSummary(item) }}
              </template>

              <template #[`item.actions`]="{ item }">
                <v-tooltip v-if="canManage" text="Run now" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-play"
                      size="small"
                      variant="text"
                      @click="runScheduleNow(item)"
                    />
                  </template>
                </v-tooltip>
                <v-tooltip v-if="canManage" text="Edit" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-pencil"
                      size="small"
                      variant="text"
                      @click="openScheduleDialog(item)"
                    />
                  </template>
                </v-tooltip>
                <v-tooltip v-if="isAdmin" text="Delete" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-delete"
                      size="small"
                      variant="text"
                      color="error"
                      @click="confirmDeleteSchedule(item)"
                    />
                  </template>
                </v-tooltip>
              </template>

              <template #no-data>
                <div class="text-center pa-6 text-medium-emphasis">
                  No schedules configured.
                </div>
              </template>
            </v-data-table>
          </v-card>
        </v-window-item>
      </v-window>
    </v-container>

    <!-- Run Backup Now dialog (device picker) -->
    <v-dialog v-model="showRunDialog" max-width="640" persistent scrollable>
      <v-card>
        <v-card-title class="text-h5">Run Backup Now</v-card-title>
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-3">
            Select devices to back up immediately.
          </p>
          <v-text-field
            v-model="deviceSearch"
            label="Search devices"
            prepend-inner-icon="mdi-magnify"
            density="compact"
            hide-details
            clearable
            class="mb-3"
          />
          <v-data-table
            v-model="selectedDeviceIds"
            :headers="devicePickerHeaders"
            :items="filteredDevices"
            :search="deviceSearch"
            item-value="id"
            show-select
            density="compact"
            :items-per-page="10"
          >
            <template #[`item.type`]="{ item }">
              {{ typeLabel(item.type) }}
            </template>
          </v-data-table>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showRunDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="backupsStore.running"
            :disabled="selectedDeviceIds.length === 0"
            @click="submitRun"
          >
            Back Up {{ selectedDeviceIds.length }} Device(s)
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- View backup content dialog -->
    <v-dialog v-model="showViewDialog" max-width="900" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center">
          <span class="text-truncate">{{ viewTarget?.deviceName }} — {{ formatDate(viewTarget?.createdAt) }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" @click="showViewDialog = false" />
        </v-card-title>
        <v-card-text>
          <v-progress-linear v-if="loadingContent" indeterminate color="primary" />
          <pre v-else class="config-content">{{ viewContent }}</pre>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Compare dialog -->
    <v-dialog v-model="showCompareDialog" max-width="1100" scrollable>
      <v-card>
        <v-card-title class="text-h5">Compare Backups</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-select
                v-model="compareFromId"
                :items="compareCandidates"
                label="From (older)"
                density="compact"
                @update:model-value="loadDiff"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="compareToId"
                :items="compareCandidates"
                label="To (newer)"
                density="compact"
                @update:model-value="loadDiff"
              />
            </v-col>
          </v-row>

          <v-progress-linear v-if="loadingDiff" indeterminate color="primary" class="mb-3" />
          <ConfigDiffViewer
            v-else-if="diffResult"
            :patch="diffResult.patch"
            :additions="diffResult.additions"
            :deletions="diffResult.deletions"
            :identical="diffResult.identical"
          />
          <div v-else class="text-medium-emphasis text-center pa-4">
            Select two backups to compare.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCompareDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Schedule create/edit dialog -->
    <v-dialog v-model="showScheduleDialog" max-width="720" persistent scrollable>
      <v-card>
        <v-card-title class="text-h5">
          {{ editingSchedule ? 'Edit Schedule' : 'New Backup Schedule' }}
        </v-card-title>
        <v-card-text>
          <v-form ref="scheduleFormRef">
            <v-text-field
              v-model="scheduleForm.name"
              label="Name"
              :rules="[rules.required]"
              class="mb-2"
            />

            <v-row>
              <v-col cols="12" md="7">
                <v-text-field
                  v-model="scheduleForm.cronExpression"
                  label="Cron Expression"
                  hint="Minute Hour Day Month Weekday"
                  persistent-hint
                  :rules="[rules.required]"
                />
              </v-col>
              <v-col cols="12" md="5">
                <v-select
                  v-model="cronPreset"
                  :items="cronPresets"
                  label="Preset"
                  density="comfortable"
                  @update:model-value="applyCronPreset"
                />
              </v-col>
            </v-row>

            <v-text-field
              v-model="scheduleForm.timezone"
              label="Timezone"
              hint="e.g. UTC, America/Chicago"
              persistent-hint
              class="mb-3"
            />

            <v-select
              v-model="scheduleForm.deviceSelection.mode"
              :items="selectionModes"
              label="Device Selection"
              class="mb-2"
            />
            <v-select
              v-if="scheduleForm.deviceSelection.mode === 'types'"
              v-model="scheduleForm.deviceSelection.types"
              :items="deviceTypeItems"
              label="Device Types"
              multiple
              chips
              class="mb-2"
            />
            <v-select
              v-if="scheduleForm.deviceSelection.mode === 'devices'"
              v-model="scheduleForm.deviceSelection.deviceIds"
              :items="deviceSelectItems"
              label="Devices"
              multiple
              chips
              class="mb-2"
            />

            <v-row>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model.number="scheduleForm.retentionDays"
                  label="Retention (days)"
                  type="number"
                  hint="0 = keep forever"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model.number="scheduleForm.retentionMaxCount"
                  label="Max backups per device"
                  type="number"
                  hint="0 = unlimited"
                  persistent-hint
                />
              </v-col>
            </v-row>

            <v-switch
              v-model="scheduleForm.active"
              label="Active"
              color="success"
              hide-details
            />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showScheduleDialog = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :loading="savingSchedule" @click="saveSchedule">
            {{ editingSchedule ? 'Save' : 'Create' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirmation -->
    <v-dialog v-model="showDeleteDialog" max-width="440">
      <v-card>
        <v-card-title class="text-h6">Confirm Delete</v-card-title>
        <v-card-text>{{ deleteMessage }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDeleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="performDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout">
      {{ snackbar.message }}
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useBackupsStore } from '@/stores/backups'
import { useDevicesStore } from '@/stores/devices'
import { useWebSocket } from '@/composables/useWebSocket'
import ConfigDiffViewer from '@/components/backups/ConfigDiffViewer.vue'

const authStore = useAuthStore()
const backupsStore = useBackupsStore()
const devicesStore = useDevicesStore()
const { connected, connecting } = useWebSocket()

const activeTab = ref('backups')
const page = ref(1)
const itemsPerPage = ref(25)
const statusFilter = ref(null)

const isAdmin = computed(() => authStore.user?.role === 'admin')
const canManage = computed(() => ['admin', 'operator'].includes(authStore.user?.role))

const snackbar = ref({ show: false, message: '', color: 'success', timeout: 4000 })
function notify(message, color = 'success') {
  snackbar.value = { show: true, message, color, timeout: 4000 }
}

const rules = {
  required: value => !!value || 'This field is required'
}

// ---- Table headers ----
const backupHeaders = [
  { title: 'Device', key: 'deviceName' },
  { title: 'Status', key: 'status' },
  { title: 'Trigger', key: 'trigger' },
  { title: 'Changes', key: 'hasChanges' },
  { title: 'Size', key: 'sizeBytes' },
  { title: 'Date', key: 'createdAt' },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' }
]

const scheduleHeaders = [
  { title: 'Name', key: 'name' },
  { title: 'Schedule', key: 'cronExpression' },
  { title: 'Active', key: 'active', sortable: false },
  { title: 'Next Run', key: 'nextRun' },
  { title: 'Retention', key: 'retention', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' }
]

const devicePickerHeaders = [
  { title: 'Name', key: 'name' },
  { title: 'Type', key: 'type' },
  { title: 'Serial', key: 'serial' },
  { title: 'IP', key: 'ipAddress' }
]

const statusFilterItems = [
  { title: 'Success', value: 'success' },
  { title: 'Failed', value: 'failed' },
  { title: 'Running', value: 'running' },
  { title: 'Pending', value: 'pending' }
]

const deviceTypeItems = [
  { title: 'Access Point', value: 'access_point' },
  { title: 'Switch', value: 'switch' },
  { title: 'Gateway', value: 'gateway' }
]

const selectionModes = [
  { title: 'All devices', value: 'all' },
  { title: 'By device type', value: 'types' },
  { title: 'Specific devices', value: 'devices' }
]

const cronPresets = [
  { title: 'Daily at 2:00 AM', value: '0 2 * * *' },
  { title: 'Every 6 hours', value: '0 */6 * * *' },
  { title: 'Hourly', value: '0 * * * *' },
  { title: 'Weekly (Sun 3 AM)', value: '0 3 * * 0' },
  { title: 'Monthly (1st, 4 AM)', value: '0 4 1 * *' }
]

// ---- Backups tab ----
function statusColor(status) {
  return { success: 'success', failed: 'error', running: 'info', pending: 'grey' }[status] || 'grey'
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function typeLabel(type) {
  return deviceTypeItems.find(t => t.value === type)?.title || type
}

async function reloadBackups() {
  try {
    await backupsStore.fetchBackups({
      page: page.value,
      itemsPerPage: itemsPerPage.value,
      filters: { status: statusFilter.value }
    })
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to load backups', 'error')
  }
}

function onTableOptions(options) {
  page.value = options.page
  itemsPerPage.value = options.itemsPerPage
  reloadBackups()
}

// View content
const showViewDialog = ref(false)
const viewTarget = ref(null)
const viewContent = ref('')
const loadingContent = ref(false)

async function viewBackup(item) {
  viewTarget.value = item
  viewContent.value = ''
  loadingContent.value = true
  showViewDialog.value = true
  try {
    const data = await backupsStore.fetchBackupContent(item.id)
    viewContent.value = data.content
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to load configuration', 'error')
    showViewDialog.value = false
  } finally {
    loadingContent.value = false
  }
}

async function download(item) {
  try {
    await backupsStore.downloadBackup(item.id)
  } catch (error) {
    notify(error.userMessage || error.message || 'Download failed', 'error')
  }
}

// Compare / diff
const showCompareDialog = ref(false)
const compareDeviceId = ref(null)
const compareFromId = ref(null)
const compareToId = ref(null)
const diffResult = ref(null)
const loadingDiff = ref(false)

const compareCandidates = computed(() =>
  backupsStore.backups
    .filter(b => b.status === 'success' && b.deviceId === compareDeviceId.value)
    .map(b => ({ title: formatDate(b.createdAt), value: b.id }))
)

function openCompareDialog(item) {
  compareDeviceId.value = item.deviceId
  compareToId.value = item.id
  compareFromId.value = null
  diffResult.value = null
  showCompareDialog.value = true
}

async function loadDiff() {
  if (!compareFromId.value || !compareToId.value || compareFromId.value === compareToId.value) {
    diffResult.value = null
    return
  }
  loadingDiff.value = true
  try {
    diffResult.value = await backupsStore.diffBackups(compareFromId.value, compareToId.value)
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to compute diff', 'error')
  } finally {
    loadingDiff.value = false
  }
}

// Run backup now
const showRunDialog = ref(false)
const deviceSearch = ref('')
const selectedDeviceIds = ref([])

const filteredDevices = computed(() => devicesStore.devices)
const deviceSelectItems = computed(() =>
  devicesStore.devices.map(d => ({ title: `${d.name} (${d.serial})`, value: d.id }))
)

async function openRunDialog() {
  selectedDeviceIds.value = []
  deviceSearch.value = ''
  if (devicesStore.devices.length === 0) {
    try {
      await devicesStore.fetchDevices()
    } catch (error) {
      notify(error.userMessage || error.message || 'Failed to load devices', 'error')
    }
  }
  showRunDialog.value = true
}

async function submitRun() {
  try {
    await backupsStore.runBackup(selectedDeviceIds.value)
    notify(`Backup queued for ${selectedDeviceIds.value.length} device(s)`)
    showRunDialog.value = false
    setTimeout(reloadBackups, 1500)
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to queue backup', 'error')
  }
}

// Schedules
const showScheduleDialog = ref(false)
const editingSchedule = ref(null)
const savingSchedule = ref(false)
const scheduleFormRef = ref(null)
const cronPreset = ref(null)

const emptyScheduleForm = () => ({
  name: '',
  cronExpression: '0 2 * * *',
  timezone: 'UTC',
  active: true,
  deviceSelection: { mode: 'all', types: [], deviceIds: [] },
  retentionDays: 90,
  retentionMaxCount: 30
})
const scheduleForm = ref(emptyScheduleForm())

function applyCronPreset(value) {
  if (value) scheduleForm.value.cronExpression = value
}

function deviceSelectionSummary(selection) {
  if (!selection) return 'All devices'
  if (selection.mode === 'all') return 'All devices'
  if (selection.mode === 'types') return `Types: ${(selection.types || []).map(typeLabel).join(', ') || 'none'}`
  if (selection.mode === 'devices') return `${(selection.deviceIds || []).length} specific device(s)`
  return ''
}

function retentionSummary(item) {
  const parts = []
  parts.push(item.retentionDays ? `${item.retentionDays}d` : 'forever')
  parts.push(item.retentionMaxCount ? `max ${item.retentionMaxCount}` : 'unlimited')
  return parts.join(' / ')
}

async function openScheduleDialog(item = null) {
  editingSchedule.value = item
  cronPreset.value = null
  if (item) {
    scheduleForm.value = {
      name: item.name,
      cronExpression: item.cronExpression,
      timezone: item.timezone,
      active: item.active,
      deviceSelection: {
        mode: item.deviceSelection?.mode || 'all',
        types: item.deviceSelection?.types || [],
        deviceIds: item.deviceSelection?.deviceIds || []
      },
      retentionDays: item.retentionDays,
      retentionMaxCount: item.retentionMaxCount
    }
  } else {
    scheduleForm.value = emptyScheduleForm()
  }
  if (devicesStore.devices.length === 0) {
    try { await devicesStore.fetchDevices() } catch { /* non-fatal */ }
  }
  showScheduleDialog.value = true
}

async function saveSchedule() {
  const { valid } = await scheduleFormRef.value.validate()
  if (!valid) return
  savingSchedule.value = true
  try {
    const payload = { ...scheduleForm.value }
    if (editingSchedule.value) {
      await backupsStore.updateSchedule(editingSchedule.value.id, payload)
      notify('Schedule updated')
    } else {
      await backupsStore.createSchedule(payload)
      notify('Schedule created')
    }
    showScheduleDialog.value = false
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to save schedule', 'error')
  } finally {
    savingSchedule.value = false
  }
}

async function toggleSchedule(item) {
  try {
    await backupsStore.updateSchedule(item.id, { active: !item.active })
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to update schedule', 'error')
  }
}

async function runScheduleNow(item) {
  try {
    await backupsStore.runScheduleNow(item.id)
    notify(`Schedule "${item.name}" queued`)
    setTimeout(reloadBackups, 1500)
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to run schedule', 'error')
  }
}

// Delete (shared for backups + schedules)
const showDeleteDialog = ref(false)
const deleteMessage = ref('')
const deleting = ref(false)
const deleteAction = ref(null)

function confirmDeleteBackup(item) {
  deleteMessage.value = `Delete the backup of "${item.deviceName}" from ${formatDate(item.createdAt)}?`
  deleteAction.value = () => backupsStore.deleteBackup(item.id)
  showDeleteDialog.value = true
}

function confirmDeleteSchedule(item) {
  deleteMessage.value = `Delete schedule "${item.name}"? This does not delete existing backups.`
  deleteAction.value = () => backupsStore.deleteSchedule(item.id)
  showDeleteDialog.value = true
}

async function performDelete() {
  deleting.value = true
  try {
    await deleteAction.value()
    notify('Deleted')
    showDeleteDialog.value = false
  } catch (error) {
    notify(error.userMessage || error.message || 'Delete failed', 'error')
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  reloadBackups()
  backupsStore.fetchSchedules().catch(() => {})
})
</script>

<style scoped>
.config-content {
  font-family: 'Roboto Mono', 'Courier New', monospace;
  font-size: 0.8125rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 65vh;
  overflow-y: auto;
}
</style>
