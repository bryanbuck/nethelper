// The Network Map's VXLAN overlay: the frontend reads the tunnel statuses the
// backend computes (services/topology/vxlan-analysis.js), so it must know
// every one of them; the rest are display helpers over the same graph.
import { createRequire } from 'node:module'
import {
  TunnelStatusInfo, tunnelStatusFor, visibleTunnels, vxlanNodeRoles, vniTitle, vniSummaryText,
  fabricSummaryText, tunnelLabel, nodeVxlanText, vniMapText
} from '@/models/topology-vxlan'

const require = createRequire(import.meta.url)
const { buildGraph } = require('../../../backend/src/services/topology/graph.js')
const { TUNNEL_STATUSES } = require('../../../backend/src/services/topology/vxlan-analysis.js')
const { makeVxlanSnapshot } = require('../../../backend/src/services/topology/vxlan-membership.js')
const { parseCxVxlan } = require('../../../backend/src/services/topology/parsers/aos-cx-vxlan.js')

const vtep = (ip, vnis, peers = []) => makeVxlanSnapshot({
  vteps: [{ iface: 'vxlan1', sourceIp: ip }],
  vnis: Object.entries(vnis).map(([vni, vlan]) => ({ vni: Number(vni), vlan, state: 'operational' })),
  peers: peers.map((p) => ({ iface: 'vxlan1', origin: 'static', state: 'operational', ...p }))
})

// The live lab pair (e0 ↔ e1, VNI 110), plus e2 flooding 120 to e0 one-sidedly
// and peering with an address no device has, and sw with no VXLAN at all.
const devices = ['e0', 'e1', 'e2', 'sw'].map((id) => ({ id, name: id, type: 'switch', ipAddress: `172.16.0.${id.length}${id.charCodeAt(1) % 10}` }))
const states = [
  { deviceId: 'e0', vxlan: parseCxVxlan(require('../../../backend/tests/fixtures/aos-cx-live/vxlan-edge0.json')), vxlanSource: 'AOS-CX REST' },
  { deviceId: 'e1', vxlan: parseCxVxlan(require('../../../backend/tests/fixtures/aos-cx-live/vxlan-edge1.json')), vxlanSource: 'AOS-CX REST' },
  {
    deviceId: 'e2',
    vxlan: vtep('10.15.20.30', { 120: 120, 130: 130 }, [{ remoteIp: '10.15.20.20', vnis: [120] }, { remoteIp: '10.99.0.1', vnis: [130] }]),
    vxlanSource: 'AOS-CX REST'
  }
]
const graph = buildGraph({ devices, links: [], states })

describe('tunnel statuses mirror the backend', () => {
  test('every backend status has display info', () => {
    expect(Object.keys(TunnelStatusInfo).sort()).toEqual([...TUNNEL_STATUSES].sort())
  })

  test('the frontend reads each tunnel × VNI as the backend computed it', () => {
    expect(graph.vxlan.tunnels).toHaveLength(2)
    for (const t of graph.vxlan.tunnels) {
      for (const vni of t.vnis) expect(tunnelStatusFor(t, vni)).toBe(t.vniStatus[vni])
      expect(tunnelStatusFor(t, null)).toBe(t.status)
      expect(tunnelStatusFor(t, 999)).toBeNull()
    }
  })
})

describe('display helpers', () => {
  const live = graph.vxlan.tunnels.find((t) => t.target === 'device:e1')
  const oneSided = graph.vxlan.tunnels.find((t) => t.source === 'device:e0' && t.target === 'device:e2')
  const vni = (n) => graph.vxlan.vnis.find((v) => v.vni === n)

  test('the live tunnel carries VNI 110; the other is one-sided', () => {
    expect(live.status).toBe('carried')
    expect(oneSided.vniStatus).toEqual({ 120: 'one-sided' })
  })

  test('visibleTunnels filters by VNI', () => {
    expect(visibleTunnels(graph.vxlan.tunnels, null)).toHaveLength(2)
    expect(visibleTunnels(graph.vxlan.tunnels, 110)).toEqual([live])
    expect(visibleTunnels(graph.vxlan.tunnels, 5)).toEqual([])
  })

  test('node roles: VTEPs, an isolated VTEP, and devices without it', () => {
    const all = vxlanNodeRoles(null, graph.nodes)
    expect(all.get('device:e0')).toBe('vtep')
    expect(all.get('device:sw')).toBe('absent')
    const v120 = vxlanNodeRoles(vni(120), graph.nodes)
    expect(v120.get('device:e2')).toBe('vtep')
    expect(v120.get('device:e1')).toBe('absent')
    // e2's VNI 130 peer matches no device: unresolved, not isolated.
    expect(vni(130)).toMatchObject({ isolated: [], unresolved: [{ node: 'device:e2', remoteIp: '10.99.0.1' }] })
  })

  test('a device whose VXLAN read failed is unknown, not absent', () => {
    const roles = vxlanNodeRoles(null, [{ id: 'x', data: { vxlan: { error: 'HTTP 404', source: null, sourceIps: [] } } }])
    expect(roles.get('x')).toBe('unknown')
  })

  test('texts', () => {
    expect(vniTitle(vni(110))).toBe('VNI 110 · VLAN 110')
    expect(vniTitle({ vni: 10000, kind: 'l3', vteps: [{ vrf: 'tenant' }] })).toBe('VNI 10000 · VRF tenant')
    expect(vniTitle({ vni: 5000, kind: 'l2', vteps: [{ vlan: 20 }, { vlan: 10 }] })).toBe('VNI 5000 · VLANs 10/20')
    expect(vniSummaryText(vni(110))).toBe('On 2 VTEPs, 1 tunnel')
    expect(vniSummaryText(vni(130))).toBe('On 1 VTEP, 0 tunnels, 1 peer matching no device')
    expect(fabricSummaryText(graph.vxlan)).toBe('2 tunnels, 3 VNIs, 1 with a problem, 1 peer matching no device')
    expect(fabricSummaryText({ tunnels: [], vnis: [], unresolved: [] })).toBe('No VXLAN tunnels on this map.')
    expect(tunnelLabel(live, null)).toBe('VNI 110')
    expect(tunnelLabel({ vnis: [1, 2, 3] }, null)).toBe('3 VNIs')
    const e0 = graph.nodes.find((n) => n.id === 'device:e0').data.vxlan
    expect(nodeVxlanText(e0)).toBe('VTEP 10.15.20.20 · 1 peer') // e2 → e0 is one-sided
    expect(nodeVxlanText(null)).toMatch(/AOS-CX REST only/)
    expect(vniMapText({ vni: 110, kind: 'l2', vlan: 110 })).toBe('110 → VLAN 110')
  })
})
