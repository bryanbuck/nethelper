<template>
  <BaseNode
    :id="id"
    :data="data"
    :selected="selected"
    type="notification"
    :label="nodeLabel"
    :subtitle="nodeSubtitle"
    :description="nodeDescription"
    :icon="nodeIcon"
    icon-color="purple"
    :is-end-node="true"
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
  id: String,
  data: {
    type: Object,
    default: () => ({})
  },
  selected: Boolean
})

defineEmits(['node-click', 'node-double-click', 'node-configure', 'node-delete'])

const nodeLabel = computed(() => {
  if (!props.data?.notificationType) return 'Notification'
  
  const notificationTypes = {
    'email': 'Send Email',
    'slack': 'Slack Message',
    'teams': 'Teams Message',
    'webhook': 'Webhook',
    'sms': 'SMS Alert',
    'dashboard': 'Dashboard Alert',
    'log': 'Log Entry'
  }
  
  return notificationTypes[props.data.notificationType] || 'Notification'
})

const nodeSubtitle = computed(() => {
  if (!props.data?.config) return 'Configure notification'
  
  switch (props.data.notificationType) {
    case 'email':
      return props.data.config.recipients?.length > 0 
        ? `${props.data.config.recipients.length} recipients` 
        : 'Set recipients'
    case 'slack':
      return props.data.config.channel || 'Select channel'
    case 'teams':
      return props.data.config.channel || 'Select channel'
    case 'webhook':
      return props.data.config.url || 'Enter URL'
    case 'sms':
      return props.data.config.phoneNumbers?.length > 0 
        ? `${props.data.config.phoneNumbers.length} numbers` 
        : 'Set phone numbers'
    case 'dashboard':
      return props.data.config.severity || 'Set severity'
    case 'log':
      return props.data.config.logLevel || 'Set log level'
    default:
      return 'Configure notification'
  }
})

const nodeDescription = computed(() => {
  if (!props.data?.config) return ''
  
  switch (props.data.notificationType) {
    case 'email':
      return `Send email to ${props.data.config.recipients?.join(', ') || 'recipients'}`
    case 'slack':
      return `Post to ${props.data.config.channel}`
    case 'teams':
      return `Send to ${props.data.config.channel}`
    case 'webhook':
      return `POST to ${props.data.config.url}`
    case 'sms':
      return `Text ${props.data.config.phoneNumbers?.length || 0} numbers`
    case 'dashboard':
      return `${props.data.config.severity} alert in dashboard`
    case 'log':
      return `${props.data.config.logLevel} log entry`
    default:
      return ''
  }
})

const nodeIcon = computed(() => {
  if (!props.data?.notificationType) return 'mdi-bell'
  
  const notificationIcons = {
    'email': 'mdi-email',
    'slack': 'mdi-slack',
    'teams': 'mdi-microsoft-teams',
    'webhook': 'mdi-webhook',
    'sms': 'mdi-message-text',
    'dashboard': 'mdi-view-dashboard',
    'log': 'mdi-file-document-outline'
  }
  
  return notificationIcons[props.data.notificationType] || 'mdi-bell'
})

const validationErrors = computed(() => {
  const errors = []
  
  if (!props.data?.notificationType) {
    errors.push('Notification type is required')
  }
  
  if (props.data?.notificationType && !props.data?.config) {
    errors.push('Notification configuration is required')
  }
  
  if (props.data?.notificationType === 'email') {
    if (!props.data.config?.recipients || props.data.config.recipients.length === 0) {
      errors.push('Email recipients are required')
    }
    if (!props.data.config?.subject) {
      errors.push('Email subject is required')
    }
  }
  
  if (props.data?.notificationType === 'slack' || props.data?.notificationType === 'teams') {
    if (!props.data.config?.channel) {
      errors.push('Channel is required')
    }
    if (!props.data.config?.message) {
      errors.push('Message is required')
    }
  }
  
  if (props.data?.notificationType === 'webhook') {
    if (!props.data.config?.url) {
      errors.push('Webhook URL is required')
    }
  }
  
  if (props.data?.notificationType === 'sms') {
    if (!props.data.config?.phoneNumbers || props.data.config.phoneNumbers.length === 0) {
      errors.push('Phone numbers are required')
    }
    if (!props.data.config?.message) {
      errors.push('SMS message is required')
    }
  }
  
  return errors
})
</script>