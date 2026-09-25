<template>
  <v-dialog 
    v-model="show" 
    max-width="800px" 
    persistent
    scrollable
  >
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <div class="d-flex align-center">
          <v-icon 
            :color="nodeTypeColor" 
            class="mr-3" 
            size="24"
          >
            {{ nodeTypeIcon }}
          </v-icon>
          <div>
            <div class="text-h6">Configure {{ nodeTypeLabel }}</div>
            <div class="text-caption text-medium-emphasis">{{ node?.id }}</div>
          </div>
        </div>
        
        <v-btn 
          variant="text" 
          size="small" 
          icon="mdi-close"
          @click="handleCancel"
        />
      </v-card-title>
      
      <v-divider></v-divider>
      
      <v-card-text class="pa-6">
        <v-form ref="form" v-model="formValid">
          <!-- Trigger Node Configuration -->
          <div v-if="node?.type === 'trigger'">
            <v-select
              v-model="nodeConfig.triggerType"
              label="Trigger Type"
              :items="triggerTypes"
              variant="outlined"
              required
              :rules="[rules.required]"
              @update:model-value="onTriggerTypeChange"
            />
            
            <!-- Device Status Trigger -->
            <div v-if="nodeConfig.triggerType === 'device-status'">
              <v-select
                v-model="nodeConfig.config.deviceName"
                label="Device"
                :items="availableDevices"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
              <v-select
                v-model="nodeConfig.config.status"
                label="Status Condition"
                :items="statusConditions"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
            </div>
            
            <!-- Schedule Trigger -->
            <div v-if="nodeConfig.triggerType === 'schedule'">
              <v-text-field
                v-model="nodeConfig.config.schedule"
                label="Cron Expression"
                variant="outlined"
                required
                :rules="[rules.required]"
                placeholder="0 0 * * *"
                hint="Minute Hour Day Month DayOfWeek"
                persistent-hint
              />
              <v-select
                v-model="nodeConfig.config.timezone"
                label="Timezone"
                :items="timezones"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
            </div>
            
            <!-- Threshold Trigger -->
            <div v-if="nodeConfig.triggerType === 'threshold'">
              <v-select
                v-model="nodeConfig.config.metric"
                label="Metric"
                :items="availableMetrics"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
              <v-select
                v-model="nodeConfig.config.operator"
                label="Operator"
                :items="operators"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
              <v-text-field
                v-model="nodeConfig.config.value"
                label="Threshold Value"
                variant="outlined"
                type="number"
                required
                :rules="[rules.required, rules.number]"
              />
            </div>
          </div>
          
          <!-- Condition Node Configuration -->
          <div v-if="node?.type === 'condition'">
            <v-select
              v-model="nodeConfig.conditionType"
              label="Condition Type"
              :items="conditionTypes"
              variant="outlined"
              required
              :rules="[rules.required]"
              @update:model-value="onConditionTypeChange"
            />
            
            <!-- Device Property Condition -->
            <div v-if="nodeConfig.conditionType === 'device-property'">
              <v-select
                v-model="nodeConfig.config.property"
                label="Device Property"
                :items="deviceProperties"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
              <v-select
                v-model="nodeConfig.config.operator"
                label="Operator"
                :items="operators"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
              <v-text-field
                v-model="nodeConfig.config.value"
                label="Value"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
            </div>
            
            <!-- Time Window Condition -->
            <div v-if="nodeConfig.conditionType === 'time-window'">
              <v-text-field
                v-model="nodeConfig.config.startTime"
                label="Start Time"
                variant="outlined"
                type="time"
                required
                :rules="[rules.required]"
              />
              <v-text-field
                v-model="nodeConfig.config.endTime"
                label="End Time"
                variant="outlined"
                type="time"
                required
                :rules="[rules.required]"
              />
              <v-select
                v-model="nodeConfig.config.days"
                label="Days of Week"
                :items="daysOfWeek"
                variant="outlined"
                multiple
                chips
              />
            </div>
            
            <!-- User Approval Condition -->
            <div v-if="nodeConfig.conditionType === 'user-approval'">
              <v-select
                v-model="nodeConfig.config.approver"
                label="Approver"
                :items="availableUsers"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
              <v-text-field
                v-model="nodeConfig.config.message"
                label="Approval Message"
                variant="outlined"
                multiline
                rows="3"
              />
            </div>
          </div>
          
          <!-- Action Node Configuration -->
          <div v-if="node?.type === 'action'">
            <v-select
              v-model="nodeConfig.actionType"
              label="Action Type"
              :items="actionTypes"
              variant="outlined"
              required
              :rules="[rules.required]"
              @update:model-value="onActionTypeChange"
            />
            
            <!-- Device Reboot Action -->
            <div v-if="nodeConfig.actionType === 'device-reboot'">
              <v-select
                v-model="nodeConfig.config.targetDevices"
                label="Target Devices"
                :items="availableDevices"
                variant="outlined"
                multiple
                chips
                required
                :rules="[rules.required]"
              />
              <v-checkbox
                v-model="nodeConfig.config.waitForReboot"
                label="Wait for devices to come back online"
              />
              <v-text-field
                v-if="nodeConfig.config.waitForReboot"
                v-model="nodeConfig.config.timeoutMinutes"
                label="Timeout (minutes)"
                variant="outlined"
                type="number"
                min="1"
                max="60"
              />
            </div>
            
            <!-- Send Command Action -->
            <div v-if="nodeConfig.actionType === 'send-command'">
              <v-select
                v-model="nodeConfig.config.targetDevices"
                label="Target Devices"
                :items="availableDevices"
                variant="outlined"
                multiple
                chips
                required
                :rules="[rules.required]"
              />
              <v-textarea
                v-model="nodeConfig.config.command"
                label="Command"
                variant="outlined"
                required
                :rules="[rules.required]"
                placeholder="show version"
                rows="3"
              />
              <v-checkbox
                v-model="nodeConfig.config.saveOutput"
                label="Save command output"
              />
            </div>
            
            <!-- HTTP Request Action -->
            <div v-if="nodeConfig.actionType === 'http-request'">
              <v-select
                v-model="nodeConfig.config.method"
                label="HTTP Method"
                :items="httpMethods"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
              <v-text-field
                v-model="nodeConfig.config.url"
                label="URL"
                variant="outlined"
                required
                :rules="[rules.required, rules.url]"
                placeholder="https://api.example.com/webhook"
              />
              <v-textarea
                v-if="['POST', 'PUT', 'PATCH'].includes(nodeConfig.config.method)"
                v-model="nodeConfig.config.body"
                label="Request Body (JSON)"
                variant="outlined"
                rows="4"
                placeholder="{&quot;message&quot;: &quot;Hello World&quot;}"
              />
              <v-textarea
                v-model="nodeConfig.config.headers"
                label="Headers (JSON)"
                variant="outlined"
                rows="3"
                placeholder="{&quot;Content-Type&quot;: &quot;application/json&quot;}"
              />
            </div>
          </div>
          
          <!-- Notification Node Configuration -->
          <div v-if="node?.type === 'notification'">
            <v-select
              v-model="nodeConfig.notificationType"
              label="Notification Type"
              :items="notificationTypes"
              variant="outlined"
              required
              :rules="[rules.required]"
              @update:model-value="onNotificationTypeChange"
            />
            
            <!-- Email Notification -->
            <div v-if="nodeConfig.notificationType === 'email'">
              <v-combobox
                v-model="nodeConfig.config.recipients"
                label="Recipients"
                variant="outlined"
                multiple
                chips
                required
                :rules="[rules.required]"
                placeholder="user@example.com"
              />
              <v-text-field
                v-model="nodeConfig.config.subject"
                label="Subject"
                variant="outlined"
                required
                :rules="[rules.required]"
              />
              <v-textarea
                v-model="nodeConfig.config.message"
                label="Message"
                variant="outlined"
                required
                :rules="[rules.required]"
                rows="4"
              />
            </div>
            
            <!-- Slack Notification -->
            <div v-if="nodeConfig.notificationType === 'slack'">
              <v-text-field
                v-model="nodeConfig.config.channel"
                label="Channel"
                variant="outlined"
                required
                :rules="[rules.required]"
                placeholder="#general"
              />
              <v-textarea
                v-model="nodeConfig.config.message"
                label="Message"
                variant="outlined"
                required
                :rules="[rules.required]"
                rows="4"
              />
              <v-checkbox
                v-model="nodeConfig.config.mentionChannel"
                label="Mention @channel"
              />
            </div>
            
            <!-- Webhook Notification -->
            <div v-if="nodeConfig.notificationType === 'webhook'">
              <v-text-field
                v-model="nodeConfig.config.url"
                label="Webhook URL"
                variant="outlined"
                required
                :rules="[rules.required, rules.url]"
                placeholder="https://hooks.slack.com/services/..."
              />
              <v-textarea
                v-model="nodeConfig.config.payload"
                label="Payload (JSON)"
                variant="outlined"
                rows="4"
                placeholder="{&quot;text&quot;: &quot;Automation completed&quot;}"
              />
            </div>
          </div>
          
          <!-- Common Settings -->
          <v-divider class="my-6"></v-divider>
          
          <h3 class="text-h6 mb-4">General Settings</h3>
          
          <v-text-field
            v-model="nodeConfig.label"
            label="Node Label"
            variant="outlined"
            placeholder="Custom label for this node"
          />
          
          <v-textarea
            v-model="nodeConfig.description"
            label="Description"
            variant="outlined"
            rows="2"
            placeholder="Describe what this node does"
          />
          
          <v-checkbox
            v-model="nodeConfig.enabled"
            label="Enable this node"
          />
          
          <v-text-field
            v-if="node?.type === 'action'"
            v-model="nodeConfig.config.retryAttempts"
            label="Retry Attempts"
            variant="outlined"
            type="number"
            min="0"
            max="5"
            hint="Number of times to retry if the action fails"
            persistent-hint
          />
        </v-form>
      </v-card-text>
      
      <v-divider></v-divider>
      
      <v-card-actions class="px-6 py-4">
        <v-btn 
          variant="outlined"
          @click="handleCancel"
        >
          Cancel
        </v-btn>
        
        <v-btn 
          variant="outlined"
          prepend-icon="mdi-test-tube"
          :disabled="!formValid"
          @click="testConfiguration"
        >
          Test
        </v-btn>
        
        <v-spacer></v-spacer>
        
        <v-btn 
          color="primary"
          variant="flat"
          prepend-icon="mdi-content-save"
          :disabled="!formValid"
          :loading="saving"
          @click="handleSave"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useDevicesStore } from '@/stores/devices'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  node: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:modelValue', 'save', 'test'])

