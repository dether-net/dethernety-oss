import { DtUtils } from '../dt-utils/dt-utils.js'
import { DtClass, ChangeElementBindingResult } from '../dt-class/dt-class.js'
import * as Apollo from '@apollo/client'
import { Class, Control, ControlCandidate, ControlGapsResult, Element as DtElement } from '../interfaces/core-types-interface.js'

/**
 * Bundled-method return shape: the residual UPDATE_CONTROL surfaces `control`,
 * the binding portion of the call surfaces `bindingResult`. Either half may be
 * null (binding skipped when `controlClasses` not passed; control null on
 * residual failure). `residualOk` is the boolean view of the residual call.
 *
 * `ControlDialog.vue` reads `bindingResult` for the delta-receipt snackbar
 * and may fire a second residual-failure toast when `residualOk === false`.
 */
export interface UpdateControlResult {
  control: Control | null
  bindingResult: ChangeElementBindingResult | null
  residualOk: boolean
}
import {
  CREATE_CONTROL,
  DELETE_CONTROL,
  GET_CONTROLS,
  UPDATE_CONTROL,
  FIND_CONTROLS,
  CONTROL_IDS_BY_ELEMENTS,
  CONTROL_GAPS,
  CONTROL_CANDIDATES_FOR_TYPE,
  ASSIGN_CONTROL_TO_ELEMENTS,
  GET_CONTROLS_BY_IDS,
  GET_CONTROLS_ASSIGNED_MODELS,
  GET_CONTROL_INSTANTIATION_ATTRIBUTES,
} from './dt-control-gql.js'

