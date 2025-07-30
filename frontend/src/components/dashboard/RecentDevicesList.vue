<template>
  <v-card elevation="2" class="recent-devices-card">
    <v-card-title class="d-flex align-center justify-space-between">
      <div class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-devices</v-icon>
        Recent Activity
      </div>
      <v-btn 
        variant="text" 
        size="small" 
        color="primary"
        @click="$emit('view-all')"
      >
        View All
        <v-icon end size="small">mdi-arrow-right</v-icon>
      </v-btn>
    </v-card-title>
    
    <v-divider></v-divider>
    
    <v-card-text class="pa-0">
      <div v-if="loading" class="text-center pa-4">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </div>
      
      <div v-else-if="recentDevices.length === 0" class="text-center pa-4">
        <v-icon size="48" color="grey-lighten-1" class="mb-2">
          mdi-server-off
        </v-icon>
        <div class="text-body-2 text-medium-emphasis">
          No recent device activity
        </div>
      </div>
      
      <v-list v-else class="pa-0">
        <template v-for="(device, index) in recentDevices" :key="device.id">
          <v-list-item 
            :to="`/devices/${device.id}`"
            class="device-item"
          >
            <template v-slot:prepend>
              <v-avatar :color="getDeviceTypeColor(device.type)" variant="tonal">
                <v-icon :icon="getDeviceIcon(device.type)"></v-icon>
              </v-avatar>
            </template>
            
            <v-list-item-title class="font-weight-medium">
              {{ device.name }}
            </v-list-item-title>
            
            <v-list-item-subtitle class="text-caption">
              {{ device.location }} " {{ device.ipAddress }}
            </v-list-item-subtitle>
            
            <template v-slot:append>
              <div class="text-right">
                <v-chip 
                  :color="getStatusColor(device.status)" 
                  size="small" 
                  variant="flat"
                  class="mb-1"
                >
                  {{ device.status }}
                </v-chip>
                <div class="text-caption text-medium-emphasis">
                  {{ formatLastSeen(device.lastSeen) }}
                </div>
              </div>
            </template>
          </v-list-item>
          
          <v-divider v-if="index < recentDevices.length - 1"></v-divider>
        </template>
      </v-list>
    </v-card-text>
    
    <v-card-actions v-if="!loading && recentDevices.length > 0">
      <v-spacer></v-spacer>
      <v-btn 
        variant="text" 
        size="small" 
        color="primary"
        prepend-icon="mdi-refresh"
        @click="refreshDevices"
        :loading="refreshing"
      >
        Refresh
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import { formatDistanceToNow } from 'date-fns'

const props = defineProps({
  maxItems: {
    type: Number,
    default: 8
  }
})

defineEmits(['view-all'])

const devicesStore = useDevicesStore()
const refreshing = ref(false)

const loading = computed(() => devicesStore.loading)
const recentDevices = computed(() => 
  devicesStore.recentDevices.slice(0, props.maxItems)
)

const getDeviceIcon = (type) => {
  const icons = {
    'Access Point': 'mdi-wifi',
    'Switch': 'mdi-switch',
    'Gateway': 'mdi-router-wireless',
    'Controller': 'mdi-server',
    'Router': 'mdi-router'
  }
  return icons[type] || 'mdi-help-circle'
}

const getDeviceTypeColor = (type) => {
  const colors = {
    'Access Point': 'blue',
    'Switch': 'green',
    'Gateway': 'orange',
    'Controller': 'purple',
    'Router': 'teal'
  }
  return colors[type] || 'grey'
}

const getStatusColor = (status) => {
  const colors = {
    online: 'success',
    offline: 'error',
    warning: 'warning',
    maintenance: 'info'
  }
  return colors[status] || 'grey'
}

const formatLastSeen = (lastSeen) => {
  if (!lastSeen) return 'Unknown'
  
  try {
    return formatDistanceToNow(new Date(lastSeen), { addSuffix: true })
  } catch (error) {
    return 'Unknown'
  }
}

const refreshDevices = async () => {
  refreshing.value = true
  try {
    await devicesStore.fetchDevices()
  } finally {
    refreshing.value = false
  }
}
</script>

<style scoped>
.recent-devices-card {
  height: 100%;
}

.device-item {
  transition: background-color 0.2s ease;
}

.device-item:hover {
  background-color: rgba(var(--v-theme-primary), 0.04);
}

.v-list-item__append {
  align-self: flex-start;
}
</style>