/**
 * Network Map VXLAN overlay: display states for tunnels and VTEPs. The server
 * computes the tunnels (`graph.vxlan.tunnels`, each with a per-VNI
 * `vniStatus`), the per-VNI list (`graph.vxlan.vnis`) and the peers no device
 * matched (`graph.vxlan.unresolved`) in services/topology/vxlan-analysis.js;
 * this only reads them. `TunnelStatusInfo` covers the backend's
 * TUNNEL_STATUSES (parity-tested).
 */

export const TunnelStatusInfo = {
  carried: { label: 'carried', text: 'both VTEPs flood it to each other', color: 'primary' },
  'one-sided': { label: 'one side only', text: 'only one VTEP floods it to the other', color: 'warning' },
  down: { label: 'down', text: 'a VTEP reports this peer not operational', color: 'error' },
  unknown: { label: 'far end not read', text: 'the far VTEP was not read, so only one side is known', color: undefined }
}

/**
 * How a tunnel shows for the selected VNI (null: every tunnel, by its overall
 * status). null when the tunnel doesn't carry that VNI.
 */
export function tunnelStatusFor(tunnel, vni) {
  if (vni === null || vni === undefined) return tunnel?.status || null
  return tunnel?.vniStatus?.[vni] || null
}

/** Tunnels to draw: all of them, or those that carry `vni`. */
export function visibleTunnels(tunnels, vni) {
  return (tunnels || []).filter((t) => tunnelStatusFor(t, vni) !== null)
}

/**
 * Per-node role while the VXLAN overlay is on: vtep | isolated | unknown | absent.
 * `unknown` is a device whose VXLAN read failed; `absent` has no VXLAN (or not
 * this VNI).
 * @returns {Map<string, string>}
 */
export function vxlanNodeRoles(vniEntry, nodes) {
  const roles = new Map()
  const isolated = new Set(vniEntry?.isolated || [])
  const vteps = vniEntry ? new Set(vniEntry.vteps.map((v) => v.node)) : null
  for (const node of nodes) {
    const summary = node.data?.vxlan
    let role
    if (summary?.error && !summary.source) role = 'unknown'
    else if (vteps ? !vteps.has(node.id) : !summary?.sourceIps?.length) role = 'absent'
    else role = isolated.has(node.id) ? 'isolated' : 'vtep'
    roles.set(node.id, role)
  }
  return roles
}

/** "VNI 110 · VLAN 110", "VNI 5000 · VLANs 10/20", "VNI 10000 · VRF tenant". */
export function vniTitle(entry) {
  if (!entry) return ''
  if (entry.kind === 'l3') {
    const vrfs = [...new Set(entry.vteps.map((v) => v.vrf).filter(Boolean))]
    return `VNI ${entry.vni}${vrfs.length ? ` · VRF ${vrfs.join(' / ')}` : ''}`
  }
  const vlans = [...new Set(entry.vteps.map((v) => v.vlan).filter((v) => v !== null))].sort((a, b) => a - b)
  if (!vlans.length) return `VNI ${entry.vni}`
  return `VNI ${entry.vni} · VLAN${vlans.length > 1 ? 's' : ''} ${vlans.join('/')}`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One-line summary for the legend. */
export function vniSummaryText(entry) {
  if (!entry) return ''
  const parts = [`On ${plural(entry.vteps.length, 'VTEP')}`, plural(entry.tunnels.length, 'tunnel')]
  if (entry.isolated.length) parts.push(`${plural(entry.isolated.length, 'VTEP')} with no peer for it`)
  if (entry.unresolved.length) parts.push(`${plural(entry.unresolved.length, 'peer')} matching no device`)
  return parts.join(', ')
}

/** Fleet summary for the legend when no VNI is picked. */
export function fabricSummaryText(vxlan) {
  const tunnels = vxlan?.tunnels || []
  if (!tunnels.length && !vxlan?.unresolved?.length) return 'No VXLAN tunnels on this map.'
  const parts = [plural(tunnels.length, 'tunnel'), plural(vxlan.vnis.length, 'VNI')]
  const bad = tunnels.filter((t) => t.status === 'down' || t.status === 'one-sided').length
  if (bad) parts.push(`${bad} with a problem`)
  if (vxlan.unresolved.length) parts.push(`${plural(vxlan.unresolved.length, 'peer')} matching no device`)
  return parts.join(', ')
}

/** Short edge label: "VNI 110" or "3 VNIs". */
export function tunnelLabel(tunnel, vni) {
  if (vni !== null && vni !== undefined) return `VNI ${vni}`
  return tunnel.vnis.length === 1 ? `VNI ${tunnel.vnis[0]}` : plural(tunnel.vnis.length, 'VNI')
}

/** A node's VXLAN line for the details panel. */
export function nodeVxlanText(summary) {
  if (!summary) return 'No VXLAN read (AOS-CX REST only, for now)'
  if (!summary.source) return 'No VXLAN data'
  const ips = summary.sourceIps.length ? `VTEP ${summary.sourceIps.join(', ')}` : 'VXLAN interface without a source address'
  return `${ips} · ${plural(summary.peerCount, 'peer')}`
}

/** "110 → VLAN 110", "10000 → VRF tenant". */
export const vniMapText = (v) => `${v.vni} → ${v.kind === 'l3' ? `VRF ${v.vrf || '?'}` : v.vlan !== null ? `VLAN ${v.vlan}` : 'no VLAN'}`
