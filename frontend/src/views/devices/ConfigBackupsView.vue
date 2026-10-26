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
        <v-tab value="scopes" prepend-icon="mdi-cloud-outline">Cloud Scopes</v-tab>
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
              :headers="shownBackupHeaders"
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
                <div
                  v-if="item.status === 'failed' && item.error"
                  class="text-caption text-medium-emphasis backup-error"
                  :title="item.error"
                >
                  {{ item.error }}
                </div>
                <!-- Succeeded, but without everything (e.g. NETCONF refused, cloud copy only) -->
                <div
                  v-if="item.status === 'success' && item.warning"
                  class="text-caption text-warning backup-error"
                  :title="item.warning"
                >
                  <v-icon icon="mdi-alert" size="x-small" /> {{ item.warning }}
                </div>
                <!-- APs have no per-device config: point at where it lives -->
                <v-btn
                  v-if="item.status === 'failed' && isApConfigError(item.error)"
                  size="x-small"
                  variant="text"
                  color="primary"
                  prepend-icon="mdi-cloud-outline"
                  class="px-0"
                  @click="activeTab = 'scopes'"
                >
                  See cloud scopes
                </v-btn>
              </template>

              <template #[`item.formats`]="{ item }">
                <template v-if="item.status === 'success'">
                  <v-chip
                    v-for="artifact in artifactsOf(item)"
                    :key="artifact.kind"
                    size="x-small"
                    variant="tonal"
                    class="mr-1"
                    :color="artifact.kind === 'cli' ? 'primary' : 'default'"
                    :title="formatLabel(artifact.format)"
                  >
                    {{ kindLabel(artifact.kind) }}
                  </v-chip>
                </template>
                <span v-else>—</span>
              </template>

              <template #[`item.trigger`]="{ item }">
                <v-icon size="small" class="mr-1">
                  {{ item.trigger === 'scheduled' ? 'mdi-calendar-clock' : 'mdi-gesture-tap' }}
                </v-icon>
                {{ item.trigger }}
              </template>

              <template #[`item.hasChanges`]="{ item }">
                <template v-if="item.status === 'success'">
                  <v-chip
                    :color="item.hasChanges ? 'warning' : 'default'"
                    size="x-small"
                    variant="tonal"
                  >
                    {{ item.hasChanges ? 'Changed' : 'No change' }}
                  </v-chip>
                  <!-- Present only when the Git mirror is enabled and committed this run -->
                  <v-chip
                    v-if="item.commitSha"
                    class="ml-1"
                    size="x-small"
                    variant="tonal"
                    color="info"
                    prepend-icon="mdi-source-commit"
                    :title="`Committed to the backup repository as ${item.commitSha}`"
                  >
                    {{ item.commitSha.slice(0, 7) }}
                  </v-chip>
                </template>
                <span v-else>—</span>
              </template>

              <template #[`item.sizeBytes`]="{ item }">
                {{ item.sizeBytes ? formatBytes(item.sizeBytes) : '—' }}
              </template>

              <template #[`item.createdAt`]="{ item }">
                {{ formatDate(item.createdAt) }}
              </template>

              <template #[`item.actions`]="{ item }">
                <v-tooltip v-if="canManage" text="View" location="top">
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
                <v-tooltip v-if="canManage" text="Download" location="top">
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
                <v-tooltip v-if="canManage" text="Compare" location="top">
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

        <!-- ============ CLOUD SCOPES TAB ============ -->
        <v-window-item value="scopes">
          <v-card>
            <v-card-title class="d-flex align-center flex-wrap ga-2">
              <span>Cloud Scope Backups</span>
              <v-spacer />
              <v-select
                v-model="scopeProvider"
                :items="scopeProviderOptions"
                label="Cloud"
                density="compact"
                variant="outlined"
                hide-details
                class="scope-provider-filter"
                @update:model-value="onScopeProviderChange"
              />
              <v-btn
                v-if="canManage"
                color="primary"
                prepend-icon="mdi-cloud-download-outline"
                :loading="backupsStore.running"
                @click="runScopeBackup"
              >
                Back Up Cloud Scopes
              </v-btn>
            </v-card-title>
            <v-card-subtitle class="text-wrap pb-2">
              Configuration a cloud holds above the device: a Juniper Mist org and its sites
              (WLANs, RF templates, device profiles, switch templates), and Aruba Central's global
              scope, site collections, sites and device groups (profiles and where they are assigned).
              Access points are configured here, not per device.
            </v-card-subtitle>

            <v-data-table-server
              v-model:page="scopePage"
              v-model:items-per-page="scopeItemsPerPage"
              :headers="shownScopeHeaders"
              :items="backupsStore.scopeBackups"
              :items-length="backupsStore.scopeTotal"
              :loading="backupsStore.scopeLoading"
              @update:options="onScopeTableOptions"
            >
              <template #[`item.scopeName`]="{ item }">
                <div class="font-weight-medium">{{ item.scopeName }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ cloudProviderLabel(item.provider, { short: false }) }} · {{ scopeTypeLabel(item.scopeType) }} · {{ item.integrationName }}
                </div>
              </template>

              <template #[`item.status`]="{ item }">
                <v-chip :color="statusColor(item.status)" size="small" variant="tonal">
                  {{ item.status }}
                </v-chip>
                <div
                  v-if="item.status === 'failed' && item.error"
                  class="text-caption text-medium-emphasis backup-error"
                  :title="item.error"
                >
                  {{ item.error }}
                </div>
              </template>

              <template #[`item.hasChanges`]="{ item }">
                <template v-if="item.status === 'success'">
                  <v-chip :color="item.hasChanges ? 'warning' : 'default'" size="x-small" variant="tonal">
                    {{ item.hasChanges ? 'Changed' : 'No change' }}
                  </v-chip>
                  <v-chip
                    v-if="item.commitSha"
                    class="ml-1"
                    size="x-small"
                    variant="tonal"
                    color="info"
                    prepend-icon="mdi-source-commit"
                    :title="`Committed to the backup repository as ${item.commitSha}`"
                  >
                    {{ item.commitSha.slice(0, 7) }}
                  </v-chip>
                </template>
                <span v-else>—</span>
              </template>

              <template #[`item.sizeBytes`]="{ item }">
                {{ item.sizeBytes ? formatBytes(item.sizeBytes) : '—' }}
              </template>

              <template #[`item.createdAt`]="{ item }">
                {{ formatDate(item.createdAt) }}
              </template>

              <template #[`item.actions`]="{ item }">
                <v-tooltip v-if="canManage" text="View" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-eye"
                      size="small"
                      variant="text"
                      :disabled="item.status !== 'success'"
                      @click="viewScopeBackup(item)"
                    />
                  </template>
                </v-tooltip>
                <v-tooltip v-if="canManage" text="Download" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-download"
                      size="small"
                      variant="text"
                      :disabled="item.status !== 'success'"
                      @click="downloadScope(item)"
                    />
                  </template>
                </v-tooltip>
                <v-tooltip v-if="canManage" text="Compare" location="top">
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-file-compare"
                      size="small"
                      variant="text"
                      :disabled="item.status !== 'success'"
                      @click="openScopeCompareDialog(item)"
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
                      @click="confirmDeleteScopeBackup(item)"
                    />
                  </template>
                </v-tooltip>
              </template>

              <template #no-data>
                <div class="text-center pa-6 text-medium-emphasis">
                  No cloud scope backups yet. Back up cloud scopes now, or turn on
                  "Also back up cloud scopes" in a schedule.
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
              :headers="shownScheduleHeaders"
              :items="backupsStore.schedules"
              :loading="backupsStore.schedulesLoading"
            >
              <template #[`item.name`]="{ item }">
                <div class="font-weight-medium">{{ item.name }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ deviceSelectionSummary(item.deviceSelection) }}{{ item.includeScopes ? ' + cloud scopes' : '' }}
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
    <v-dialog v-model="showRunDialog" max-width="640" :fullscreen="$vuetify.display.xs" persistent scrollable>
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

    <!-- View backup content dialog (one tab per artifact: CLI / JSON) -->
    <v-dialog v-model="showViewDialog" max-width="900" :fullscreen="$vuetify.display.xs" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center">
          <span class="text-truncate">{{ viewTarget?.title }} — {{ formatDate(viewTarget?.createdAt) }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" @click="showViewDialog = false" />
        </v-card-title>
        <div class="d-flex align-center flex-wrap px-4 ga-2">
          <v-tabs
            v-if="viewTarget?.artifacts.length > 1"
            v-model="viewKind"
            density="compact"
            color="primary"
            @update:model-value="loadViewContent"
          >
            <v-tab v-for="artifact in viewTarget.artifacts" :key="artifact.kind" :value="artifact.kind">
              {{ kindLabel(artifact.kind) }}
            </v-tab>
          </v-tabs>
          <v-chip v-else-if="viewArtifact" size="small" variant="tonal">{{ formatLabel(viewArtifact.format) }}</v-chip>
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-content-copy"
            :disabled="loadingContent || !viewContent"
            @click="copyContent"
          >
            Copy
          </v-btn>
          <v-btn size="small" variant="text" prepend-icon="mdi-download" @click="downloadViewed">
            Download
          </v-btn>
        </div>
        <v-card-text>
          <v-alert
            v-if="viewHint"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            {{ viewHint }}
            <div class="text-caption mt-1">NetHelper does not push configurations to devices yet.</div>
          </v-alert>
          <v-progress-linear v-if="loadingContent" indeterminate color="primary" />
          <pre v-else class="config-content">{{ viewContent }}</pre>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Compare dialog -->
    <v-dialog v-model="showCompareDialog" max-width="1100" :fullscreen="$vuetify.display.xs" scrollable>
      <v-card>
        <v-card-title class="text-h5">Compare Backups</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <v-select
                v-model="compareFromId"
                :items="compareCandidates"
                :loading="loadingCompareRows"
                label="From (older)"
                density="compact"
                @update:model-value="loadDiff"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="compareToId"
                :items="compareCandidates"
                :loading="loadingCompareRows"
                label="To (newer)"
                density="compact"
                @update:model-value="loadDiff"
              />
            </v-col>
          </v-row>

          <div v-if="diffResult?.kinds?.length > 1" class="d-flex align-center mb-3">
            <span class="text-body-2 text-medium-emphasis mr-3">Compare</span>
            <v-btn-toggle
              v-model="compareKind"
              density="compact"
              variant="outlined"
              mandatory
              @update:model-value="loadDiff"
            >
              <v-btn v-for="kind in diffResult.kinds" :key="kind" :value="kind" size="small">
                {{ kindLabel(kind) }}
              </v-btn>
            </v-btn-toggle>
          </div>

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
    <v-dialog v-model="showScheduleDialog" max-width="720" :fullscreen="$vuetify.display.xs" persistent scrollable>
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
              v-model="scheduleForm.includeScopes"
              label="Also back up cloud scopes"
              hint="Mist org/site and Central scope configuration, which is where access point configuration lives"
              persistent-hint
              color="primary"
              class="mb-2"
            />
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
import { CloudProviderInfo, cloudProviderLabel } from '@/models/vendors'
import { usePhoneColumns } from '@/composables/usePhoneColumns'

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
  { title: 'Formats', key: 'formats', sortable: false },
  { title: 'Changes', key: 'hasChanges' },
  { title: 'Size', key: 'sizeBytes' },
  { title: 'Date', key: 'createdAt' },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' }
]
const shownBackupHeaders = usePhoneColumns(backupHeaders, ['deviceName', 'status', 'hasChanges', 'createdAt', 'actions'])

