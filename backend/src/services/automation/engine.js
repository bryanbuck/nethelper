/**
 * Runs an automation's builder graph (Automation.elements) once, for one
 * device or none, from its trigger.
 *
 * Nodes run in topological order. A node runs when one of its incoming
 * connections was taken: a condition takes its 'true' or 'false' outputs, a
 * failed node takes none (its branch stops) unless config.continueOnError,
 * and a disabled node passes straight through. Nodes that never run are
 * reported as skipped. context.shouldStop(), when given, is checked before
 * each step; once it returns true the rest are reported as cancelled.
 */

const { parseGraph, nodeKey, subtypeOf, isEnabled, nodeLabel } = require('./graph');
const { NODES } = require('./nodes');

/**
 * Check a graph can run. Returns { graph, errors, triggerType, needsDevice }.
 * Disabled nodes are not checked: they pass through without running.
 */
function validate(elements) {
  const graph = parseGraph(elements);
  const errors = [...graph.errors];
  const triggerType = graph.trigger ? subtypeOf(graph.trigger) : null;
  let needsDevice = false;

  for (const node of graph.nodes.filter(isEnabled)) {
    const label = nodeLabel(node);
    if (!subtypeOf(node)) {
      errors.push(`"${label}" has no ${node.type} type chosen`);
      continue;
    }
    const def = NODES[nodeKey(node)];
    if (!def) {
      errors.push(`"${label}" (${node.type} ${subtypeOf(node)}) can't run yet`);
      continue;
    }
    if (def.needsAlert && triggerType !== 'alert') errors.push(`"${label}" needs an Alert trigger`);
    if (def.needsDevice) needsDevice = true;
    for (const message of def.validate(node.data.config || {})) errors.push(`"${label}": ${message}`);
  }
  return { graph, errors, triggerType, needsDevice };
}

function outgoing(graph, node) {
  return graph.edges.filter((e) => e.source === node.id);
}

/**
 * @param {{ id, name, elements }} automation
 * @param {{ device?, alert?, executionId?, shouldStop?: () => Promise<boolean> }} context
 * @returns {Promise<{ status: 'success'|'failed'|'cancelled', results: Array }>}
 */
async function run(automation, context = {}) {
  const { graph, errors } = validate(automation.elements);
  if (errors.length) throw new Error(`The workflow can't run: ${errors.join('; ')}`);

  const ctx = { ...context, automation: { id: automation.id, name: automation.name } };
  const taken = new Set(); // edge ids whose target may run
  const results = [];
  let failed = false;
  let cancelled = false;

  for (const node of graph.order) {
    const base = { nodeId: node.id, label: nodeLabel(node), type: nodeKey(node) };
    const reached = node === graph.trigger || graph.edges.some((e) => e.target === node.id && taken.has(e));
    if (!reached) {
      results.push({ ...base, status: 'skipped' });
      continue;
    }
    if (!cancelled && node !== graph.trigger && ctx.shouldStop) cancelled = await ctx.shouldStop();
    if (cancelled) {
      results.push({ ...base, status: 'cancelled' });
      continue;
    }
    const out = outgoing(graph, node);
    if (!isEnabled(node)) {
      out.forEach((e) => taken.add(e));
      results.push({ ...base, status: 'disabled' });
      continue;
    }

    const def = NODES[nodeKey(node)];
    const config = node.data.config || {};
    try {
      if (def.needsDevice && !ctx.device) throw new Error('This step needs a device, and the run has none');
      const result = await def.run(ctx, config);
      if (node.type === 'condition') {
        const branch = result ? 'true' : 'false';
        // An unlabelled connection out of a condition counts as its 'true' output.
        out.filter((e) => (e.sourceHandle || 'true') === branch).forEach((e) => taken.add(e));
        results.push({ ...base, status: 'ok', result: branch });
      } else {
        out.forEach((e) => taken.add(e));
        results.push({ ...base, status: 'ok', result });
      }
    } catch (error) {
      failed = true;
      results.push({ ...base, status: 'failed', error: error.message });
      if (config.continueOnError) out.forEach((e) => taken.add(e));
    }
  }

  return { status: cancelled ? 'cancelled' : failed ? 'failed' : 'success', results };
}

module.exports = { validate, run };
