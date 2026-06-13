import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { Class, Module } from '../interfaces/core-types-interface.js'
import {
  GET_BOUNDARY_CLASS,
  GET_COMPONENT_CLASS,
  GET_DATA_FLOW_CLASS,
  GET_DATA_CLASS_BY_ID,
  SET_INSTANTIATION_ATTRIBUTES,
  SET_INSTANTIATION_ATTRIBUTES_WITH_STALE_COUNT,
  GET_ATTRIBUTES_FROM_CLASS_RELATIONSHIP,
  GET_CONTROL_CLASSES,
  GET_CONTROL_CLASS_BY_ID,
  GET_COMPONENT_CLASS_BY_ID,
  GET_BOUNDARY_CLASS_BY_ID,
  GET_DATA_FLOW_CLASS_BY_ID,
  MATCH_CLASSES,
  LIST_CLASSES,
  CHANGE_ELEMENT_BINDING,
} from './dt-class-gql.js'

export type ElementBindingTarget =
  | { kind: 'CLASS'; classIds: string[] }
  | { kind: 'REPRESENTED_MODEL'; modelId: string }
  | { kind: 'NONE' }

export type ElementBindingErrorCode =
  | 'VALIDATION_ERROR'
  | 'ELEMENT_NOT_FOUND'
  | 'CLASS_NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'ORPHAN_CLASS_REFUSED'
  | 'REPRESENTED_MODEL_NOT_ALLOWED'
  | 'MODULE_ERROR'
  | 'DATABASE_ERROR'

export interface ElementBindingDeltas {
  deletedDerivedExposures: number
  instantiatedDerivedExposures: number
  preservedCustomExposures: number
  deletedDerivedCountermeasures: number
  instantiatedDerivedCountermeasures: number
  preservedCustomCountermeasures: number
}

export type ElementBindingEcho =
  | { __typename: 'ClassBinding'; classIds: string[] }
  | { __typename: 'RepresentedModelBinding'; modelId: string }
  | { __typename: 'NoBinding' }

export interface ChangeElementBindingResult {
  success: boolean
  elementId: string
  targetBinding: ElementBindingEcho
  deltas: ElementBindingDeltas
  errorCode: ElementBindingErrorCode | null
  errorMessage: string | null
}
import yaml from 'js-yaml';

/**
 * Decode a potentially base64-encoded guide string.
 * The guide field is base64 encoded during CSV export to preserve newlines
 * through Memgraph's LOAD CSV which corrupts multiline strings.
 */
function decodeGuide(guide: string): string {
  if (!guide || guide.trim() === '') {
    return guide;
  }

  // Check if the string looks like base64 (only contains base64 chars and has reasonable length)
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  const trimmedGuide = guide.trim();

  // Base64 strings are typically longer and don't start with YAML markers
  if (base64Regex.test(trimmedGuide) && !trimmedGuide.startsWith('-') && !trimmedGuide.startsWith('#')) {
    try {
      // Use atob for browser compatibility, with TextDecoder for UTF-8
      const binaryString = atob(trimmedGuide);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const decoded = new TextDecoder('utf-8').decode(bytes);
      // Verify the decoded string looks like valid YAML (starts with - or has : for mappings)
      if (decoded.includes(':') || decoded.startsWith('-')) {
        return decoded;
      }
    } catch {
      // Not valid base64, return original
    }
  }

  return guide;
}

