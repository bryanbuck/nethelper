// Display of a Live tab port row's `vlan`, as the backend's
// services/device-api/cx-live.js builds it from the switch:
//   { mode: 'access', untagged }
//   { mode: 'trunk', native, nativeTagged, allowed: [ids], allAllowed }
//   { mode: 'routed' }
// plus `lag` on a LAG's member ports (they carry the LAG's VLANs; a LAG with
// nothing to say has mode null). null: the switch reported no VLAN data.

const MODE_LABELS = { access: 'Access', trunk: 'Trunk', routed: 'Routed' }

/** "1, 10-20, 110" from a list of VLAN ids (ranges of 3 or more collapse). */
export function compressVlans (ids = []) {
  const sorted = [...new Set(ids)].filter(Number.isInteger).sort((a, b) => a - b)
  const parts = []
  for (let i = 0; i < sorted.length;) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1
    if (j - i >= 2) parts.push(`${sorted[i]}-${sorted[j]}`)
    else for (let k = i; k <= j; k += 1) parts.push(String(sorted[k]))
    i = j + 1
  }
  return parts.join(', ')
}

export function vlanModeLabel (vlan) {
  return MODE_LABELS[vlan?.mode] || ''
}

/** The VLAN cell, one string per line: "110", or "Native: 1" + "Allowed: 10-20". */
export function vlanLines (vlan) {
  if (vlan?.mode === 'access') return vlan.untagged ? [String(vlan.untagged)] : []
  if (vlan?.mode !== 'trunk') return []
  const lines = []
  if (vlan.native) lines.push(`Native: ${vlan.native}${vlan.nativeTagged ? ' (tagged)' : ''}`)
  lines.push(`Allowed: ${vlan.allAllowed ? 'all' : compressVlans(vlan.allowed) || 'none'}`)
  return lines
}

/** One line for the phone layout: "Trunk · Native 1 · Allowed 10-20 · lag1". */
export function vlanSummary (vlan) {
  if (!vlan) return ''
  const parts = [vlanModeLabel(vlan)]
  if (vlan.mode === 'access' && vlan.untagged) parts[0] = `Access ${vlan.untagged}`
  if (vlan.mode === 'trunk') parts.push(...vlanLines(vlan).map((line) => line.replace(': ', ' ')))
  if (vlan.lag) parts.push(vlan.lag)
  return parts.filter(Boolean).join(' · ')
}
