<template>
  <v-snackbar
    v-for="notification in visibleNotifications"
    :key="notification.id"
    v-model="notification.visible"
    :color="getColor(notification.type)"
    :timeout="notification.timeout"
    :location="location"
    :vertical="vertical"
    multi-line
    class="notification-snackbar"
    @update:model-value="(val) => !val && handleClose(notification.id)"
  >
    <div class="d-flex align-center">
      <v-icon v-if="notification.type" start>
        {{ getIcon(notification.type) }}
      </v-icon>
      <div class="flex-grow-1">
        <div v-if="notification.title" class="font-weight-bold mb-1">
          {{ notification.title }}
        </div>
        <div>{{ notification.message }}</div>
      </div>
    </div>

    <template #actions>
      <v-btn
        v-for="item in notification.actions"
        :key="item.label"
        variant="text"
        size="small"
        @click="runAction(notification.id, item)"
      >
        {{ item.label }}
      </v-btn>
      <v-btn
        icon="mdi-close"
        size="small"
        variant="text"
        @click="handleClose(notification.id)"
      >
      </v-btn>
    </template>
  </v-snackbar>
</template>

<script setup>
import { computed, watch } from 'vue'
import { useNotificationsStore } from '@/stores/notifications'

const props = defineProps({
  location: {
    type: String,
    default: 'top right'
  },
  vertical: {
    type: Boolean,
    default: false
  },
  maxVisible: {
    type: Number,
    default: 3
  }
})

const notificationsStore = useNotificationsStore()

// Track which notifications are visible
const visibleNotifications = computed(() => {
  return notificationsStore.unreadNotifications
    .slice(0, props.maxVisible)
    .map(n => ({
      ...n,
      visible: true
    }))
})

const getColor = (type) => {
  const colors = {
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info'
  }
  return colors[type] || 'info'
}

const getIcon = (type) => {
  const icons = {
    success: 'mdi-check-circle',
    error: 'mdi-alert-circle',
    warning: 'mdi-alert',
    info: 'mdi-information'
  }
  return icons[type] || 'mdi-information'
}

const runAction = (notificationId, item) => {
  handleClose(notificationId)
  item.action?.()
}

const handleClose = (notificationId) => {
  notificationsStore.markAsRead(notificationId)
  notificationsStore.removeNotification(notificationId)
}

// Watch for new notifications and mark as read after a delay
watch(() => notificationsStore.notifications.length, () => {
  // Auto-mark as read after timeout
  visibleNotifications.value.forEach(notification => {
    if (!notification.persistent && notification.timeout > 0) {
      setTimeout(() => {
        notificationsStore.markAsRead(notification.id)
      }, notification.timeout)
    }
  })
})
</script>

<style scoped>
.notification-snackbar {
  margin-bottom: 8px;
}

/* Style the action button to be bold and match notification text color */
:deep(.notification-action-btn) {
  font-weight: bold !important;
  opacity: 1 !important;
}
</style>