export class DtClass {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
  }

  private getClass = async (
    {
      id,
      query,
      idVariableName,
      classPath,
      action,
    }:
    {
      id: string,
      query: any,
      idVariableName: string,
      classPath: string,
      action: string
    }
  ): Promise<Class | undefined> => {
    try {
      const variables = { [idVariableName]: id }
      const response = await this.dtUtils.performQuery<any>({
        query,
        variables,
        action,
        fetchPolicy: 'network-only'
      })

      let data = this.dtUtils.getValueFromPath({ obj: response, path: classPath })
      if (data) {
        // Parse template JSON with error handling
        let templateValue = {}
        if (data.template) {
          try {
            templateValue = JSON.parse(data.template)
          } catch (jsonError) {
            console.warn(`Failed to parse template JSON for class ${id}:`, jsonError)
          }
        }

        // Parse guide YAML with error handling for malformed data
        // Guide may be base64 encoded to preserve newlines through Memgraph's LOAD CSV
        let guideValue: object | undefined = undefined
        if (data.guide) {
          try {
            const decodedGuide = decodeGuide(data.guide)
            guideValue = yaml.load(decodedGuide) as object
          } catch (yamlError) {
            console.warn(`Failed to parse guide YAML for class ${id}:`, yamlError)
            // Guide data is malformed - leave as undefined
          }
        }

        return {
          id: data.id,
          name: data.name,
          description: data.description,
          type: data.type,
          category: data.category,
          template: templateValue,
          guide: guideValue,
          module: data.module as Module | undefined,
        }
      }
      return undefined
    } catch (error) {
      console.error(`Failed to get class ${id}:`, error)
      return undefined
    }
  }

  /**
   * Get a component class by ID
   * @param componentId - The ID of the component
   * @returns The component class or undefined if an error occurs
   */
  getComponentClass = async ({ componentId }: { componentId: string }): Promise<Class | undefined> => {
    try {
      const result = await this.getClass({
        id: componentId,
        query: GET_COMPONENT_CLASS,
        idVariableName: 'componentId',
        classPath: 'components[0].componentClass[0]',
        action: 'getComponentClass',
      })
      if (result) {
        return {
          ...result,
          module: result.module && Array.isArray(result.module) && result.module.length > 0 
            ? result.module[0]
            : result.module,
        }
      }
      return undefined
    } catch (error) {
      throw error
    }
  }

  /**
   * Get a boundary class by ID
   * @param boundaryId - The ID of the boundary
   * @returns The boundary class or undefined if an error occurs
   */
  getBoundaryClass = async ({ boundaryId }: { boundaryId: string }): Promise<Class | undefined> => {
    const mutexKey = `getBoundaryClass_${boundaryId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const result = await this.getClass({
          id: boundaryId,
          query: GET_BOUNDARY_CLASS,
          idVariableName: 'boundaryId',
          classPath: 'securityBoundaries[0].securityBoundaryClass[0]',
          action: 'getBoundaryClass',
        })
        if (result) {
          return {
            ...result,
            module: result.module && Array.isArray(result.module) && result.module.length > 0
              ? result.module[0]
              : result.module,
          }
        } else {
          return undefined
        }
      } catch (error) {
        this.dtUtils.handleError({ action: 'getBoundaryClass', error })
        return undefined
      }
    })
  }

  /**
   * Get a data flow class by ID
   * @param dataFlowId - The ID of the data flow
   * @returns The data flow class or undefined if an error occurs
   */
  getDataFlowClass = async ({ dataFlowId }: { dataFlowId: string }): Promise<Class | undefined> => {
    const mutexKey = `getDataFlowClass_${dataFlowId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const result = await this.getClass({
          id: dataFlowId,
          query: GET_DATA_FLOW_CLASS,
          idVariableName: 'dataFlowId',
          classPath: 'dataFlows[0].dataFlowClass[0]',
          action: 'getDataFlowClass',
        })
        if (result) {
          return {
            ...result,
            module: result.module && Array.isArray(result.module) && result.module.length > 0
              ? result.module[0]
              : result.module,
          }
        } else {
          return undefined
        }
      } catch (error) {
        this.dtUtils.handleError({ action: 'getDataFlowClass', error })
        return undefined
      }
    })
  }

  /**
   * Get a data class by ID
   * @param dataClassId - The ID of the data class
   * @returns The data class or undefined if an error occurs
   */
  getDataClass = async ({ dataClassId }: { dataClassId: string }): Promise<Class | undefined> => {
    const mutexKey = `getDataClass_${dataClassId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      try {
        const result = await this.getClass({
          id: dataClassId,
          query: GET_DATA_CLASS_BY_ID,
          idVariableName: 'dataClassId',
          classPath: 'dataClasses[0]',
          action: 'getDataClass',
        })
        if (result) {
          return {
            ...result,
            module: result.module && Array.isArray(result.module) && result.module.length > 0
              ? result.module[0]
              : result.module,
          }
        } else {
          return undefined
        }
      } catch (error) {
        this.dtUtils.handleError({ action: 'getDataClass', error })
        return undefined
      }
    })
  }

  /**
   * Get any class by its ID and type.
   * Routes to the correct direct-by-ID GQL query based on class type.
   * Returns parsed template (JSON) and guide (YAML) when available.
   */
  getClassById = async ({ classId, classType }: { classId: string, classType: string }): Promise<Class | undefined> => {
    const queryConfig: Record<string, { query: any; path: string; idVar: string }> = {
      component: { query: GET_COMPONENT_CLASS_BY_ID, path: 'componentClasses[0]', idVar: 'classId' },
      boundary: { query: GET_BOUNDARY_CLASS_BY_ID, path: 'securityBoundaryClasses[0]', idVar: 'classId' },
      dataflow: { query: GET_DATA_FLOW_CLASS_BY_ID, path: 'dataFlowClasses[0]', idVar: 'classId' },
      data: { query: GET_DATA_CLASS_BY_ID, path: 'dataClasses[0]', idVar: 'dataClassId' },
      control: { query: GET_CONTROL_CLASS_BY_ID, path: 'controlClasses[0]', idVar: 'classId' },
    }

    const config = queryConfig[classType]
    if (!config) return undefined

    const result = await this.getClass({
      id: classId,
      query: config.query,
      idVariableName: config.idVar,
      classPath: config.path,
      action: `getClassById(${classType})`,
    })

    if (result) {
      return {
        ...result,
        module: result.module && Array.isArray(result.module) && result.module.length > 0
          ? result.module[0]
          : result.module,
      }
    }
    return undefined
  }

  /**
   * Set the instantiation attributes for a component class
   * @param componentId - The ID of the component
   * @param classId - The ID of the class
   * @param attributes - The attributes to set
   * @returns True if the attributes were set, false otherwise
   */
  setInstantiationAttributes = async (
    { componentId, classId, attributes }:
    { componentId: string, classId: string, attributes: object }
  ): Promise<boolean> => {
    // The mutation returns `SetInstantiationAttributesResult!`
    // (was `Boolean!`). The GraphQL document selects `{ success }`; we
    // extract that field via `dataPath: 'success'` so the wrapper's
    // `Promise<boolean>` surface stays unchanged — the 4 internal call
    // sites (dt-update, dt-update-split, dt-control, dt-control-library)
    // continue to bind a boolean. The sibling method
    // `setInstantiationAttributesWithStaleCount` serves the frontend picker
    // save path that needs the `staleFlippedCount` value.
    try {
      // dataPath navigates inside response.data. The mutation's
      // return type changed from Boolean to SetInstantiationAttributesResult, so the
      // payload is `{ setInstantiationAttributes: { success: true } }`. The
      // previous path `'success'` resolved to undefined on the root response
      // and performMutation threw "No data returned"; the caller saw
      // "Failed to save attributes" even though the write succeeded server-side.
      const response = await this.dtUtils.performMutation<boolean>({
        mutation: SET_INSTANTIATION_ATTRIBUTES,
        variables: { componentId, classId, attributes },
        dataPath: 'setInstantiationAttributes.success',
        action: 'setInstantiationAttributes',
        deduplicationKey: `set-attributes-${componentId}-${classId}`
      })
      return Boolean(response)
    } catch (error) {
      return false
    }
  }

  /**
   * Picker save path needs the `staleFlippedCount`
   * to drive the "N need review" badge on SettingsExposuresTab without a
   * follow-up exposures refetch.
   *
   * Same wire call as `setInstantiationAttributes`; the only differences are
   * the GraphQL selection set (adds `staleFlippedCount`) and the return shape
   * (full envelope instead of just `success`). The 4 internal callers stay on
   * the boolean-returning sibling — they have no use for the count.
   *
   * Domain failure semantics also differ: this method does NOT swallow errors
   * — it propagates them so the picker save path can surface specific
   * messaging to the user. The boolean-returning sibling swallows for the
   * fire-and-forget internal callers.
   */
  setInstantiationAttributesWithStaleCount = async (
    { componentId, classId, attributes }:
    { componentId: string, classId: string, attributes: object }
  ): Promise<{ success: boolean, staleFlippedCount: number | null, errorMessage: string | null }> => {
    const response = await this.dtUtils.performMutation<{ success: boolean, staleFlippedCount: number | null, errorCode: string | null, errorMessage: string | null }>({
      mutation: SET_INSTANTIATION_ATTRIBUTES_WITH_STALE_COUNT,
      variables: { componentId, classId, attributes },
      dataPath: 'setInstantiationAttributes',
      action: 'setInstantiationAttributesWithStaleCount',
      deduplicationKey: `set-attributes-with-count-${componentId}-${classId}`,
    })
    return {
      success: Boolean(response?.success),
      staleFlippedCount: response?.staleFlippedCount ?? null,
      // The backend supplies a curated diagnosis on the failure path (wrong
      // class kind, missing element/class, no IS_INSTANCE_OF edge). Carry it
      // through so the control-library push pipeline can name the root cause
      // instead of throwing an opaque "setInstantiationAttributes failed".
      errorMessage: response?.errorMessage ?? null,
    }
  }

  /**
   * Get the attributes from a class relationship
   * @param componentId - The ID of the component
   * @param classId - The ID of the class
   * @returns The attributes from the class relationship or undefined if an error occurs
   */
  getAttributesFromClassRelationship = async (
    { componentId, classId }:
    { componentId: string, classId: string }
  ): Promise<object> => {
    try {
      const response = await this.dtUtils.performQuery<{ getAttributesFromClassRel: { properties: object } }>({
        query: GET_ATTRIBUTES_FROM_CLASS_RELATIONSHIP,
        variables: { componentId, classId },
        action: 'getAttributesFromClassRelationship',
        fetchPolicy: 'network-only'
      })
      return response.getAttributesFromClassRel?.properties || {}
    } catch (error) {
      throw error
    }
  }

  /**
   * Get the control classes
   * @param moduleWhere - The module where
   * @param classWhere - The class where
   * @returns The control classes or undefined if an error occurs
   */
  getControlClasses = async (
    { moduleWhere, classWhere }: { moduleWhere: any, classWhere: any }
  ) => {
    try {
      const response = await this.dtUtils.performQuery<{ modules: Module[] }>({
        query: GET_CONTROL_CLASSES,
        variables: { moduleWhere, classWhere },
        action: 'getControlClasses',
        fetchPolicy: 'network-only'
      })
      
      if (response.modules) {
        return response.modules.map((module: Module) => ({
          ...module,
          controlClasses: module.controlClasses && Array.isArray(module.controlClasses) && module.controlClasses.length > 0
            ? module.controlClasses.map((controlClass: Class) => ({
              ...controlClass,
              module: controlClass.module && Array.isArray(controlClass.module) && controlClass.module.length > 0
                ? controlClass.module[0]
                : controlClass.module,
            }))
            : module.controlClasses,
        }))
      }
      return []
    } catch (error) {
      throw error
    }
  }
  
  /**
   * Get a control class by ID
   * @param classId - The ID of the class
   * @returns The control class or null if an error occurs
   */
  getControlClassById = async ({ classId }: { classId: string }): Promise<Class | null> => {
    try {
      const response = await this.dtUtils.performQuery<{ controlClasses: any[] }>({
        query: GET_CONTROL_CLASS_BY_ID,
        variables: { classId },
        action: 'getControlClassById',
        fetchPolicy: 'network-only'
      })

      if (response.controlClasses && response.controlClasses.length > 0) {
        const data = response.controlClasses[0]

        // Parse template JSON with error handling
        let templateValue = {}
        if (data.template) {
          try {
            templateValue = JSON.parse(data.template)
          } catch (jsonError) {
            console.warn(`Failed to parse template JSON for class ${classId}:`, jsonError)
          }
        }

        // Parse guide YAML with error handling for malformed data
        // Guide may be base64 encoded to preserve newlines through Memgraph's LOAD CSV
        let guideValue: object | undefined = undefined
        if (data.guide) {
          try {
            const decodedGuide = decodeGuide(data.guide)
            guideValue = yaml.load(decodedGuide) as object
          } catch (yamlError) {
            console.warn(`Failed to parse guide YAML for class ${classId}:`, yamlError)
            // Guide data is malformed - leave as undefined
          }
        }

        return {
          id: data.id,
          name: data.name,
          description: data.description,
          type: data.type,
          category: data.category,
          template: templateValue,
          guide: guideValue,
          module: data.module && Array.isArray(data.module) && data.module.length > 0
            ? data.module[0]
            : data.module,
        }
      }
      return null
    } catch (error) {
      console.error(`Failed to get control class ${classId}:`, error)
      return null
    }
  }

  /**
   * Match elements against class catalog nodes using a multi-priority pipeline.
   * @param elements - Array of elements to match (name, optional type and description)
   * @param classLabel - Which class node label to search (COMPONENT, CONTROL, etc.)
   * @param componentType - Filter ComponentClass nodes by type (only when classLabel = COMPONENT)
   * @param moduleIds - Restrict search to classes from these modules
   * @param topN - Number of top candidates per element (default 3)
   * @param fields - Which optional fields to include on candidates (description, category, type)
   * @returns Match results with candidates per element, plus unmatched element names
   */
  matchClasses = async ({
    elements,
    classLabel,
    componentType,
    moduleIds,
    topN,
    fields,
  }: {
    elements: Array<{ name: string; type?: string; description?: string }>;
    classLabel: string;
    componentType?: string;
    moduleIds?: string[];
    topN?: number;
    fields?: string[];
  }): Promise<{
    matches: Array<{
      elementName: string;
      candidates: Array<{
        classId: string;
        className: string;
        classDescription?: string;
        classCategory?: string;
        classType?: string;
        moduleId: string;
        moduleName: string;
        matchType: string;
        confidence: string;
        similarityScore?: number;
      }>;
    }>;
    unmatched: string[];
    vectorAvailable: boolean;
  }> => {
    // Cancel-on-replace keyed per call-site context: rapid-fire keystrokes from
    // the same picker (same classLabel + componentType) supersede each other.
    const key = `matchClasses:${classLabel}:${componentType ?? '_'}`
    return this.dtUtils.withCancellableLatest(key, async () => {
      const response = await this.dtUtils.performQuery<{
        matchClasses: {
          matches: Array<{
            elementName: string;
            candidates: Array<{
              classId: string;
              className: string;
              classDescription?: string;
              classCategory?: string;
              classType?: string;
              moduleId: string;
              moduleName: string;
              matchType: string;
              confidence: string;
              similarityScore?: number;
            }>;
          }>;
          unmatched: string[];
          vectorAvailable: boolean;
        };
      }>({
        query: MATCH_CLASSES,
        variables: {
          input: {
            elements,
            classLabel,
            ...(componentType ? { componentType } : {}),
            ...(moduleIds ? { moduleIds } : {}),
            ...(topN !== undefined ? { topN } : {}),
            ...(fields ? { fields } : {}),
          },
        },
        action: 'matchClasses',
        fetchPolicy: 'network-only',
      })
      return response.matchClasses
    })
  }

  /**
   * Paginated class catalogue with server-aggregated facet counts. Powers the
   * class-picker side-sheet's browse-all path. Cancel-on-replace keyed by
   * `classLabel + componentType` so rapid filter/pagination changes within a
   * single picker discard stale results.
   *
   * @param classLabel    - Which class node label to list (COMPONENT, CONTROL, etc.)
   * @param componentType - Filter ComponentClass by type (only when classLabel = COMPONENT)
   * @param search        - Optional case-insensitive substring filter on class name
   * @param categories    - Optional category filter (OR within)
   * @param moduleIds     - Optional module filter (OR within)
   * @param offset        - Pagination offset (default 0 on server)
   * @param limit         - Pagination size (default 50, capped at 200 on server)
   */
  listClasses = async ({
    classLabel,
    componentType,
    search,
    categories,
    moduleIds,
    offset,
    limit,
  }: {
    classLabel: string;
    componentType?: string;
    search?: string;
    categories?: string[];
    moduleIds?: string[];
    offset?: number;
    limit?: number;
  }): Promise<{
    items: Array<{
      classId: string;
      className: string;
      classDescription?: string | null;
      classCategory?: string | null;
      classType?: string | null;
      moduleId: string;
      moduleName: string;
      matchType: string;
      confidence: string;
      similarityScore?: number | null;
    }>;
    totalCount: number;
    facetCounts: {
      categories: Array<{ value: string; count: number }>;
      modules: Array<{ moduleId: string; moduleName: string; count: number }>;
      types: Array<{ value: string; count: number }>;
    };
  }> => {
    const key = `listClasses:${classLabel}:${componentType ?? '_'}`
    return this.dtUtils.withCancellableLatest(key, async () => {
      const response = await this.dtUtils.performQuery<{
        listClasses: {
          items: Array<{
            classId: string;
            className: string;
            classDescription?: string | null;
            classCategory?: string | null;
            classType?: string | null;
            moduleId: string;
            moduleName: string;
            matchType: string;
            confidence: string;
            similarityScore?: number | null;
          }>;
          totalCount: number;
          facetCounts: {
            categories: Array<{ value: string; count: number }>;
            modules: Array<{ moduleId: string; moduleName: string; count: number }>;
            types: Array<{ value: string; count: number }>;
          };
        };
      }>({
        query: LIST_CLASSES,
        variables: {
          input: {
            classLabel,
            ...(componentType ? { componentType } : {}),
            ...(search ? { search } : {}),
            ...(categories ? { categories } : {}),
            ...(moduleIds ? { moduleIds } : {}),
            ...(offset !== undefined ? { offset } : {}),
            ...(limit !== undefined ? { limit } : {}),
          },
        },
        action: 'listClasses',
        fetchPolicy: 'network-only',
      })
      return response.listClasses
    })
  }

  /**
   * Atomically change an element's binding (class / representedModel / none).
   * Dispatches the server-side `changeElementBinding` mutation which owns the
   * single-transaction destructive-sweep + rewire + constructive-upsert flow
   * for derived exposures and countermeasures.
   *
   * Mutex scope: the `binding_${elementId}` key serialises same-element calls
   * **on this DtClass instance only**. Cross-store / cross-Dt*-class races
   * fall through to the backend `executeWrite` — the frontend mutex is a
   * latency hedge, not a distributed coordination primitive. Verified in
   * `__tests__/change-element-binding.test.ts` (same-instance same-elementId
   * serialisation; cross-elementId parallelism).
   */
  changeElementBinding = async (
    { elementId, target }:
    { elementId: string; target: ElementBindingTarget }
  ): Promise<ChangeElementBindingResult> => {
    const mutexKey = `binding_${elementId}`
    return this.dtUtils.withMutex(mutexKey, async () => {
      const variables = {
        elementId,
        target: this.normaliseBindingTarget(target),
      }
      const result = await this.dtUtils.performMutation<ChangeElementBindingResult>({
        mutation: CHANGE_ELEMENT_BINDING,
        variables,
        dataPath: 'changeElementBinding',
        action: 'changeElementBinding',
      })
      return result
    })
  }

  /**
   * Coerce the discriminated input shape to the GraphQL `ElementBindingInput`
   * payload. The server re-validates the combination; this is just a
   * one-roundtrip pre-shape (drops irrelevant fields per `kind`).
   */
  private normaliseBindingTarget(target: ElementBindingTarget): {
    kind: 'CLASS' | 'REPRESENTED_MODEL' | 'NONE'
    classIds?: string[]
    modelId?: string
  } {
    if (target.kind === 'CLASS') {
      return { kind: 'CLASS', classIds: target.classIds }
    }
    if (target.kind === 'REPRESENTED_MODEL') {
      return { kind: 'REPRESENTED_MODEL', modelId: target.modelId }
    }
    return { kind: 'NONE' }
  }
}