// Component state
const form = ref(null)
const formValid = ref(false)
const saving = ref(false)
const nodeConfig = ref({})

// Computed properties
const show = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const nodeTypeLabel = computed(() => {
  const labels = {
    trigger: 'Trigger',
    condition: 'Condition',
    action: 'Action',
    notification: 'Notification'
  }
  return labels[props.node?.type] || 'Node'
})

const nodeTypeIcon = computed(() => {
  const icons = {
    trigger: 'mdi-play',
    condition: 'mdi-help-rhombus',
    action: 'mdi-cog',
    notification: 'mdi-bell'
  }
  return icons[props.node?.type] || 'mdi-circle'
})

const nodeTypeColor = computed(() => {
  const colors = {
    trigger: 'success',
    condition: 'warning',
    action: 'primary',
    notification: 'purple'
  }
  return colors[props.node?.type] || 'grey'
})

// Form data options
const triggerTypes = [
  { title: 'Device Status Change', value: 'device-status' },
  { title: 'Scheduled Event', value: 'schedule' },
  { title: 'Threshold Alert', value: 'threshold' },
  { title: 'Webhook Trigger', value: 'webhook' },
  { title: 'Manual Trigger', value: 'manual' }
]

const conditionTypes = [
  { title: 'Device Property', value: 'device-property' },
  { title: 'Time Window', value: 'time-window' },
  { title: 'User Approval', value: 'user-approval' },
  { title: 'Custom Script', value: 'custom-script' },
  { title: 'Device Count', value: 'device-count' }
]

