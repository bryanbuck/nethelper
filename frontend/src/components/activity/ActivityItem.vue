<template>
  <!-- Navigates on click rather than :to, so the device-name link isn't nested in another <a>. -->
  <v-list-item
    :link="!!info.link"
    class="activity-item"
    :class="{ 'activity-item--dense': dense }"
    @click="info.link && router.push(info.link)"
  >
    <template #prepend>
      <v-avatar :color="info.color" variant="tonal" :size="dense ? 28 : 36">
        <v-icon :icon="info.icon" :size="dense ? 'small' : 'default'" />
      </v-avatar>
    </template>

    <v-list-item-title class="activity-title">
      <router-link
        v-if="item.device && !item.device.deleted"
        :to="`/devices/${item.device.id}`"
        class="activity-device"
        @click.stop
      >
        {{ item.device.name }}
      </router-link>
      <span v-else-if="item.device" class="activity-device text-medium-emphasis" title="Device no longer exists">{{ item.device.name }}</span>
      <span class="activity-label">{{ info.label }}</span>
    </v-list-item-title>
    <v-list-item-subtitle v-if="info.detail" class="activity-detail">{{ info.detail }}</v-list-item-subtitle>

    <template #append>
      <span class="text-caption text-medium-emphasis activity-time" :title="new Date(item.at).toLocaleString()">
        {{ showRelative ? timeAgo(item.at, now) : clockTime(item.at) }}
      </span>
    </template>
  </v-list-item>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { activityInfo, timeAgo } from '@/models/activity'

const props = defineProps({
  item: { type: Object, required: true },
  dense: { type: Boolean, default: false },
  // Relative time ("5 min ago") instead of the clock time under a day heading
  showRelative: { type: Boolean, default: false },
  now: { type: Number, default: () => Date.now() },
})

const router = useRouter()
const info = computed(() => activityInfo(props.item))
const clockTime = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<style scoped>
.activity-title {
  display: flex;
  flex-wrap: wrap;
  column-gap: 8px;
  white-space: normal;
}

.activity-device {
  font-weight: 500;
  color: rgb(var(--v-theme-primary-text));
  text-decoration: none;
}

.activity-device:hover {
  text-decoration: underline;
}

.activity-detail {
  white-space: normal;
}

.activity-time {
  white-space: nowrap;
  margin-left: 12px;
}

.activity-item--dense {
  min-height: 48px;
}
</style>
