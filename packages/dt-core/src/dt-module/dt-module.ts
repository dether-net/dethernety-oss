import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { GET_AVAILABLE_FRONTEND_MODULES, GET_MODULE_BY_ID, GET_MODULE_BY_NAME, GET_MODULE_FRONTEND_BUNDLE, GET_MODULES, RESET_MODULE, SAVE_MODULE } from './dt-module-gql.js'
import { Module } from '../interfaces/core-types-interface.js'

export class DtModule {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  /**
   * Get the modules
   * @returns The modules
   */
  getModules = async (): Promise<Module[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ modules: Module[] }>({
        query: GET_MODULES,
        action: 'getModules',
        fetchPolicy: 'network-only'
      })
      
      return response.modules || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Get a module by ID
   * @param moduleId - The ID of the module to get
   * @returns The module
   */
  getModuleById = async (moduleId: string): Promise<Module> => {
    try {
      const response = await this.dtUtils.performQuery<{ modules: Module[] }>({
        query: GET_MODULE_BY_ID,
        variables: { moduleId },
        action: 'getModuleById',
        fetchPolicy: 'network-only'
      })
      
      return response.modules[0]
    } catch (error) {
      throw error
    }
  }

  /**
   * Get a module by name
   * @param moduleName - The name of the module to get
   * @returns The module
   */
  getModuleByName = async (moduleName: string): Promise<Module> => {
    try {
      const response = await this.dtUtils.performQuery<{ modules: Module[] }>({
        query: GET_MODULE_BY_NAME,
        variables: { moduleName },
        action: 'getModuleByName',
        fetchPolicy: 'network-only'
      })
      
      return response.modules[0]
    } catch (error) {
      throw error
    }
  }

  /**
   * Save a module
   * @param moduleId - The ID of the module to save
   * @param attributes - The attributes to save
   * @returns The saved module
   */
  saveModule = async ({moduleId, attributes}: {moduleId: string, attributes: string}): Promise<Module> => {
    if (!moduleId || !attributes) {
      throw new Error('Module ID and attributes are required')
    }
    
    try {
      const response = await this.dtUtils.performMutation<{ updateModules: { modules: Module[] } }>({
        mutation: SAVE_MODULE,
        variables: { moduleId, attributes },
        dataPath: '',
        action: 'saveModule',
        deduplicationKey: `save-module-${moduleId}`
      })
      
      if (!response?.updateModules?.modules?.length) {
        throw new Error('No module returned from save operation')
      }
      
      return response.updateModules.modules[0]
    } catch (error) {
      throw error
    }
  }

  /**
   * Reset a module
   * @param moduleId - The ID of the module to reset
   * @returns True if the module was reset, false otherwise
   */
  resetModule = async (moduleId: string): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<{ resetModule: boolean }>({
        mutation: RESET_MODULE,
        variables: { moduleId },
        dataPath: '',
        action: 'resetModule',
        deduplicationKey: false // Disable deduplication for reset operations
      })
      
      return response?.resetModule || false
    } catch (error) {
      throw error
    }
  }

  /**
   * Get the available frontend modules
   * @returns The available frontend modules
   */
  getAvailableFrontendModules = async (): Promise<string[]> => {
    try {
      const response = await this.dtUtils.performQuery<{ getAvailableFrontendModules: string[] }>({
        query: GET_AVAILABLE_FRONTEND_MODULES,
        action: 'getAvailableFrontendModules',
        fetchPolicy: 'network-only'
      })
      return response.getAvailableFrontendModules || []
    } catch (error) {
      throw error
    }
  }
  
  /**
   * Get the frontend bundle for a module
   * @param moduleName - The name of the module to get the frontend bundle for
   * @returns The frontend bundle for the module
   */
  getModuleFrontendBundle = async ({moduleName}: {moduleName: string}): Promise<string> => {
    if (!moduleName) {
      throw new Error('Module name is required')
    }
    
    try {
      const response = await this.dtUtils.performQuery<{ getModuleFrontendBundle: string }>({
        query: GET_MODULE_FRONTEND_BUNDLE,
        variables: { moduleName },  
        action: 'getModuleFrontendBundle',
        fetchPolicy: 'network-only'
      })
      
      return response.getModuleFrontendBundle || ''
    } catch (error) {
      throw error
    }
  }
}