const actionTypes = [
  { title: 'Reboot Device', value: 'device-reboot' },
  { title: 'Configure Device', value: 'device-config' },
  { title: 'Send Command', value: 'send-command' },
  { title: 'Update Firmware', value: 'update-firmware' },
  { title: 'Create Backup', value: 'create-backup' },
  { title: 'Generate Report', value: 'generate-report' },
  { title: 'Run Script', value: 'run-script' },
  { title: 'HTTP Request', value: 'http-request' }
]

const notificationTypes = [
  { title: 'Email', value: 'email' },
  { title: 'Slack', value: 'slack' },
  { title: 'Teams', value: 'teams' },
  { title: 'Webhook', value: 'webhook' },
  { title: 'SMS', value: 'sms' },
  { title: 'Dashboard Alert', value: 'dashboard' },
  { title: 'Log Entry', value: 'log' }
]

// Real inventory names for the device pickers (loaded on first open)
const devicesStore = useDevicesStore()
const availableDevices = computed(() => devicesStore.devices.map((d) => d.name).filter(Boolean))
onMounted(() => {
  if (devicesStore.devices.length === 0) {
    devicesStore.fetchDevices().catch(() => {}) // store records the error
  }
})

const statusConditions = [
  { title: 'Goes Online', value: 'online' },
  { title: 'Goes Offline', value: 'offline' },
  { title: 'Warning State', value: 'warning' },
  { title: 'Maintenance Mode', value: 'maintenance' }
]

