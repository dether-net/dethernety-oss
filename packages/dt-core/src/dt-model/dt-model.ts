import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { Model, ComponentData, BoundaryData, DataFlowData, DataItem, Module } from '../interfaces/core-types-interface.js'
import { flattenConduits } from '../dt-boundary/boundary-zoning-utils.js'
import { connectIds, assertConnectId } from '../dt-utils/connect-id.js'
import { linkInput, LinkBaselines } from '../dt-utils/link-delta.js'
import { ModelScopeLocal, localScopeToPlatform } from '../schemas/index.js'
import { Node, Edge } from '@vue-flow/core'

import {
  CREATE_MODEL,
  DELETE_MODEL,
  GET_MODELS,
  DUMP_MODEL_DATA,
  GET_NOT_REPRESENTING_MODELS,
  UPDATE_MODEL,
} from './dt-model-gql.js'

export class DtModel {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  /**
   * Get the models
   * @returns The models
   */
  getModels = async ({ folderId }: { folderId?: string | undefined }): Promise<Model[]> => {
    try {
      let query = null
      if (folderId) {
        query = {
          folder: {
            single: {
              id: { eq: folderId },
            },
          },
        }
      } else {
        query = { folder: { none: null } }
      }

      const response = await this.dtUtils.performQuery<{ models: Model[] }>({
        query: GET_MODELS,
        variables: { query },
        action: 'getModels',
        fetchPolicy: 'network-only'
      })

      // Return empty array for no results, throw for actual errors
      return response.models?.map((model: Model) => ({
        ...model,
        folder: model.folder && Array.isArray(model.folder) && model.folder.length > 0
          ? model.folder[0]
          : model.folder,
      })) || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get the models that are not representing the given model
   * @param modelId - The ID of the model to get the not representing models for
   * @returns The models that are not representing the given model
   */
  getNotRepresentingModels = async ({ modelId }: { modelId: string }): Promise<Model[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ getNotRepreseningModels: Model[] }>({
        query: GET_NOT_REPRESENTING_MODELS,
        variables: { modelId },
        action: 'getNotRepresentingModels',
        fetchPolicy: 'network-only'
      })
      
      return response.getNotRepreseningModels || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Dump the model data
   * @param modelId - The ID of the model to dump the data for
   * @returns The model data
   */
  dumpModelData = async ({ modelId }: { modelId: string }) => {
    try {
      const response = await this.dtUtils.performQuery<any>({
        query: DUMP_MODEL_DATA,
        variables: { modelId },
        action: 'dumpModelData',
        fetchPolicy: 'network-only'
      })

      const value = response
        let results: {
          currentModel: Model | null
          components: Node[]
          boundaries: Node[]
          dataFlows: Edge[]
          dataItems: DataItem[]
          modules: Module[]
          defaultBoundary: Node | null
        } = {
          currentModel: null,
          components: [],
          boundaries: [],
          dataFlows: [],
          dataItems: [],
          modules: [],
          defaultBoundary: null,
        }

        if (value && value.models && value.models.length > 0) {
          const model = value.models[0]
          results.currentModel = {
            id: model.id,
            name: model.name,
            description: model.description,
            controls: model.controls?.map((control: { id: any }) => control.id),
          }
          if (model.defaultBoundary) {
            const rootBoundary = Array.isArray(model.defaultBoundary) && model.defaultBoundary.length > 0
              ? model.defaultBoundary[0]
              : model.defaultBoundary
            const defaultBoundary = {
              id: rootBoundary.id,
              position: { x: 0, y: 0 },
              type: 'BOUNDARY',
              data: {
                label: rootBoundary.name,
                description: rootBoundary.description,
                controls: rootBoundary.controls?.map((boundary: { id: any }) => boundary.id),
                dataItems: rootBoundary.dataItems?.map((data: { id: any }) => data.id),
              },
            }
            results.defaultBoundary = defaultBoundary

            const firstId = (arr: { id: string }[] | undefined): string | null =>
              arr && arr.length > 0 ? arr[0].id : null
            const mapComponent = (component: ComponentData): Node => ({
              id: component.id,
              type: component.type,
              position: { x: component.positionX, y: component.positionY },
              data: {
                label: component.name,
                description: component.description,
                controls: component.controls?.map(control => control.id),
                dataItems: component.dataItems?.map(dataItem => dataItem.id),
                classId: firstId(component.componentClass),
                representedModelId: firstId(component.representedModel),
                crownJewel: component.crownJewel,
              },
              parentNode:
                Array.isArray(component.parentBoundary) &&
                component.parentBoundary.length > 0 &&
                component.parentBoundary[0].id !== defaultBoundary.id
                  ? component.parentBoundary[0].id
                  : '',
            })

            const mapBoundary = (boundary: BoundaryData): Node => ({
              id: boundary.id,
              type: 'BOUNDARY',
              position: { x: boundary.positionX || 0, y: boundary.positionY || 0 },
              data: {
                label: boundary.name,
                description: boundary.description,
                controls: boundary.controls?.map(boundary => boundary.id),
                minWidth: boundary.dimensionsMinWidth,
                minHeight: boundary.dimensionsMinHeight,
                dataItems: boundary.dataItems?.map(dataItem => dataItem.id),
                classId: firstId(boundary.securityBoundaryClass),
                representedModelId: firstId(boundary.representedModel),
                zone: boundary.zone,
                domains: boundary.domains,
                planes: boundary.planes,
                conduits: flattenConduits(boundary),
              },
              width: boundary.dimensionsWidth || 0,
              height: boundary.dimensionsHeight || 0,
              parentNode:
                Array.isArray(boundary.parentBoundary) &&
                boundary.parentBoundary.length > 0 &&
                boundary.parentBoundary[0].id !== defaultBoundary.id
                  ? boundary.parentBoundary[0].id
                  : '',
            })
            const mapDataFlow = (dataFlow: DataFlowData): Edge => ({
              id: dataFlow.id,
              label: dataFlow.name,
              data: {
                description: dataFlow.description,
                controls: dataFlow.controls?.map(control => control.id),
                dataItems: dataFlow.dataItems?.map(dataItem => dataItem.id),
              },
              source: Array.isArray(dataFlow.source) ? dataFlow.source[0]?.id : undefined,
              target: Array.isArray(dataFlow.target) ? dataFlow.target[0]?.id : undefined,
              sourceHandle: dataFlow.sourceHandle,
              targetHandle: dataFlow.targetHandle,
              markerEnd: 'arrowclosed',
            })
            results.components = rootBoundary.allDescendantComponents.map(mapComponent)
            results.boundaries = rootBoundary.allDescendantBoundaries.map(mapBoundary)
            results.dataFlows = rootBoundary.allDescendantDataFlows.map(mapDataFlow)
          }
          if (model.dataItems) {
            results.dataItems = model.dataItems.map((dataItem: DataItem) => ({
              ...dataItem,
              dataClass: dataItem.dataClass && Array.isArray(dataItem.dataClass) && dataItem.dataClass.length > 0
                ? dataItem.dataClass[0]
                : dataItem.dataClass,
            }))
          }
          if (model.modules) {
            results.modules = model.modules
          }
        }
        return results
      } catch (error) {
        throw error
      }
    }

  /**
   * Get the model data
   * @param modelId - The ID of the model to get the data for
   * @returns The model data
   */
  getModelData = async ({ modelId }: { modelId: string }): Promise<any> => {
    try {
      const response = await this.dtUtils.performQuery<{ models: any[] }>({
        query: DUMP_MODEL_DATA,
        variables: { modelId },
        action: 'getModelData',
        fetchPolicy: 'network-only'
      })
      
      if (response.models && response.models.length > 0) {
        const model = response.models[0]
          return {
            ...model,
            // Flatten the array-shaped `folder` relationship to a single object (mirrors
            // getModel). Lets the update orchestrator preserve the model's folder by
            // re-passing existingModel.folder?.id instead of unlinking it every push.
            folder: Array.isArray(model.folder) && model.folder.length > 0
              ? model.folder[0]
              : model.folder,
            defaultBoundary: Array.isArray(model.defaultBoundary) && model.defaultBoundary.length > 0
              ? {
                ...model.defaultBoundary[0],
                allDescendantComponents: model.defaultBoundary[0].allDescendantComponents.map((component: ComponentData) => ({
                  ...component,
                  parentBoundary: Array.isArray(component.parentBoundary) && component.parentBoundary.length > 0
                    ? component.parentBoundary[0]
                    : '',
                })),
                allDescendantBoundaries: model.defaultBoundary[0].allDescendantBoundaries.map((boundary: BoundaryData) => ({
                  ...boundary,
                  parentBoundary: Array.isArray(boundary.parentBoundary) && boundary.parentBoundary.length > 0
                    ? boundary.parentBoundary[0]
                    : '',
                })),
                allDescendantDataFlows: model.defaultBoundary[0].allDescendantDataFlows.map((dataFlow: DataFlowData) => ({
                  ...dataFlow,
                  source: Array.isArray(dataFlow.source) && dataFlow.source.length > 0
                    ? dataFlow.source[0]
                    : '',
                  target: Array.isArray(dataFlow.target) && dataFlow.target.length > 0
                    ? dataFlow.target[0]
                    : '',
                })),
              }
              : model.defaultBoundary,
            dataItems: model.dataItems.map((dataItem: DataItem) => ({
              ...dataItem,
              dataClass: dataItem.dataClass && Array.isArray(dataItem.dataClass) && dataItem.dataClass.length > 0
                ? dataItem.dataClass[0]
                : dataItem.dataClass,
            })),
          }
        }
        return null
      } catch (error) {
        throw error
      }
    }

  getModel = async ({ modelId }: { modelId: string }): Promise<Model | null> => {
    try {
      const query = { id: { eq: modelId } }
      const response = await this.dtUtils.performQuery<{ models: Model[] }>({
        query: GET_MODELS,
        variables: { query },
        action: 'getModel',
        fetchPolicy: 'network-only'
      })
      
      if (response.models && response.models.length > 0) {
        return {
          ...response.models[0],
          folder: response.models[0].folder && Array.isArray(response.models[0].folder) && response.models[0].folder.length > 0
            ? response.models[0].folder[0]
            : response.models[0].folder,
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Create a model
   * @param name - The name of the model
   * @param description - The description of the model
   * @param modules - The modules of the model
   * @param folderId - The ID of the folder to create the model in
   * @returns The created model
   */
  createModel = async (
    { name, description, modules, folderId, scope, controls }:
    { name: string, description: string, modules: string[], folderId: string | undefined, scope?: ModelScopeLocal, controls?: string[] }
  ): Promise<Model> => {
    try {
      const defaultBoundaryName = `Default Boundary`
      // Asset-context scope on create: set present fields only (a fresh node has
      // nothing to clear). Flat camelCase platform values, enums SCREAMING_SNAKE.
      const p = scope ? localScopeToPlatform(scope) : undefined
      const scopeCreate = p ? {
        ...(p.depth ? { depth: p.depth } : {}),
        ...(p.modelingIntent ? { modelingIntent: p.modelingIntent } : {}),
        ...(p.complianceDrivers ? { complianceDrivers: p.complianceDrivers } : {}),
        ...(p.exclusions ? { exclusions: p.exclusions } : {}),
        ...(p.trustAssumptions ? { trustAssumptions: p.trustAssumptions } : {}),
      } : {}
      const mutationInput = {
        name,
        description,
        ...scopeCreate,
        defaultBoundary: {
          create: {
            node: {
              name: defaultBoundaryName,
              trustLevel: 'UNTRUSTED',
            },
          },
        },
        modules: {
          connect: modules.map(module => ({
            where: { node: { id: { eq: module } } },
          })),
        },
        // Model-level controls connected at create time (SUPPORTS). Create-only
        // connect — no disconnect — so it never clears anything and never touches
        // the folder relationship. Omitted when there are none.
        ...(controls && controls.length > 0
          ? {
              controls: {
                connect: controls.map(id => ({
                  where: { node: { id: { eq: id } } },
                })),
              },
            }
          : {}),
        folder: { }
      }
      if (folderId) {
        mutationInput.folder = {
          connect: {
            where: { node: { id: { eq: folderId } } },
          },
        }
      }
      
      const response = await this.dtUtils.performMutation<{ createModels: { models: Model[] } }>({
        mutation: CREATE_MODEL,
        variables: { input: [mutationInput] },
        dataPath: '',
        action: 'createModel',
        deduplicationKey: `create-model-${name}-${folderId || 'no-folder'}`
      })
      
      if (!response?.createModels?.models?.length) {
        throw new Error('No model returned from create operation')
      }
      
      return {
        ...response.createModels.models[0],
        folder: response.createModels.models[0].folder && Array.isArray(response.createModels.models[0].folder) && response.createModels.models[0].folder.length > 0
          ? response.createModels.models[0].folder[0]
          : response.createModels.models[0].folder,
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a model.
   *
   * EVERY FIELD BUT THE ID IS OPTIONAL, and a field that is not supplied is not written. That is the
   * same contract the component, boundary and data-flow writers keep, and this was the one writer
   * without it: it emitted name, description, modules, controls and folder unconditionally, so a caller
   * that only wanted to rename a model rewrote everything else about it from whatever it had loaded —
   * including a module another user had just assigned.
   *
   * @param id - The ID of the model to update
   * @param baselineLinks - What the caller knew the controls to be before this edit, if it knows
   * @returns The updated model
   */
  updateModel = async (
    { id, name, description, modules, controls, folderId, scope, baselineLinks }:
    {
      id: string,
      name?: string,
      description?: string,
      // The two link lists are typed loosely on purpose: they are built by mapping id fields that are
      // optional on the shared types, so an entry that is not an id is a shape the caller can produce and
      // this writer has to survive.
      modules?: (string | undefined)[],
      controls?: (string | undefined)[],
      folderId?: string,
      scope?: ModelScopeLocal,
      baselineLinks?: LinkBaselines,
    }
  ): Promise<Model> => {
    try {
      // Asset-context scope on update: REPLACE (local authoritative). When scope
      // is supplied with at least one valid field, set all five — clearing the
      // ones absent within the scope ({ set: null }/{ set: [] }). When scope is
      // omitted entirely (p === undefined), emit no scope keys so the platform's
      // scope is left untouched (no blanket wipe). Callers that don't sync scope
      // (e.g. the modules-only update) simply pass no scope.
      const p = scope ? localScopeToPlatform(scope) : undefined
      const scopeUpdate = p ? {
        depth: { set: p.depth ?? null },
        modelingIntent: { set: p.modelingIntent ?? null },
        complianceDrivers: { set: p.complianceDrivers ?? [] },
        exclusions: { set: p.exclusions ?? [] },
        trustAssumptions: { set: p.trustAssumptions ?? [] },
      } : {}
      // THE CONTROLS ARE WRITTEN AS A DELTA WHEN THE CALLER CAN SAY WHAT THEY WERE, and as a whole-list
      // replace when it cannot. THE MODULES ARE ALWAYS A REPLACE, and the asymmetry is deliberate: the
      // settings dialog can edit the control list, so it holds a baseline and its save composes with
      // somebody else's; nothing edits a model's modules except the push path, which asserts them whole
      // and has no earlier state to compare against.
      //
      // Both lists are filtered before any operand is built. An entry that is not a usable id would
      // build a connect whose filter carries no condition, and that does not connect nothing: it
      // connects EVERY module, or every control, in the deployment.
      const controlsInput = linkInput(controls, baselineLinks, 'controls')
      const mutationInput: Record<string, unknown> = {
        ...(name !== undefined && { name: { set: name } }),
        ...(description !== undefined && { description: { set: description } }),
        ...scopeUpdate,
        ...(modules !== undefined && {
          modules: {
            disconnect: {},
            connect: connectIds(modules).map(module => ({
              where: { node: { id: { eq: module } } },
            })),
          },
        }),
        ...(controlsInput !== undefined && { controls: controlsInput }),
        // A named folder is a move. An empty one is the root — and a model's root is the ABSENCE of a
        // folder rather than a node to connect to, so it disconnects and connects nothing. That is the
        // same intent an empty parent carries on the canvas, where the root happens to be a real node.
        // No folder at all is neither: the model stays where it is, and the key is not written. Only
        // the empty string carries the root meaning, so anything else that cannot name a folder refuses
        // rather than silently unfiling the model.
        ...(folderId !== undefined && {
          folder: folderId === ''
            ? { disconnect: {} }
            : {
                disconnect: {},
                connect: {
                  where: { node: { id: { eq: assertConnectId(folderId, 'folder') } } },
                },
              },
        }),
      }
      
      const response = await this.dtUtils.performMutation<{ updateModels: { models: Model[] } }>({
        mutation: UPDATE_MODEL,
        variables: { id, input: mutationInput },
        dataPath: '',
        action: 'updateModel',
        // The key carries WHICH FIELDS are being written, not just which model. Deduplication joins an
        // in-flight request under the same key and returns its result, which is right for a double
        // submit of one act and wrong for two different ones: a folder move still in flight would
        // otherwise swallow a rename clicked a moment later and report it saved.
        deduplicationKey: `update-model-${id}-${Object.keys(mutationInput).sort().join('.')}`
      })
      
      if (!response?.updateModels?.models?.length) {
        throw new Error('No model returned from update operation')
      }
      
      return response.updateModels.models[0]
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete a model
   * @param modelId - The ID of the model to delete
   * @returns True if the model was deleted, false otherwise
   */
  deleteModel = async ({ modelId }: { modelId: string }):
  Promise<{ nodesDeleted: number, relationshipsDeleted: number } | null> => {
    try {
      const mutationInput = { modelId }
      const response = await this.dtUtils.performMutation<{ deleteModel: { nodesDeleted: number, relationshipsDeleted: number } }>({
        mutation: DELETE_MODEL,
        variables: mutationInput,
        dataPath: '',
        action: 'deleteModel',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return response?.deleteModel || null
    } catch (error) {
      throw error
    }
  }
}
