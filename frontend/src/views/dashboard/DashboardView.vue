<template>
  <div class="dashboard-view">
    <v-container fluid class="pa-4">
      <div class="d-flex align-center justify-space-between mb-6">
        <div>
          <h1 class="text-h4 font-weight-bold mb-1">Dashboard</h1>
          <p class="text-subtitle-1 text-medium-emphasis mb-0">
            Monitor your network infrastructure and device status
          </p>
        </div>
        
        <div class="d-flex align-center ga-2">
          <v-chip 
            :color="connectionStatus.color" 
            variant="flat" 
            size="small"
            prepend-icon="mdi-circle"
          >
            {{ connectionStatus.text }}
          </v-chip>
          
          <v-btn 
            color="primary" 
            prepend-icon="mdi-sync"
            :loading="devicesStore.loading"
            @click="syncAllDevices"
          >
            Sync Devices
          </v-btn>
        </div>
      </div>

      <v-row>
        <v-col cols="12" sm="6" md="3">
          <StatsCard
            title="Total Devices"
            :value="devicesStore.stats.total"
            icon="mdi-devices"
            color="primary"
            :trend="totalDevicesTrend.direction"
            :trend-value="totalDevicesTrend.value"
            trend-label="from last sync"
            :loading="devicesStore.loading"
            show-actions
            @action-click="$router.push('/devices')"
          />
        </v-col>
        
        <v-col cols="12" sm="6" md="3">
          <StatsCard
            title="Online Devices"
            :value="devicesStore.stats.online"
            icon="mdi-check-circle"
            color="success"
            :trend="onlineDevicesTrend.direction"
            :trend-value="onlineDevicesTrend.value"
            trend-label="from last hour"
            :loading="devicesStore.loading"
            show-actions
            @action-click="viewOnlineDevices"
          />
        </v-col>
        
        <v-col cols="12" sm="6" md="3">
          <StatsCard
            title="Offline Devices"
            :value="devicesStore.stats.offline"
            icon="mdi-alert-circle"
            color="error"
            :trend="offlineDevicesTrend.direction"
            :trend-value="offlineDevicesTrend.value"
            trend-label="from last hour"
            :loading="devicesStore.loading"
            show-actions
            @action-click="viewOfflineDevices"
          />
        </v-col>
        
        <v-col cols="12" sm="6" md="3">
          <StatsCard
            title="Warning Devices"
            :value="devicesStore.stats.warning"
            icon="mdi-alert-triangle"
            color="warning"
            :trend="warningDevicesTrend.direction"
            :trend-value="warningDevicesTrend.value"
            trend-label="from last hour"
            :loading="devicesStore.loading"
            show-actions
            @action-click="viewWarningDevices"
          />
        </v-col>
      </v-row>

      <v-row class="mt-4">
        <v-col cols="12" lg="8">
          <DeviceStatusChart />
        </v-col>
        
        <v-col cols="12" lg="4">
          <RecentDevicesList 
            :max-items="8"
            @view-all="$router.push('/devices')"
          />
        </v-col>
      </v-row>

      <v-row v-if="quickActions.length > 0" class="mt-4">
        <v-col cols="12">
          <v-card elevation="2">
            <v-card-title>
              <v-icon class="mr-2" color="primary">mdi-flash</v-icon>
              Quick Actions
            </v-card-title>
            
            <v-divider></v-divider>
            
            <v-card-text>
              <v-row>
                <v-col 
                  v-for="action in quickActions" 
                  :key="action.id"
                  cols="12" 
                  sm="6" 
                  md="4"
                >
                  <v-card 
                    variant="outlined" 
                    class="quick-action-card" 
                    @click="executeQuickAction(action)"
                  >
                    <v-card-text class="text-center pa-4">
                      <v-avatar 
                        :color="action.color" 
                        size="48" 
                        class="mb-3"
                      >
                        <v-icon :icon="action.icon" color="white"></v-icon>
                      </v-avatar>
                      <div class="text-subtitle-1 font-weight-medium mb-1">
                        {{ action.title }}
                      </div>
                      <div class="text-caption text-medium-emphasis">
                        {{ action.description }}
                      </div>
                    </v-card-text>
                  </v-card>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
    
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="snackbar.timeout"
      location="bottom right"
    >
      {{ snackbar.message }}
      <template #actions>
        <v-btn
          icon="mdi-close"
          variant="text"
          @click="snackbar.show = false"
        >
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useAlertsStore } from '@/stores/alerts'
import { useWebSocket } from '@/composables/useWebSocket'
import StatsCard from '@/components/dashboard/StatsCard.vue'
import DeviceStatusChart from '@/components/dashboard/DeviceStatusChart.vue'
import RecentDevicesList from '@/components/dashboard/RecentDevicesList.vue'

const router = useRouter()
const devicesStore = useDevicesStore()
const { connected, connecting } = useWebSocket()

const snackbar = ref({
  show: false,
  message: '',
  color: 'success',
  timeout: 4000
})

