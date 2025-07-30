import dagre from 'dagre'

export const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  // Set graph options
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 100,
    ranksep: 150,
    marginx: 50,
    marginy: 50
  })

  // Add nodes to the graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: node.width || 200,
      height: node.height || 80
    })
  })

  // Add edges to the graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  // Calculate layout
  dagre.layout(dagreGraph)

  // Apply calculated positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - (node.width || 200) / 2,
        y: nodeWithPosition.y - (node.height || 80) / 2
      }
    }
  })

  return {
    nodes: layoutedNodes,
    edges
  }
}

export const getHierarchicalLayout = (nodes, edges) => {
  return getLayoutedElements(nodes, edges, 'TB')
}

export const getHorizontalLayout = (nodes, edges) => {
  return getLayoutedElements(nodes, edges, 'LR')
}

export const validateWorkflow = (nodes, edges) => {
  const errors = []
  const warnings = []

  // Check for trigger nodes
  const triggerNodes = nodes.filter(node => node.type === 'trigger')
  if (triggerNodes.length === 0) {
    errors.push('Workflow must have at least one trigger node')
  }

  // Check for isolated nodes (nodes with no connections)
  const connectedNodeIds = new Set()
  edges.forEach(edge => {
    connectedNodeIds.add(edge.source)
    connectedNodeIds.add(edge.target)
  })

  const isolatedNodes = nodes.filter(node => !connectedNodeIds.has(node.id))
  if (isolatedNodes.length > 0) {
    warnings.push(`${isolatedNodes.length} node(s) are not connected to the workflow`)
  }

  // Check for cycles (simplified check)
  const hasCycle = detectCycle(nodes, edges)
  if (hasCycle) {
    errors.push('Workflow contains cycles which may cause infinite loops')
  }

  // Check for nodes without configuration
  const unconfiguredNodes = nodes.filter(node => {
    const data = node.data || {}
    const nodeType = node.type
    
    if (nodeType === 'trigger') {
      return !data.triggerType || !data.config
    }
    if (nodeType === 'condition') {
      return !data.conditionType || !data.config
    }
    if (nodeType === 'action') {
      return !data.actionType || !data.config
    }
    if (nodeType === 'notification') {
      return !data.notificationType || !data.config
    }
    
    return false
  })

  if (unconfiguredNodes.length > 0) {
    warnings.push(`${unconfiguredNodes.length} node(s) need configuration`)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

const detectCycle = (nodes, edges) => {
  const visited = new Set()
  const recursionStack = new Set()
  
  const adjacencyList = {}
  
  // Build adjacency list
  nodes.forEach(node => {
    adjacencyList[node.id] = []
  })
  
  edges.forEach(edge => {
    if (adjacencyList[edge.source]) {
      adjacencyList[edge.source].push(edge.target)
    }
  })
  
  const dfs = (nodeId) => {
    visited.add(nodeId)
    recursionStack.add(nodeId)
    
    const neighbors = adjacencyList[nodeId] || []
    
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) {
          return true
        }
      } else if (recursionStack.has(neighbor)) {
        return true // Cycle detected
      }
    }
    
    recursionStack.delete(nodeId)
    return false
  }
  
  // Check each unvisited node
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) {
        return true
      }
    }
  }
  
  return false
}

export const optimizeWorkflow = (nodes, edges) => {
  const suggestions = []
  
  // Suggest combining sequential actions
  const actionNodes = nodes.filter(node => node.type === 'action')
  const sequentialActions = findSequentialActions(actionNodes, edges)
  
  if (sequentialActions.length > 0) {
    suggestions.push({
      type: 'optimization',
      message: 'Consider combining sequential actions to improve performance',
      nodes: sequentialActions
    })
  }
  
  // Suggest adding error handling
  const nodesWithoutErrorHandling = actionNodes.filter(node => {
    const outgoingEdges = edges.filter(edge => edge.source === node.id)
    return outgoingEdges.length === 1 // Only success path
  })
  
  if (nodesWithoutErrorHandling.length > 0) {
    suggestions.push({
      type: 'best-practice',
      message: 'Consider adding error handling for critical actions',
      nodes: nodesWithoutErrorHandling
    })
  }
  
  return suggestions
}

const findSequentialActions = (actionNodes, edges) => {
  const sequences = []
  
  actionNodes.forEach(node => {
    const outgoingEdges = edges.filter(edge => edge.source === node.id)
    const incomingEdges = edges.filter(edge => edge.target === node.id)
    
    // Look for nodes that have exactly one input and one output to another action
    if (outgoingEdges.length === 1 && incomingEdges.length === 1) {
      const nextNode = actionNodes.find(n => n.id === outgoingEdges[0].target)
      if (nextNode) {
        sequences.push([node, nextNode])
      }
    }
  })
  
  return sequences
}

export const exportWorkflowToJSON = (nodes, edges, metadata = {}) => {
  return {
    version: '1.0',
    metadata: {
      name: metadata.name || 'Untitled Workflow',
      description: metadata.description || '',
      created: metadata.created || new Date().toISOString(),
      modified: new Date().toISOString(),
      ...metadata
    },
    nodes: nodes.map(node => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      style: edge.style
    }))
  }
}

export const importWorkflowFromJSON = (workflowData) => {
  if (!workflowData.nodes || !workflowData.edges) {
    throw new Error('Invalid workflow format')
  }
  
  return {
    nodes: workflowData.nodes,
    edges: workflowData.edges,
    metadata: workflowData.metadata || {}
  }
}