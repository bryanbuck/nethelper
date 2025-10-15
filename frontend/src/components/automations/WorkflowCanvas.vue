<template>
  <div class="workflow-canvas">
    <VueFlow
      v-model="elements"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :default-zoom="1"
      :min-zoom="0.2"
      :max-zoom="2"
      :zoom-on-scroll="true"
      :zoom-on-pinch="true"
      :pan-on-scroll="false"
      :pan-on-scroll-mode="PanOnScrollMode.Free"
      :pan-on-drag="true"
      :selection-key-code="'Meta'"
      :multi-selection-key-code="'Shift'"
      :delete-key-code="'Delete'"
      :connection-line-style="connectionLineStyle"
      :default-edge-options="defaultEdgeOptions"
      @node-click="onNodeClick"
      @node-double-click="onNodeDoubleClick"
      @edge-click="onEdgeClick"
      @connect="onConnect"
      @edge-update="onEdgeUpdate"
      @nodes-change="onNodesChange"
      @edges-change="onEdgesChange"
      @drop="onDrop"
      @dragover="onDragOver"
      @selection-change="onSelectionChange"
      @pane-click="onPaneClick"
      class="vue-flow-container"
    >
      <!-- Background -->
      <Background 
        :pattern-color="'#e2e8f0'"
        :gap="16"
        variant="dots"
      />
      
      <!-- Controls -->
      <Controls position="bottom-left">
        <ControlButton 
          title="Reset View" 
          @click="resetView"
        >
          <v-icon size="16">mdi-fit-to-screen</v-icon>
        </ControlButton>
        
        <ControlButton 
          title="Auto Layout" 
          @click="autoLayout"
        >
          <v-icon size="16">mdi-auto-fix</v-icon>
        </ControlButton>
        
        <ControlButton 
          title="Clear All" 
          @click="clearCanvas"
        >
          <v-icon size="16">mdi-delete-sweep</v-icon>
        </ControlButton>
      </Controls>
      
      <!-- MiniMap -->
      <MiniMap 
        position="bottom-right"
        :pannable="true"
        :zoomable="true"
        :node-color="getNodeColor"
      />
      
      <!-- Selection Box -->
      <div 
        v-if="selectionBox.visible" 
        class="selection-box"
        :style="selectionBoxStyle"
      ></div>
    </VueFlow>
    
    <!-- Context Menu -->
    <v-menu
      v-model="contextMenu.show"
      :position-x="contextMenu.x"
      :position-y="contextMenu.y"
      absolute
      offset-y
    >
      <v-list dense>
        <v-list-item 
          v-if="contextMenu.type === 'node'"
          prepend-icon="mdi-cog"
          title="Configure"
          @click="configureNode(contextMenu.target)"
        />
        <v-list-item 
          v-if="contextMenu.type === 'node'"
          prepend-icon="mdi-content-copy"
          title="Duplicate"
          @click="duplicateNode(contextMenu.target)"
        />
        <v-divider v-if="contextMenu.type === 'node'"></v-divider>
        <v-list-item 
          v-if="contextMenu.type === 'edge'"
          prepend-icon="mdi-label"
          title="Add Label"
          @click="addEdgeLabel(contextMenu.target)"
        />
        <v-list-item 
          prepend-icon="mdi-delete"
          title="Delete"
          class="text-error"
          @click="deleteElement(contextMenu.target)"
        />
      </v-list>
    </v-menu>
    
    <!-- Loading Overlay -->
    <v-overlay 
      v-model="loading" 
      class="align-center justify-center"
      contained
    >
      <v-progress-circular 
        indeterminate 
        size="64" 
        color="primary"
      ></v-progress-circular>
    </v-overlay>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import {
  VueFlow,
  useVueFlow,
  PanOnScrollMode,
  MarkerType
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls, ControlButton } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { getLayoutedElements } from '@/utils/layoutUtils'

// Import custom node components
import TriggerNode from './nodes/TriggerNode.vue'
import ConditionNode from './nodes/ConditionNode.vue'
import ActionNode from './nodes/ActionNode.vue'
import NotificationNode from './nodes/NotificationNode.vue'

const props = defineProps({
  initialElements: {
    type: Array,
    default: () => []
  },
  readonly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'elements-change',
  'node-configure',
  'node-select',
  'edge-select',
  'selection-change'
])

// Vue Flow instance
const { 
  nodes, 
  edges, 
  addNodes, 
  addEdges, 
  removeNodes, 
  removeEdges,
  findNode,
  findEdge,
  getConnectedEdges,
  fitView,
  setViewport,
  toObject
} = useVueFlow()

