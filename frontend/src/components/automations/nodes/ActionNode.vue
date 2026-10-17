<template>
  <BaseNode
    :id="id"
    :data="data"
    :selected="selected"
    type="action"
    :label="nodeLabel"
    :subtitle="nodeSubtitle"
    :description="nodeDescription"
    :icon="nodeIcon"
    icon-color="primary"
    :validation-errors="validationErrors"
    :show-status="true"
    :status="executionStatus"
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
  if (!props.data?.actionType) return 'Action'
  
  const actionTypes = {
    'raise-alert': 'Raise Alert',
    'clear-alert': 'Clear Alert',
    'acknowledge-alert': 'Acknowledge Alert',
    'device-reboot': 'Reboot Device',
    'device-config': 'Configure Device',
    'send-command': 'Send Command',
    'update-firmware': 'Update Firmware',
    'create-backup': 'Create Backup',
    'generate-report': 'Generate Report',
    'run-script': 'Run Script',
    'http-request': 'HTTP Request'
  }
  
  return actionTypes[props.data.actionType] || 'Action'
})

const nodeSubtitle = computed(() => {
  if (!props.data?.config) return 'Configure action'
  
  switch (props.data.actionType) {
    case 'device-reboot':
      return props.data.config.targetDevices?.length > 0 
        ? `${props.data.config.targetDevices.length} devices` 
        : 'Select devices'
    case 'device-config':
      return props.data.config.configTemplate || 'Select template'
    case 'send-command':
      return props.data.config.command || 'Enter command'
    case 'update-firmware':
      return props.data.config.firmwareVersion || 'Select version'
    case 'raise-alert':
      return props.data.config.key ? `Key: ${props.data.config.key}` : 'Set alert key'
    case 'clear-alert':
      return props.data.config.key ? `Key: ${props.data.config.key}` : 'Set alert key'
    case 'acknowledge-alert':
      return 'Triggering alert'
    case 'create-backup':
      return 'The run\'s device'
    case 'generate-report':
      return props.data.config.reportType || 'Select report type'
    case 'run-script':
      return props.data.config.scriptName || 'Select script'
    case 'http-request':
      return props.data.config.url || 'Enter URL'
    default:
      return 'Configure action'
  }
})

const nodeDescription = computed(() => {
  if (!props.data?.config) return ''
  
  switch (props.data.actionType) {
    case 'device-reboot':
      return `Reboot ${props.data.config.targetDevices?.length || 0} selected devices`
    case 'device-config':
      return `Apply ${props.data.config.configTemplate} configuration`
    case 'send-command':
      return `Execute: ${props.data.config.command}`
    case 'update-firmware':
      return `Update to version ${props.data.config.firmwareVersion}`
    case 'raise-alert':
      return props.data.config.title || ''
    case 'clear-alert':
      return 'Resolve the alert raised with this key'
    case 'acknowledge-alert':
      return 'Acknowledge the alert that started the run'
    case 'create-backup':
      return 'Back up the device\'s configuration'
    case 'generate-report':
      return `Generate ${props.data.config.reportType} report`
    case 'run-script':
      return `Execute ${props.data.config.scriptName}`
    case 'http-request':
      return `${props.data.config.method} ${props.data.config.url}`
    default:
      return ''
  }
})

const nodeIcon = computed(() => {
  if (!props.data?.actionType) return 'mdi-cog'
  
  const actionIcons = {
    'raise-alert': 'mdi-bell-plus',
    'clear-alert': 'mdi-bell-check',
    'acknowledge-alert': 'mdi-bell-ring',
    'device-reboot': 'mdi-restart',
    'device-config': 'mdi-cog',
    'send-command': 'mdi-console',
    'update-firmware': 'mdi-download',
    'create-backup': 'mdi-backup-restore',
    'generate-report': 'mdi-file-document',
    'run-script': 'mdi-script-text',
    'http-request': 'mdi-web'
  }
  
  return actionIcons[props.data.actionType] || 'mdi-cog'
})

const executionStatus = computed(() => {
  return props.data?.executionStatus || 'ready'
})

const validationErrors = computed(() => {
  const errors = []
  
  if (!props.data?.actionType) {
    errors.push('Action type is required')
  }
  
  if (props.data?.actionType && !props.data?.config) {
    errors.push('Action configuration is required')
  }
  
  if (props.data?.actionType === 'device-reboot') {
    if (!props.data.config?.targetDevices || props.data.config.targetDevices.length === 0) {
      errors.push('Target devices are required')
    }
  }
  
  if (props.data?.actionType === 'device-config') {
    if (!props.data.config?.configTemplate) {
      errors.push('Configuration template is required')
    }
  }
  
  if (props.data?.actionType === 'send-command') {
    if (!props.data.config?.command) {
      errors.push('Command is required')
    }
  }
  
  if (props.data?.actionType === 'http-request') {
    if (!props.data.config?.url) {
      errors.push('URL is required')
    }
    if (!props.data.config?.method) {
      errors.push('HTTP method is required')
    }
  }
  
  return errors
})
</script>