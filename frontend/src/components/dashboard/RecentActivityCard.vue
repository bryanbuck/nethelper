<template>
  <v-card elevation="2" class="recent-activity-card">
    <v-card-title class="d-flex flex-wrap align-center justify-space-between ga-2">
      <div class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-timeline-clock-outline</v-icon>
        Recent Activity
      </div>
      <v-btn variant="text" size="small" to="/activity">
        View All
        <v-icon end size="small">mdi-arrow-right</v-icon>
      </v-btn>
    </v-card-title>
    <v-divider />
    <v-card-text class="pa-0">
      <div v-if="loading && !items.length" class="text-center pa-4">
        <v-progress-circular indeterminate color="primary" />
      </div>
      <div v-else-if="error" class="text-center pa-4 text-body-2 text-error">{{ error }}</div>
      <div v-else-if="!items.length" class="text-center pa-4">
        <v-icon size="48" class="mb-2 text-medium-emphasis">mdi-timeline-clock-outline</v-icon>
        <div class="text-body-2 text-medium-emphasis">No device activity yet</div>
      </div>
      <v-list v-else lines="two" class="py-0">
        <template v-for="(item, index) in items" :key="item.id">
          <ActivityItem :item="item" dense show-relative :now="now" />
          <v-divider v-if="index < items.length - 1" inset />
        </template>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useActivityFeed } from '@/composables/useActivityFeed'
import { DEFAULT_ACTIVITY_CATEGORIES } from '@/models/activity'
import ActivityItem from '@/components/activity/ActivityItem.vue'

const props = defineProps({
  maxItems: { type: Number, default: 8 },
})

const { items, loading, error } = useActivityFeed({
  categories: ref([...DEFAULT_ACTIVITY_CATEGORIES]),
  limit: props.maxItems,
})

// Relative times tick while the card is mounted.
const now = ref(Date.now())
let ticker = null
onMounted(() => { ticker = setInterval(() => { now.value = Date.now() }, 30000) })
onBeforeUnmount(() => clearInterval(ticker))
</script>

<style scoped>
.recent-activity-card {
  height: 100%;
}
</style>