const refreshInterval = ref(null)
const previousStats = ref({ total: 0, online: 0, offline: 0, warning: 0 })

const connectionStatus = computed(() => {
  if (connected.value) {
    return { text: 'Connected', color: 'success' }
  } else if (connecting.value) {
    return { text: 'Connecting...', color: 'warning' }
  } else {
    return { text: 'Disconnected', color: 'error' }
  }
})

const totalDevicesTrend = computed(() => {
  const current = devicesStore.stats.total
  const previous = previousStats.value.total
  const diff = current - previous
  
  if (diff > 0) {
    return { direction: 'up', value: Math.abs(diff) }
  } else if (diff < 0) {
    return { direction: 'down', value: Math.abs(diff) }
  }
  return { direction: 'neutral', value: 0 }
})

const onlineDevicesTrend = computed(() => {
  const current = devicesStore.stats.online
  const previous = previousStats.value.online
  const percentage = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0
  
  if (percentage > 0) {
    return { direction: 'up', value: Math.abs(percentage) }
  } else if (percentage < 0) {
    return { direction: 'down', value: Math.abs(percentage) }
  }
  return { direction: 'neutral', value: 0 }
})

const offlineDevicesTrend = computed(() => {
  const current = devicesStore.stats.offline
  const previous = previousStats.value.offline
  const percentage = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0
  
  if (percentage > 0) {
    return { direction: 'up', value: Math.abs(percentage) }
  } else if (percentage < 0) {
    return { direction: 'down', value: Math.abs(percentage) }
  }
  return { direction: 'neutral', value: 0 }
})

const warningDevicesTrend = computed(() => {
  const current = devicesStore.stats.warning
  const previous = previousStats.value.warning
  const percentage = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0
  
  if (percentage > 0) {
    return { direction: 'up', value: Math.abs(percentage) }
  } else if (percentage < 0) {
    return { direction: 'down', value: Math.abs(percentage) }
  }
  return { direction: 'neutral', value: 0 }
})

const alertsStore = useAlertsStore()

const quickActions = computed(() => [
  {
    id: 'sync-devices',
    title: 'Sync All Devices',
    description: 'Update device information from every cloud integration',
    icon: 'mdi-sync',
    color: 'primary'
  },
  {
    id: 'create-automation',
    title: 'Create Automation',
    description: 'Build a new network automation workflow',
    icon: 'mdi-auto-fix',
    color: 'secondary'
  },
  {
    id: 'view-alerts',
    title: 'View Alerts',
    description: alertsStore.unresolvedCount
      ? `${alertsStore.unresolvedCount} unresolved alert${alertsStore.unresolvedCount === 1 ? '' : 's'}`
      : 'No unresolved alerts',
    icon: alertsStore.badgeCount ? 'mdi-bell-alert' : 'mdi-bell',
    color: 'warning'
  }
])

const syncAllDevices = async () => {
  try {
    await devicesStore.syncDevices()
    showSnackbar('Device sync started', 'success')
    // Results arrive as device:sync:completed (see the watch on lastSyncResult).
  } catch (error) {
    showSnackbar('Failed to sync devices', 'error')
  }
}

const viewOnlineDevices = () => {
  router.push({ path: '/devices', query: { status: 'online' } })
}

const viewOfflineDevices = () => {
  router.push({ path: '/devices', query: { status: 'offline' } })
}

const viewWarningDevices = () => {
  router.push({ path: '/devices', query: { status: 'warning' } })
}

const executeQuickAction = (action) => {
  switch (action.id) {
    case 'sync-devices':
      syncAllDevices()
      break
    case 'create-automation':
      router.push('/automations/new')
      break
    case 'view-alerts':
      router.push('/alerts')
      break
  }
}

const showSnackbar = (message, color = 'success') => {
  snackbar.value = {
    show: true,
    message,
    color,
    timeout: 4000
  }
}

const startAutoRefresh = () => {
  refreshInterval.value = setInterval(async () => {
    if (!devicesStore.loading) {
      previousStats.value = { ...devicesStore.stats }
      await devicesStore.fetchDevices()
    }
  }, 30000)
}

// A cloud sync job finished: show its additions now rather than at the next tick.
watch(() => devicesStore.lastSyncResult, () => {
  devicesStore.fetchDevices().catch(() => {})
})

const stopAutoRefresh = () => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
    refreshInterval.value = null
  }
}

onMounted(async () => {
  try {
    await devicesStore.fetchDevices()
    previousStats.value = { ...devicesStore.stats }
    startAutoRefresh()
  } catch (error) {
    showSnackbar('Failed to load dashboard data', 'error')
  }
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<style scoped>
.dashboard-view {
  background-color: rgb(var(--v-theme-background));
  min-height: 100vh;
}

.quick-action-card {
  cursor: pointer;
  transition: all 0.3s ease;
}

.quick-action-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Style the snackbar action button to be bold and match notification text color */
.snackbar-action-btn {
  font-weight: bold !important;
  opacity: 1 !important;
}
</style>