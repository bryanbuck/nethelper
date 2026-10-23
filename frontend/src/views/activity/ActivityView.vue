<template>
  <div>
    <v-container fluid class="pa-4">
      <div class="d-flex align-center flex-wrap mb-4 ga-2">
        <div>
          <h1 class="text-h4 font-weight-bold">Activity</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            What happened to your devices lately, newest first. Repeated changes are folded together.
          </p>
        </div>
        <v-spacer />
        <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
      </div>

      <v-card>
        <v-card-title class="d-flex align-center flex-wrap ga-2">
          <v-chip-group v-model="categories" multiple column mandatory>
            <v-chip
              v-for="cat in ACTIVITY_CATEGORIES"
              :key="cat.value"
              :value="cat.value"
              :prepend-icon="cat.icon"
              :title="cat.hint"
              filter
              variant="outlined"
              size="small"
            >
              {{ cat.title }}
            </v-chip>
          </v-chip-group>
          <v-spacer />
          <v-select
            v-model="vendor"
            :items="vendorOptions"
            label="Vendor"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="filter-field"
          />
          <v-autocomplete
            v-model="deviceId"
            :items="deviceOptions"
            :loading="devicesLoading"
            label="Device"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="filter-field"
            @focus="loadDevices"
          />
        </v-card-title>
        <v-divider />

        <v-alert v-if="error" type="error" variant="tonal" class="ma-4">{{ error }}</v-alert>

        <div v-if="loading && !items.length" class="text-center pa-8">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <div v-else-if="!items.length && !error" class="text-center pa-8">
          <v-icon size="48" class="mb-2 text-medium-emphasis">mdi-timeline-clock-outline</v-icon>
          <div class="text-body-2 text-medium-emphasis">
            Nothing has happened that these filters show.
          </div>
        </div>

        <v-list v-else lines="two" class="py-0">
          <template v-for="group in groups" :key="group.label">
            <v-list-subheader class="day-heading">{{ group.label }}</v-list-subheader>
            <template v-for="(item, index) in group.items" :key="item.id">
              <ActivityItem :item="item" />
              <v-divider v-if="index < group.items.length - 1" inset />
            </template>
          </template>
        </v-list>

        <v-card-actions v-if="nextBefore" class="justify-center">
          <v-btn variant="text" :loading="loadingMore" prepend-icon="mdi-chevron-down" @click="loadMore">
            Load older
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-container>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useActivityFeed } from '@/composables/useActivityFeed'
import { ACTIVITY_CATEGORIES, DEFAULT_ACTIVITY_CATEGORIES, dayLabel } from '@/models/activity'
import { vendorOptions } from '@/models/vendors'
import ActivityItem from '@/components/activity/ActivityItem.vue'

const route = useRoute()
const router = useRouter()
const devicesStore = useDevicesStore()

const KNOWN = ACTIVITY_CATEGORIES.map((c) => c.value)
const fromQuery = String(route.query.categories || '').split(',').filter((c) => KNOWN.includes(c))
const categories = ref(fromQuery.length ? fromQuery : [...DEFAULT_ACTIVITY_CATEGORIES])
const deviceId = ref(route.query.deviceId || null)
const vendor = ref(route.query.vendor || null)

const { items, nextBefore, loading, loadingMore, error, load, loadMore } = useActivityFeed({ categories, deviceId, vendor })

// Filters live in the URL, so a filtered feed can be linked and survives a reload.
watch([categories, deviceId, vendor], () => {
  const isDefault = categories.value.length === DEFAULT_ACTIVITY_CATEGORIES.length &&
    DEFAULT_ACTIVITY_CATEGORIES.every((c) => categories.value.includes(c))
  router.replace({
    query: {
      ...route.query,
      categories: isDefault ? undefined : categories.value.join(','),
      deviceId: deviceId.value || undefined,
      vendor: vendor.value || undefined,
    },
  })
}, { deep: true })

const groups = computed(() => {
  const out = []
  for (const item of items.value) {
    const label = dayLabel(item.at)
    if (out.at(-1)?.label !== label) out.push({ label, items: [] })
    out.at(-1).items.push(item)
  }
  return out
})

const devicesLoading = ref(false)
async function loadDevices() {
  if (devicesStore.devicesComplete || devicesLoading.value) return
  devicesLoading.value = true
  try { await devicesStore.ensureAllDevices() } catch { /* the store records the error */ }
  devicesLoading.value = false
}
const deviceOptions = computed(() => {
  const options = devicesStore.devices
    .map((d) => ({ title: d.name, value: d.id }))
    .sort((a, b) => a.title.localeCompare(b.title))
  // A device picked from a link shows its name before the list loads.
  const picked = items.value.find((i) => i.device?.id === deviceId.value)?.device
  if (deviceId.value && picked && !options.some((o) => o.value === deviceId.value)) {
    options.unshift({ title: picked.name, value: picked.id })
  }
  return options
})
if (deviceId.value) loadDevices()
</script>

<style scoped>
.filter-field {
  min-width: 180px;
  max-width: 240px;
}

.day-heading {
  background: rgb(var(--v-theme-surface));
  font-weight: 600;
}
</style>
