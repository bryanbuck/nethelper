<template>
  <v-card class="node-toolbar" elevation="4">
    <v-card-title class="text-h6 py-3">
      <v-icon class="mr-2" color="primary">mdi-puzzle</v-icon>
      Node Palette
    </v-card-title>
    
    <v-divider></v-divider>
    
    <v-card-text class="pa-0">
      <v-expansion-panels v-model="openPanels" multiple variant="accordion">
        <!-- Triggers Section -->
        <v-expansion-panel>
          <v-expansion-panel-title>
            <div class="d-flex align-center">
              <v-icon class="mr-2" color="success">mdi-play</v-icon>
              Triggers
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text class="pa-2">
            <div class="node-grid">
              <div 
                v-for="trigger in triggerNodes" 
                :key="trigger.type"
                :class="['node-item', { 'node-item--later': !isRunnable('trigger', trigger.type) }]"
                :title="isRunnable('trigger', trigger.type) ? undefined : 'Not runnable yet: a workflow using this can be saved but not run or activated'"
                :draggable="true"
                @dragstart="onDragStart($event, 'trigger', trigger)"
                @click="addNode('trigger', trigger)"
              >
                <div class="node-item-icon">
                  <v-icon :color="trigger.color" size="20">
                    {{ trigger.icon }}
                  </v-icon>
                </div>
                <div class="node-item-content">
                  <div class="node-item-title">{{ trigger.label }}</div>
                  <div class="node-item-description">{{ trigger.description }}</div>
                  <div v-if="!isRunnable('trigger', trigger.type)" class="node-item-later">Not runnable yet</div>
                </div>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
        
        <!-- Conditions Section -->
        <v-expansion-panel>
          <v-expansion-panel-title>
            <div class="d-flex align-center">
              <v-icon class="mr-2" color="warning">mdi-help-rhombus</v-icon>
              Conditions
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text class="pa-2">
            <div class="node-grid">
              <div 
                v-for="condition in conditionNodes" 
                :key="condition.type"
                :class="['node-item', { 'node-item--later': !isRunnable('condition', condition.type) }]"
                :title="isRunnable('condition', condition.type) ? undefined : 'Not runnable yet: a workflow using this can be saved but not run or activated'"
                :draggable="true"
                @dragstart="onDragStart($event, 'condition', condition)"
                @click="addNode('condition', condition)"
              >
                <div class="node-item-icon">
                  <v-icon :color="condition.color" size="20">
                    {{ condition.icon }}
                  </v-icon>
                </div>
                <div class="node-item-content">
                  <div class="node-item-title">{{ condition.label }}</div>
                  <div class="node-item-description">{{ condition.description }}</div>
                  <div v-if="!isRunnable('condition', condition.type)" class="node-item-later">Not runnable yet</div>
                </div>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
        
        <!-- Actions Section -->
        <v-expansion-panel>
          <v-expansion-panel-title>
            <div class="d-flex align-center">
              <v-icon class="mr-2" color="primary">mdi-cog</v-icon>
              Actions
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text class="pa-2">
            <div class="node-grid">
              <div 
                v-for="action in actionNodes" 
                :key="action.type"
                :class="['node-item', { 'node-item--later': !isRunnable('action', action.type) }]"
                :title="isRunnable('action', action.type) ? undefined : 'Not runnable yet: a workflow using this can be saved but not run or activated'"
                :draggable="true"
                @dragstart="onDragStart($event, 'action', action)"
                @click="addNode('action', action)"
              >
                <div class="node-item-icon">
                  <v-icon :color="action.color" size="20">
                    {{ action.icon }}
                  </v-icon>
                </div>
                <div class="node-item-content">
                  <div class="node-item-title">{{ action.label }}</div>
                  <div class="node-item-description">{{ action.description }}</div>
                  <div v-if="!isRunnable('action', action.type)" class="node-item-later">Not runnable yet</div>
                </div>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
        
        <!-- Notifications Section -->
        <v-expansion-panel>
          <v-expansion-panel-title>
            <div class="d-flex align-center">
              <v-icon class="mr-2" color="purple">mdi-bell</v-icon>
              Notifications
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text class="pa-2">
            <div class="node-grid">
              <div 
                v-for="notification in notificationNodes" 
                :key="notification.type"
                :class="['node-item', { 'node-item--later': !isRunnable('notification', notification.type) }]"
                :title="isRunnable('notification', notification.type) ? undefined : 'Not runnable yet: a workflow using this can be saved but not run or activated'"
                :draggable="true"
                @dragstart="onDragStart($event, 'notification', notification)"
                @click="addNode('notification', notification)"
              >
                <div class="node-item-icon">
                  <v-icon :color="notification.color" size="20">
                    {{ notification.icon }}
                  </v-icon>
                </div>
                <div class="node-item-content">
                  <div class="node-item-title">{{ notification.label }}</div>
                  <div class="node-item-description">{{ notification.description }}</div>
                  <div v-if="!isRunnable('notification', notification.type)" class="node-item-later">Not runnable yet</div>
                </div>
              </div>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
    
    <v-divider></v-divider>
    
    <v-card-actions class="px-4 py-3">
      <v-btn 
        variant="outlined" 
        size="small" 
        prepend-icon="mdi-help-circle"
        class="text-none"
        @click="showHelp = true"
      >
        Help
      </v-btn>
      
      <v-spacer></v-spacer>
      
      <v-btn 
        variant="text" 
        size="small" 
        :icon="collapsed ? 'mdi-chevron-right' : 'mdi-chevron-left'"
        @click="$emit('toggle-collapse')"
      ></v-btn>
    </v-card-actions>
    
    <!-- Help Dialog -->
    <v-dialog v-model="showHelp" max-width="500">
      <v-card>
        <v-card-title>
          <v-icon class="mr-2" color="primary">mdi-help-circle</v-icon>
          Node Palette Help
        </v-card-title>
        
        <v-card-text>
          <div class="help-content">
            <h3>How to use the Node Palette:</h3>
            <ul>
              <li><strong>Drag & Drop:</strong> Drag nodes from the palette to the canvas</li>
              <li><strong>Click to Add:</strong> Click a node to add it to the center of the canvas</li>
              <li><strong>Node Types:</strong></li>
              <ul>
                <li><strong>Triggers:</strong> Start your workflow with events</li>
                <li><strong>Conditions:</strong> Add logic and decision points</li>
                <li><strong>Actions:</strong> Perform network operations</li>
                <li><strong>Notifications:</strong> Send alerts and messages</li>
              </ul>
              <li><strong>Connections:</strong> Drag from output handles to input handles to connect nodes</li>
            </ul>
          </div>
        </v-card-text>
        
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="showHelp = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup>
import { ref } from 'vue'
import { isRunnable } from '@/models/automation-nodes'

defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['add-node', 'toggle-collapse'])

const openPanels = ref([0, 1, 2, 3]) // All panels open by default
const showHelp = ref(false)

// Node definitions
const triggerNodes = [
  {
    type: 'alert',
    label: 'Alert',
    description: 'When an alert opens or resolves',
    icon: 'mdi-bell-alert',
    color: 'success'
  },
  {
    type: 'device-status',
    label: 'Device Status',
    description: 'Trigger on device state change',
    icon: 'mdi-router-wireless',
    color: 'success'
  },
  {
    type: 'schedule',
    label: 'Schedule',
    description: 'Trigger at specific times',
    icon: 'mdi-clock',
    color: 'success'
  },
  {
    type: 'threshold',
    label: 'Threshold',
    description: 'Trigger on metric thresholds',
    icon: 'mdi-chart-line',
    color: 'success'
  },
  {
    type: 'webhook',
    label: 'Webhook',
    description: 'Trigger via HTTP webhook',
    icon: 'mdi-webhook',
    color: 'success'
  },
  {
    type: 'manual',
    label: 'Manual',
    description: 'Manually triggered workflow',
    icon: 'mdi-play',
    color: 'success'
  }
]

const conditionNodes = [
  {
    type: 'alert-severity',
    label: 'Alert Severity',
    description: 'Check the triggering alert\'s severity',
    icon: 'mdi-alert',
    color: 'warning'
  },
  {
    type: 'device-property',
    label: 'Device Property',
    description: 'Check device properties',
    icon: 'mdi-cog',
    color: 'warning'
  },
  {
    type: 'time-window',
    label: 'Time Window',
    description: 'Restrict to time periods',
    icon: 'mdi-clock-outline',
    color: 'warning'
  },
  {
    type: 'user-approval',
    label: 'User Approval',
    description: 'Require manual approval',
    icon: 'mdi-account-check',
    color: 'warning'
  },
  {
    type: 'custom-script',
    label: 'Custom Script',
    description: 'Execute custom logic',
    icon: 'mdi-code-braces',
    color: 'warning'
  },
  {
    type: 'device-count',
    label: 'Device Count',
    description: 'Check device count conditions',
    icon: 'mdi-counter',
    color: 'warning'
  }
]

