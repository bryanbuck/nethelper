<template>
  <v-btn
    icon
    :color="color"
    to="/alerts"
    :title="title"
  >
    <v-badge
      :model-value="alertsStore.badgeCount > 0"
      :content="alertsStore.badgeCount > 99 ? '99+' : alertsStore.badgeCount"
      :color="alertsStore.summary.openBySeverity?.critical ? 'error' : 'warning'"
    >
      <v-icon>{{ alertsStore.badgeCount ? 'mdi-bell-alert' : 'mdi-bell-outline' }}</v-icon>
    </v-badge>
  </v-btn>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useAlertsStore } from '@/stores/alerts'
import { useWebSocket } from '@/composables/useWebSocket'

defineProps({
  // On the primary app bar the global VBtn default color would vanish.
  color: { type: String, default: undefined }
})

const alertsStore = useAlertsStore()

// Holding the socket here keeps it open for the whole signed-in session, so
// new alerts toast and the badge stays current on every page.
useWebSocket()

const title = computed(() => {
  const n = alertsStore.badgeCount
  return n ? `${n} open alert${n === 1 ? '' : 's'} need attention` : 'Alerts'
})

onMounted(() => alertsStore.fetchSummary())
</script>
