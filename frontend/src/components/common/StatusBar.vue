<template>
  <v-footer app height="32" class="status-bar pa-0">
    <v-menu
      v-model="historyOpen"
      location="top start"
      offset="4"
      :close-on-content-click="false"
    >
      <template #activator="{ props: menuProps }">
        <button
          type="button"
          class="status-message"
          :class="{ 'status-message--active': current }"
          :style="current ? { '--status-tint': `var(--v-theme-${current.type})` } : null"
          :title="current ? lineText(current) : 'Show activity history'"
          aria-label="Activity history"
          v-bind="menuProps"
        >
          <v-badge
            :model-value="store.unseenCount > 0"
            :content="store.unseenCount > 99 ? '99+' : store.unseenCount"
            :color="store.unseenProblemCount ? 'error' : 'primary'"
            offset-x="-2"
            offset-y="2"
          >
            <v-icon size="18" class="status-message__history">mdi-history</v-icon>
          </v-badge>

          <template v-if="current">
            <span
              :key="current.id"
              class="status-message__body"
              :class="{ 'status-message__body--pulse': isProblem(current) }"
            >
              <v-icon :color="current.type" size="16">{{ typeIcon(current.type) }}</v-icon>
              <span class="status-message__text">{{ lineText(current) }}</span>
            </span>
            <span class="status-message__time">{{ relativeTime(current.createdAt) }}</span>
          </template>
          <span v-else class="status-message__text status-message__idle">
            No new activity<template v-if="latest"> · last {{ relativeTime(latest.createdAt) }}</template>
          </span>
        </button>
      </template>

      <v-card class="status-history" elevation="8">
        <div class="status-history__header">
          <span class="text-subtitle-2">Activity</span>
          <span class="text-caption text-medium-emphasis">{{ store.entries.length }} this session</span>
          <v-spacer />
          <v-btn-toggle v-model="filter" mandatory density="compact" variant="outlined" divided>
            <v-btn value="all" size="x-small">All</v-btn>
            <v-btn value="problems" size="x-small">Problems</v-btn>
          </v-btn-toggle>
          <v-btn
            size="x-small"
            variant="text"
            :disabled="!store.entries.length"
            @click="store.clearHistory()"
          >
            Clear
          </v-btn>
        </div>
        <v-divider />

        <div v-if="!shownEntries.length" class="status-history__empty text-body-2 text-medium-emphasis">
          {{ filter === 'problems' ? 'No warnings or errors this session.' : 'Nothing has happened yet this session.' }}
        </div>
        <div v-else class="status-history__list">
          <div
            v-for="entry in shownEntries"
            :key="entry.id"
            class="status-history__row"
          >
            <v-icon :color="entry.type" size="18" class="mt-1">{{ typeIcon(entry.type) }}</v-icon>
            <div class="status-history__content">
              <div class="d-flex align-center ga-2">
                <span v-if="entry.title" class="text-body-2 font-weight-medium">{{ entry.title }}</span>
                <span v-if="newSinceOpen.has(entry.id)" class="status-history__new" title="New" />
                <v-spacer />
                <span class="text-caption text-medium-emphasis text-no-wrap" :title="fullTime(entry.createdAt)">
                  {{ clockTime(entry.createdAt) }}
                </span>
              </div>
              <div v-if="entry.message" class="text-body-2 text-medium-emphasis">{{ entry.message }}</div>
              <div v-if="entry.actions?.length" class="mt-1">
                <v-btn
                  v-for="item in entry.actions"
                  :key="item.label"
                  size="x-small"
                  variant="tonal"
                  class="mr-1"
                  @click="runAction(item)"
                >
                  {{ item.label }}
                </v-btn>
              </div>
            </div>
          </div>
        </div>
      </v-card>
    </v-menu>

    <template v-if="current">
      <v-btn
        v-for="item in current.actions"
        :key="item.label"
        size="x-small"
        variant="text"
        class="ml-1"
        @click="runAction(item)"
      >
        {{ item.label }}
      </v-btn>
      <v-btn
        v-if="current.pinned"
        icon="mdi-close"
        size="x-small"
        variant="text"
        title="Dismiss"
        @click="store.dismissCurrent()"
      />
    </template>

    <!-- Admins open System Status from here; everyone else sees the connection state. -->
    <component
      :is="authStore.isAdmin ? 'button' : 'div'"
      class="status-meta d-none d-sm-flex"
      :class="{ 'status-meta--link': authStore.isAdmin }"
      :type="authStore.isAdmin ? 'button' : undefined"
      :title="authStore.isAdmin ? `System status · ${connectionLabel}` : connectionLabel"
      :aria-label="authStore.isAdmin ? 'System status' : undefined"
      @click="authStore.isAdmin && router.push('/system')"
    >
      <span
        class="status-meta__dot"
        :class="`status-meta__dot--${store.connection}`"
      />
      <span>NetHelper {{ version }} · Beta</span>
      <v-icon v-if="authStore.isAdmin" size="14" class="status-meta__icon">mdi-monitor-dashboard</v-icon>
    </component>
  </v-footer>

  <!-- Critical alerts only: everything else stays in the bar. -->
  <v-snackbar
    :model-value="Boolean(store.popup)"
    location="bottom end"
    color="error"
    :timeout="-1"
    multi-line
    @update:model-value="(open) => !open && store.dismissPopup()"
  >
    <div v-if="store.popup" class="d-flex align-start ga-2">
      <v-icon>{{ typeIcon(store.popup.type) }}</v-icon>
      <div>
        <div class="font-weight-bold">{{ store.popup.title }}</div>
        <div>{{ store.popup.message }}</div>
      </div>
    </div>
    <template #actions>
      <v-btn
        v-for="item in store.popup?.actions || []"
        :key="item.label"
        variant="text"
        color="on-error"
        @click="runAction(item)"
      >
        {{ item.label }}
      </v-btn>
      <v-btn icon="mdi-close" variant="text" color="on-error" title="Close" @click="store.dismissPopup()" />
    </template>
  </v-snackbar>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationsStore } from '@/stores/notifications'
