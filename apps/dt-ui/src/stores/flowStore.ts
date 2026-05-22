// useFlowStore.ts

import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'
import apolloClient from '@/plugins/apolloClient'
import { Edge, Node } from '@vue-flow/core'
import {
  // Core classes
  DtBoundary, DtClass, DtComponent, DtControl, DtDataflow, DtDataItem,
  DtExposure, DtMitreAttack, DtModel, DtModule, DtUtils,

  // Supersede orchestration helper (pure, Vue-free).
  executeSupersedeFlow,

  // Core types
  Exposure, Class, Control, DataItem, DirectDescendant, Model, Module,
  MitreAttackTactic, MitreAttackTechnique,
  ChangeElementBindingResult,
  DispositionKind, DispositionMutationResult,
} from '@dethernety/dt-core'

// Crown-jewel components carry a `crown-jewel` class on the vue-flow wrapper so the
// gold treatment (main.css) can render. Riding `node.class` (not a manual DOM class)
// keeps it across re-renders. Derived purely from `data.crownJewel` wherever a
// component node is (re)built — boundaries never set it. Exported so the canvas's
// drag handlers (which reset `node.class` for boundary-intersection feedback) can
// preserve it rather than clobber it.
export const crownJewelClass = (data: any): string | undefined =>
  data?.crownJewel === true ? 'crown-jewel' : undefined

