<script setup lang="ts">
  import { computed, ref, useAttrs, Teleport } from 'vue'
  import { Controls } from '@vue-flow/controls'
  import {
    Connection,
    Edge,
    getRectOfNodes,
    MarkerType,
    type Node,
    useVueFlow,
    VueFlow,
  } from '@vue-flow/core'
  import { getId, getNewName, nodeTypes, useDragAndDrop } from '@/utils/dataFlowUtils'
  import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

  import { useFlowStore } from '@/stores/flowStore'
  import DataFlowBackground from '@/components/DataFlow/DataFlowBackground.vue'
  import ProcessNode from '@/components/DataFlow/Nodes/ProcessNode.vue'
  import StoreNode from '@/components/DataFlow/Nodes/StoreNode.vue'
  import ExtEntNode from '@/components/DataFlow/Nodes/ExtEntNode.vue'
  import BoundaryNode from '@/components/DataFlow/Nodes/BoundaryNode.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'
  import ModelDialog from '@/components/Dialogs/Model/ModelDialog.vue'

  interface SnackBar {
    show: boolean;
    message: string;
    color: string;
  }

  interface NodeWithComputedPosition extends Node {
    computedPosition?: {
      x: number;
      y: number;
    };
  }

  const showNodeDeleteDialog = ref(false)
  const showEdgeDeleteDialog = ref(false)
  const newNodePosition = ref<{ x: number; y: number } | null>(null)
  const newNodeType = ref<string>('')
  const openSettings = ref(false)

  const {
    onNodeDrag,
    onNodeDragStop,
    getIntersectingNodes,
    updateNode,
    onInit,
    onConnect,
    onNodesChange,
    onEdgesChange,
    applyNodeChanges,
    onNodeDoubleClick,
    onEdgeDoubleClick,
    applyEdgeChanges,
    getNodes,
    screenToFlowCoordinate,
  } = useVueFlow()

  const {
    onDragOver,
    onDrop,
    onDragLeave,
    isDragOver,
    draggedType,
  } = useDragAndDrop()

  const route = useRoute()
  const modelId = ref<string | null>(route.query.id as string | null)
  const showModelDialog = ref(false)
  const router = useRouter()
  const flowStore = useFlowStore()
  const attrs = useAttrs()

  const getChildNodes = (node: Node) => getNodes.value.filter(n => n.parentNode === node.id)

  const selectedItem = computed(() => flowStore.selectedItem)
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  flowStore.fetchMitreAttackTactics()

  const modelName = ref<string | null>(null)

  flowStore.getModelData({ modelId: modelId.value || '' }).then(model => {
    modelName.value = model.name
  })

  // utility functions
  
  // Get all descendant nodes (children, grandchildren, etc.) recursively
  const getAllDescendantNodes = (node: Node): Node[] => {
    const directChildren = getChildNodes(node)
    const allDescendants: Node[] = [...directChildren]
    
    for (const child of directChildren) {
      // Recursively get descendants of each child
      const childDescendants = getAllDescendantNodes(child)
      allDescendants.push(...childDescendants)
    }
    
    return allDescendants
  }
  const findInnermostBoundary = (boundaries: Node[]): Node | null => {
    return boundaries.reduce((innermost: Node | null, boundary: Node) => {
      // Use width/height properties directly from Vue Flow Node
      const boundaryWidth = boundary.width || (boundary as any).dimensions?.width || 0
      const boundaryHeight = boundary.height || (boundary as any).dimensions?.height || 0
      const area = boundaryWidth * boundaryHeight
      
      if (!innermost) return boundary
      
      const innermostWidth = innermost.width || (innermost as any).dimensions?.width || 0
      const innermostHeight = innermost.height || (innermost as any).dimensions?.height || 0
      const innermostArea = innermostWidth * innermostHeight
      
      return area < innermostArea ? boundary : innermost
    }, null)
  }

  const findIntersectingBoundary = (node: Node) => {
    const intersections = getIntersectingNodes(node, false)
    const intersectionIds = intersections.map(intersection => intersection.id)

    // Get all descendant nodes of the current node (if it's a boundary with children)
    const descendantNodeIds = node.type === 'BOUNDARY' ? getAllDescendantNodes(node).map(child => child.id) : []

    // Filter out the node itself and its descendants from potential parent boundaries
    const containingBoundaries = getNodes.value.filter(boundaryNode => {
      return boundaryNode.type === 'BOUNDARY' && 
             intersectionIds.includes(boundaryNode.id) &&
             boundaryNode.id !== node.id &&
             !descendantNodeIds.includes(boundaryNode.id) // Don't include descendant boundaries as potential parents
    })

    if (containingBoundaries.length > 0) {
      const innermostBoundary = findInnermostBoundary(containingBoundaries)
      if (innermostBoundary) {
        // Get dimensions consistently
        const nodeWidth = node.width || (node as any).dimensions?.width || 0
        const nodeHeight = node.height || (node as any).dimensions?.height || 0
        const boundaryWidth = innermostBoundary.width || (innermostBoundary as any).dimensions?.width || 0
        const boundaryHeight = innermostBoundary.height || (innermostBoundary as any).dimensions?.height || 0
        
        // For non-boundary nodes, always assign the parent
        // For boundary nodes, only assign if the dropped boundary can fit within the potential parent
        if (
          node.type !== 'BOUNDARY' ||
          (
            nodeWidth > 0 &&
            boundaryWidth > 0 &&
            nodeHeight > 0 &&
            boundaryHeight > 0 &&
            nodeWidth < boundaryWidth &&
            nodeHeight < boundaryHeight
          )
        ) {
          // Additional check: ensure the potential parent is not already a descendant of the node being dropped
          // This prevents circular parent-child relationships in multi-level hierarchies
          if (node.type === 'BOUNDARY') {
            const allDescendantNodes = getAllDescendantNodes(node)
            const isCircularRelation = allDescendantNodes.some(descendant => descendant.id === innermostBoundary.id)
            if (isCircularRelation) {
              return null
            }
          }
          
          return innermostBoundary
        }
      } 
      return null
    }
    return null
  }

  const getMinDimensions = (boundary: Node) => {
    const childNodes = getChildNodes(boundary)
    const childNodesRect = getRectOfNodes(childNodes)
    const boundaryPos = (boundary as NodeWithComputedPosition).computedPosition || boundary.position
    const minWidth = childNodesRect.width + (childNodesRect.x - boundaryPos.x) + 10
    const minHeight = childNodesRect.height + (childNodesRect.y - boundaryPos.y) + 10

    return {
      minWidth,
      minHeight,
    }
  }

  const setParentBoundary = (node: Node) => {
    const intersectingBoundary = findIntersectingBoundary(node)

    for (const n of getNodes.value) {
      updateNode(n.id, { class: '' })
    }

    if ( intersectingBoundary ) {
      const nodePos = (node as NodeWithComputedPosition).computedPosition || node.position
      const boundaryPos = (intersectingBoundary as NodeWithComputedPosition).computedPosition || intersectingBoundary.position
      flowStore.updateNode({
        nodeId: node.id,
        updates: {
          parentNode: intersectingBoundary.id,
          position: {
            x: nodePos.x - boundaryPos.x,
            y: nodePos.y - boundaryPos.y,
          },
        },
      })
      const { minWidth, minHeight } = getMinDimensions(intersectingBoundary)
      flowStore.updateNode({
        nodeId: intersectingBoundary.id,
        updates: {
          data: {
            minWidth,
            minHeight,
          },
        },
      })
    } else {
      const nodePos = (node as NodeWithComputedPosition).computedPosition || node.position
      flowStore.updateNode({
        nodeId: node.id,
        updates: {
          parentNode: '',
          position: {
            x: nodePos.x,
            y: nodePos.y,
          },
        },
      })
    }
  }

  // event handlers
  onInit(instance => {
    if (modelId.value) {
      flowStore.setModelId({ newModelId: modelId.value })
      flowStore.fetchData({ model: modelId.value }).then(() => {
        if (instance) {
          setTimeout(() => {
            instance.fitView()
          }, 100)
        }
      })
      flowStore.fetchControls()
    }
  })

  onEdgesChange(async changes => {
    const nextChanges = []

    for (const change of changes) {
      if (change.type === 'remove') {
        if (!selectedItem.value || selectedItem.value.id === flowStore.defaultBoundary?.id) return
        showEdgeDeleteDialog.value = true
      } else {
        nextChanges.push(change)
      }
    }
    applyEdgeChanges(nextChanges)
  })

  onNodeDoubleClick(() => { openSettings.value = true })
  onEdgeDoubleClick(() => { openSettings.value = true })
  onBeforeRouteLeave(() => { flowStore.resetStore() })

  onNodesChange(async changes => {
    const nextChanges = []

    for (const change of changes) {
      if (change.type === 'remove') {
        if (!selectedItem.value || selectedItem.value.id === flowStore.defaultBoundary?.id) return
        showNodeDeleteDialog.value = true
        showEdgeDeleteDialog.value = false
      } else {
        nextChanges.push(change)
      }
    }
    applyNodeChanges(nextChanges)
  })

  onNodeDrag(({ node: draggedNode }: { node: Node }) => {
    flowStore.setSelectedItem({ item: draggedNode })
    const intersectingBoundary = findIntersectingBoundary(draggedNode)

    for (const node of getNodes.value) {
      updateNode(node.id, { class: '' })
    }

    if (intersectingBoundary) {
      updateNode(intersectingBoundary.id, { class: 'intersecting' })
    } else {
      for (const node of getNodes.value) {
        updateNode(node.id, { class: '' })
      }
    }
  })

  onNodeDragStop(({ node: draggedNode }: { node: Node }) => {
    setParentBoundary(draggedNode)
  })

  const onBoundaryResize = (boundaryId: string) => {
    const boundaryNode = getNodes.value.find(node => node.id === boundaryId)
    if (!boundaryNode) return
    const { minWidth, minHeight } = getMinDimensions(boundaryNode)
    flowStore.updateNode({
      nodeId: boundaryId,
      updates: {
        data: {
          minWidth,
          minHeight,
        },
      },
    })
  }

  onConnect((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const edgeId = getId()

    const newDataFlow = {
      id: edgeId,
      markerEnd: MarkerType.ArrowClosed,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      label: getNewName({
        baseName: 'New Data Flow',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - Complex type inference issue
        existingNames: flowStore.edges.map((edge: { label: any }) => (edge.label as string) || ''),
      }),
      data: {
        description: 'New Data Flow',
      },
    }

    flowStore.createDataFlow({ newEdge: newDataFlow, classId: '' }).then(() => {
      openSettings.value = true
    })
  })

  const onNodeDrop = (type: string, position: { x: number; y: number }) => {
    newNodeType.value = type
    newNodePosition.value = position
    const nodeId = getId()

    const newNode = {
      id: nodeId,
      type,
      position: {
        x: position.x - nodeTypes[type].width / 2,
        y: position.y - nodeTypes[type].height / 2,
      },
      data: {
        label: getNewName({
          baseName: `New ${nodeTypes[type].displayName}`,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore - Complex type inference issue with flowStore.nodes
          existingNames: flowStore.nodes.map((node: Node) => (node.data?.label as string) || ''),
        }),
        description: `New ${type}`,
      },
      width: nodeTypes[type].width,
      height: nodeTypes[type].height,
      parentNode: '',
    }

    const onNodeCreated = (createdNode: Node | null) => {
      if (createdNode) {
        setTimeout(() => {
          try {
            const node = getNodes.value.find(n => n.id === createdNode.id)
            if (node) {
              setParentBoundary(node)
            }
          } catch (error) {
            console.warn('Error setting parent boundary:', error)
            for (const node of getNodes.value) {
              updateNode(node.id, { class: '' })
            }
          }
        }, 300)
        openSettings.value = true
      }
    }

    if (type === 'BOUNDARY') {
      flowStore.createBoundaryNode({ newNode, classId: '' }).then(onNodeCreated)
    } else {
      flowStore.createComponentNode({ newNode, classId: '' }).then(onNodeCreated)
    }
  }

  const onNodeDelete = () => {
    if (!selectedItem.value) return
    if (selectedItem.value.type === 'BOUNDARY') {
      flowStore.deleteBoundaryNode({ boundaryId: selectedItem.value.id })
    } else {
      flowStore.deleteComponentNode({ componentId: selectedItem.value.id })
    }
    flowStore.setSelectedItem({ item: null })
    showNodeDeleteDialog.value = false
  }

  const onEdgeDelete = () => {
    if (selectedItem.value) {
      flowStore.deleteDataFlow({ dataFlowId: selectedItem.value.id })
      flowStore.setSelectedItem({ item: null })
    }
    showEdgeDeleteDialog.value = false
  }

  const onNodeClick = (event: { node: Node }) => { flowStore.setSelectedItem({ item: event.node }) }
  const onEdgeClick = (event: { edge: Edge }) => { flowStore.setSelectedItem({ item: event.edge }) }

  const onEdgeUpdate = ({ edge, connection }: { edge: Edge, connection: Connection }) => {
    const edgeId = edge.id
    const updates = {
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    }
    flowStore.updateDataFlow({ edgeId, updates })
  }

  const onPaneClick = () => {
    if (flowStore.defaultBoundaryId) {
      flowStore.setSelectedItem({ item: flowStore.defaultBoundary })
    }
  }

  const openModel = (updatedModelId: string) => {
    modelId.value = updatedModelId
    flowStore.resetStore()
    flowStore.fetchData({ model: updatedModelId })
    flowStore.fetchControls()
    flowStore.getModelData({ modelId: modelId.value || '' }).then(model => {
      modelName.value = model.name
    })
    openSettings.value = false
    router.push({
      path: '/dataflow',
      query: {
        id: updatedModelId,
      },
    })
  }

  const editModel = () => { showModelDialog.value = true }

  const onSaveModel = (success: boolean, error: string | undefined) => {
    snackBar.value = {
      show: true,
      // message: success ? 'Model saved' : 'Failed to save model',
      message: success ? 'Model saved' : error ? error : 'Failed to save model',
      color: success ? 'success' : 'error',
    }
    showModelDialog.value = false
    if (modelId.value) {
      flowStore.fetchData({ model: modelId.value })
      flowStore.getModelData({ modelId: modelId.value }).then(model => {
        modelName.value = model.name
      })
    }
    openSettings.value = false
  }

  const handleDragOver = (event: DragEvent) => {
    onDragOver(event)

    if (!draggedType.value) return

    const position = {
      x: event.clientX,
      y: event.clientY,
    }
    const flowPosition = screenToFlowCoordinate(position)

    const nodeWidth = nodeTypes[draggedType.value]?.width || 100
    const nodeHeight = nodeTypes[draggedType.value]?.height || 100

    const tempNode = {
      id: 'temp-ghost-node',
      type: draggedType.value,
      position: {
        x: flowPosition.x - nodeWidth / 2,
        y: flowPosition.y - nodeHeight / 2,
      },
      dimensions: {
        width: nodeWidth,
        height: nodeHeight,
      },
      computedPosition: {
        x: flowPosition.x - nodeWidth / 2,
        y: flowPosition.y - nodeHeight / 2,
      },
    }

    for (const node of getNodes.value) {
      updateNode(node.id, { class: '' })
    }

    const intersectingBoundary = findIntersectingBoundary(tempNode)

    if (intersectingBoundary) {
      updateNode(intersectingBoundary.id, { class: 'intersecting' })
    }
  }

  const handleDragLeave = () => {
    onDragLeave()

    for (const node of getNodes.value) {
      updateNode(node.id, { class: '' })
    }
  }

  const redirectToIssue = () => {
    router.push({ path: '/issues' })
  }
