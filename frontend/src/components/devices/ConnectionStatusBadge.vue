<template>
  <v-tooltip :text="tooltipText" location="top">
    <template #activator="{ props: tooltipProps }">
      <v-chip
        v-bind="tooltipProps"
        :color="statusColor"
        :variant="compact ? 'flat' : 'elevated'"
        :size="compact ? 'x-small' : 'small'"
        class="connection-status-badge"
      >
        <v-icon :icon="statusIcon" :size="compact ? 'x-small' : 'small'" start />
        <span v-if="!compact">{{ statusText }}</span>
      </v-chip>
    </template>
  </v-tooltip>
</template>

<script setup>
import { computed } from 'vue'
import { formatDistanceToNow } from 'date-fns'

const props = defineProps({
  status: {
    type: String,
    required: true,
    validator: (value) => ['connected', 'failed', 'untested', 'no-credentials', 'testing'].includes(value)
  },
  lastTested: {
    type: [String, Date],
    default: null
  },
  responseTime: {
    type: Number,
    default: null
  },
  compact: {
    type: Boolean,
    default: false
  },
  errorMessage: {
    type: String,
    default: null
  }
})

const statusConfig = computed(() => {
  const configs = {
    connected: {
      color: 'success',
      icon: 'mdi-check-circle',
      text: 'Connected'
    },
    failed: {
      color: 'error',
      icon: 'mdi-close-circle',
      text: 'Failed'
    },
    untested: {
      color: 'warning',
      icon: 'mdi-alert-circle',
      text: 'Untested'
    },
    'no-credentials': {
      color: 'grey',
      icon: 'mdi-minus-circle',
      text: 'No Credentials'
    },
    testing: {
      color: 'info',
      icon: 'mdi-loading',
      text: 'Testing...'
    }
  }
  return configs[props.status] || configs['no-credentials']
})

const statusColor = computed(() => statusConfig.value.color)
const statusIcon = computed(() => statusConfig.value.icon)
const statusText = computed(() => statusConfig.value.text)

const formattedLastTested = computed(() => {
  if (!props.lastTested) return null

  try {
    const date = typeof props.lastTested === 'string'
      ? new Date(props.lastTested)
      : props.lastTested
    return formatDistanceToNow(date, { addSuffix: true })
  } catch (error) {
    return null
  }
})

const tooltipText = computed(() => {
  const parts = []

  parts.push(`Status: ${statusText.value}`)

  if (formattedLastTested.value) {
    parts.push(`Last tested: ${formattedLastTested.value}`)
  }

  if (props.responseTime !== null && props.status === 'connected') {
    parts.push(`Response time: ${props.responseTime}ms`)
  }

  if (props.errorMessage && props.status === 'failed') {
    parts.push(`Error: ${props.errorMessage}`)
  }

  return parts.join('\n')
})
</script>

<style scoped>
.connection-status-badge {
  cursor: help;
}
</style>