const actionNodes = [
  {
    type: 'raise-alert',
    label: 'Raise Alert',
    description: 'Open an alert (or count it again)',
    icon: 'mdi-bell-plus',
    color: 'primary'
  },
  {
    type: 'clear-alert',
    label: 'Clear Alert',
    description: 'Resolve an alert an automation raised',
    icon: 'mdi-bell-check',
    color: 'primary'
  },
  {
    type: 'acknowledge-alert',
    label: 'Acknowledge Alert',
    description: 'Acknowledge the triggering alert',
    icon: 'mdi-bell-ring',
    color: 'primary'
  },
  {
    type: 'device-reboot',
    label: 'Reboot Device',
    description: 'Restart network devices',
    icon: 'mdi-restart',
    color: 'primary'
  },
  {
    type: 'device-config',
    label: 'Configure Device',
    description: 'Apply device configuration',
    icon: 'mdi-cog',
    color: 'primary'
  },
  {
    type: 'send-command',
    label: 'Send Command',
    description: 'Execute device commands',
    icon: 'mdi-console',
    color: 'primary'
  },
  {
    type: 'update-firmware',
    label: 'Update Firmware',
    description: 'Update device firmware',
    icon: 'mdi-download',
    color: 'primary'
  },
  {
    type: 'create-backup',
    label: 'Create Backup',
    description: 'Backup device configuration',
    icon: 'mdi-backup-restore',
    color: 'primary'
  },
  {
    type: 'generate-report',
    label: 'Generate Report',
    description: 'Create network reports',
    icon: 'mdi-file-document',
    color: 'primary'
  },
  {
    type: 'run-script',
    label: 'Run Script',
    description: 'Execute custom scripts',
    icon: 'mdi-script-text',
    color: 'primary'
  },
  {
    type: 'http-request',
    label: 'HTTP Request',
    description: 'Make HTTP API calls',
    icon: 'mdi-web',
    color: 'primary'
  }
]

const notificationNodes = [
  {
    type: 'email',
    label: 'Email',
    description: 'Send email notifications',
    icon: 'mdi-email',
    color: 'purple'
  },
  {
    type: 'slack',
    label: 'Slack',
    description: 'Send Slack messages',
    icon: 'mdi-slack',
    color: 'purple'
  },
  {
    type: 'teams',
    label: 'Teams',
    description: 'Send Teams messages',
    icon: 'mdi-microsoft-teams',
    color: 'purple'
  },
  {
    type: 'webhook',
    label: 'Webhook',
    description: 'Send webhook notifications',
    icon: 'mdi-webhook',
    color: 'purple'
  },
  {
    type: 'sms',
    label: 'SMS',
    description: 'Send SMS alerts',
    icon: 'mdi-message-text',
    color: 'purple'
  },
  {
    type: 'dashboard',
    label: 'Dashboard Alert',
    description: 'Show dashboard alerts',
    icon: 'mdi-view-dashboard',
    color: 'purple'
  },
  {
    type: 'log',
    label: 'Log Entry',
    description: 'Write to system logs',
    icon: 'mdi-file-document-outline',
    color: 'purple'
  }
]

// Methods
const onDragStart = (event, nodeCategory, nodeData) => {
  event.dataTransfer.setData('application/vueflow', JSON.stringify({
    category: nodeCategory,
    ...nodeData
  }))
  event.dataTransfer.effectAllowed = 'move'
}

const addNode = (category, nodeData) => {
  emit('add-node', {
    category,
    ...nodeData
  })
}
</script>

<style scoped>
.node-toolbar {
  width: 280px;
  height: 100%;
  max-height: 100vh;
  overflow-y: auto;
  border-radius: 0;
}

.node-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.node-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: rgb(var(--v-theme-surface));
}

.node-item:hover {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.node-item:active {
  transform: translateY(0);
}

.node-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: rgba(var(--v-theme-surface), 0.1);
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
}

.node-item-content {
  flex: 1;
  min-width: 0;
}

.node-item-title {
  font-weight: 600;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  line-height: 1.2;
  margin-bottom: 2px;
}

.node-item-description {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  line-height: 1.2;
}

.node-item--later {
  opacity: 0.6;
}

.node-item-later {
  font-size: 10px;
  font-weight: 500;
  color: rgb(var(--v-theme-warning));
  margin-top: 2px;
}

.help-content {
  font-size: 14px;
  line-height: 1.5;
}

.help-content h3 {
  margin-bottom: 12px;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
}

.help-content ul {
  margin-bottom: 16px;
  padding-left: 20px;
}

.help-content li {
  margin-bottom: 8px;
}

.help-content ul ul {
  margin-top: 8px;
  margin-bottom: 8px;
}
</style>