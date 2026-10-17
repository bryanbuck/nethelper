// The builder marks nodes runnable from models/automation-nodes.js; the
// backend engine's registry is the truth. A node added on one side only fails here.
import { createRequire } from 'node:module'
import Module from 'node:module'
import { RUNNABLE_NODES, DEVICE_PROPERTY_OPTIONS } from '@/models/automation-nodes'
import { ALERT_RULE_LABELS } from '@/models/alerts'

const require = createRequire(import.meta.url)

// nodes.js requires the database and alert service at load; neither is used here.
const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request.endsWith('config/database')) return { getPrisma: () => ({}) }
  if (request.endsWith('alert.service')) return {}
  return originalLoad.call(this, request, ...rest)
}
const backend = require('../../../backend/src/services/automation/nodes.js')
const { ALERT_RULES } = require('../../../backend/src/constants/alert-rules.js')
Module._load = originalLoad

const sorted = (values) => [...values].sort()

describe('models/automation-nodes mirrors the backend engine', () => {
  test('runnable node keys', () => {
    expect(sorted(RUNNABLE_NODES)).toEqual(sorted(Object.keys(backend.NODES)))
  })

  test('device properties', () => {
    expect(sorted(DEVICE_PROPERTY_OPTIONS.map((p) => p.value))).toEqual(sorted(Object.keys(backend.DEVICE_PROPERTIES)))
  })

  test('alert rule labels cover every backend rule', () => {
    expect(sorted(Object.keys(ALERT_RULE_LABELS))).toEqual(sorted(Object.keys(ALERT_RULES)))
  })
})
