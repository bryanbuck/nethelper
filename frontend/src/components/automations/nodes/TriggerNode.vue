<template>
  <BaseNode
    :id="id"
    :data="data"
    :selected="selected"
    type="trigger"
    :label="nodeLabel"
    :subtitle="nodeSubtitle"
    :description="nodeDescription"
    :icon="nodeIcon"
    icon-color="success"
    :is-start-node="true"
    :validation-errors="validationErrors"
    @click="$emit('node-click', $event)"
    @double-click="$emit('node-double-click', $event)"
    @configure="$emit('node-configure', $event)"
    @delete="$emit('node-delete', $event)"
  />
</template>

<script setup>
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'

const props = defineProps({
  id: {
    type: String,
    default: ''
  },
  data: {
    type: Object,
    default: () => ({})
  },
  selected: Boolean
})

defineEmits(['node-click', 'node-double-click', 'node-configure', 'node-delete'])

const nodeLabel = computed(() => {
  if (!props.data?.triggerType) return 'Trigger'
  
  const triggerTypes = {
    'device-status': 'Device Status Change',
    'schedule': 'Scheduled Event',
    'threshold': 'Threshold Alert',
    'webhook': 'Webhook Trigger',
    'manual': 'Manual Trigger'
  }
  
  return triggerTypes[props.data.triggerType] || 'Trigger'
})

const nodeSubtitle = computed(() => {
  if (!props.data?.config) return 'Configure trigger'
  
  switch (props.data.triggerType) {
    case 'device-status':
      return props.data.config.deviceName || 'Select device'
    case 'schedule':
      return props.data.config.schedule || 'Set schedule'
    case 'threshold':
      return props.data.config.metric || 'Set threshold'
    case 'webhook':
      return props.data.config.endpoint || 'Configure webhook'
    case 'manual':
      return 'Manual execution'
    default:
      return 'Configure trigger'
  }
})

const nodeDescription = computed(() => {
  if (!props.data?.config) return ''
  
  switch (props.data.triggerType) {
    case 'device-status':
      return `When ${props.data.config.deviceName} goes ${props.data.config.status}`
    case 'schedule':
      return `Run ${props.data.config.schedule}`
    case 'threshold':
      return `When ${props.data.config.metric} ${props.data.config.operator} ${props.data.config.value}`
    case 'webhook':
      return `HTTP ${props.data.config.method} to ${props.data.config.endpoint}`
    default:
      return ''
  }
})

const nodeIcon = computed(() => {
  if (!props.data?.triggerType) return 'mdi-play'
  
  const triggerIcons = {
    'device-status': 'mdi-router-wireless',
    'schedule': 'mdi-clock',
    'threshold': 'mdi-chart-line',
    'webhook': 'mdi-webhook',
    'manual': 'mdi-play'
  }
  
  return triggerIcons[props.data.triggerType] || 'mdi-play'
})

const validationErrors = computed(() => {
  const errors = []
  
  if (!props.data?.triggerType) {
    errors.push('Trigger type is required')
  }
  
  if (props.data?.triggerType && !props.data?.config) {
    errors.push('Trigger configuration is required')
  }
  
  if (props.data?.triggerType === 'device-status') {
    if (!props.data.config?.deviceName) {
      errors.push('Device selection is required')
    }
    if (!props.data.config?.status) {
      errors.push('Status condition is required')
    }
  }
  
  if (props.data?.triggerType === 'schedule') {
    if (!props.data.config?.schedule) {
      errors.push('Schedule configuration is required')
    }
  }
  
  if (props.data?.triggerType === 'threshold') {
    if (!props.data.config?.metric) {
      errors.push('Metric selection is required')
    }
    if (!props.data.config?.operator) {
      errors.push('Comparison operator is required')
    }
    if (props.data.config?.value === undefined || props.data.config?.value === '') {
      errors.push('Threshold value is required')
    }
  }
  
  return errors
})
</script>