<template>
  <div>
    <v-container fluid class="pa-4">
      <!-- Header -->
      <div class="d-flex align-center flex-wrap mb-4 ga-2">
        <div>
          <h1 class="text-h4 font-weight-bold">Alerts</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Conditions raised by the built-in rules. They resolve on their own when the condition clears.
          </p>
        </div>
        <v-spacer />
        <v-chip
          v-for="sev in ALERT_SEVERITIES"
          :key="sev.value"
          :color="sev.color"
          size="small"
          variant="tonal"
          :prepend-icon="sev.icon"
          :title="`${alertsStore.summary.bySeverity[sev.value] || 0} unresolved ${sev.title.toLowerCase()}`"
        >
          {{ alertsStore.summary.bySeverity[sev.value] || 0 }}
        </v-chip>
        <v-btn
          variant="text"
          prepend-icon="mdi-tune-variant"
          :to="{ path: '/settings', query: { tab: 'alerts' } }"
        >
          Rules
        </v-btn>
      </div>

      <v-tabs v-model="statusTab" color="primary" class="mb-4" @update:model-value="reload(1)">
        <v-tab value="active">
          Unresolved
          <v-chip v-if="alertsStore.unresolvedCount" size="x-small" class="ml-2" variant="tonal">
            {{ alertsStore.unresolvedCount }}
          </v-chip>
        </v-tab>
        <v-tab value="open">Open</v-tab>
        <v-tab value="acknowledged">Acknowledged</v-tab>
        <v-tab value="resolved">Resolved</v-tab>
        <v-tab value="all">All</v-tab>
      </v-tabs>

      <v-card>
        <v-card-title class="d-flex align-center flex-wrap ga-2">
          <v-chip-group
            v-model="severityFilter"
            multiple
            column
            @update:model-value="reload(1)"
          >
            <v-chip
              v-for="sev in ALERT_SEVERITIES"
              :key="sev.value"
              :value="sev.value"
              :color="sev.color"
              filter
              variant="outlined"
              size="small"
            >
              {{ sev.title }}
            </v-chip>
          </v-chip-group>
          <v-chip
            v-if="deviceFilter"
            closable
            size="small"
            prepend-icon="mdi-router-network"
            @click:close="clearDeviceFilter"
          >
            {{ deviceFilterName }}
          </v-chip>
          <v-spacer />
          <v-select
            v-model="ruleFilter"
            :items="ruleItems"
            label="Rule"
            density="compact"
            hide-details
            clearable
            style="max-width: 220px"
            @update:model-value="reload(1)"
          />
          <v-text-field
            v-model="search"
            label="Search"
            prepend-inner-icon="mdi-magnify"
            density="compact"
            hide-details
            clearable
            style="max-width: 240px"
            @update:model-value="onSearch"
          />
        </v-card-title>

        <div v-if="canEdit && selected.length" class="d-flex align-center ga-2 px-4 pb-2">
          <span class="text-body-2">{{ selected.length }} selected</span>
          <v-btn
            size="small"
            variant="tonal"
            color="warning"
            prepend-icon="mdi-check"
            :loading="acting === 'acknowledge'"
            @click="act('acknowledge', selected)"
          >
            Acknowledge
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            color="success"
            prepend-icon="mdi-check-all"
            :loading="acting === 'resolve'"
            @click="act('resolve', selected)"
          >
            Resolve
          </v-btn>
          <v-btn size="small" variant="text" @click="selected = []">Clear</v-btn>
        </div>

        <v-data-table-server
          v-model="selected"
          v-model:page="page"
          v-model:items-per-page="itemsPerPage"
          :headers="headers"
          :items="alertsStore.items"
          :items-length="alertsStore.total"
          :loading="alertsStore.loading"
          :show-select="canEdit"
          :item-selectable="(item) => item.status !== 'resolved'"
          item-value="id"
          @update:options="onTableOptions"
        >
          <template #[`item.severity`]="{ item }">
            <v-icon :color="severityMeta(item.severity).color" :title="severityMeta(item.severity).title">
              {{ severityMeta(item.severity).icon }}
            </v-icon>
          </template>

          <template #[`item.title`]="{ item }">
            <div class="font-weight-medium">{{ item.title }}</div>
            <div class="text-caption text-medium-emphasis alert-message" :title="item.message">{{ item.message }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ ruleLabel(item.rule) }}
              <router-link
                v-if="item.rule === 'automation.raised' && item.data?.automationId"
                :to="`/automations/builder/${item.data.automationId}`"
                class="subject-link"
              >
                · {{ item.data.automationName || 'automation' }}
              </router-link>
            </div>
          </template>

          <template #[`item.subject`]="{ item }">
            <router-link
              v-if="alertLink(item)"
              :to="alertLink(item)"
              class="subject-link"
            >
              {{ subjectLabel(item) }}
            </router-link>
            <span v-else>{{ subjectLabel(item) }}</span>
            <div v-if="item.port" class="text-caption text-medium-emphasis">Port {{ item.port }}</div>
          </template>

          <template #[`item.lastSeenAt`]="{ item }">
            <div :title="formatDate(item.lastSeenAt)">{{ timeAgo(item.lastSeenAt) }}</div>
            <div class="text-caption text-medium-emphasis" :title="formatDate(item.firstSeenAt)">
              since {{ timeAgo(item.firstSeenAt) }}
              <span v-if="item.occurrences > 1"> · ×{{ item.occurrences }}</span>
            </div>
          </template>

          <template #[`item.status`]="{ item }">
            <v-chip :color="statusMeta(item.status).color" size="small" variant="tonal">
              {{ statusMeta(item.status).title }}
            </v-chip>
            <div v-if="item.status === 'acknowledged' && acknowledgedByLabel(item)" class="text-caption text-medium-emphasis">
              by {{ acknowledgedByLabel(item) }}
            </div>
            <div v-if="item.status === 'resolved'" class="text-caption text-medium-emphasis" :title="formatDate(item.resolvedAt)">
              {{ resolvedLabel(item) }}
            </div>
          </template>

          <template #[`item.actions`]="{ item }">
            <template v-if="canEdit && item.status !== 'resolved'">
              <v-btn
                v-if="item.status === 'open'"
                icon="mdi-check"
                size="small"
                variant="text"
                title="Acknowledge"
                @click="act('acknowledge', [item.id])"
              />
              <v-btn
                icon="mdi-check-all"
                size="small"
                variant="text"
                title="Resolve now"
                @click="act('resolve', [item.id])"
              />
            </template>
          </template>

          <template #no-data>
            <div class="py-8 text-center text-medium-emphasis">
              <v-icon size="40" class="mb-2">mdi-bell-check-outline</v-icon>
              <div>{{ emptyMessage }}</div>
            </div>
          </template>
        </v-data-table-server>
      </v-card>
    </v-container>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAlertsStore } from '@/stores/alerts'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import {
  ALERT_SEVERITIES,
  ALERT_RULE_LABELS,
  severityMeta,
  statusMeta,
  alertLink
} from '@/models/alerts'