export class DtControl {
  private dtUtils: DtUtils
  private dtClass: DtClass
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
    this.dtClass = new DtClass(this.apolloClient)
  }

  /**
   * Get all controls
   * @returns An array of controls or null if an error occurs
   */
  getControls = async ({ folderId }: { folderId?: string | undefined }): Promise<Control[]> => {
    try {
      let query = null
      if (folderId) {
        if (folderId === 'all') {
          query = null
        } else {
          query = { folder: { single: { id: { eq: folderId }, }, }, }
        }
      } else {
        query = { folder: { none: null } }
      }
      
      const response = await this.dtUtils.performQuery<{ controls: Control[] }>({
        query: GET_CONTROLS,
        variables: { query },
        action: 'getControls',
        fetchPolicy: 'network-only'
      })
      
      if (response.controls) {
        const controls = response.controls.map((control: Control) => ({
          ...control,
          folder: control.folder && Array.isArray(control.folder) && control.folder.length > 0
            ? control.folder[0]
            : control.folder,
          controlClasses: control.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }))
        return controls
      }
      return []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get a control
   * @param controlId - The ID of the control
   * @returns The control or null if an error occurs
   */
  getControl = async ({ controlId }: { controlId: string | undefined }): Promise<Control | null> => {
    if (!controlId) return null

    try {
      const query = { id: { eq: controlId }, }
      const response = await this.dtUtils.performQuery<{ controls: Control[] }>({
        query: GET_CONTROLS,
        variables: { query },
        action: 'getControl',
        fetchPolicy: 'network-only'
      })
      
      if (response.controls && response.controls.length > 0) {
        const control = response.controls[0]
        return {
          ...control,
          folder: control.folder && Array.isArray(control.folder) && control.folder.length > 0
            ? control.folder[0]
            : control.folder,
          controlClasses: control.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Create a control
   * @param newControl - The new control
   * @param classIds - The IDs of the classes
   * @returns The created control or null if an error occurs
   */
  createControl = async (
    { newControl, classIds, folderId }:
    { newControl: Control, classIds: string[] | null, folderId: string | undefined }
  ): Promise<Control | null> => {
    try {
      const mutuationInput = {
        name: newControl.name,
        description: newControl.description,
        controlClasses: {
          connect: classIds?.map(classId => ({
            where: {
              node: { id: { eq: classId } },
            },
          })),
        },
        folder: { },
      }
      if (folderId) {
        mutuationInput.folder = {
          connect: {
            where: { node: { id: { eq: folderId } } },
          },
        }
      }
      
      const result = await this.dtUtils.performMutation<Control>({
        mutation: CREATE_CONTROL,
        variables: { input: [mutuationInput] },
        dataPath: 'createControls.controls[0]',
        action: 'createControl',
        deduplicationKey: `create-control-${newControl.name}-${folderId || 'no-folder'}`
      })
      
      if (result) {
        return {
          ...result,
          folder: result.folder && Array.isArray(result.folder) && result.folder.length > 0
            ? result.folder[0]
            : result.folder,
          controlClasses: result.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete a control
   * @param controlId - The ID of the control
   * @returns True if the control was deleted, false otherwise
   */
  deleteControl = async ({ controlId }: { controlId: string }): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<{ nodesDeleted: number, relationshipsDeleted: number }>({
        mutation: DELETE_CONTROL,
        variables: { controlId },
        dataPath: 'deleteControls',
        action: 'deleteControl',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      if (response && (response.nodesDeleted > 0 || response.relationshipsDeleted > 0)) {
        return true
      }
      return false
    } catch (error) {
      return false
    }
  }

  /**
   * Update a control. Bundled method: when `controlClasses` is part of the
   * call (always today), the binding portion routes through
   * {@link DtClass.changeElementBinding} first; the residual UPDATE_CONTROL
   * mutation then handles name / description / folder. The atomic backend
   * transaction owns class-derived countermeasure cleanup, so the legacy
   * `countermeasureDeletion` filter is gone.
   *
   * @param controlClasses - When length > 0: targets CLASS kind. When empty:
   *   targets NONE kind. Backend identity-short-circuits if unchanged.
   * @returns UpdateControlResult — both halves observable so callers can
   *   render the two-snackbar partial-failure UX.
   */
  updateControl = async (
    { controlId, name, description, controlClasses, folderId }:
    { controlId: string, name: string, description: string, controlClasses: string[], folderId: string | undefined }
  ): Promise<UpdateControlResult> => {
    if (!controlId) {
      return { control: null, bindingResult: null, residualOk: false }
    }

    let bindingResult: ChangeElementBindingResult | null = null
    try {
      bindingResult = await this.dtClass.changeElementBinding({
        elementId: controlId,
        target: controlClasses.length > 0
          ? { kind: 'CLASS', classIds: controlClasses }
          : { kind: 'NONE' },
      })
    } catch (error) {
      this.dtUtils.handleError({ action: 'updateControl:changeElementBinding', error })
      return { control: null, bindingResult: null, residualOk: false }
    }

    if (bindingResult.errorCode) {
      return { control: null, bindingResult, residualOk: false }
    }

    try {
      const variables: any = {
        controlId,
        input: {
          name: { set: name },
          description: { set: description },
          folder: folderId
            ? { disconnect: {}, connect: { where: { node: { id: { eq: folderId } } } } }
            : { disconnect: {} },
        },
      }

      const result = await this.dtUtils.performMutation<Control>({
        mutation: UPDATE_CONTROL,
        variables,
        dataPath: 'updateControls.controls[0]',
        action: 'updateControl',
        deduplicationKey: `update-control-${controlId}`
      })

      if (result) {
        const control: Control = {
          ...result,
          folder: result.folder && Array.isArray(result.folder) && result.folder.length > 0
            ? result.folder[0]
            : result.folder,
          controlClasses: result.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }
        return { control, bindingResult, residualOk: true }
      }
      return { control: null, bindingResult, residualOk: false }
    } catch (error) {
      this.dtUtils.handleError({ action: 'updateControl:residual', error })
      return { control: null, bindingResult, residualOk: false }
    }
  }

  /**
   * Find controls with flexible filtering.
   * Uses a dual-path approach: elementIds go through a Cypher helper for performance
   * (avoids polymorphic interface query), other filters use auto-generated GraphQL.
   * @param controlId - Optional specific control ID
   * @param name - Optional name substring match
   * @param classId - Optional control class ID filter
   * @param classType - Optional control class type filter
   * @param elementIds - Optional element IDs (uses Cypher helper for performance)
   * @param moduleId - Optional module ID filter
   * @param moduleName - Optional module name filter
   * @returns Array of matching controls
   */
  findControls = async ({
    controlId,
    name,
    classId,
    classType,
    elementIds,
    moduleId,
    moduleName,
  }: {
    controlId?: string
    name?: string
    classId?: string
    classType?: string
    elementIds?: string[]
    moduleId?: string
    moduleName?: string
  }): Promise<Control[]> => {
    try {
      const condition: Record<string, any> = {}

      // Path 1: elementIds provided — use Cypher helper for performance
      // (polymorphic interface queries are slow on Memgraph, same issue as findIssues)
      if (elementIds && elementIds.length > 0) {
        const helperResponse = await this.dtUtils.performQuery<{ controlIdsByElements: string[] }>({
          query: CONTROL_IDS_BY_ELEMENTS,
          variables: { elementIds },
          action: 'controlIdsByElements',
          fetchPolicy: 'network-only'
        })

        const controlIds = helperResponse.controlIdsByElements
        if (!controlIds || controlIds.length === 0) {
          return []
        }

        condition.id = { in: controlIds }
      }

      // Path 2 (and additional filters for Path 1): build condition
      if (controlId) condition.id = { eq: controlId }
      if (name) condition.name = { contains: name }

      if (classId || classType) {
        const classFilter: Record<string, any> = {}
        if (classId) classFilter.id = { eq: classId }
        if (classType) classFilter.type = { eq: classType }
        condition.controlClasses = { some: classFilter }
      }

      if (moduleId || moduleName) {
        const moduleFilter: Record<string, any> = {}
        if (moduleId) moduleFilter.id = { eq: moduleId }
        if (moduleName) moduleFilter.name = { eq: moduleName }
        condition.controlClasses = {
          ...condition.controlClasses,
          some: {
            ...condition.controlClasses?.some,
            module: { single: moduleFilter }
          }
        }
      }

      const response = await this.dtUtils.performQuery<{ controls: Control[] }>({
        query: FIND_CONTROLS,
        variables: { condition: { "AND": condition } },
        action: 'findControls',
        fetchPolicy: 'network-only'
      })

      if (response.controls) {
        const controls = response.controls.map((control: Control) => ({
          ...control,
          folder: control.folder && Array.isArray(control.folder) && control.folder.length > 0
            ? control.folder[0]
            : control.folder,
          controlClasses: control.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }))
        return controls
      }
      return []
    } catch (error) {
      throw error
    }
  }

  /**
   * Assign a control to elements by creating SUPPORTS edges (append-only).
   * Uses GraphQL connect on the polymorphic elements relationship.
   * Idempotent — calling with the same args does not create duplicate edges.
   * @param controlId - The ID of the control
   * @param elementIds - The IDs of the elements to connect
   * @returns The updated control or null if an error occurs
   */
  assignControlToElements = async ({
    controlId,
    elementIds,
  }: {
    controlId: string
    elementIds: string[]
  }): Promise<Control | null> => {
    if (!controlId || !elementIds || elementIds.length === 0) return null

    try {
      // Broadcast all element IDs to all three typed connect paths.
      // Each connect's WHERE filter is type-scoped (e.g. supportedComponents
      // only matches Component nodes), so non-matching IDs are silently
      // skipped. This avoids a pre-flight type lookup and works because the
      // SUPPORTS edge is the same regardless of the target node's label.
      const connects = elementIds.map(id => ({
        where: { node: { id: { eq: id } } },
      }))

      const variables = {
        controlId,
        input: {
          supportedComponents: { connect: connects },
          supportedBoundaries: { connect: connects },
          supportedDataFlows: { connect: connects },
        },
      }

      const result = await this.dtUtils.performMutation<Control>({
        mutation: ASSIGN_CONTROL_TO_ELEMENTS,
        variables,
        dataPath: 'updateControls.controls[0]',
        action: 'assignControlToElements',
        deduplicationKey: `assign-control-${controlId}-${elementIds.slice().sort().join(',')}`
      })

      if (result) {
        // Synthesize the polymorphic `elements` array from the typed responses
        // so existing callers that read `control.elements` keep working.
        const elements: DtElement[] = [
          ...(result.supportedComponents ?? []),
          ...(result.supportedBoundaries ?? []),
          ...(result.supportedDataFlows ?? []),
        ]

        return {
          ...result,
          elements,
          folder: result.folder && Array.isArray(result.folder) && result.folder.length > 0
            ? result.folder[0]
            : result.folder,
          controlClasses: result.controlClasses?.map((controlClass: Class) => ({
            ...controlClass,
            module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
              ? controlClass.module[0]
              : controlClass.module,
          })),
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Analyze control gaps for a model by traversing the MITRE framework chain.
   * Returns unmitigated/unaddressable exposures, recommended controls, and coverage summary.
   * @param modelId - The model ID to analyze
   * @param topN - Number of top recommended controls (default 3)
   * @param limit - Maximum exposures to return (default 50)
   * @returns Control gap analysis result
   */
  controlGaps = async ({
    modelId,
    topN,
    limit,
  }: {
    modelId: string
    topN?: number
    limit?: number
  }): Promise<ControlGapsResult> => {
    try {
      const response = await this.dtUtils.performQuery<{ controlGaps: ControlGapsResult }>({
        query: CONTROL_GAPS,
        variables: { input: { modelId, topN, limit } },
        action: 'controlGaps',
        fetchPolicy: 'network-only'
      })
      return response.controlGaps
    } catch (error) {
      throw error
    }
  }

  /**
   * Find control candidates whose classes support the given element types.
   * Returns per-class fit details for scoring by the MCP rank action.
   * @param elementTypes - Element types to match against class supportedTypes
   * @param moduleIds - Optional module filter (empty array = all modules)
   * @returns Array of control candidates with class fit details
   */
  controlCandidatesForType = async ({
    elementTypes,
    moduleIds,
  }: {
    elementTypes: string[]
    moduleIds?: string[]
  }): Promise<ControlCandidate[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ controlCandidatesForType: ControlCandidate[] }>({
        query: CONTROL_CANDIDATES_FOR_TYPE,
        variables: { elementTypes, moduleIds: moduleIds ?? [] },
        action: 'controlCandidatesForType',
        fetchPolicy: 'network-only'
      })
      return response.controlCandidatesForType
    } catch (error) {
      throw error
    }
  }

  /**
   * Batched fetch returning class metadata for a list of Control ids.
   * Returns `{ id, name, controlClasses: [{ id, name, module: { id } }] }` only —
   * per-instance IS_INSTANCE_OF edge attributes come from
   * `getControlInstantiationAttributes`. Short-circuits on empty input without
   * a Bolt round-trip.
   *
   * @param ids - The control ids to fetch (deduplicated client-side)
   * @returns Array of Controls with class metadata; empty array if input is empty
   */
  getControlsByIds = async ({ ids }: { ids: string[] }): Promise<Control[]> => {
    if (!ids?.length) return []
    const dedupedIds = Array.from(new Set(ids))
    try {
      const response = await this.dtUtils.performQuery<{ controls: Control[] }>({
        query: GET_CONTROLS_BY_IDS,
        variables: { ids: dedupedIds },
        action: 'getControlsByIds',
        fetchPolicy: 'network-only'
      })
      if (!response.controls) return []
      return response.controls.map((control: Control) => ({
        ...control,
        controlClasses: control.controlClasses?.map((controlClass: Class) => ({
          ...controlClass,
          module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
            ? controlClass.module[0]
            : controlClass.module,
        })),
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Batched lookup of the live set of Model IDs that reference each given
   * Control via SUPPORTS edges. Backs the shared-ownership safety check
   * (CONTROL_LIBRARY.md §6).
   *
   * Returns a Map keyed by controlId (never positional — Memgraph returns rows
   * in index-scan order, not input order). Ids absent from the platform result
   * get an empty-array entry in the Map; DtControlLibrary applies
   * lifecycle-aware reconciliation (brownfield/partially-pushed absent ⇒
   * tombstone; greenfield absence is expected).
   *
   * Short-circuits on empty input without a Bolt round-trip — `UNWIND null`
   * errors with `Argument of UNWIND must be a list` on Memgraph.
   *
   * @param ids - The control ids to query (deduplicated client-side)
   * @returns Map<controlId, modelIds[]>
   */
  getControlsAssignedModels = async ({ ids }: { ids: string[] }): Promise<Map<string, string[]>> => {
    const result = new Map<string, string[]>()
    if (!ids?.length) return result
    const dedupedIds = Array.from(new Set(ids))
    // Initialise all requested ids to empty arrays so callers can differentiate
    // "0 SUPPORTS edges" from "id missing from platform" via Map.has().
    for (const id of dedupedIds) result.set(id, [])
    try {
      const response = await this.dtUtils.performQuery<{
        getControlsAssignedModels: { controlId: string, modelIds: string[] }[]
      }>({
        query: GET_CONTROLS_ASSIGNED_MODELS,
        variables: { controlIds: dedupedIds },
        action: 'getControlsAssignedModels',
        fetchPolicy: 'network-only'
      })
      for (const row of response.getControlsAssignedModels ?? []) {
        result.set(row.controlId, row.modelIds ?? [])
      }
      return result
    } catch (error) {
      throw error
    }
  }

  /**
   * Batched lookup of per-(Control, ControlClass) instantiation attributes
   * (IS_INSTANCE_OF edge properties) for the given Control ids. Backs the
   * control-library pull and the brownfield push Step B refresh
   * (CONTROL_LIBRARY.md §7).
   *
   * Short-circuits on empty input without a Bolt round-trip (same Memgraph
   * null-UNWIND constraint as {@link getControlsAssignedModels}).
   *
   * @param controlIds - The control ids to query (deduplicated client-side)
   * @returns Array of `{ controlId, classId, attributes }` rows; one row per
   *          (Control, ControlClass) pair. A Control with no IS_INSTANCE_OF
   *          edge returns one row with `classId === null, attributes === null`.
   */
  getControlInstantiationAttributes = async ({ controlIds }: { controlIds: string[] }): Promise<{
    controlId: string
    classId: string | null
    attributes: Record<string, unknown> | null
  }[]> => {
    if (!controlIds?.length) return []
    const dedupedIds = Array.from(new Set(controlIds))
    try {
      const response = await this.dtUtils.performQuery<{
        getControlInstantiationAttributes: {
          controlId: string
          classId: string | null
          attributes: Record<string, unknown> | null
        }[]
      }>({
        query: GET_CONTROL_INSTANTIATION_ATTRIBUTES,
        variables: { controlIds: dedupedIds },
        action: 'getControlInstantiationAttributes',
        fetchPolicy: 'network-only'
      })
      return response.getControlInstantiationAttributes ?? []
    } catch (error) {
      throw error
    }
  }

  /**
   * Set per-instance attributes on the IS_INSTANCE_OF edge between a Control
   * and its ControlClass.
   *
   * Thin pass-through to {@link DtClass.setInstantiationAttributes} — the
   * underlying platform mutation is element-agnostic, and dt-class.ts is the
   * single source of truth for the mutation path. Exposed on dt-control.ts so
   * control-library code paths can call it through a Control-scoped seam.
   *
   * **Partial-payload contract (CONTROL_LIBRARY.md DEC-CL-11).** The platform
   * uses `r += $attributes` (Cypher property merge), so keys not present in
   * `attributes` are left unchanged on the edge. Callers that want to clear
   * a key must either push it explicitly with a tombstone value (when the
   * schema allows) or use a separate mutation — dropping a key from the
   * payload does NOT remove it on the platform.
   *
   * @param controlId - Control UUID (the element-side of IS_INSTANCE_OF)
   * @param classId - ControlClass UUID
   * @param attributes - Partial payload of per-instance attributes to merge
   * @returns `{ success, errorMessage }` — on failure, `errorMessage` carries
   *   the backend's diagnosis (wrong class kind, missing edge, …) so the
   *   control-library push pipeline can name the root cause. Routes through the
   *   stale-count variant (which propagates errors and now selects
   *   `errorMessage`) rather than the boolean-returning sibling used by the
   *   fire-and-forget import/update callers.
   */
  setInstantiationAttributes = async (
    { controlId, classId, attributes }:
    { controlId: string, classId: string, attributes: Record<string, unknown> }
  ): Promise<{ success: boolean, errorMessage: string | null }> => {
    const { success, errorMessage } = await this.dtClass.setInstantiationAttributesWithStaleCount({
      componentId: controlId,
      classId,
      attributes,
    })
    return { success, errorMessage }
  }
}