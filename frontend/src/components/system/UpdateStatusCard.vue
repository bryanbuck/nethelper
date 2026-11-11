<template>
  <v-card variant="outlined" data-testid="update-card">
    <v-card-text class="d-flex flex-wrap align-center ga-3">
      <v-icon :icon="view.icon" :class="view.iconClass" />
      <div class="update-card__text">
        <div class="text-subtitle-2" data-testid="update-headline">{{ view.headline }}</div>
        <div class="text-caption text-medium-emphasis">
          {{ view.detail }}
          <template v-if="available && status.latest.url">
            ·
            <a :href="status.latest.url" target="_blank" rel="noopener noreferrer" class="text-primary">Release notes</a>
          </template>
        </div>
        <div v-if="lastCheckFailed" class="text-caption text-warning" data-testid="update-error">
          Last check failed: {{ status.error }}
        </div>
      </div>
      <v-spacer />
      <ActionButton
        v-if="status?.enabled"
        icon="mdi-refresh"
        label="Check now"
        variant="text"
        size="small"
        :loading="store.checking"
        @click="store.checkNow()"
      />
    </v-card-text>

    <template v-if="available">
      <v-divider />
      <v-card-text data-testid="update-commands">
        <p class="text-body-2 mb-3">
          Upgrading is one command on the server; NetHelper never updates itself. The command takes an
          application backup first, and NetHelper is down for a minute or two while it restarts.
        </p>
        <div class="update-card__command">
          <span class="text-caption text-medium-emphasis">Docker Compose, from the <code>deploy</code> folder of the NetHelper tree</span>
          <code>./install.sh --upgrade</code>
        </div>
        <div class="update-card__command">
          <span class="text-caption text-medium-emphasis">Bare metal (systemd), as root</span>
          <code>nethelper-admin upgrade</code>
        </div>
        <p class="text-caption text-medium-emphasis mb-0 mt-3">
          Both are for an install from a release tarball. A git checkout upgrades with
          <code>git pull</code>: see
          <a :href="UPGRADE_DOC" target="_blank" rel="noopener noreferrer" class="text-primary">Upgrading</a>.
        </p>
      </v-card-text>
    </template>
  </v-card>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useUpdateCheckStore } from '@/stores/updateCheck'
import { timeAgo } from '@/models/activity'
import ActionButton from '@/components/common/ActionButton.vue'

const UPGRADE_DOC = 'https://github.com/bryanbuck/nethelper/blob/master/deploy/README.md#upgrading'

const store = useUpdateCheckStore()
const status = computed(() => store.status)
const available = computed(() => store.updateAvailable)
// A failed check with an earlier answer still on show.
const lastCheckFailed = computed(() => Boolean(status.value?.enabled && status.value.error && status.value.checkedAt))

const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '')

const view = computed(() => {
  const s = status.value
  const muted = 'text-medium-emphasis'
  if (!s) {
    return store.error
      ? { icon: 'mdi-alert-circle-outline', iconClass: 'text-warning', headline: "Couldn't load the update status", detail: store.error }
      : { icon: 'mdi-update', iconClass: muted, headline: 'Updates', detail: 'Loading…' }
  }
  if (!s.enabled) {
    return {
      icon: 'mdi-update', iconClass: muted, headline: 'Update check is off',
      detail: `This server runs NetHelper ${s.current}. UPDATE_CHECK_ENABLED=false is set on the server.`,
    }
  }
  if (available.value) {
    const released = day(s.latest.publishedAt)
    return {
      icon: 'mdi-arrow-up-circle', iconClass: 'text-primary', headline: `NetHelper ${s.latest.version} is available`,
      detail: `This server runs ${s.current}.${released ? ` Released ${released}.` : ''} Checked ${timeAgo(s.checkedAt)}`,
    }
  }
  if (s.checkedAt) {
    return {
      icon: 'mdi-check-circle-outline', iconClass: 'text-success', headline: `NetHelper ${s.current} is up to date`,
      detail: `Checked ${timeAgo(s.checkedAt)}`,
    }
  }
  if (s.error) {
    return { icon: 'mdi-alert-circle-outline', iconClass: 'text-warning', headline: "Couldn't check for updates", detail: s.error }
  }
  return {
    icon: 'mdi-update', iconClass: muted, headline: 'Not checked for updates yet',
    detail: 'The server checks a minute after it starts, then once a day.',
  }
})

onMounted(() => store.load())
</script>

<style scoped>
.update-card__text {
  min-width: 0;
  flex: 1 1 240px;
}
.update-card__command {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
.update-card__command > code {
  align-self: flex-start;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
  user-select: all;
}
</style>
