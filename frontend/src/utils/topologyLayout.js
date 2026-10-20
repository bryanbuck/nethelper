import { getLayoutedElements } from './layoutUtils'

// Rendered sizes of the map's node components, used for layout spacing.
export const NODE_SIZE = {
  device: { width: 220, height: 76 },
  ghost: { width: 200, height: 64 },
  subnet: { width: 200, height: 64 }
}

const GRID_GAP_X = 40
const GRID_GAP_Y = 50
const GRID_COLUMNS = 6

const sizeOf = (node) => NODE_SIZE[node.kind] || NODE_SIZE.device

/**
 * Positions for every node: saved positions win (unless `force`), linked
 * nodes are laid out top-down by dagre (edges already point downstream), and
 * nodes without links go in a grid underneath, devices first, then
 * discovery subnet groups.
 *
 * @param {Object[]} nodes - graph nodes ({ id, kind })
 * @param {Object[]} edges - graph edges ({ source, target })
 * @param {Object} saved - { nodeId: { x, y } }
 * @param {{ force?: boolean }} options - force: ignore saved positions
 * @returns {Object} { nodeId: { x, y } }
 */
export function layoutTopology(nodes, edges, saved = {}, { force = false } = {}) {
  const linked = new Set()
  for (const e of edges) {
    linked.add(e.source)
    linked.add(e.target)
  }

  const positions = {}
  const connected = nodes.filter((n) => linked.has(n.id))
  let bottom = 0

  if (connected.length) {
    const { nodes: laid } = getLayoutedElements(
      connected.map((n) => ({ id: n.id, ...sizeOf(n) })),
      edges.filter((e) => linked.has(e.source) && linked.has(e.target)),
      'TB'
    )
    for (const n of laid) {
      positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
      bottom = Math.max(bottom, n.position.y + n.height)
    }
  }

  const isolated = nodes
    .filter((n) => !linked.has(n.id))
    .sort((a, b) => (a.kind === 'subnet') - (b.kind === 'subnet'))
  const cellWidth = NODE_SIZE.device.width + GRID_GAP_X
  const cellHeight = NODE_SIZE.device.height + GRID_GAP_Y
  const top = connected.length ? bottom + GRID_GAP_Y * 2 : 50
  isolated.forEach((n, i) => {
    positions[n.id] = {
      x: 50 + (i % GRID_COLUMNS) * cellWidth,
      y: Math.round(top + Math.floor(i / GRID_COLUMNS) * cellHeight)
    }
  })

  if (!force) {
    for (const [id, pos] of Object.entries(saved || {})) {
      if (positions[id] && Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) positions[id] = { x: pos.x, y: pos.y }
    }
  }
  return positions
}
