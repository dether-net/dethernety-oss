import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
type ApolloClient<T> = Apollo.ApolloClient<T>
type NormalizedCacheObject = Apollo.NormalizedCacheObject
import { Class, Module } from '../interfaces/core-types-interface.js'
import {
  GET_BOUNDARY_CLASS,
  GET_COMPONENT_CLASS,
  GET_DATA_FLOW_CLASS,
  GET_DATA_CLASS_BY_ID,
  SET_INSTANTIATION_ATTRIBUTES,
  GET_ATTRIBUTES_FROM_CLASS_RELATIONSHIP,
  GET_CONTROL_CLASSES,
  GET_CONTROL_CLASS_BY_ID,
} from './dt-class-gql.js'
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
  private apolloClient: ApolloClient<NormalizedCacheObject>

  constructor(apolloClient: ApolloClient<NormalizedCacheObject>) {
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
    try {
      const response = await this.dtUtils.performMutation<any>({
        mutation: SET_INSTANTIATION_ATTRIBUTES,
        variables: { componentId, classId, attributes },
        dataPath: '',
        action: 'setInstantiationAttributes',
        deduplicationKey: `set-attributes-${componentId}-${classId}`
      })
      return Boolean(response)
    } catch (error) {
      return false
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
}