const route = useRoute()
const router = useRouter()
const alertsStore = useAlertsStore()
const authStore = useAuthStore()
const notifications = useNotificationsStore()

const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))

const statusTab = ref(['active', 'open', 'acknowledged', 'resolved', 'all'].includes(route.query.status) ? route.query.status : 'active')
const severityFilter = ref([])
const ruleFilter = ref(route.query.rule || null)
// From the device page's alerts banner (?deviceId=)
const deviceFilter = ref(route.query.deviceId || null)
const deviceFilterName = computed(() =>
  alertsStore.items.find((a) => a.device?.id === deviceFilter.value)?.device?.name || 'One device')
const search = ref('')
const page = ref(1)
const itemsPerPage = ref(25)
const selected = ref([])
const acting = ref(null)

const headers = [
  { title: '', key: 'severity', sortable: false, width: 48 },
  { title: 'Alert', key: 'title', sortable: false },
  { title: 'Subject', key: 'subject', sortable: false },
  { title: 'Last seen', key: 'lastSeenAt', sortable: false },
  { title: 'Status', key: 'status', sortable: false },
  { title: '', key: 'actions', sortable: false, align: 'end', width: 96 }
]

const ruleItems = Object.entries(ALERT_RULE_LABELS).map(([value, title]) => ({ value, title }))

const emptyMessage = computed(() => {
  if (statusTab.value === 'active' || statusTab.value === 'open') return 'No unresolved alerts. All clear.'
  return 'No alerts match these filters.'
})

async function reload(toPage = page.value) {
  page.value = toPage
  selected.value = []
  try {
    await alertsStore.fetch({
      status: statusTab.value,
      severity: severityFilter.value,
      rule: ruleFilter.value,
      deviceId: deviceFilter.value,
      q: search.value?.trim() || null,
      page: page.value,
      limit: itemsPerPage.value
    })
  } catch (error) {
    notifications.showError(error.userMessage || error.message || 'Failed to load alerts')
  }
}

function clearDeviceFilter() {
  deviceFilter.value = null
  router.replace({ query: { ...route.query, deviceId: undefined } })
  reload(1)
}

function onTableOptions(options) {
  page.value = options.page
  itemsPerPage.value = options.itemsPerPage
  reload()
}

let searchTimer = null
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => reload(1), 300)
}

async function act(action, ids) {
  acting.value = action
  try {
    await alertsStore[action](ids)
    selected.value = selected.value.filter((id) => !ids.includes(id))
    notifications.showSuccess(`${ids.length} alert${ids.length === 1 ? '' : 's'} ${action === 'acknowledge' ? 'acknowledged' : 'resolved'}`)
  } catch (error) {
    notifications.showError(error.userMessage || error.message || `Failed to ${action} alerts`)
  } finally {
    acting.value = null
  }
}

// A new alert (or rows removed in bulk) may change the current page.
watch(() => alertsStore.staleAt, () => {
  if (!alertsStore.loading) reload()
})

function ruleLabel(rule) {
  return ALERT_RULE_LABELS[rule] || rule
}

function subjectLabel(alert) {
  if (alert.device) return alert.device.name
  if (alert.rule === 'sync.failed') return 'Cloud integration'
  if (alert.rule === 'backup.failed') return 'Cloud scope'
  return '—'
}

function acknowledgedByLabel(alert) {
  if (alert.acknowledgedBy) return alert.acknowledgedBy.name
  if (alert.acknowledgedByAutomation) return `automation ${alert.acknowledgedByAutomation.name}`
  return null
}

function resolvedLabel(alert) {
  const when = timeAgo(alert.resolvedAt)
  if (alert.resolvedBy === 'user') return `by hand, ${when}`
  if (alert.resolvedBy === 'merge') return `device merged, ${when}`
  return `cleared ${when}`
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
.alert-message {
  max-width: 520px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subject-link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.subject-link:hover {
  text-decoration: underline;
}
</style>
