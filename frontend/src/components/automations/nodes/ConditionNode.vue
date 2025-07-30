<template>
  <BaseNode
    :id="id"
    :data="data"
    :selected="selected"
    type="condition"
    :label="nodeLabel"
    :subtitle="nodeSubtitle"
    :description="nodeDescription"
    :icon="nodeIcon"
    icon-color="warning"
    :validation-errors="validationErrors"
    @click="$emit('node-click', $event)"
    @double-click="$emit('node-double-click', $event)"
    @configure="$emit('node-configure', $event)"
    @delete="$emit('node-delete', $event)"
  >
    <!-- Custom handles for true/false branches -->
    <template v-if="data?.conditionType">
      <Handle 
        type="source" 
        position="Position.Right" 
        id="true"
        :style="{ background: '#4caf50', top: '30%' }"
      />
      <Handle 
        type="source" 
        position="Position.Right" 
        id="false"
        :style="{ background: '#f44336', top: '70%' }"
      />
      
      <!-- Branch labels -->
      <div class="condition-branches">
        <div class="branch-label true-branch">
          <v-icon size="12" color="success">mdi-check</v-icon>
          True
        </div>
        <div class="branch-label false-branch">
          <v-icon size="12" color="error">mdi-close</v-icon>
          False
        </div>
      </div>
    </template>
  </BaseNode>
</template>

<script setup>
import { computed } from 'vue'
import BaseNode from './BaseNode.vue'
import { Handle, Position } from '@vue-flow/core'

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
  if (!props.data?.conditionType) return 'Condition'
  
  const conditionTypes = {
    'device-property': 'Device Property',
    'time-window': 'Time Window',
    'user-approval': 'User Approval',
    'custom-script': 'Custom Script',
    'device-count': 'Device Count'
  }
  
  return conditionTypes[props.data.conditionType] || 'Condition'
})

const nodeSubtitle = computed(() => {
  if (!props.data?.config) return 'Configure condition'
  
  switch (props.data.conditionType) {
    case 'device-property':
      return props.data.config.property || 'Select property'
    case 'time-window':
      return `${props.data.config.startTime} - ${props.data.config.endTime}` || 'Set time window'
    case 'user-approval':
      return props.data.config.approver || 'Set approver'
    case 'custom-script':
      return props.data.config.scriptName || 'Configure script'
    case 'device-count':
      return `Count ${props.data.config.operator} ${props.data.config.count}` || 'Set count condition'
    default:
      return 'Configure condition'
  }
})

const nodeDescription = computed(() => {
  if (!props.data?.config) return ''
  
  switch (props.data.conditionType) {
    case 'device-property':
      return `If ${props.data.config.property} ${props.data.config.operator} ${props.data.config.value}`
    case 'time-window':
      return `Only between ${props.data.config.startTime} and ${props.data.config.endTime}`
    case 'user-approval':
      return `Requires approval from ${props.data.config.approver}`
    case 'custom-script':
      return `Execute ${props.data.config.scriptName}`
    case 'device-count':
      return `When device count ${props.data.config.operator} ${props.data.config.count}`
    default:
      return ''
  }
})

const nodeIcon = computed(() => {
  if (!props.data?.conditionType) return 'mdi-help-rhombus'
  
  const conditionIcons = {
    'device-property': 'mdi-cog',
    'time-window': 'mdi-clock-outline',
    'user-approval': 'mdi-account-check',
    'custom-script': 'mdi-code-braces',
    'device-count': 'mdi-counter'
  }
  
  return conditionIcons[props.data.conditionType] || 'mdi-help-rhombus'
})

const validationErrors = computed(() => {
  const errors = []
  
  if (!props.data?.conditionType) {
    errors.push('Condition type is required')
  }
  
  if (props.data?.conditionType && !props.data?.config) {
    errors.push('Condition configuration is required')
  }
  
  if (props.data?.conditionType === 'device-property') {
    if (!props.data.config?.property) {
      errors.push('Property selection is required')
    }
    if (!props.data.config?.operator) {
      errors.push('Comparison operator is required')
    }
    if (props.data.config?.value === undefined || props.data.config?.value === '') {
      errors.push('Comparison value is required')
    }
  }
  
  if (props.data?.conditionType === 'time-window') {
    if (!props.data.config?.startTime) {
      errors.push('Start time is required')
    }
    if (!props.data.config?.endTime) {
      errors.push('End time is required')
    }
  }
  
  if (props.data?.conditionType === 'user-approval') {
    if (!props.data.config?.approver) {
      errors.push('Approver is required')
    }
  }
  
  return errors
})
</script>

<style scoped>
.condition-branches {
  position: absolute;
  right: -50px;
  top: 20%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.branch-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 12px;
  background: white;
  border: 1px solid #e0e0e0;
  white-space: nowrap;
}

.true-branch {
  color: #4caf50;
  border-color: #4caf50;
}

.false-branch {
  color: #f44336;
  border-color: #f44336;
}
</style>