</script>

<template>
  <!-- eslint-disable vue/attribute-hyphenation -->
  <!-- eslint-disable vue/no-lone-template -->
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <div class="data-flow-root dnd-flow" v-bind="attrs" @drop="(event: DragEvent) => onDrop(event, onNodeDrop)">
    <VueFlow
      :apply-default="false"
      class="vue-flow"
      :connection-line-options="{ markerEnd: 'arrowclosed' }"
      :default-viewport="{ zoom: 1.5 }"
      :edges="flowStore.edges"
      edgesUpdatable
      :elevate-edges-on-select="true"
      :max-zoom="4"
      :min-zoom="0.2"
      :nodes="flowStore.nodes"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @edge-click="onEdgeClick"
      @edge-update="onEdgeUpdate"
      @keydown.esc="openSettings = false"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
    >
      <DataFlowBackground
        :modelId="modelId"
        :modelName="modelName"
        :openSettings="openSettings"
        :style="{
          backgroundColor: isDragOver ? 'rgb(var(--v-theme-background))' : 'transparent',
          opacity: isDragOver ? 0.5 : 1,
          transition: 'background-color 0.2s ease',
        }"
        @delete:edge="onEdgeDelete"
        @delete:node="onNodeDelete"
        @edit-model="editModel"
        @open-model="openModel"
        @redirect:issue="redirectToIssue"
        @update:open-settings="openSettings = $event"
        @update:snackBar="snackBar = $event"
      >
        <p v-if="isDragOver" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white;">Drop here</p>
      </DataFlowBackground>

      <template #node-PROCESS="props">
        <ProcessNode :id="props.id" :data="props.data" />
      </template>

      <template #node-STORE="props">
        <StoreNode :id="props.id" :data="props.data" />
      </template>

      <template #node-EXTERNAL_ENTITY="props">
        <ExtEntNode :id="props.id" :data="props.data" />
      </template>

      <template #node-BOUNDARY="props">
        <BoundaryNode :id="props.id" :data="props.data" @resize:start="onBoundaryResize" />
      </template>

      <Controls
        class="controls"
        position="bottom-right"
      />
    </VueFlow>
  </div>

  <!-- Use Teleport to render dialogs at document root to prevent DOM connection issues -->
  <Teleport to="body">
    <ConfirmDeleteDialog
      v-if="showEdgeDeleteDialog"
      :message="`Are you sure you want to delete the edge ${selectedItem?.label ?? ''}?`"
      :show="showEdgeDeleteDialog"
      @delete:canceled="showEdgeDeleteDialog = false"
      @delete:confirmed="onEdgeDelete"
    />
    <ConfirmDeleteDialog
      v-if="showNodeDeleteDialog"
      :message="`Are you sure you want to delete the node ${selectedItem?.label ?? ''}?`"
      :show="showNodeDeleteDialog"
      @delete:canceled="showNodeDeleteDialog = false"
      @delete:confirmed="onNodeDelete"
    />
    <ModelDialog
      v-if="showModelDialog && modelId !== null"
      :id="modelId ?? ''"
      :show="showModelDialog"
      :show-file-actions="false"
      @model:closed="showModelDialog = false"
      @model:saved="onSaveModel"
      @redirect:issue="redirectToIssue"
    />
  </Teleport>

  <v-snackbar
    v-model="snackBar.show"
    :color="snackBar.color"
    :timeout="5000"
    top
  >
    {{ snackBar.message }}
  </v-snackbar>
</template>

<style>
  @import '@/components/DataFlow/Style/main.css';
</style>

<style scoped>
.data-flow-root {
  width: 100%;
  height: 100%;
  display: flex;
}

.vue-flow {
  width: 100%;
  height: 100%;
}

.vue-flow__container {
  position: fixed !important;
}

.controls {
  background-color: rgb(var(--v-theme-surface));
  opacity: 0.9;
  transition: background-color 0.2s ease;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  padding: 11px;
  margin: 10px;
  position: fixed;
  bottom: 35px;
  right: 25px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}
</style>
