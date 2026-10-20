<template>
  <div>
    <v-container fluid class="pa-4">
      <div class="d-flex align-center flex-wrap mb-4 ga-2">
        <div>
          <h1 class="text-h4 font-weight-bold">Run History</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Every automation run: Run now, schedules, and alert triggers. Finished runs are kept for
            90 days by default.
          </p>
        </div>
        <v-spacer />
        <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/automations">Automations</v-btn>
      </div>

      <v-card>
        <v-card-title class="d-flex align-center flex-wrap ga-2">
          <v-select
            v-model="automationFilter"
            :items="automationItems"
            label="Automation"
            density="compact"
            hide-details
            clearable
            style="max-width: 260px"
            @update:model-value="reload(1)"
          />
          <v-select
            v-model="statusFilter"
            :items="EXECUTION_STATUSES"
            item-title="title"
            item-value="value"
            label="Status"
            density="compact"
            hide-details
            clearable
            style="max-width: 180px"
            @update:model-value="reload(1)"
          />
          <v-select
            v-model="triggerFilter"
            :items="EXECUTION_TRIGGERS"
            item-title="title"
            item-value="value"
            label="Started by"
            density="compact"
            hide-details
            clearable
            style="max-width: 180px"
            @update:model-value="reload(1)"
          />
          <v-spacer />
          <v-btn variant="text" icon="mdi-refresh" title="Refresh" :loading="store.loading" @click="reload()" />
        </v-card-title>

        <v-data-table-server
          v-model:page="page"
          v-model:items-per-page="itemsPerPage"
          :headers="headers"
          :items="store.items"
          :items-length="store.total"
          :loading="store.loading"
          :items-per-page-options="[10, 25, 50, 100]"
          item-value="id"
          hover
          @update:options="onTableOptions"
          @click:row="(_, { item }) => openDetail(item)"
        >
          <template #[`item.status`]="{ item }">
            <v-chip
              :color="executionStatusMeta(item.status).color"
              :prepend-icon="executionStatusMeta(item.status).icon"
              size="small"
              variant="tonal"
            >
              {{ executionStatusMeta(item.status).title }}
            </v-chip>
          </template>

          <template #[`item.automation`]="{ item }">
            <router-link
              v-if="item.automation"
              :to="`/automations/builder/${item.automation.id}`"
              class="plain-link"
              @click.stop
            >
              {{ item.automation.name }}
            </router-link>
            <div v-if="item.error" class="text-caption text-error run-error" :title="item.error">{{ item.error }}</div>
          </template>

          <template #[`item.device`]="{ item }">
            <router-link v-if="item.device" :to="`/devices/${item.device.id}`" class="plain-link" @click.stop>
              {{ item.device.name }}
            </router-link>
            <span v-else class="text-medium-emphasis">—</span>
          </template>

          <template #[`item.trigger`]="{ item }">
            <v-icon size="small" class="mr-1">{{ triggerMeta(item.trigger).icon }}</v-icon>
            {{ triggerMeta(item.trigger).title }}
            <div v-if="item.triggeredBy" class="text-caption text-medium-emphasis">by {{ item.triggeredBy.name }}</div>
          </template>

          <template #[`item.createdAt`]="{ item }">
            <span :title="formatDate(item.startedAt || item.createdAt)">{{ timeAgo(item.startedAt || item.createdAt) }}</span>
          </template>

          <template #[`item.duration`]="{ item }">
            {{ formatDuration(item.duration) }}
          </template>

          <template #[`item.actions`]="{ item }">
            <v-btn
              v-if="canEdit && ['pending', 'running'].includes(item.status)"
              icon="mdi-cancel"
              size="small"
              variant="text"
              title="Cancel run"
              :loading="cancelling === item.id"
              @click.stop="cancelRun(item)"
            />
            <v-btn icon="mdi-text-box-search-outline" size="small" variant="text" title="Details" @click.stop="openDetail(item)" />
          </template>

          <template #no-data>
            <div class="py-8 text-center text-medium-emphasis">
              <v-icon size="40" class="mb-2">mdi-history</v-icon>
              <div>No runs match these filters.</div>
            </div>
          </template>
        </v-data-table-server>
      </v-card>
    </v-container>

    <!-- Run detail -->
    <v-dialog v-model="detailOpen" max-width="760" scrollable>
      <v-card v-if="detail">
        <v-card-title class="d-flex align-center ga-2">
          <v-icon :color="executionStatusMeta(detail.status).color">{{ executionStatusMeta(detail.status).icon }}</v-icon>
          {{ detail.automation?.name || 'Automation run' }}
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="detailOpen = false" />
        </v-card-title>
        <v-card-subtitle class="pb-2">
          {{ executionStatusMeta(detail.status).title }}
          · {{ triggerMeta(detail.trigger).title }}
          <span v-if="detail.device"> · {{ detail.device.name }}</span>
          · {{ formatDate(detail.startedAt || detail.createdAt) }}
          · {{ formatDuration(detail.duration) }}
        </v-card-subtitle>
        <v-divider />
        <v-card-text>
          <v-alert v-if="detail.error" type="error" variant="tonal" density="compact" class="mb-4">
            {{ detail.error }}
          </v-alert>
          <div v-if="!steps.length" class="text-medium-emphasis">
            {{ ['pending', 'running'].includes(detail.status) ? 'The run hasn\'t finished yet.' : 'No steps were recorded.' }}
          </div>
          <v-list v-else density="compact" class="py-0">
            <v-list-item v-for="step in steps" :key="step.nodeId" class="px-0">
              <template #prepend>
                <v-icon :color="stepMeta(step.status).color" class="mr-2">{{ stepMeta(step.status).icon }}</v-icon>
              </template>
              <v-list-item-title>
                {{ step.label }}
                <span class="text-caption text-medium-emphasis">· {{ stepMeta(step.status).title }}</span>
              </v-list-item-title>
              <v-list-item-subtitle v-if="step.error" class="text-error step-detail">{{ step.error }}</v-list-item-subtitle>
              <v-list-item-subtitle v-else-if="step.result !== undefined" class="step-detail">
                {{ describeResult(step.result) }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions v-if="canEdit && ['pending', 'running'].includes(detail.status)">
          <v-spacer />
          <v-btn color="warning" variant="tonal" prepend-icon="mdi-cancel" :loading="cancelling === detail.id" @click="cancelRun(detail)">
            Cancel run
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useExecutionsStore } from '@/stores/executions'
import { useAutomationsStore } from '@/stores/automations'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { useWebSocket } from '@/composables/useWebSocket'
import {
  EXECUTION_STATUSES,
  EXECUTION_TRIGGERS,
  STEP_STATUSES,
  executionStatusMeta,
  triggerMeta,
  formatDuration
} from '@/models/executions'

