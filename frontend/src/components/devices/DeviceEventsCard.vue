<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon start icon="mdi-timeline-clock-outline" />
      Recent events
      <v-spacer />
      <span class="text-caption text-medium-emphasis">Raw transitions, newest first</span>
    </v-card-title>
    <v-divider />
    <v-list v-if="events.length" density="compact">
      <v-list-item v-for="e in events" :key="e.id || `${e.type}-${e.occurredAt}`">
        <template #prepend>
          <v-icon :icon="eventInfo(e).icon" :color="eventInfo(e).color" size="small" />
        </template>
        <v-list-item-title>
          <span v-if="e.port" class="font-weight-medium">{{ e.port }}</span>
          {{ eventInfo(e).label }}
        </v-list-item-title>
        <template #append>
          <span class="text-caption text-medium-emphasis" :title="EVENT_SOURCE_LABELS[e.source] || e.source">
            <v-icon v-if="e.source === 'cloud'" icon="mdi-cloud-outline" size="x-small" class="mr-1" />
            {{ formatTime(e.occurredAt) }}
          </span>
        </template>
      </v-list-item>
    </v-list>
    <v-card-text v-else class="text-medium-emphasis">
      {{ emptyText }}
    </v-card-text>
  </v-card>
</template>

<script setup>
import { format } from 'date-fns'
import { eventInfo, EVENT_SOURCE_LABELS } from '@/models/device-events'

defineProps({
  events: { type: Array, required: true },
  emptyText: { type: String, default: 'No events yet.' },
})

function formatTime(at) {
  try {
    return format(new Date(at), 'MMM d, HH:mm:ss')
  } catch {
    return ''
  }
}
</script>
