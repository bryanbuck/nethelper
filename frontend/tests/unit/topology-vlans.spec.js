// The Network Map's VLAN overlay: the frontend's edge status must agree with
// the backend's (services/topology/vlan-analysis.js) on the same graph.
import { createRequire } from 'node:module'
import {
  edgeVlanStatus, edgeMismatch, vlanNodeRoles, vlanRangeText, vlanTitle, vlanSummaryText
} from '@/models/topology-vlans'

const require = createRequire(import.meta.url)
const { buildGraph } = require('../../../backend/src/services/topology/graph.js')
const { edgeStatus } = require('../../../backend/src/services/topology/vlan-analysis.js')
const { makeVlanSnapshot } = require('../../../backend/src/services/topology/vlan-membership.js')

const vl = (...ids) => ids.map((id) => ({ id, name: `v${id}` }))
const trunk = (port, untagged, tagged, extra = {}) => ({ port, mode: 'trunk', untagged, tagged, ...extra })
const mac = (n) => `aa:00:00:00:00:0${n}`

// core —(1/1/1 ↔ 1/1/49)— sw1 —(1/1/1 ↔ 1/1/50)— sw2, and sw1 → an unmanaged phone.
const devices = [
  { id: 'core', name: 'core', type: 'switch', macAddress: mac(1) },
  { id: 'sw1', name: 'sw1', type: 'switch', macAddress: mac(2) },
  { id: 'sw2', name: 'sw2', type: 'switch', macAddress: mac(3) },
  { id: 'sw3', name: 'sw3', type: 'switch', macAddress: mac(4) }
]
const link = (deviceId, localPort, n, remotePortId) => ({
  deviceId, localPort, remoteChassisId: mac(n), remoteMac: mac(n), remotePortId, source: 'lldp'
})
const links = [
  link('core', '1/1/1', 2, '1/1/49'),
  link('sw1', '1/1/1', 3, '1/1/50'),
  link('sw1', '1/1/2', 4, '1/1/1'),
  { deviceId: 'sw1', localPort: '1/1/3', remoteChassisId: '04:2a:e2:00:00:01', remoteMac: '04:2a:e2:00:00:01', remotePortId: 'P1', source: 'lldp' }
]
const snapshots = {
  core: makeVlanSnapshot({ vlans: vl(1, 10, 20), ports: [trunk('1/1/1', 1, [10, 20])], routed: [{ vlan: 10 }, { vlan: 20 }] }),
  sw1: makeVlanSnapshot({ vlans: vl(1, 10, 20, 30), ports: [trunk('1/1/49', 1, [10, 20]), trunk('1/1/1', 1, [10]), trunk('1/1/3', 1, [20])] }),
  sw2: makeVlanSnapshot({ vlans: vl(1, 10, 20), ports: [trunk('1/1/50', 10, [], { allTagged: true })] })
}
const states = Object.entries(snapshots).map(([deviceId, vlans]) => ({ deviceId, status: 'ok', vlans, vlanSource: 'AOS-CX REST' }))
const graph = buildGraph({ devices, links, states })
const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))
const backendSnapshots = new Map(states.map((s) => [`device:${s.deviceId}`, s.vlans]))

describe('edgeVlanStatus mirrors the backend', () => {
  test('every edge × VLAN', () => {
    expect(graph.edges.length).toBe(4)
    for (const edge of graph.edges) {
      for (const vlan of [1, 10, 20, 30, 99]) {
        expect([edge.id, vlan, edgeVlanStatus(edge, vlan, nodesById)])
          .toEqual([edge.id, vlan, edgeStatus(edge, vlan, backendSnapshots)])
      }
    }
  })

  test('the cases it is for', () => {
    const between = (a, b) => graph.edges.find((e) => [e.source, e.target].sort().join() === [`device:${a}`, `device:${b}`].sort().join())
    expect(edgeVlanStatus(between('core', 'sw1'), 20, nodesById)).toBe('carried')
    expect(edgeVlanStatus(between('sw1', 'sw2'), 20, nodesById)).toBe('pruned')
    expect(edgeVlanStatus(between('sw1', 'sw2'), 30, nodesById)).toBe('absent')
    expect(edgeVlanStatus(between('sw1', 'sw3'), 10, nodesById)).toBe('unknown')
    expect(edgeMismatch(between('sw1', 'sw2'))).toMatchObject({ pruned: [{ vlan: 20, side: 'device:sw1' }], native: { 'device:sw1': 1, 'device:sw2': 10 } })
    expect(edgeMismatch(between('core', 'sw1'))).toBeNull()
  })
})

describe('VLAN summary', () => {
  const v20 = graph.vlans.find((v) => v.id === 20)

  test('sw2 is cut off from VLAN 20\'s gateway', () => {
    expect(v20.islands).toEqual([['device:sw2']])
    const roles = vlanNodeRoles(v20, graph.nodes)
    expect(roles.get('device:core')).toBe('routes')
    expect(roles.get('device:sw1')).toBe('carries')
    expect(roles.get('device:sw2')).toBe('island')
    expect(roles.get('device:sw3')).toBe('unknown')
    expect(vlanSummaryText(v20)).toBe('Carried by 3 devices, routed on 1 device, 1 device with no L2 path to a gateway')
    expect(vlanTitle(v20)).toBe('20 · v20')
  })

  test('vlanRangeText collapses runs', () => {
    expect(vlanRangeText([10, 1, 2, 3, 5, 6])).toBe('1-3, 5-6, 10')
    expect(vlanRangeText([])).toBe('')
  })
})
