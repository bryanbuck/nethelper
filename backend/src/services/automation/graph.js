/**
 * The automation builder's saved graph (Automation.elements): vue-flow nodes
 * and edges in one array.
 *
 * A node is { id, type: 'trigger'|'condition'|'action'|'notification',
 * data: { label, enabled, <type>Type: <subtype>, config } }. An edge is
 * anything with source and target; edges out of a condition carry
 * sourceHandle 'true' or 'false'.
 */

const KINDS = ['trigger', 'condition', 'action', 'notification'];

function subtypeOf(node) {
  return node.data?.[`${node.type}Type`] || null;
}

/** Registry key of a node, e.g. 'action:raise-alert'. */
function nodeKey(node) {
  return `${node.type}:${subtypeOf(node)}`;
}

function isEnabled(node) {
  return node.data?.enabled !== false;
}

function nodeLabel(node) {
  return node.data?.label || nodeKey(node);
}

/**
 * Split and check the graph. Returns { nodes, edges, trigger, order, errors }.
 * order is a topological order of every node (empty when there is a cycle).
 */
function parseGraph(elements) {
  const errors = [];
  if (!Array.isArray(elements)) {
    return { nodes: [], edges: [], trigger: null, order: [], errors: ['The automation has no workflow'] };
  }
  const edges = elements.filter((el) => el && el.source && el.target);
  const nodes = elements.filter((el) => el && !(el.source && el.target) && KINDS.includes(el.type));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) errors.push('The workflow needs a trigger');
  if (triggers.length > 1) errors.push('The workflow can have only one trigger');

  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) {
      errors.push(`A connection points at a node that no longer exists (${edge.source} → ${edge.target})`);
    }
  }

  // Kahn's algorithm: a cycle leaves nodes with unresolved inputs.
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) {
    if (indegree.has(edge.target) && byId.has(edge.source)) indegree.set(edge.target, indegree.get(edge.target) + 1);
  }
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(byId.get(id));
    for (const edge of edges.filter((e) => e.source === id && indegree.has(e.target))) {
      indegree.set(edge.target, indegree.get(edge.target) - 1);
      if (indegree.get(edge.target) === 0) queue.push(edge.target);
    }
  }
  if (order.length !== nodes.length) errors.push('The workflow has a loop; connections must flow one way');

  return {
    nodes,
    edges,
    trigger: triggers.length === 1 ? triggers[0] : null,
    order: order.length === nodes.length ? order : [],
    errors,
  };
}

module.exports = { parseGraph, nodeKey, subtypeOf, isEnabled, nodeLabel };
