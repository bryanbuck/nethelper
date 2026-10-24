/**
 * Network Map VLAN overlay: how a selected VLAN shows on each edge and node.
 * The server computes per-edge `vlans` ({ carried, pruned, native, known })
 * and the per-VLAN list (`graph.vlans`: devices, routedOn, islands); this
 * turns them into display states. `edgeVlanStatus` mirrors the backend's
 * `edgeStatus` (services/topology/vlan-analysis.js; parity-tested).
 */

/** Does a node's device carry `vlan`? true | false | null (no VLAN data). */
export function nodeHasVlan(node, vlan) {
  const ids = node?.data?.vlans?.ids
  if (!node?.data?.vlans?.source || !Array.isArray(ids)) return null
  return ids.includes(vlan)
}

/** carried | pruned | absent | unknown */
export function edgeVlanStatus(edge, vlan, nodesById) {
  const v = edge?.vlans
  if (!v) return 'unknown'
  if (v.carried.includes(vlan)) return 'carried'
  if (v.pruned.some((p) => p.vlan === vlan)) return 'pruned'
  const ends = [edge.source, edge.target]
  if (ends.some((id) => nodeHasVlan(nodesById.get(id), vlan) === false)) return 'absent'
  if (ends.every((id) => v.known?.[id])) return 'absent'
  return 'unknown'
}

/** The link's problems regardless of VLAN: pruned VLANs and a native mismatch. */
export function edgeMismatch(edge) {
  const v = edge?.vlans
  if (!v || (!v.pruned.length && !v.native)) return null
  return { pruned: v.pruned, native: v.native }
}

/**
 * Per-node role for the selected VLAN: routes | island | carries | absent | unknown.
 * @returns {Map<string, string>}
 */
export function vlanNodeRoles(entry, nodes) {
  const roles = new Map()
  if (!entry) return roles
  const routed = new Set(entry.routedOn)
  const island = new Set(entry.islands.flat())
  const carries = new Set(entry.devices)
  for (const node of nodes) {
    if (routed.has(node.id)) roles.set(node.id, 'routes')
    else if (island.has(node.id)) roles.set(node.id, 'island')
    else if (carries.has(node.id)) roles.set(node.id, 'carries')
    else roles.set(node.id, nodeHasVlan(node, entry.id) === false ? 'absent' : 'unknown')
  }
  return roles
}

export function vlanTitle(entry) {
  if (!entry) return ''
  return entry.names.length ? `${entry.id} · ${entry.names.join(' / ')}` : `VLAN ${entry.id}`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One-line summary for the legend. */
export function vlanSummaryText(entry) {
  if (!entry) return ''
  const parts = [`Carried by ${plural(entry.devices.length, 'device')}`]
  parts.push(entry.routedOn.length ? `routed on ${plural(entry.routedOn.length, 'device')}` : 'not routed on any device we read')
  const cut = entry.islands.reduce((n, group) => n + group.length, 0)
  if (cut) parts.push(`${plural(cut, 'device')} with no L2 path to a gateway`)
  return parts.join(', ')
}

/** Text for one end's untagged VLAN in a native mismatch. */
export const nativeText = (value) => (value === null ? 'none (all tagged)' : `VLAN ${value}`)

/** Human list of VLAN ids, collapsing runs: [1,2,3,10] -> "1-3, 10". */
export function vlanRangeText(ids) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]))
    i = j
  }
  return out.join(', ')
}
