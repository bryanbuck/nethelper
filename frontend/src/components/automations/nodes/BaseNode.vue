<template>
  <div 
    :class="[
      'base-node',
      `node-${type}`,
      { 'node-selected': selected },
      { 'node-error': hasError },
      { 'node-running': isRunning }
    ]"
    @click="handleClick"
    @dblclick="handleDoubleClick"
  >
    <Handle 
      v-if="!isStartNode" 
      type="target" 
      :position="Position.Left" 
      :style="{ background: 'rgba(var(--v-theme-on-surface), 0.6)' }"
    />
    
    <div class="node-header">
      <div class="node-icon">
        <v-icon :color="iconColor" :size="iconSize">
          {{ icon }}
        </v-icon>
      </div>
      
      <div class="node-title">
        <div class="node-label">{{ label }}</div>
        <div v-if="subtitle" class="node-subtitle">{{ subtitle }}</div>
      </div>
      
      <div class="node-actions">
        <v-btn 
          v-if="isConfigurable"
          variant="text" 
          size="x-small" 
          icon="mdi-cog"
          @click.stop="handleConfigure"
        />
        <v-btn 
          variant="text" 
          size="x-small" 
          icon="mdi-delete"
          @click.stop="handleDelete"
        />
      </div>
    </div>
    
    <div v-if="description" class="node-description">
      {{ description }}
    </div>
    
    <div v-if="showStatus" class="node-status">
      <v-chip 
        :color="statusColor" 
        size="x-small" 
        variant="flat"
      >
        <v-icon v-if="statusIcon" start size="x-small">
          {{ statusIcon }}
        </v-icon>
        {{ status }}
      </v-chip>
    </div>
    
    <div v-if="hasValidationErrors" class="node-errors">
      <v-tooltip location="bottom">
        <template #activator="{ props: tooltipProps }">
          <v-icon 
            v-bind="tooltipProps"
            color="error" 
            size="small"
            class="error-icon"
          >
            mdi-alert-circle
          </v-icon>
        </template>
        <div v-for="error in validationErrors" :key="error">
          {{ error }}
        </div>
      </v-tooltip>
    </div>
    
    <Handle 
      v-if="!isEndNode" 
      type="source" 
      :position="Position.Right" 
      :style="{ background: 'rgba(var(--v-theme-on-surface), 0.6)' }"
    />
  </div>
</template>

<script setup>
import { computed, defineProps, defineEmits } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  id: {
    type: String,
    required: true
  },
  data: {
    type: Object,
    default: () => ({})
  },
  selected: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  subtitle: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  icon: {
    type: String,
    required: true
  },
  iconColor: {
    type: String,
    default: 'primary'
  },
  iconSize: {
    type: String,
    default: '20'
  },
  isStartNode: {
    type: Boolean,
    default: false
  },
  isEndNode: {
    type: Boolean,
    default: false
  },
  isConfigurable: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    default: 'ready'
  },
  showStatus: {
    type: Boolean,
    default: false
  },
  validationErrors: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['click', 'double-click', 'configure', 'delete'])

const hasError = computed(() => props.validationErrors.length > 0)
const hasValidationErrors = computed(() => props.validationErrors.length > 0)
const isRunning = computed(() => props.status === 'running')

const statusColor = computed(() => {
  switch (props.status) {
    case 'success': return 'success'
    case 'error': return 'error'
    case 'running': return 'warning'
    case 'ready': return 'info'
    default: return 'grey'
  }
})

const statusIcon = computed(() => {
  switch (props.status) {
    case 'success': return 'mdi-check'
    case 'error': return 'mdi-close'
    case 'running': return 'mdi-loading'
    case 'ready': return 'mdi-play'
    default: return null
  }
})

const handleClick = (event) => {
  emit('click', event)
}

const handleDoubleClick = (event) => {
  emit('double-click', event)
}

const handleConfigure = (event) => {
  emit('configure', event)
}

const handleDelete = (event) => {
  emit('delete', event)
}
</script>

<style scoped>
.base-node {
  background: rgb(var(--v-theme-surface));
  border: 2px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  min-width: 180px;
  max-width: 250px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: relative;
}

.base-node:hover {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  transform: translateY(-1px);
}

.node-selected {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.2);
}

.node-error {
  border-color: #f44336;
}

.node-error:hover {
  border-color: #d32f2f;
}

.node-running {
  border-color: #ff9800;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 152, 0, 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(255, 152, 0, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 152, 0, 0);
  }
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.node-icon {
  flex-shrink: 0;
}

.node-title {
  flex: 1;
  min-width: 0;
}

.node-label {
  font-weight: 600;
  font-size: 14px;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  line-height: 1.2;
  word-break: break-word;
}

.node-subtitle {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  margin-top: 2px;
  line-height: 1.2;
}

.node-actions {
  display: flex;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.base-node:hover .node-actions {
  opacity: 1;
}

.node-description {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  margin-bottom: 8px;
  line-height: 1.3;
}

.node-status {
  margin-top: 8px;
}

.node-errors {
  position: absolute;
  top: 4px;
  right: 4px;
}

.error-icon {
  animation: shake 0.5s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-2px); }
  75% { transform: translateX(2px); }
}

/* Node type specific styling */
.node-trigger {
  border-color: #4caf50;
}

.node-trigger:hover {
  border-color: #388e3c;
}

.node-condition {
  border-color: #ff9800;
}

.node-condition:hover {
  border-color: #f57c00;
}

.node-action {
  border-color: #FF8300;
}

.node-action:hover {
  border-color: #cc6900;
}

.node-notification {
  border-color: #9c27b0;
}

.node-notification:hover {
  border-color: #7b1fa2;
}
</style>