import { useAuthStore } from '@/stores/auth'

defineProps({
  version: { type: String, default: '' }
})

const store = useNotificationsStore()
const authStore = useAuthStore()
const router = useRouter()

const historyOpen = ref(false)
const filter = ref('all')
// Entries that were unseen when the history opened keep their "new" dot while it stays open.
const newSinceOpen = ref(new Set())

const current = computed(() => store.current)
const latest = computed(() => store.entries[0] || null)
const isProblem = (entry) => entry.type === 'warning' || entry.type === 'error'
const shownEntries = computed(() =>
  filter.value === 'problems' ? store.entries.filter(isProblem) : store.entries
)

watch(historyOpen, (open) => {
  if (!open) return
  newSinceOpen.value = new Set(store.entries.filter((e) => !e.seen).map((e) => e.id))
  store.markAllSeen()
})

const TYPE_ICONS = {
  success: 'mdi-check-circle',
  error: 'mdi-alert-circle',
  warning: 'mdi-alert',
  info: 'mdi-information'
}
const typeIcon = (type) => TYPE_ICONS[type] || TYPE_ICONS.info

const lineText = (entry) => [entry.title, entry.message].filter(Boolean).join(' — ')

const CONNECTION_LABELS = {
  idle: 'Real-time updates: not connected',
  connected: 'Real-time updates: connected',
  reconnecting: 'Real-time updates: reconnecting',
  failed: 'Real-time updates: connection failed'
}
const connectionLabel = computed(() => CONNECTION_LABELS[store.connection] || CONNECTION_LABELS.idle)

// Relative times tick while the bar is mounted.
const now = ref(Date.now())
let ticker = null
onMounted(() => { ticker = setInterval(() => { now.value = Date.now() }, 15000) })
onBeforeUnmount(() => clearInterval(ticker))

function relativeTime(iso) {
  const seconds = Math.max(0, Math.round((now.value - new Date(iso).getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString()
}

const clockTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const fullTime = (iso) => new Date(iso).toLocaleString()

function runAction(item) {
  historyOpen.value = false
  store.dismissPopup()
  if (item.to) router.push(item.to)
  else item.action?.()
}
</script>

<style scoped>
.status-bar {
  border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
  font-size: 0.8125rem;
  gap: 4px;
  padding-inline: 4px 12px !important;
  flex-wrap: nowrap;
}

.status-message {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border-radius: 4px;
  color: inherit;
  text-align: left;
  transition: background-color 0.2s;
}
.status-message:hover {
  background: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}
.status-message:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary-text));
}
.status-message--active {
  background: rgba(var(--status-tint), 0.12);
}
.status-message--active:hover {
  background: rgba(var(--status-tint), 0.2);
}

.status-message__history {
  opacity: var(--v-medium-emphasis-opacity);
}

.status-message__body {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.status-message__body--pulse {
  animation: status-pulse 0.6s ease-in-out 3;
}
@keyframes status-pulse {
  50% { opacity: 0.35; }
}

.status-message__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.status-message__idle,
.status-message__time {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.status-message__time {
  flex-shrink: 0;
  font-size: 0.75rem;
}

.status-meta {
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 12px;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  white-space: nowrap;
}
.status-meta--link {
  height: 26px;
  padding: 0 8px;
  margin-left: 4px;
  border-radius: 4px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  transition: background-color 0.2s;
}
.status-meta--link:hover {
  background: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
  color: rgb(var(--v-theme-on-surface));
}
.status-meta--link:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary-text));
}
.status-meta__icon {
  opacity: var(--v-medium-emphasis-opacity);
}
.status-meta__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), var(--v-disabled-opacity));
}
.status-meta__dot--connected { background: rgb(var(--v-theme-success)); }
.status-meta__dot--reconnecting { background: rgb(var(--v-theme-warning)); }
.status-meta__dot--failed { background: rgb(var(--v-theme-error)); }

.status-history {
  width: 440px;
  max-width: calc(100vw - 16px);
}
.status-history__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}
.status-history__list {
  max-height: 60vh;
  overflow-y: auto;
}
.status-history__row {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.status-history__row:last-child {
  border-bottom: 0;
}
.status-history__content {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.status-history__new {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
}
.status-history__empty {
  padding: 24px 12px;
  text-align: center;
}
</style>