useWebSocket() // live status as runs start and finish

const route = useRoute()
const store = useExecutionsStore()
const automationsStore = useAutomationsStore()
const authStore = useAuthStore()
const notifications = useNotificationsStore()

const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))

const automationFilter = ref(route.query.automationId || null)
const statusFilter = ref(route.query.status || null)
const triggerFilter = ref(route.query.trigger || null)
const page = ref(1)
const itemsPerPage = ref(25)
const cancelling = ref(null)
const detailOpen = ref(false)
const detail = ref(null)

const headers = [
  { title: 'Status', key: 'status', sortable: false, width: 130 },
  { title: 'Automation', key: 'automation', sortable: false },
  { title: 'Device', key: 'device', sortable: false },
  { title: 'Started by', key: 'trigger', sortable: false },
  { title: 'When', key: 'createdAt', sortable: false },
  { title: 'Duration', key: 'duration', sortable: false },
  { title: '', key: 'actions', sortable: false, align: 'end', width: 96 }
]

const automationItems = computed(() =>
  automationsStore.automations.map((a) => ({ title: a.name, value: a.id }))
)

const steps = computed(() => detail.value?.output?.results || [])

async function reload(toPage = page.value) {
  page.value = toPage
  try {
    await store.fetch({
      automationId: automationFilter.value,
      status: statusFilter.value,
      trigger: triggerFilter.value,
      page: page.value,
      limit: itemsPerPage.value
    })
  } catch (error) {
    notifications.showError(error.userMessage || error.message || 'Failed to load run history')
  }
}

function onTableOptions(options) {
  page.value = options.page
  itemsPerPage.value = options.itemsPerPage
  reload()
}

async function openDetail(item) {
  detail.value = item
  detailOpen.value = true
  try {
    detail.value = await store.fetchOne(item.id)
  } catch (error) {
    notifications.showError(error.userMessage || error.message || 'Failed to load the run')
  }
}

async function cancelRun(item) {
  cancelling.value = item.id
  try {
    const row = await store.cancel(item.id)
    if (detail.value?.id === item.id) detail.value = { ...detail.value, ...row }
    notifications.showSuccess(item.status === 'running'
      ? 'Cancelled: the run stops before its next step'
      : 'Run cancelled')
  } catch (error) {
    notifications.showError(error.userMessage || error.message || 'Failed to cancel the run')
  } finally {
    cancelling.value = null
  }
}

// A run started or finished that isn't on this page.
watch(() => store.staleAt, () => {
  if (!store.loading) reload()
})

// Keep an open detail current while its run progresses.
watch(() => store.items.find((r) => r.id === detail.value?.id)?.status, async (status, previous) => {
  if (!detailOpen.value || !status || status === previous) return
  detail.value = await store.fetchOne(detail.value.id).catch(() => detail.value)
})

onMounted(() => {
  if (!automationsStore.automations.length) automationsStore.fetchAutomations().catch(() => {})
})

function stepMeta(status) {
  return STEP_STATUSES[status] || { title: status, color: 'grey', icon: 'mdi-help' }
}

function describeResult(result) {
  if (result === 'true') return 'Condition matched'
  if (result === 'false') return 'Condition did not match'
  if (result && typeof result === 'object') {
    return Object.entries(result).map(([k, v]) => `${k}: ${v}`).join(' · ')
  }
  return String(result)
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function timeAgo(value) {
  if (!value) return '—'
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}
</script>

<style scoped>
.plain-link {
  color: rgb(var(--v-theme-primary-text));
  text-decoration: none;
}

.plain-link:hover {
  text-decoration: underline;
}

.run-error {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-detail {
  white-space: normal;
  -webkit-line-clamp: unset;
  line-clamp: unset;
}
</style>