// Component state
const elements = ref(props.initialElements)
const loading = ref(false)
const nodeIdCounter = ref(1)
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  type: null,
  target: null
})
const selectionBox = ref({
  visible: false,
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0
})

// Node types configuration
const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
  notification: NotificationNode
}

// Edge types configuration
const edgeTypes = {}

// Style configurations
const connectionLineStyle = {
  strokeWidth: 2,
  stroke: '#FF8300'
}

const defaultEdgeOptions = {
  style: {
    strokeWidth: 2,
    stroke: '#64748b'
  },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#64748b'
  },
  type: 'smoothstep'
}

// Computed properties
const selectionBoxStyle = computed(() => {
  const { startX, startY, endX, endY } = selectionBox.value
  const left = Math.min(startX, endX)
  const top = Math.min(startY, endY)
  const width = Math.abs(endX - startX)
  const height = Math.abs(endY - startY)

  return {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    border: '2px dashed #FF8300',
    backgroundColor: 'rgba(255, 131, 0, 0.1)',
    pointerEvents: 'none',
    zIndex: 1000
  }
})

// Methods
const generateNodeId = () => {
  return `node_${nodeIdCounter.value++}`
}

const generateEdgeId = () => {
  return `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

const addNode = (nodeData, position = null) => {
  const id = generateNodeId()
  const defaultPosition = position || { x: 250, y: 150 }
  
  const newNode = {
    id,
    type: nodeData.category,
    position: defaultPosition,
    data: {
      [`${nodeData.category}Type`]: nodeData.type,
      config: {},
      label: nodeData.label
    }
  }
  
  addNodes([newNode])
  elements.value = [...nodes.value, ...edges.value]
  emit('elements-change', elements.value)
  
  return newNode
}

const onDrop = (event) => {
  event.preventDefault()
  
  const nodeData = JSON.parse(
    event.dataTransfer.getData('application/vueflow')
  )
  
  if (!nodeData) return
  
  const rect = event.currentTarget.getBoundingClientRect()
  const position = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }
  
  addNode(nodeData, position)
}

const onDragOver = (event) => {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}

const onConnect = (connection) => {
  // Validate connection
  if (!isValidConnection(connection)) {
    return
  }
  
  const id = generateEdgeId()
  const newEdge = {
    id,
    ...connection,
    ...defaultEdgeOptions
  }
  
  addEdges([newEdge])
  elements.value = [...nodes.value, ...edges.value]
  emit('elements-change', elements.value)
}

const isValidConnection = (connection) => {
  const sourceNode = findNode(connection.source)
  const targetNode = findNode(connection.target)
  
  if (!sourceNode || !targetNode) return false
  
  // Prevent self-connections
  if (connection.source === connection.target) return false
  
  // Check if connection already exists
  const existingEdge = edges.value.find(edge => 
    edge.source === connection.source && 
    edge.target === connection.target &&
    edge.sourceHandle === connection.sourceHandle &&
    edge.targetHandle === connection.targetHandle
  )
  
  if (existingEdge) return false
  
  // Validate node type connections
  const sourceType = sourceNode.type
  const targetType = targetNode.type
  
  // Triggers can only connect to conditions or actions
  if (sourceType === 'trigger' && !['condition', 'action', 'notification'].includes(targetType)) {
    return false
  }
  
  // Notifications cannot have outgoing connections
  if (sourceType === 'notification') {
    return false
  }
  
  // Triggers cannot have incoming connections
  if (targetType === 'trigger') {
    return false
  }
  
  return true
}

const onNodeClick = (event) => {
  if (event.detail === 2) return // Ignore double clicks
  
  const node = event.node
  emit('node-select', node)
}

const onNodeDoubleClick = (event) => {
  const node = event.node
  emit('node-configure', node)
}

const onEdgeClick = (event) => {
  const edge = event.edge
  emit('edge-select', edge)
}

const onEdgeUpdate = ({ edge, connection }) => {
  if (!isValidConnection(connection)) return
  
  const edgeIndex = edges.value.findIndex(e => e.id === edge.id)
  if (edgeIndex > -1) {
    edges.value[edgeIndex] = { ...edge, ...connection }
    elements.value = [...nodes.value, ...edges.value]
    emit('elements-change', elements.value)
  }
}

const onNodesChange = (changes) => {
  // Handle node position changes, deletions, etc.
  elements.value = [...nodes.value, ...edges.value]
  emit('elements-change', elements.value)
}

const onEdgesChange = (changes) => {
  // Handle edge changes
  elements.value = [...nodes.value, ...edges.value]
  emit('elements-change', elements.value)
}

const onSelectionChange = (selection) => {
  emit('selection-change', selection)
}

const onPaneClick = () => {
  contextMenu.value.show = false
}

const resetView = () => {
  fitView({ padding: 0.2 })
}

const autoLayout = async () => {
  loading.value = true
  
  try {
    const layoutedElements = await getLayoutedElements(nodes.value, edges.value)
    
    // Update node positions
    layoutedElements.nodes.forEach(layoutedNode => {
      const node = findNode(layoutedNode.id)
      if (node) {
        node.position = layoutedNode.position
      }
    })
    
    await nextTick()
    fitView({ padding: 0.2 })
    
  } catch (error) {
    console.error('Auto layout failed:', error)
  } finally {
    loading.value = false
  }
}

const clearCanvas = () => {
  if (confirm('Are you sure you want to clear the entire workflow? This action cannot be undone.')) {
    removeNodes(nodes.value.map(n => n.id))
    removeEdges(edges.value.map(e => e.id))
    elements.value = []
    emit('elements-change', elements.value)
  }
}

const configureNode = (node) => {
  emit('node-configure', node)
  contextMenu.value.show = false
}

const duplicateNode = (node) => {
  const newPosition = {
    x: node.position.x + 50,
    y: node.position.y + 50
  }
  
  const duplicatedNode = {
    ...node,
    id: generateNodeId(),
    position: newPosition,
    data: { ...node.data }
  }
  
  addNodes([duplicatedNode])
  elements.value = [...nodes.value, ...edges.value]
  emit('elements-change', elements.value)
  contextMenu.value.show = false
}

const addEdgeLabel = (edge) => {
  const updatedEdge = {
    ...edge,
    label: 'New Label',
    labelStyle: { fontSize: 12, fontWeight: 'bold' }
  }
  
  const edgeIndex = edges.value.findIndex(e => e.id === edge.id)
  if (edgeIndex > -1) {
    edges.value[edgeIndex] = updatedEdge
    elements.value = [...nodes.value, ...edges.value]
    emit('elements-change', elements.value)
  }
  
  contextMenu.value.show = false
}

const deleteElement = (element) => {
  if (element.type) {
    // It's a node
    const connectedEdges = getConnectedEdges([element])
    removeEdges(connectedEdges.map(e => e.id))
    removeNodes([element.id])
  } else {
    // It's an edge
    removeEdges([element.id])
  }
  
  elements.value = [...nodes.value, ...edges.value]
  emit('elements-change', elements.value)
  contextMenu.value.show = false
}

const getNodeColor = (node) => {
  const colors = {
    trigger: '#4caf50',
    condition: '#ff9800',
    action: '#FF8300',
    notification: '#9c27b0'
  }
  return colors[node.type] || '#64748b'
}

// Public methods for external use
const addNodeFromPalette = (nodeData) => {
  return addNode(nodeData)
}

const exportWorkflow = () => {
  return toObject()
}

const importWorkflow = (flowData) => {
  if (flowData.nodes) {
    removeNodes(nodes.value.map(n => n.id))
    addNodes(flowData.nodes)
  }
  
  if (flowData.edges) {
    removeEdges(edges.value.map(e => e.id))
    addEdges(flowData.edges)
  }
  
  elements.value = [...nodes.value, ...edges.value]
  emit('elements-change', elements.value)
  
  nextTick(() => {
    fitView({ padding: 0.2 })
  })
}

// Expose methods for parent components
defineExpose({
  addNodeFromPalette,
  exportWorkflow,
  importWorkflow,
  autoLayout,
  resetView,
  clearCanvas
})

// Initialize
onMounted(() => {
  if (props.initialElements.length > 0) {
    importWorkflow({ 
      nodes: props.initialElements.filter(el => el.type),
      edges: props.initialElements.filter(el => !el.type)
    })
  }
})
</script>

<style scoped>
.workflow-canvas {
  width: 100%;
  height: 100%;
  position: relative;
}

.vue-flow-container {
  background-color: #fafafa;
}

.selection-box {
  position: absolute;
  border: 2px dashed #FF8300;
  background-color: rgba(255, 131, 0, 0.1);
  pointer-events: none;
  z-index: 1000;
}

/* Override Vue Flow default styles */
:deep(.vue-flow__node) {
  cursor: pointer;
}

:deep(.vue-flow__edge) {
  cursor: pointer;
}

:deep(.vue-flow__edge:hover) {
  stroke: #FF8300;
}

:deep(.vue-flow__edge.selected) {
  stroke: #FF8300;
}

:deep(.vue-flow__controls) {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

:deep(.vue-flow__minimap) {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}
</style>