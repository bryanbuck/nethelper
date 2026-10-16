<template>
  <div class="topology-canvas">
    <VueFlow
      :id="flowId"
      :nodes="flowNodes"
      :edges="flowEdges"
      :node-types="nodeTypes"
      :nodes-connectable="false"
      :edges-updatable="false"
      :nodes-draggable="draggable"
      :min-zoom="0.1"
      :max-zoom="2"
      :default-edge-options="{ type: 'default' }"
      class="vue-flow-container"
      @node-click="({ node }) => emit('node-click', node)"
      @pane-click="emit('pane-click')"
      @node-drag-stop="onDragStop"
      @nodes-initialized="onInitialized"
    >
      <Background :pattern-color="canvasColors.pattern" :gap="16" />
      <Controls position="bottom-left" :show-interactive="false" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        :node-color="minimapColor"
        :mask-color="canvasColors.minimapMask"
      />
    </VueFlow>
  </div>
</template>

<script setup>
/**
 * The Network Map canvas: renders the topology graph with vue-flow. Layout
 * comes from utils/topologyLayout.js (dagre + saved positions). Nodes can be
 * dragged when `draggable`; `moved` reports every node's position after a
 * drag so the view can offer "Save layout".
 */
import { ref, computed, watch, markRaw, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { useTheme } from 'vuetify'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import DeviceNode from './nodes/DeviceNode.vue'
import GhostNode from './nodes/GhostNode.vue'
import SubnetGroupNode from './nodes/SubnetGroupNode.vue'
import { layoutTopology } from '@/utils/topologyLayout'

const props = defineProps({
  graph: { type: Object, required: true },
  savedPositions: { type: Object, default: () => ({}) },
  draggable: { type: Boolean, default: false },
  selectedId: { type: String, default: null }
})

const emit = defineEmits(['node-click', 'pane-click', 'moved'])

const flowId = 'network-map'
const { fitView, setCenter, findNode } = useVueFlow(flowId)
const theme = useTheme()

const nodeTypes = {
  device: markRaw(DeviceNode),
  ghost: markRaw(GhostNode),
  subnet: markRaw(SubnetGroupNode)
}

// vue-flow writes these into SVG attributes, where CSS variables don't resolve.
const canvasColors = computed(() => theme.current.value.dark
  ? { pattern: '#3a3f47', minimapMask: 'rgba(0, 0, 0, 0.55)', device: '#64b5f6', ghost: '#9e9e9e', subnet: '#616161' }
  : { pattern: '#e2e8f0', minimapMask: 'rgba(240, 240, 240, 0.6)', device: '#1976d2', ghost: '#bdbdbd', subnet: '#9e9e9e' })

const minimapColor = (node) => canvasColors.value[node.type] || canvasColors.value.ghost

// Positions live here so status patches (node data changes) don't reset a
// drag. They are recomputed only when the set of nodes or the saved layout
// changes, or on relayout().
const positions = ref({})
const nodeIdsKey = computed(() => props.graph.nodes.map((n) => n.id).sort().join('|'))

function computePositions(force = false) {
  positions.value = layoutTopology(props.graph.nodes, props.graph.edges, props.savedPositions, { force })
}

watch([nodeIdsKey, () => props.savedPositions], () => computePositions(), { immediate: true })

const flowNodes = computed(() => props.graph.nodes.map((n) => ({
  id: n.id,
  type: n.kind,
  position: positions.value[n.id] || { x: 0, y: 0 },
  data: n.data,
  selected: n.id === props.selectedId
})))

const flowEdges = computed(() => props.graph.edges.map((e) => {
  const toGhost = e.source.startsWith('ghost:') || e.target.startsWith('ghost:')
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: [e.sourcePort, e.targetPort].filter(Boolean).join(' ↔ '),
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
    class: { 'topo-edge-ghost': toGhost, 'topo-edge-oneway': !e.bidirectional && !toGhost },
    data: e
  }
}))

function onDragStop({ nodes }) {
  for (const n of nodes) positions.value[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
  emit('moved', { ...positions.value })
}

let fittedOnce = false
function onInitialized() {
  if (fittedOnce) return
  fittedOnce = true
  fitView({ padding: 0.15 })
}

/** Throw away positions (saved or dragged) and lay out from scratch. */
async function relayout() {
  computePositions(true)
  emit('moved', { ...positions.value })
  await nextTick()
  fitView({ padding: 0.15 })
}

function focusNode(id) {
  const node = findNode(id)
  if (!node) return
  const { x, y } = node.position
  setCenter(x + (node.dimensions?.width || 200) / 2, y + (node.dimensions?.height || 70) / 2, { zoom: 1.2, duration: 400 })
}

defineExpose({ relayout, focusNode, fit: () => fitView({ padding: 0.15 }) })
</script>

<style scoped>
.topology-canvas {
  width: 100%;
  height: 100%;
  position: relative;
}

.vue-flow-container {
  background-color: rgb(var(--v-theme-background));

  /* vue-flow's theme-default.css colors, pointed at the Vuetify theme. */
  --vf-node-bg: rgb(var(--v-theme-surface));
  --vf-node-text: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  --vf-connection-path: rgba(var(--v-theme-on-surface), 0.4);
  --vf-handle: rgba(var(--v-theme-on-surface), 0.6);
}

/* Custom nodes draw their own card; drop vue-flow's default chrome. */
:deep(.vue-flow__node-device),
:deep(.vue-flow__node-ghost),
:deep(.vue-flow__node-subnet) {
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

:deep(.topo-node) {
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 8px 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}

:deep(.topo-device) { width: 220px; }
:deep(.topo-ghost),
:deep(.topo-subnet) { width: 200px; }

:deep(.topo-ghost) {
  border-style: dashed;
  background: rgba(var(--v-theme-surface), 0.7);
}

:deep(.topo-subnet) {
  border-style: dotted;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

:deep(.topo-node.selected) {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.35);
}

:deep(.topo-node.out-of-scope) {
  opacity: 0.6;
}

:deep(.topo-title) {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.2;
}

:deep(.topo-sub),
:deep(.topo-meta) {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

:deep(.topo-handle) {
  opacity: 0;
  pointer-events: none;
}

:deep(.vue-flow__edge-path) {
  stroke: rgba(var(--v-theme-on-surface), 0.45);
  stroke-width: 1.5;
}

:deep(.topo-edge-ghost .vue-flow__edge-path) {
  stroke-dasharray: 6 4;
}

:deep(.topo-edge-oneway .vue-flow__edge-path) {
  stroke-dasharray: 2 3;
}

:deep(.vue-flow__edge-textbg) {
  fill: rgb(var(--v-theme-surface));
}

:deep(.vue-flow__edge-text) {
  fill: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 10px;
}

:deep(.vue-flow__controls) {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

:deep(.vue-flow__minimap) {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  background-color: rgb(var(--v-theme-surface));
}

:deep(.vue-flow__controls-button) {
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  fill: currentColor;
  border: none;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

:deep(.vue-flow__controls-button:hover) {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
</style>