const scopeHeaders = [
  { title: 'Scope', key: 'scopeName', sortable: false },
  { title: 'Status', key: 'status', sortable: false },
  { title: 'Changes', key: 'hasChanges', sortable: false },
  { title: 'Size', key: 'sizeBytes', sortable: false },
  { title: 'Date', key: 'createdAt', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' }
]
const shownScopeHeaders = usePhoneColumns(scopeHeaders, ['scopeName', 'status', 'hasChanges', 'createdAt', 'actions'])

const scheduleHeaders = [
  { title: 'Name', key: 'name' },
  { title: 'Schedule', key: 'cronExpression' },
  { title: 'Active', key: 'active', sortable: false },
  { title: 'Next Run', key: 'nextRun' },
  { title: 'Retention', key: 'retention', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' }
]
const shownScheduleHeaders = usePhoneColumns(scheduleHeaders, ['name', 'cronExpression', 'active', 'actions'])

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

// ---- Artifacts: a backup holds a CLI text, a JSON document, or both (AOS-CX) ----
const KIND_LABELS = { cli: 'CLI', structured: 'JSON' }
const FORMAT_LABELS = {
  'cli-text': 'CLI running-config',
  'junos-set': 'Junos set commands',
  'aoscx-json': 'AOS-CX REST config (JSON)',
  'mist-config-json': 'Mist device config (JSON)',
  'mist-scope-json': 'Mist org/site config (JSON)',
  'central-scope-json': 'Central scope config (JSON)',
  'meraki-settings-json': 'Meraki settings (JSON)'
}
const KIND_ORDER = ['cli', 'structured']

function kindLabel(kind) {
  return KIND_LABELS[kind] || kind
}

function formatLabel(format) {
  return FORMAT_LABELS[format] || format || 'Configuration'
}

function kindOfFormat(format) {
  return /json$/.test(format || '') ? 'structured' : 'cli'
}

// Rows from before artifacts existed carry only `format`.
function artifactsOf(backup) {
  const artifacts = backup.artifacts?.length
    ? backup.artifacts
    : (backup.format || backup.status === 'success' ? [{ kind: kindOfFormat(backup.format), format: backup.format || 'cli-text' }] : [])
  return [...artifacts].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

function isApConfigError(error) {
  return /access point/i.test(error || '')
}

function scopeTypeLabel(type) {
  return {
    org: 'Organization',
    'site-collection': 'Site collection',
    site: 'Site',
    'device-group': 'Device group',
    group: 'Group',
  }[type] || type
}

/**
 * How a person would apply this artifact by hand. NetHelper itself never
 * writes config; this only says where the text can go.
 */
const SCOPE_APPLY_HINTS = {
  aruba_central: 'Configuration Central holds for this scope: the library profiles assigned here and the objects in effect. Changes are made in Central (profiles and their assignments), not on a device.',
  juniper_mist: 'Configuration Mist holds for this org or site: settings, WLANs and templates. Changes are made in Mist, not on a device.',
}

const CLOUD_CLI_HINTS = {
  aruba_central: 'This device is managed by Aruba Central and refuses local configuration changes. Apply changes through Central, e.g. MultiEdit for AOS-CX switches in UI groups.',
  juniper_mist: 'Mist configures this device, so local changes are overwritten on its next config push. Apply changes in Mist (device, site or switch template).',
}

function applyHint(artifact, device, isScope, provider = null) {
  if (!artifact) return null
  const secretsNote = ' Secrets are replaced by fingerprints that change when the secret does.'
  if (isScope) {
    return (SCOPE_APPLY_HINTS[provider]
      || 'Configuration held by the cloud for this scope. Changes are applied through the cloud dashboard or API, not on a device.') + secretsNote
  }
  const cloudManaged = device && (device.managementMode === 'cloud' || device.cloudManaged === true)
  const deviceProvider = device?.cloudIntegration?.provider
  const cloudName = cloudProviderLabel(deviceProvider, { short: false })
  if (artifact.kind === 'cli') {
    if (artifact.format === 'junos-set') {
      return cloudManaged
        ? `Set commands for this Junos device. It is managed by ${cloudName}, so apply changes there rather than on the local CLI.`
        : 'Junos: enter configuration mode, run "load set terminal", paste, then "commit confirmed 5" and confirm with "commit".'
    }
    if (cloudManaged) {
      return CLOUD_CLI_HINTS[deviceProvider]
        || `This device is cloud-managed and refuses local configuration changes. Apply changes through ${cloudName}.`
    }
    return 'Paste over SSH in configuration mode ("configure terminal"). Pasting merges into the running config; it does not remove lines that are absent from this text.'
  }
  if (artifact.format === 'aoscx-json') {
    return 'The switch\'s REST configuration database. Not for pasting into the CLI; it is the format the AOS-CX REST API restores from.'
  }
  if (artifact.format === 'mist-config-json') {
    return 'The Mist configuration object for this device (intent, not a running-config). Applied through Mist, not the device CLI.'
  }
  return null
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
// { id, title, createdAt, artifacts, isScope, device }
const viewTarget = ref(null)
const viewKind = ref(null)
const viewContent = ref('')
const loadingContent = ref(false)

const viewArtifact = computed(() =>
  viewTarget.value?.artifacts.find(a => a.kind === viewKind.value) || viewTarget.value?.artifacts[0] || null
)
const viewHint = computed(() =>
  viewTarget.value ? applyHint(viewArtifact.value, viewTarget.value.device, viewTarget.value.isScope, viewTarget.value.provider) : null
)

async function viewBackup(item) {
  try { await devicesStore.ensureAllDevices() } catch { /* hint falls back to the generic one */ }
  const artifacts = artifactsOf(item)
  viewTarget.value = {
    id: item.id,
    title: item.deviceName,
    createdAt: item.createdAt,
    artifacts,
    isScope: false,
    device: devicesStore.devices.find(d => d.id === item.deviceId) || null
  }
  viewKind.value = artifacts[0]?.kind || null
  showViewDialog.value = true
  await loadViewContent()
}

function viewScopeBackup(item) {
  viewTarget.value = {
    id: item.id,
    title: `${scopeTypeLabel(item.scopeType)} ${item.scopeName}`,
    createdAt: item.createdAt,
    artifacts: [{ kind: 'structured', format: item.format }],
    isScope: true,
    provider: item.provider,
    device: null
  }
  viewKind.value = 'structured'
  showViewDialog.value = true
  loadViewContent()
}

async function loadViewContent() {
  const target = viewTarget.value
  if (!target) return
  viewContent.value = ''
  loadingContent.value = true
  try {
    const data = target.isScope
      ? await backupsStore.fetchScopeBackupContent(target.id)
      : await backupsStore.fetchBackupContent(target.id, viewKind.value)
    viewContent.value = data.content
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to load configuration', 'error')
    showViewDialog.value = false
  } finally {
    loadingContent.value = false
  }
}

async function copyContent() {
  try {
    await navigator.clipboard.writeText(viewContent.value)
    notify('Configuration copied to the clipboard')
  } catch {
    notify('Copy failed: the browser blocked clipboard access', 'error')
  }
}

function downloadViewed() {
  const target = viewTarget.value
  if (!target) return
  if (target.isScope) downloadScope({ id: target.id })
  else download({ id: target.id }, viewKind.value)
}

async function download(item, kind) {
  try {
    await backupsStore.downloadBackup(item.id, kind)
  } catch (error) {
    notify(error.userMessage || error.message || 'Download failed', 'error')
  }
}

async function downloadScope(item) {
  try {
    await backupsStore.downloadScopeBackup(item.id)
  } catch (error) {
    notify(error.userMessage || error.message || 'Download failed', 'error')
  }
}

// Compare / diff (device backups, or cloud-scope backups)
const showCompareDialog = ref(false)
const compareMode = ref('device')
const compareRows = ref([])
const loadingCompareRows = ref(false)
const compareFromId = ref(null)
const compareToId = ref(null)
const compareKind = ref(null)
const diffResult = ref(null)
const loadingDiff = ref(false)

// Candidates are the device's (or scope's) whole history, loaded when the
// dialog opens: the table holds only one page of every device's backups.
const compareCandidates = computed(() =>
  compareRows.value.map(b => ({ title: formatDate(b.createdAt), value: b.id }))
)

function openCompareDialog(item) {
  compareMode.value = 'device'
  startCompare(item, () => backupsStore.fetchDeviceBackupHistory(item.deviceId))
}

function openScopeCompareDialog(item) {
  compareMode.value = 'scope'
  startCompare(item, () => backupsStore.fetchScopeBackupHistory(item))
}

let compareLoad = 0

async function startCompare(item, loadHistory) {
  compareRows.value = [item]
  compareToId.value = item.id
  compareFromId.value = null
  compareKind.value = null
  diffResult.value = null
  showCompareDialog.value = true

  const load = ++compareLoad
  loadingCompareRows.value = true
  try {
    const rows = await loadHistory()
    if (load !== compareLoad) return // another Compare was opened meanwhile
    compareRows.value = rows.some(b => b.id === item.id) ? rows : [item, ...rows]
  } catch (error) {
    if (load === compareLoad) notify(error.userMessage || error.message || 'Failed to load backup history', 'error')
  } finally {
    if (load === compareLoad) loadingCompareRows.value = false
  }
}

async function loadDiff() {
  if (!compareFromId.value || !compareToId.value || compareFromId.value === compareToId.value) {
    diffResult.value = null
    return
  }
  loadingDiff.value = true
  try {
    diffResult.value = compareMode.value === 'scope'
      ? await backupsStore.diffScopeBackups(compareFromId.value, compareToId.value)
      : await backupsStore.diffBackups(compareFromId.value, compareToId.value, compareKind.value || undefined)
    if (diffResult.value.kind) compareKind.value = diffResult.value.kind
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to compute diff', 'error')
  } finally {
    loadingDiff.value = false
  }
}

// Cloud scopes
const scopePage = ref(1)
const scopeItemsPerPage = ref(25)
const scopeProvider = ref(null)
const scopeProviderOptions = [
  { title: 'All clouds', value: null },
  ...Object.entries(CloudProviderInfo).map(([value, info]) => ({ title: info.label, value }))
]

function onScopeProviderChange() {
  scopePage.value = 1
  reloadScopeBackups()
}

async function reloadScopeBackups() {
  try {
    await backupsStore.fetchScopeBackups({
      limit: scopeItemsPerPage.value,
      offset: (scopePage.value - 1) * scopeItemsPerPage.value,
      ...(scopeProvider.value && { provider: scopeProvider.value })
    })
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to load cloud scope backups', 'error')
  }
}

function onScopeTableOptions(options) {
  scopePage.value = options.page
  scopeItemsPerPage.value = options.itemsPerPage
  reloadScopeBackups()
}

async function runScopeBackup() {
  try {
    await backupsStore.runScopeBackup()
    notify('Cloud scope backup queued')
    setTimeout(reloadScopeBackups, 1500)
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to queue cloud scope backup', 'error')
  }
}

function confirmDeleteScopeBackup(item) {
  deleteMessage.value = `Delete the backup of ${scopeTypeLabel(item.scopeType).toLowerCase()} "${item.scopeName}" from ${formatDate(item.createdAt)}?`
  deleteAction.value = () => backupsStore.deleteScopeBackup(item.id)
  showDeleteDialog.value = true
}

// Run backup now
const showRunDialog = ref(false)
const deviceSearch = ref('')
const selectedDeviceIds = ref([])

const filteredDevices = computed(() => devicesStore.devices)
const deviceSelectItems = computed(() =>
  devicesStore.devices.map(d => ({ title: d.serial ? `${d.name} (${d.serial})` : d.name, value: d.id }))
)

async function openRunDialog() {
  selectedDeviceIds.value = []
  deviceSearch.value = ''
  try {
    await devicesStore.ensureAllDevices()
  } catch (error) {
    notify(error.userMessage || error.message || 'Failed to load devices', 'error')
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
  retentionMaxCount: 30,
  includeScopes: false
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
      retentionMaxCount: item.retentionMaxCount,
      includeScopes: item.includeScopes === true
    }
  } else {
    scheduleForm.value = emptyScheduleForm()
  }
  try { await devicesStore.ensureAllDevices() } catch { /* non-fatal */ }
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
.scope-provider-filter {
  max-width: 200px;
}

.config-content {
  font-family: 'Roboto Mono', 'Courier New', monospace;
  font-size: 0.8125rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 65vh;
  overflow-y: auto;
}

.backup-error {
  max-width: 280px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Phones have no hover for the title tooltip: show the whole text. */
@media (max-width: 599.98px) {
  .backup-error {
    max-width: none;
    white-space: normal;
  }
}
</style>