export const useFlowStore = defineStore('flow', () => {
  // === DEPENDENCIES ===
  const dtUtils = new DtUtils(apolloClient)
  const dtModel = new DtModel(apolloClient)
  const dtModule = new DtModule(apolloClient)
  const dtComponent = new DtComponent(apolloClient)
  const dtBoundary = new DtBoundary(apolloClient)
  const dtDataflow = new DtDataflow(apolloClient)
  const dtDataItem = new DtDataItem(apolloClient)
  const dtExposure = new DtExposure(apolloClient)
  const dtClass = new DtClass(apolloClient)
  const dtMitreAttack = new DtMitreAttack(apolloClient)
  const dtControl = new DtControl(apolloClient)

  // === STATE VARIABLES ===
  const nodes = ref<Node[]>([])
  const edges = ref<Edge[]>([])
  const controls = ref<Control[]>([])
  const dataItems = ref<DataItem[]>([])
  const modules = ref<Module[]>([])

  const modelId = ref<string | undefined>(undefined)
  const currentModel = ref<Model | null>(null)
  const defaultBoundary = ref<Node | null>(null)
  const defaultBoundaryId = ref<string | undefined>(undefined)
  const selectedItem = ref<Node | Edge | null>(null)
  const mitreAttackTactics = ref<MitreAttackTactic[]>([])

  // === UI PREFERENCES ===
  const editMode = ref(false)

  // === ERROR AND LOADING STATES ===
  const errors = ref<Record<string, string>>({})
  const isLoading = ref(false)
  const operationStates = ref<Record<string, boolean>>({})
  
  // === TEMPORARY NODE TRACKING ===
  const pendingNodes = ref<Set<string>>(new Set())
  const tempNodeMapping = ref<Map<string, string>>(new Map()) // temp ID -> real ID
  const deferredUpdates = ref<Map<string, Array<{ updates: object; timestamp: number }>>>(new Map()) // temp ID -> queued updates

  // === IN-FLIGHT MODEL LOAD ===
  // Plain let (not a ref) — in-flight metadata, not reactive state.
  let activeModelLoad: string | null = null

  // === ERROR HANDLING ===
  const handleApiError = (error: Error, action: string): string => {
    const errorMessage = error.message || error.toString()
    
    if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
      return 'Please log in again to continue'
    }
    if (errorMessage.includes('403') || errorMessage.includes('forbidden')) {
      return 'Access denied to this resource'
    }
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      return 'Resource not found'
    }
    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return 'Connection failed. Please check your internet connection.'
    }
    if (errorMessage.includes('timeout')) {
      return 'Request timed out. Please try again.'
    }
    
    return `Failed to ${action}. Please try again.`
  }

  const setError = (key: string, message: string) => {
    errors.value = { ...errors.value, [key]: message }
  }

  const clearError = (key: string) => {
    const newErrors = { ...errors.value }
    delete newErrors[key]
    errors.value = newErrors
  }

  const clearAllErrors = () => {
    errors.value = {}
  }

  // === LOADING STATE MANAGEMENT ===
  const setOperationLoading = (operation: string, loading: boolean) => {
    operationStates.value = { ...operationStates.value, [operation]: loading }
  }

  const isOperationLoading = (operation: string): boolean => {
    return operationStates.value[operation] || false
  }

  // === TEMPORARY NODE HELPERS ===
  const isPendingNode = (nodeId: string): boolean => {
    return pendingNodes.value.has(nodeId) || nodeId.startsWith('temp-')
  }

  const getRealNodeId = (nodeId: string): string => {
    return tempNodeMapping.value.get(nodeId) || nodeId
  }

  const queueUpdateForTempNode = (tempId: string, updates: object) => {
    if (!deferredUpdates.value.has(tempId)) {
      deferredUpdates.value.set(tempId, [])
    }
    deferredUpdates.value.get(tempId)!.push({ updates, timestamp: Date.now() })
  }

  const applyDeferredUpdates = async (tempId: string, realId: string) => {
    const updates = deferredUpdates.value.get(tempId)
    if (!updates || updates.length === 0) {
      console.log(`No deferred updates for ${tempId}`)
      return
    }
    
    console.log(`Found ${updates.length} deferred updates for ${tempId}:`, updates)

    // Separate class updates from regular node updates
    let classId: string | undefined
    const nodeUpdates: any = {}
    
    updates.forEach(({ updates: update }) => {
      if ('classId' in update) {
        classId = (update as any).classId // Take the latest class update
      } else {
        dtUtils.deepMerge(nodeUpdates, update)
      }
    })

    // Add a small delay to ensure the node is fully created and in the store
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Verify the real node exists before applying updates
    const realNodeExists = getNodeById({ nodeId: realId }) || realId === defaultBoundaryId.value
    if (!realNodeExists) {
      console.warn(`Real node ${realId} not found when applying deferred updates. Skipping.`)
      return
    }

    // Apply class update first if present
    if (classId) {
      try {
        console.log(`Applying deferred class update: ${realId} -> ${classId}`)
        await updateNodeClass({ nodeId: realId, classId })
      } catch (error) {
        console.error('Failed to apply deferred class update:', error)
      }
    }

    // Apply regular node updates
    if (Object.keys(nodeUpdates).length > 0) {
      try {
        console.log(`Applying deferred node updates to ${realId}:`, nodeUpdates)
        await updateNode({ nodeId: realId, updates: nodeUpdates, skipDeferredQueue: true })
      } catch (error) {
        console.error('Failed to apply deferred node updates:', error)
      }
    }
    
    console.log(`Completed applying deferred updates for ${tempId} -> ${realId}`)

    // Clean up
    deferredUpdates.value.delete(tempId)
  }

  // === STATE SYNCHRONIZATION HELPERS ===
  const syncDataItems = (newDataItems: DataItem[]) => {
    newDataItems?.forEach((dataItem: DataItem) => {
      const index = getDataItemIndexById({ dataItemId: dataItem.id })
      if (index !== -1) {
        dataItems.value.splice(index, 1, dataItem)
      } else {
        dataItems.value.push(dataItem)
      }
    })
    dataItems.value = [...dataItems.value]
  }

  const syncControls = (newControls: Control[]) => {
    newControls?.forEach((control: Control) => {
      const index = getControlIndexById({ controlId: control.id })
      if (index !== -1) {
        controls.value.splice(index, 1, control)
      } else {
        controls.value.push(control)
      }
    })
    controls.value = [...controls.value]
  }

  // === DATA VALIDATION ===
  const validateDataItem = (data: { name: string, description: string, elementId: string }): string[] => {
    const errors: string[] = []
    
    if (!data.name?.trim()) {
      errors.push('Name is required')
    } else if (data.name.length > 100) {
      errors.push('Name must be 100 characters or less')
    }
    
    if (!data.elementId?.trim()) {
      errors.push('Element ID is required')
    }
    
    if (data.description && data.description.length > 500) {
      errors.push('Description must be 500 characters or less')
    }
    
    return errors
  }

  // Validation for node data (available for future use)
  // const validateNodeData = (data: { label?: string, description?: string }): string[] => {
  //   const errors: string[] = []
  //   
  //   if (data.label && data.label.length > 100) {
  //     errors.push('Label must be 100 characters or less')
  //   }
  //   
  //   if (data.description && data.description.length > 500) {
  //     errors.push('Description must be 500 characters or less')
  //   }
  //   
  //   return errors
  // }
  const resetStore = () => {
    nodes.value = []
    edges.value = []
    controls.value = []
    dataItems.value = []
    modules.value = []

    modelId.value = undefined
    currentModel.value = null
    defaultBoundaryId.value = undefined
    selectedItem.value = null
    mitreAttackTactics.value = []
    activeModelLoad = null
    
    // Clear error and loading states
    clearAllErrors()
    isLoading.value = false
    operationStates.value = {}
    
    // Clear temporary node tracking
    pendingNodes.value.clear()
    tempNodeMapping.value.clear()
    deferredUpdates.value.clear()

    // Reset UI preferences
    editMode.value = false
  }

  const setModelId = ({ newModelId }: { newModelId: string }) => { modelId.value = newModelId }
  const getModels = () => { return dtModel.getNotRepresentingModels({ modelId: modelId.value || '' }) }
  const getModelData = async ({ modelId }: { modelId: string }): Promise<any> => { return dtModel.getModelData({ modelId }) }

  const updateRepresentedModel = async (
    { nodeId, modelId }: { nodeId: string, modelId: string }
  ): Promise<ChangeElementBindingResult | null> => {
    const operationKey = `updateRepresentedModel-${nodeId}`

    try {
      clearError(operationKey)
      setOperationLoading(operationKey, true)

      let node: Node | null = null
      if (nodeId === defaultBoundaryId.value) {
        // @ts-ignore
        node = defaultBoundary.value
      } else {
        node = getNodeById({ nodeId }) || null
      }

      // @ts-ignore - Type instantiation issue with Node
      if (!node) {
        throw new Error('Node not found')
      }

      return await dtClass.changeElementBinding({
        elementId: nodeId,
        target: { kind: 'REPRESENTED_MODEL', modelId },
      })
    } catch (error) {
      const errorMessage = handleApiError(error as Error, 'update represented model')
      setError(operationKey, errorMessage)
      dtUtils.handleError({ action: 'updateRepresentedModel', error })
      return null
    } finally {
      setOperationLoading(operationKey, false)
    }
  }

  /// ////////////////////////////////
  // Module operations
  const getModuleByName = async ({ moduleName }: { moduleName: string }): Promise<Module> => {
    return dtModule.getModuleByName(moduleName)
  }
  const getModuleById = async ({ moduleId }: { moduleId: string }): Promise<Module> => {
    return dtModule.getModuleById(moduleId)
  }
  const resetModule = async ({ moduleId }: { moduleId: string}): Promise<Boolean> => {
    if (!moduleId) return false
    return dtModule.resetModule(moduleId)
  }

  /// ////////////////////////////////
  // Node operations
  const getNodeById = ({ nodeId }: { nodeId: string }): any => { 
    return nodes.value.find((node: any) => node.id === nodeId) 
  }
  const getNodeIndexById = ({ nodeId }: { nodeId: string }): number => { return nodes.value.findIndex(node => node.id === nodeId) }
  const setSelectedItem = ({ item }: { item: Node | Edge | null }) => { selectedItem.value = item }
  const getDataItemIndexById = ({ dataItemId }: { dataItemId: string }): number => { return dataItems.value.findIndex(dataItem => dataItem.id === dataItemId) }
  const getControlIndexById = ({ controlId }: { controlId: string | undefined }): number => { return controls.value.findIndex(control => control.id === controlId) }
  const getComponentRepresentedModel = ({ componentId }: { componentId: string }) => { return dtComponent.getComponentRepresentedModel({ componentId }) }
  const getBoundaryRepresentedModel = ({ boundaryId }: { boundaryId: string }) => { return dtBoundary.getBoundaryRepresentedModel({ boundaryId }) }

  const createComponentNode = async ({ newNode, classId }: { newNode: Node, classId: string }): Promise<Node | null> => {
    const operationKey = 'createComponent'
    
    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const optimisticNode = {
      id: tempId,
      type: newNode.type,
      position: newNode.position,
      data: {
        ...newNode.data,
        pending: true,
        label: newNode.data?.label || 'Creating...'
      }
    } as any
    
    try {
      clearError(operationKey)
      setOperationLoading(operationKey, true)
      
      // Track pending node
      pendingNodes.value.add(tempId)
      
      // Add optimistic node immediately
      nodes.value.push(optimisticNode)
      selectedItem.value = optimisticNode
      
      const createdComponent = await dtComponent.createComponentNode({ 
        newNode, 
        classId, 
        defaultBoundaryId: defaultBoundaryId.value || '' 
      })
      
      if (createdComponent) {
        // Replace optimistic update with real data
        const index = nodes.value.findIndex((n: any) => n.id === tempId)
        if (index !== -1) {
          // Replace the temporary node with the created component, preserving type safety
          // @ts-ignore
          nodes.value.splice(index, 1, createdComponent)
          // Update mapping for any pending operations
          tempNodeMapping.value.set(tempId, createdComponent.id)
          // Update selection if it was pointing to temp node
          if (selectedItem.value && (selectedItem.value as any).id === tempId) {
            selectedItem.value = createdComponent
          }
          // Ensure reactivity
          nodes.value = nodes.value.slice()
        }
        
        // Apply any deferred updates that were queued while the node was being created
        console.log(`Applying deferred updates for component ${tempId} -> ${createdComponent.id}`)
        await applyDeferredUpdates(tempId, createdComponent.id)
        
        // Clean up tracking
        pendingNodes.value.delete(tempId)
        // Clean up mapping after a delay to handle any race conditions
        setTimeout(() => tempNodeMapping.value.delete(tempId), 1000)
        
        return createdComponent
      }
      
      throw new Error('Failed to create component')
    } catch (error) {
      // Remove failed optimistic update
      nodes.value = nodes.value.filter(n => n.id !== tempId)
      selectedItem.value = null
      
      // Clean up tracking and deferred updates
      pendingNodes.value.delete(tempId)
      deferredUpdates.value.delete(tempId)
      tempNodeMapping.value.delete(tempId)
      
      const errorMessage = handleApiError(error as Error, 'create component')
      setError(operationKey, errorMessage)
      return null
    } finally {
      setOperationLoading(operationKey, false)
    }
  }

  const createBoundaryNode = async ({ newNode, classId }: { newNode: Node, classId: string }): Promise<Node | null> => {
    const operationKey = 'createBoundary'
    
    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const optimisticNode = {
      id: tempId,
      type: newNode.type,
      position: newNode.position,
      data: {
        ...newNode.data,
        pending: true,
        label: newNode.data?.label || 'Creating boundary...'
      }
    } as any
    
    try {
      clearError(operationKey)
      setOperationLoading(operationKey, true)
      
      // Track pending node
      pendingNodes.value.add(tempId)
      
      // Add optimistic node immediately
      nodes.value.push(optimisticNode)
      selectedItem.value = optimisticNode
      
      const createdBoundary = await dtBoundary.createBoundaryNode({ 
        newNode, 
        classId, 
        defaultBoundaryId: defaultBoundaryId.value || '' 
      })
      
      if (createdBoundary) {
        // Replace optimistic update with real data
        const index = nodes.value.findIndex(n => n.id === tempId)
        if (index !== -1) {
          nodes.value.splice(index, 1, createdBoundary)
          // Update mapping for any pending operations
          tempNodeMapping.value.set(tempId, createdBoundary.id)
          // Update selection if it was pointing to temp node
          if (selectedItem.value && selectedItem.value.id === tempId) {
            selectedItem.value = createdBoundary
          }
          // Ensure reactivity
          nodes.value = nodes.value.slice()
        }
        
        // Apply any deferred updates that were queued while the node was being created
        console.log(`Applying deferred updates for boundary ${tempId} -> ${createdBoundary.id}`)
        await applyDeferredUpdates(tempId, createdBoundary.id)
        
        // Clean up tracking
        pendingNodes.value.delete(tempId)
        // Clean up mapping after a delay to handle any race conditions
        setTimeout(() => tempNodeMapping.value.delete(tempId), 1000)
        
        return createdBoundary
      }
      
      throw new Error('Failed to create boundary')
    } catch (error) {
      // Remove failed optimistic update
      nodes.value = nodes.value.filter(n => n.id !== tempId)
            selectedItem.value = null
      
      // Clean up tracking and deferred updates
      pendingNodes.value.delete(tempId)
      deferredUpdates.value.delete(tempId)
      tempNodeMapping.value.delete(tempId)

      const errorMessage = handleApiError(error as Error, 'create boundary')
      setError(operationKey, errorMessage)
      return null
    } finally {
      setOperationLoading(operationKey, false)
    }
  }

  const updateNode = async ({ nodeId, updates, skipDeferredQueue = false }: { nodeId: string, updates: object, skipDeferredQueue?: boolean }): Promise<boolean> => {
    // Check if this is a temporary node from optimistic update
    if (!skipDeferredQueue && isPendingNode(nodeId)) {
      console.log(`Queueing update for temporary node ${nodeId}:`, updates)
      queueUpdateForTempNode(nodeId, updates)
      
      // Also update the optimistic node in the UI for immediate feedback
      const tempNodeIndex = nodes.value.findIndex(n => n.id === nodeId)
      if (tempNodeIndex !== -1) {
        const tempNode = nodes.value[tempNodeIndex]
        dtUtils.deepMerge(tempNode, updates)
        // Trigger reactivity
        nodes.value = nodes.value.slice()
      }
      
      return true // Return true to indicate the update was handled
    }
    
    const index = getNodeIndexById({ nodeId })
    if (index !== -1 || nodeId === defaultBoundaryId.value) {
      const node = nodeId === defaultBoundaryId.value ? defaultBoundary.value : nodes.value[index]
      dtUtils.deepMerge(node, updates)

      if (node && node.type === 'BOUNDARY') {
        return updateBoundaryNode({ updatedNode: node })
      } else if (node) {
        return updateComponentNode({ updatedNode: node })
      }
    } else {
      console.error(`Node with ID ${nodeId} not found`)
    }
    return false
  }

  const writeLocalClassId = (nodeId: string, classId: string | null): void => {
    const idx = getNodeIndexById({ nodeId })
    if (idx === -1) return
    const cur = nodes.value[idx]
    nodes.value.splice(idx, 1, { ...cur, data: { ...cur.data, classId } })
    nodes.value = [...nodes.value]
  }

  const updateNodeClass = async (
    { nodeId, classId }:
    { nodeId: string, classId: string }
  ): Promise<ChangeElementBindingResult | null> => {
    // Check if this is a temporary node from optimistic update
    if (isPendingNode(nodeId)) {
      console.log(`Queueing class update for temporary node ${nodeId}: ${classId}`)
      queueUpdateForTempNode(nodeId, { classId })
      return null
    }

    try {
      let node: any = null
      if (nodeId === defaultBoundaryId.value) {
        node = defaultBoundary.value
      } else {
        node = getNodeById({ nodeId }) || null
      }
      if (node) {
        const result = await dtClass.changeElementBinding({
          elementId: nodeId,
          target: { kind: 'CLASS', classIds: [classId] },
        })
        if (result.success) writeLocalClassId(nodeId, classId)
        return result
      }
    } catch (error) {
      dtUtils.handleError({ action: 'updateNodeClass', error })
    }
    return null
  }

  const updateComponentNode = async ({ updatedNode }: { updatedNode: Node }): Promise<boolean> => {
    const updatedComponent = await dtComponent.updateComponent({ updatedNode, defaultBoundaryId: defaultBoundaryId.value || '' })
    if (updatedComponent) {
      const index = getNodeIndexById({ nodeId: updatedComponent.id })
      if (index !== -1) {
        // @ts-ignore
        const newNode: Node = {
          ...nodes.value[index],
          id: updatedComponent.id,
          type: updatedComponent.type,
          // Re-derive from the (already deep-merged) in-memory crownJewel — the spread
          // above keeps the stale class, and UPDATE_COMPONENT does not return crownJewel.
          class: crownJewelClass(nodes.value[index].data),
          data: {
            ...nodes.value[index].data,
            label: updatedComponent.name,
            description: updatedComponent.description,
            controls: updatedComponent.controls?.map((control: Control) => control.id),
            dataItems: updatedComponent.dataItems?.map((dataItem: DataItem) => dataItem.id),
          },
          position: {
            x: updatedComponent.positionX,
            y: updatedComponent.positionY,
          },
          parentNode:
            updatedComponent.parentBoundary &&
            updatedComponent.parentBoundary.id !== defaultBoundaryId.value
              ? updatedComponent.parentBoundary.id
              : '',
        }
        nodes.value.splice(index, 1, newNode)
        nodes.value = [...nodes.value]

        // Update selectedItem if it's pointing to the old node
        if (selectedItem.value && selectedItem.value.id === updatedComponent.id) {
          selectedItem.value = newNode
        }

        // Use synchronization helpers
        syncDataItems(updatedComponent.dataItems || [])
        syncControls(updatedComponent.controls || [])
        return true
      }
    }
    return false
  }

  const updateBoundaryNode = async ({ updatedNode }: { updatedNode: Node }): Promise<boolean> => {
    const updatedBoundary = await dtBoundary.updateBoundaryNode({ updatedNode, defaultBoundaryId: defaultBoundaryId.value || '' })
    if (updatedBoundary) {
      if (updatedNode.id === defaultBoundaryId.value) {
        // @ts-ignore
        defaultBoundary.value = {
          ...defaultBoundary.value,
          id: updatedBoundary.id,
          data: {
            ...(defaultBoundary.value ? defaultBoundary.value.data : {}),
            label: updatedBoundary.name,
            description: updatedBoundary.description,
          },
          position: {
            x: updatedBoundary.positionX || 0,
            y: updatedBoundary.positionY || 0,
          },
          width: updatedBoundary.dimensionsWidth || 0,
          height: updatedBoundary.dimensionsHeight || 0,
        }

        // Update selectedItem if it's pointing to the old default boundary
        if (selectedItem.value && selectedItem.value.id === defaultBoundaryId.value) {
          selectedItem.value = defaultBoundary.value
        }

        return true
      } else {
        const index = getNodeIndexById({ nodeId: updatedBoundary.id })
        if (index !== -1) {
          const newNode: Node = {
            ...nodes.value[index],
            id: updatedBoundary.id,
            data: {
              ...nodes.value[index].data,
              label: updatedBoundary.name,
              description: updatedBoundary.description,
              minWidth: updatedBoundary.dimensionsMinWidth,
              minHeight: updatedBoundary.dimensionsMinHeight,
              controls: updatedBoundary.controls?.map((control: Control) => control.id),
              dataItems: updatedBoundary.dataItems?.map((dataItem: DataItem) => dataItem.id),
            },
            position: {
              x: updatedBoundary.positionX || 0,
              y: updatedBoundary.positionY || 0,
            },
            width: updatedBoundary.dimensionsWidth || 0,
            height: updatedBoundary.dimensionsHeight || 0,
            parentNode:
              updatedBoundary.parentBoundary &&
              updatedBoundary.parentBoundary.id !== defaultBoundaryId.value
                ? updatedBoundary.parentBoundary.id
                : '',
          }
          nodes.value.splice(index, 1, newNode)
          nodes.value = [...nodes.value]

          // Update selectedItem if it's pointing to the old node
          if (selectedItem.value && selectedItem.value.id === updatedBoundary.id) {
            selectedItem.value = newNode
          }
          // Use synchronization helpers
          syncDataItems(updatedBoundary.dataItems || [])
          syncControls(updatedBoundary.controls || [])
          return true
        }
      }
    }
    return false
  }

  const deleteComponentNode = async ({ componentId }: { componentId: string }) => {
    if (await dtComponent.deleteComponent({ componentId })) {
      nodes.value = nodes.value.filter(node => node.id !== componentId)
      selectedItem.value = defaultBoundaryId.value ? getNodeById({ nodeId: defaultBoundaryId.value }) || null : null
      return true
    }
    return false
  }

  const deleteBoundaryNode = async ({ boundaryId }: { boundaryId: string }): Promise<boolean> => {
    try {
      const descendants = await dtBoundary.getDescendants({ boundaryId })

      if (descendants) {
        const components: DirectDescendant[] = descendants.components
        const securityBoundaries: DirectDescendant[] = descendants.securityBoundaries

        const nodesToUpdate = [...components, ...securityBoundaries]

        for (const nodeData of nodesToUpdate) {
          const index = getNodeIndexById({ nodeId: nodeData.id })
          if (index !== -1) {
            const currentNode = nodes.value[index]

            // Parent boundary's position (the boundary being deleted)
            const parentPosition = {
              x: nodeData.parentBoundary?.positionX || 0,
              y: nodeData.parentBoundary?.positionY || 0,
            }

            // Grandparent boundary's ID (new parent after deletion)
            const grandparentId = nodeData.parentBoundary?.parentBoundary?.id || defaultBoundaryId.value || ''
            // Adjust position by adding parent boundary's position to current position
            const newPosition = {
              x: parentPosition.x + currentNode.position.x,
              y: parentPosition.y + currentNode.position.y,
            }
            const updates = {
              parentNode: grandparentId,
              position: newPosition,
            }

            // Update the node with new parent and adjusted position
            await updateNode({ nodeId: nodeData.id, updates })
          }
        }
      }

      // Delete the boundary after updating child nodes
      if (await dtBoundary.deleteBoundary({ boundaryId })) {
        nodes.value = nodes.value.filter(node => node.id !== boundaryId)
        selectedItem.value = defaultBoundaryId.value ? getNodeById({ nodeId: defaultBoundaryId.value }) || null : null
        return true
      }
      return false
    } catch (error) {
      dtUtils.handleError({ action: 'deleteBoundaryNode', error })
      throw error
    }
  }

  /// ////////////////////////////////
  // Edge operations

  const createDataFlow = async ({ newEdge, classId }: { newEdge: Edge, classId: string }): Promise<boolean> => {
    const createdDataFlow = await dtDataflow.createDataFlow({ newEdge, classId })
    if (createdDataFlow) {
      edges.value.push(createdDataFlow)
      selectedItem.value = createdDataFlow
      return true
    }
    return false
  }

  const updateDataFlow = async ({ edgeId, updates }: { edgeId: string, updates: object }): Promise<boolean> => {
    const index = edges.value.findIndex(edge => edge.id === edgeId)
    if (index !== -1) {
      const edge = edges.value[index]
      const updatedDataFlow = await dtDataflow.updateDataFlow({ edge, updates })

      if (updatedDataFlow) {
        const idx = edges.value.findIndex(edge => edge.id === updatedDataFlow.id)
        if (idx !== -1) {
          const newEdge: Edge = {
            ...edges.value[idx],
            id: updatedDataFlow.id,
            label: updatedDataFlow.name,
            data: {
              description: updatedDataFlow.description,
              controls: updatedDataFlow.controls?.map((control: Control) => control.id),
              dataItems: updatedDataFlow.dataItems?.map((dataItem: DataItem) => dataItem.id),
            },
            source: updatedDataFlow.source.id,
            target: updatedDataFlow.target.id,
            sourceHandle: updatedDataFlow.sourceHandle,
            targetHandle: updatedDataFlow.targetHandle,
            markerEnd: 'arrowclosed',
          }
          edges.value.splice(idx, 1, newEdge)
          edges.value = [...edges.value]

          // Update selectedItem if it's pointing to the old edge
          if (selectedItem.value && selectedItem.value.id === updatedDataFlow.id) {
            selectedItem.value = newEdge
          }

          // Use synchronization helpers
          syncDataItems(updatedDataFlow.dataItems || [])
          syncControls(updatedDataFlow.controls || [])
          return true
        }
      }
    }
    return false
  }

  const updateDataFlowClass = async (
    { dataFlowId, classId }: { dataFlowId: string, classId: string }
  ): Promise<ChangeElementBindingResult | null> => {
    try {
      return await dtClass.changeElementBinding({
        elementId: dataFlowId,
        target: { kind: 'CLASS', classIds: [classId] },
      })
    } catch (error) {
      dtUtils.handleError({ action: 'updateDataFlowClass', error })
      return null
    }
  }

  const deleteDataFlow = async ({ dataFlowId }: { dataFlowId: string }) => {
    if (await dtDataflow.deleteDataFlow({ dataFlowId })) {
      edges.value = edges.value.filter(edge => edge.id !== dataFlowId)
      dataItems.value = dataItems.value.filter(data => !data.elements?.some(element => element.id === dataFlowId))
      controls.value = controls.value.filter(control => !control.controlClasses?.some(cls => cls.id === dataFlowId))
      return true
    }
    return false
  }

  /// ////////////////////////////////
  // DataItem functions
  const createDataItem = async (
    { name, description, classId, elementId, sensitivity, regulatoryFlags }:
    { name: string, description: string, elementId: string, classId: string | null, sensitivity?: string | null, regulatoryFlags?: string[] }
  ): Promise<DataItem | null> => {
    const operationKey = 'createDataItem'
    
    try {
      // Validate input data
      const validationErrors = validateDataItem({ name, description, elementId })
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`)
      }
      
      clearError(operationKey)
      setOperationLoading(operationKey, true)
      
      const createdDataItem = await dtDataItem.createDataItem({
        name,
        description,
        classId,
        elementId,
        modelId: modelId.value || '',
        sensitivity: sensitivity ?? undefined,
        regulatoryFlags,
      })
      
      if (!createdDataItem) {
        throw new Error('Failed to create data item')
      }
      
      dataItems.value.push(createdDataItem)

      // ADD_DATA_ITEM doesn't return `elements` in its selection set, so we can't loop on
      // createdDataItem.elements — use the elementId we passed into the mutation as the
      // authoritative link target. Update node.data.dataItems / edge.data.dataItems via
      // fresh-array reassignment so Vue's reactivity picks up the change in
      // SettingsDataTab's `incomingDataMatches` filter.
      const nodeIdx = nodes.value.findIndex(n => n.id === elementId)
      if (nodeIdx !== -1) {
        const node = nodes.value[nodeIdx]
        node.data.dataItems = [...(node.data.dataItems ?? []), createdDataItem.id]
      } else {
        const edgeIdx = edges.value.findIndex(e => e.id === elementId)
        if (edgeIdx !== -1) {
          const edge = edges.value[edgeIdx]
          edge.data.dataItems = [...(edge.data.dataItems ?? []), createdDataItem.id]
        }
      }
      // selectedItem may be a different reference path than nodes.value[i] / edges.value[i]
      // (vue-flow's internal model can hand back the same logical node via a distinct ref).
      // Keep it in sync so children binding through props.selectedItem.data.dataItems also
      // see the new id without waiting for a full model refetch.
      if (selectedItem.value && selectedItem.value.id === elementId) {
        const sel = selectedItem.value as Node | Edge
        sel.data = { ...sel.data, dataItems: [...(sel.data?.dataItems ?? []), createdDataItem.id] }
      }
      
      return createdDataItem
    } catch (error) {
      const errorMessage = handleApiError(error as Error, 'create data item')
      setError(operationKey, errorMessage)
      return null
    } finally {
      setOperationLoading(operationKey, false)
    }
  }

  const getDataItem = ({ dataItemId }: { dataItemId: string }): DataItem | undefined => {
    return dataItems.value.find(data => data.id === dataItemId)
  }

  const updateDataItem = async (
    { dataItemId, name, description, classId, sensitivity, regulatoryFlags }:
    { dataItemId: string | null, name: string, description: string, classId?: string | null, sensitivity?: string | null, regulatoryFlags?: string[] }
  ): Promise<boolean> => {
    if (!dataItemId) return false
    
    const operationKey = `updateDataItem-${dataItemId}`
    
    try {
      // Validate input data
      const validationErrors = validateDataItem({ name, description, elementId: dataItemId })
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`)
      }
      
      clearError(operationKey)
      setOperationLoading(operationKey, true)
      
      const { dataItem: updatedDataItem, bindingResult, residualOk } = await dtDataItem.updateDataItem({
        dataItemId,
        name,
        description,
        classId,
        // Asset-context rides the same update. dt-core uses REPLACE semantics
        // (an omitted value clears the platform field), so the dialog always
        // sends the current values — see DataDialog seeding them on load.
        sensitivity: sensitivity ?? undefined,
        regulatoryFlags,
      })

      if (bindingResult?.errorCode) {
        throw new Error(bindingResult.errorMessage ?? `Failed to update data item binding (${bindingResult.errorCode})`)
      }
      if (!residualOk || !updatedDataItem) {
        throw new Error('Failed to update data item')
      }

      const idx = dataItems.value.findIndex(data => data.id === dataItemId)
      if (idx !== -1) {
        dataItems.value.splice(idx, 1, updatedDataItem)
        dataItems.value = [...dataItems.value]
      }
      
      return true
    } catch (error) {
      const errorMessage = handleApiError(error as Error, 'update data item')
      setError(operationKey, errorMessage)
      dtUtils.handleError({ action: 'updateData', error })
      return false
    } finally {
      setOperationLoading(operationKey, false)
    }
  }

  const deleteDataItem = async ({ dataItemId }: { dataItemId: string }): Promise<boolean> => {
    if (await dtDataItem.deleteDataItem({ dataItemId })) {
      dataItems.value = dataItems.value.filter(data => data.id !== dataItemId)
      return true
    }
    return false
  }

  /// ////////////////////////////////
  // Exposures

  const getExposures = async ({ elementId }: { elementId: string }): Promise<Exposure[]> => {
    return dtExposure.getExposures({ elementId })
  }

  const getExposure = async ({ exposureId }: { exposureId: string }): Promise<Exposure> => {
    return dtExposure.getExposure({ exposureId })
  }

  const createExposure = async (
    { exposure, elementId, attackTechniqueIds }:
    { exposure: Exposure, elementId: string, attackTechniqueIds: string[] }
  ): Promise<Exposure> => {
    return dtExposure.createExposure({ exposure, elementId, attackTechniqueIds })
  }

  const updateExposure = async (
    { exposureId, exposure, attackTechniqueIds }:
    { exposureId: string, exposure: Exposure, attackTechniqueIds: string[] }
  ): Promise<Exposure> => {
    return dtExposure.updateExposure({ exposureId, exposure, attackTechniqueIds })
  }

  /**
   * Delete an exposure.
   *
   * For USER-authored deletes, the dt-core wrapper fires
   * a fire-and-forget companion `updateExposures` that flips `dispositionStale`
   * on any SYSTEM exposure whose disposition reason names the deleted USER copy.
   * The store captures the exposure name before delete and passes it through.
   */
  const deleteExposure = async (
    { exposureId, exposureName }: { exposureId: string, exposureName?: string }
  ): Promise<boolean> => {
    return dtExposure.deleteExposure({ exposureId, exposureName })
  }

  /**
   * Author or replace a disposition on an exposure.
   * dt-core returns a result envelope — domain errors (validation, not-found)
   * come back with success=false + errorCode; transport errors propagate.
   */
  const disposeExposure = async (
    { exposureId, kind, reason }:
    { exposureId: string, kind: DispositionKind, reason: string }
  ): Promise<DispositionMutationResult> => {
    return dtExposure.disposeExposure({ exposureId, kind, reason })
  }

  /**
   * Clear a disposition. Idempotent.
   */
  const clearDisposition = async (
    { exposureId }: { exposureId: string }
  ): Promise<DispositionMutationResult> => {
    return dtExposure.clearDisposition({ exposureId })
  }

  /**
   * Supersede flow — frontend-orchestrated.
   *
   * Composes createExposure + disposeExposure(SUPERSEDED) via the pure dt-core
   * helper. Returns the full result so the caller (SettingsExposuresTab) can
   * render the partial-failure snackbar with a Retry action when step 2 fails
   * but step 1 succeeded.
   */
  const supersedeExposure = async (
    { exposureId, elementId, exposure }:
    { exposureId: string, elementId: string, exposure: Exposure }
  ): Promise<{ userCopy: Exposure, systemDispositionResult: DispositionMutationResult }> => {
    return executeSupersedeFlow({
      systemExposureId: exposureId,
      systemExposure: exposure,
      elementId,
      dtExposure,
    })
  }

  /// ////////////////////////////////
  // Class related functions

  const getComponentClass = async ({ componentId }: { componentId: string }): Promise<Class | undefined> => { return dtClass.getComponentClass({ componentId }) }
  const getBoundaryClass = async ({ boundaryId }: { boundaryId: string }): Promise<Class | undefined> => { return dtClass.getBoundaryClass({ boundaryId }) }
  const getDataFlowClass = async ({ dataFlowId }: { dataFlowId: string }): Promise<Class | undefined> => { return dtClass.getDataFlowClass({ dataFlowId }) }
  const getDataClass = async ({ dataClassId }: { dataClassId: string }): Promise<Class | undefined> => { return dtClass.getDataClass({ dataClassId }) }

  const setInstantiationAttributes = async ({ componentId, classId, attributes }: { componentId: string, classId: string, attributes: object }): Promise<boolean> => {
    return dtClass.setInstantiationAttributes({ componentId, classId, attributes })
  }

  /**
   * Picker save path needs `staleFlippedCount` to
   * drive the "N need review" badge on SettingsExposuresTab without a
   * follow-up exposures refetch. Wraps the dt-core sibling method that
   * selects the extra field.
   */
  const setInstantiationAttributesWithStaleCount = async (
    { componentId, classId, attributes }:
    { componentId: string, classId: string, attributes: object }
  ): Promise<{ success: boolean, staleFlippedCount: number | null }> => {
    return dtClass.setInstantiationAttributesWithStaleCount({ componentId, classId, attributes })
  }
  const getAttributesFromClassRelationship = async ({ componentId, classId }: { componentId: string, classId: string }): Promise<object> => {
    return dtClass.getAttributesFromClassRelationship({ componentId, classId })
  }

  /// ////////////////////////////////
  // Mitre Attack functions

  const getMitreAttackTechniquesByTactic = async ({ tacticId }: { tacticId: string }): Promise<MitreAttackTechnique[]> => {
    return dtMitreAttack.getMitreAttackTechniquesByTactic({ tacticId })
  }

  const findMitreAttackTechniques = async ({ query }: { query: object }): Promise<MitreAttackTechnique[]> => {
    return dtMitreAttack.findMitreAttackTechniques({ query })
  }

  const fetchMitreAttackTactics = async (): Promise<MitreAttackTactic[]> => {
    const tactics = await dtMitreAttack.getMitreAttackTactics()
    if (tactics) {
      mitreAttackTactics.value = tactics
      return tactics
    }
    return []
  }

  // Data fetching

  const fetchData = async ({ model }: { model: string }) => {
    activeModelLoad = model
    nodes.value = []
    edges.value = []
    defaultBoundaryId.value = undefined
    modelId.value = model

    const results = await dtModel.dumpModelData({ modelId: model || '' })
    // A newer fetchData superseded us; drop the write to avoid corrupting the store.
    if (activeModelLoad !== model) return null

    if (results) {
      defaultBoundaryId.value = results.defaultBoundary?.id || ''
      defaultBoundary.value = results.defaultBoundary || null
      nodes.value = [
        ...results.components.map((n: Node) => ({ ...n, class: crownJewelClass(n.data) })),
        ...results.boundaries,
      ]
      await nextTick()
      edges.value = results.dataFlows
      await nextTick()
      dataItems.value = results.dataItems
      modules.value = results.modules
      return results
    }
    return null
  }

  const fetchControls = async () => {
    controls.value = await dtControl.getControls({ folderId: 'all' })
  }

  return {
    // State variables
    nodes, edges, defaultBoundary, defaultBoundaryId, selectedItem, currentModel, modelId,
    controls, dataItems, modules, mitreAttackTactics,

    // UI preferences
    editMode,

    // Error and loading states
    errors, isLoading, operationStates,

    // Error handling functions
    setError, clearError, clearAllErrors,
    
    // Loading state functions
    setOperationLoading, isOperationLoading,
    
    // Temporary node helpers
    isPendingNode, getRealNodeId, queueUpdateForTempNode, applyDeferredUpdates,
    
    // Utility functions
    setSelectedItem, getNodeById, resetStore,
    
    // Module functions
    resetModule, getModuleByName, getModuleById,
    
    // Model functions
    getModels, getComponentRepresentedModel, getBoundaryRepresentedModel,
    updateRepresentedModel,
    
    // Node functions
    createComponentNode, createBoundaryNode, updateNode, updateNodeClass, updateComponentNode,
    updateBoundaryNode, deleteComponentNode, deleteBoundaryNode,

    // Edge / DataFlow functions
    createDataFlow, updateDataFlow, updateDataFlowClass, deleteDataFlow,
    
    // Data functions
    createDataItem, getDataItem, updateDataItem, deleteDataItem,
    
    // Exposures
    getExposures, getExposure, createExposure, updateExposure, deleteExposure,

    // Disposition + supersede surface
    disposeExposure, clearDisposition, supersedeExposure,

    // Class related functions
    getComponentClass, getBoundaryClass, getDataFlowClass, getDataClass,
    setInstantiationAttributes, setInstantiationAttributesWithStaleCount,
    getAttributesFromClassRelationship,
    
    // Data fetching
    getModelData, setModelId, fetchData, fetchControls,
    
    // Mitre Attack functions
    getMitreAttackTechniquesByTactic, findMitreAttackTechniques, fetchMitreAttackTactics,
  }
})
