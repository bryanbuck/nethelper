// Automation builder nodes the backend engine can run
// (backend/src/services/automation/nodes.js; tests/unit/automation-nodes-parity.spec.js
// keeps the two in sync). Every other node in the palette is shown as
// "not runnable yet", and the backend refuses to run or activate a workflow
// that uses one.

export const RUNNABLE_NODES = new Set([
  'trigger:manual',
  'trigger:alert',
  'trigger:schedule',
  'condition:device-property',
  'condition:alert-severity',
  'action:create-backup',
  'action:raise-alert',
  'action:clear-alert',
  'action:acknowledge-alert'
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

// Placeholders the Raise alert title/message accept
export const TEMPLATE_HINT = '{{device.name}}, {{alert.title}}, {{alert.severity}}, {{automation.name}}'
