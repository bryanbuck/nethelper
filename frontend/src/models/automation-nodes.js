// Automation builder nodes the backend engine can run
// (backend/src/services/automation/nodes.js; tests/unit/automation-nodes-parity.spec.js
// keeps the two in sync). Every other node in the palette is shown as
// "not runnable yet", and the backend refuses to run or activate a workflow
// that uses one.

export const RUNNABLE_NODES = new Set([
  'trigger:manual',
  'trigger:alert',
  'trigger:config-change',
  'trigger:schedule',
  'condition:device-property',
  'condition:alert-severity',
  'condition:time-window',
  'action:create-backup',
  'action:raise-alert',
  'action:clear-alert',
  'action:acknowledge-alert',
  'action:run-discovery',
  'action:http-request',
  'notification:channel',
  'notification:email'
])

export const isRunnable = (kind, subtype) => RUNNABLE_NODES.has(`${kind}:${subtype}`)

// Device fields a Device Property condition can test (backend DEVICE_PROPERTIES)
export const DEVICE_PROPERTY_OPTIONS = [
  { title: 'Status (ping, else cloud)', value: 'status' },
  { title: 'Cloud status', value: 'cloudStatus' },
  { title: 'Device type', value: 'type' },
  { title: 'Vendor', value: 'vendor' },
  { title: 'Platform', value: 'platform' },
  { title: 'Management mode', value: 'managementMode' },
  { title: 'Model', value: 'model' },
  { title: 'Name', value: 'name' }
]

export const DEVICE_PROPERTY_OPERATORS = [
  { title: 'Equals', value: '=' },
  { title: 'Not equal', value: '!=' },
  { title: 'Contains', value: 'contains' }
]

export const ALERT_SEVERITY_OPERATORS = [
  { title: 'At least', value: '>=' },
  { title: 'Exactly', value: '=' },
  { title: 'At most', value: '<=' }
]

export const ALERT_TRIGGER_EVENTS = [
  { title: 'An alert opens', value: 'opened' },
  { title: 'An alert resolves', value: 'resolved' }
]

// ConfigBackupArtifact kinds a Configuration Change trigger can be limited to
export const CONFIG_CHANGE_KINDS = [
  { title: 'CLI config', value: 'cli' },
  { title: 'Structured (JSON)', value: 'structured' }
]

// Placeholders the templated fields accept (backend render()): any stored
// device field, the triggering alert, what changed, and a link to it in NetHelper
export const TEMPLATE_HINT = '{{device.name}}, {{device.ipAddress}}, {{alert.title}}, {{alert.severity}}, {{change.kinds}}, {{automation.name}}, {{link}}'

export const HTTP_METHODS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE']
export const HTTP_MAX_HEADERS = 10

// Time Window days (backend DAYS)
export const WEEKDAYS = [
  { title: 'Monday', value: 'monday' },
  { title: 'Tuesday', value: 'tuesday' },
  { title: 'Wednesday', value: 'wednesday' },
  { title: 'Thursday', value: 'thursday' },
  { title: 'Friday', value: 'friday' },
  { title: 'Saturday', value: 'saturday' },
  { title: 'Sunday', value: 'sunday' }
]

export const NOTIFICATION_CHANNEL_TYPES = { email: 'Email', webhook: 'Webhook' }