const availableMetrics = [
  { title: 'CPU Usage', value: 'cpu_usage' },
  { title: 'Memory Usage', value: 'memory_usage' },
  { title: 'Interface Utilization', value: 'interface_util' },
  { title: 'Client Count', value: 'client_count' },
  { title: 'Temperature', value: 'temperature' }
]

const operators = [
  { title: 'Equals', value: '=' },
  { title: 'Greater Than', value: '>' },
  { title: 'Less Than', value: '<' },
  { title: 'Greater or Equal', value: '>=' },
  { title: 'Less or Equal', value: '<=' },
  { title: 'Not Equal', value: '!=' }
]

const deviceProperties = [
  { title: 'Uptime', value: 'uptime' },
  { title: 'Client Count', value: 'clients' },
  { title: 'CPU Usage', value: 'cpu' },
  { title: 'Memory Usage', value: 'memory' },
  { title: 'Temperature', value: 'temperature' }
]

const httpMethods = [
  { title: 'GET', value: 'GET' },
  { title: 'POST', value: 'POST' },
  { title: 'PUT', value: 'PUT' },
  { title: 'PATCH', value: 'PATCH' },
  { title: 'DELETE', value: 'DELETE' }
]

const timezones = [
  { title: 'UTC', value: 'UTC' },
  { title: 'America/New_York', value: 'America/New_York' },
  { title: 'America/Chicago', value: 'America/Chicago' },
  { title: 'America/Denver', value: 'America/Denver' },
  { title: 'America/Los_Angeles', value: 'America/Los_Angeles' },
  { title: 'Europe/London', value: 'Europe/London' },
  { title: 'Europe/Paris', value: 'Europe/Paris' }
]

const daysOfWeek = [
  { title: 'Monday', value: 'monday' },
  { title: 'Tuesday', value: 'tuesday' },
  { title: 'Wednesday', value: 'wednesday' },
  { title: 'Thursday', value: 'thursday' },
  { title: 'Friday', value: 'friday' },
  { title: 'Saturday', value: 'saturday' },
  { title: 'Sunday', value: 'sunday' }
]

const availableUsers = [
  { title: 'Admin User', value: 'admin' },
  { title: 'Network Manager', value: 'netmgr' },
  { title: 'Operations Team', value: 'ops' }
]

// Validation rules
const rules = {
  required: value => !!value || 'This field is required',
  number: value => !isNaN(value) || 'Must be a valid number',
  url: value => {
    try {
      new URL(value)
      return true
    } catch {
      return 'Must be a valid URL'
    }
  }
}

// Methods
const initializeConfig = () => {
  if (!props.node) return
  
  const nodeData = props.node.data || {}
  
  nodeConfig.value = {
    label: nodeData.label || '',
    description: nodeData.description || '',
    enabled: nodeData.enabled !== false,
    config: nodeData.config || {},
    ...nodeData
  }
  
  // Ensure config object exists
  if (!nodeConfig.value.config) {
    nodeConfig.value.config = {}
  }
}

const onTriggerTypeChange = () => {
  nodeConfig.value.config = {}
}

const onConditionTypeChange = () => {
  nodeConfig.value.config = {}
}

const onActionTypeChange = () => {
  nodeConfig.value.config = {
    retryAttempts: 1
  }
}

const onNotificationTypeChange = () => {
  nodeConfig.value.config = {}
}

const handleSave = async () => {
  if (!form.value?.validate()) return
  
  saving.value = true
  
  try {
    const updatedNode = {
      ...props.node,
      data: {
        ...props.node.data,
        ...nodeConfig.value
      }
    }
    
    emit('save', updatedNode)
    show.value = false
    
  } catch (error) {
    console.error('Failed to save node configuration:', error)
  } finally {
    saving.value = false
  }
}

const handleCancel = () => {
  show.value = false
  initializeConfig() // Reset to original values
}

const testConfiguration = () => {
  emit('test', {
    node: props.node,
    config: nodeConfig.value
  })
}

// Watchers
watch(() => props.node, () => {
  if (props.node) {
    initializeConfig()
  }
}, { immediate: true, deep: true })

watch(() => props.modelValue, async (newValue) => {
  if (newValue && props.node) {
    await nextTick()
    initializeConfig()
  }
})
</script>

<style scoped>
.v-dialog > .v-card {
  overflow-y: auto;
}
</style>