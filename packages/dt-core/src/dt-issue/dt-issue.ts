import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { ADD_ELEMENTS_TO_ISSUE, CREATE_ISSUE, DELETE_ISSUE, FIND_ISSUES, FIND_ISSUE_CLASSES, REMOVE_ELEMENT_FROM_ISSUE, UPDATE_ISSUE } from './dt-issue-gql.js'
import { Issue, Class } from '../interfaces/core-types-interface.js'

export class DtIssue {
  private dtUtils: DtUtils
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(apolloClient)
  }

  /**
   * Find issue classes
   * @param classType - The type of the class to find
   * @param moduleId - The ID of the module to find the class in
   * @param classId - The ID of the class to find
   * @param className - The name of the class to find
   * @param moduleName - The name of the module to find the class in
   * @returns The issue classes or null if the class type, module ID, class ID or class name is invalid
   */
  findIssueClasses = async (
    { classType, moduleId, classId, className, moduleName, classCategory }:
    { classType?: string, moduleId?: string, classId?: string, className?: string, moduleName?: string, classCategory?: string }
  ): Promise<Class[]> => {
    try {
      let condition: {
        id?: { eq?: string },
        name?: { eq?: string },
        type?: { eq?: string },
        category?: { eq?: string },
        module?: {
          single?: {
            id?: { eq?: string },
            name?: { eq?: string },
          }
        },
      } = {}
      if (classId) condition.id = { eq: classId }
      if (className) condition.name = { eq: className }
      if (classType) condition.type = { eq: classType }
      if (classCategory) condition.category = { eq: classCategory }
      if (moduleId || moduleName) {
        const moduleFilter: { id?: { eq?: string }, name?: { eq?: string } } = {}
        if (moduleId) moduleFilter.id = { eq: moduleId }
        if (moduleName) moduleFilter.name = { eq: moduleName }
        condition.module = { single: moduleFilter }
      }

      const response = await this.dtUtils.performQuery<{ issueClasses: Class[] }>({
        query: FIND_ISSUE_CLASSES,
        variables: { condition: { "AND": condition } },
        action: 'findIssueClasses',
        fetchPolicy: 'network-only'
      })
      
      // Return empty array for no results, throw for actual errors
      return response.issueClasses?.map((issueClass: Class) => ({
        ...issueClass,
        module: issueClass.module && Array.isArray(issueClass.module) && issueClass.module.length > 0
          ? issueClass.module[0]
          : issueClass.module,
      })) || []
    } catch (error) {
      throw error
    }
  }

  /**
   * Find issues
   * @param name - The name of the issue to find
   * @param issueId - The ID of the issue to find
   * @param classId - The ID of the class to find the issue in
   * @param elementId - The ID of the element to find the issue in
   * @param classType - The type of the class to find the issue in
   * @param moduleId - The ID of the module to find the issue in
   * @param moduleName - The name of the module to find the issue in
   * @returns The issues or null if the name, issue ID, class ID, element ID, class type or module ID is invalid
   */
  findIssues = async (
    { name, issueId, classId, elementIds, classType, moduleId, moduleName, issueStatus }:
    { name?: string, issueId?: string, classId?: string, elementIds?: string[], classType?: string, moduleId?: string, moduleName?: string, issueStatus?: string }
  ): Promise<Issue[]> => {
    try {
      let condition: {
        id?: { eq?: string },
        name?: { eq?: string },
        type?: { eq?: string },
        issueStatus?: { eq?: string },
        issueClass?: {
          single?: {
            id?: { eq?: string }
            type?: { eq?: string }
          }
        },
        model?: { some?: { id?: { in?: string[] } } },
        components?: { some?: { id?: { in?: string[] } } },
        dataFlows?: { some?: { id?: { in?: string[] } } },
        securityBoundaries?: { some?: { id?: { in?: string[] } } },
        controls?: { some?: { id?: { in?: string[] } } },
        data?: { some?: { id?: { in?: string[] } } },
        analyses?: { some?: { id?: { in?: string[] } } },
        exposures?: { some?: { id?: { in?: string[] } } },
        countermeasures?: { some?: { id?: { in?: string[] } } },
        module?: {
          single?: {
            id?: { eq?: string },
            name?: { eq?: string },
          }
        },
      } = {}
      if (issueId) condition.id = { eq: issueId }
      if (name) condition.name = { eq: name }
      if (classId || classType) {
        const classFilter: { id?: { eq?: string }, type?: { eq?: string } } = {}
        if (classId) classFilter.id = { eq: classId }
        if (classType) classFilter.type = { eq: classType }
        condition.issueClass = { single: classFilter }
      }
      if (elementIds) {
        condition.model = { some: { id: { in: elementIds } } }
        condition.components = { some: { id: { in: elementIds } } }
        condition.dataFlows = { some: { id: { in: elementIds } } }
        condition.securityBoundaries = { some: { id: { in: elementIds } } }
        condition.controls = { some: { id: { in: elementIds } } }
        condition.data = { some: { id: { in: elementIds } } }
        condition.analyses = { some: { id: { in: elementIds } } }
        condition.exposures = { some: { id: { in: elementIds } } }
        condition.countermeasures = { some: { id: { in: elementIds } } }
        // condition.elements = { some: { id: { in: elementIds } } }
      }
      if (moduleId || moduleName) {
        const moduleFilter: { id?: { eq?: string }, name?: { eq?: string } } = {}
        if (moduleId) moduleFilter.id = { eq: moduleId }
        if (moduleName) moduleFilter.name = { eq: moduleName }
        condition.module = { single: moduleFilter }
      }
      if (issueStatus !== undefined) {
        condition.issueStatus = { eq: issueStatus }
      }

      const response = await this.dtUtils.performQuery<{ issues: Issue[] }>({
        query: FIND_ISSUES,
        variables: { condition: { "AND": condition } },
        action: 'findIssues',
        fetchPolicy: 'network-only'
      })

      const issues = response.issues?.map((issue: Issue) => ({
        ...issue,
        elements: [
          ...(issue.models || []),
          ...(issue.components || []),
          ...(issue.dataFlows || []),
          ...(issue.securityBoundaries || []),
          ...(issue.controls || []),
          ...(issue.data || []),
          ...(issue.analyses || []),
          ...(issue.exposures || []),
          ...(issue.countermeasures || []),
        ] as Element[],
        issueClass: issue.issueClass && Array.isArray(issue.issueClass) && issue.issueClass.length > 0
          ? issue.issueClass[0]
          : issue.issueClass,
      })) as Issue[] || []
      return issues
    } catch (error) {
      throw error
    }
  }

  /**
   * Create an issue
   * @param name - The name of the issue to create
   * @param description - The description of the issue to create
   * @param type - The type of the issue to create
   * @param category - The category of the issue to create
   * @param attributes - The attributes of the issue to create
   * @param issueClassId - The ID of the issue class to create the issue in
   * @param comments - The comments of the issue to create
   * @returns The created issue or null if the issue class ID is invalid
   */
  createIssue = async (
    { name, description, type, category, attributes, issueClassId, comments }:
    { name: string, description?: string, type?: string, category?: string, attributes?: string, issueClassId: string, comments?: string[] }
  ): Promise<Issue> => {
    try {
      const input = {
        name: name,
        description: description || '',
        type: type || '',
        category: category || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        issueStatus: 'open',
        attributes: attributes || '',
        issueClass: {
          connect: { where: { node: { id: { eq: issueClassId } } } }
        },
        comments: comments || [],
      }
      
      const response = await this.dtUtils.performMutation<{ createIssues: { issues: Issue[] } }>({
        mutation: CREATE_ISSUE,
        variables: { input },
        dataPath: '',
        action: 'createIssue',
        deduplicationKey: `create-issue-${name}-${issueClassId}`
      })
      
      if (!response?.createIssues?.issues?.length) {
        throw new Error('No issue returned from create operation')
      }
      
      
      const issue = {
        ...response.createIssues.issues[0],
        elements: [
          ...(response.createIssues.issues[0].models || []),
          ...(response.createIssues.issues[0].components || []),
          ...(response.createIssues.issues[0].dataFlows || []),
          ...(response.createIssues.issues[0].securityBoundaries || []),
          ...(response.createIssues.issues[0].controls || []),
          ...(response.createIssues.issues[0].data || []),
          ...(response.createIssues.issues[0].analyses || []),
          ...(response.createIssues.issues[0].exposures || []),
          ...(response.createIssues.issues[0].countermeasures || []),
        ] as Element[],
        issueClass: response.createIssues.issues[0].issueClass && Array.isArray(response.createIssues.issues[0].issueClass) && response.createIssues.issues[0].issueClass.length > 0
          ? response.createIssues.issues[0].issueClass[0]
          : response.createIssues.issues[0].issueClass,
      }
      return issue
    } catch (error) {
      throw error
    }
  } 

  /**
   * Update an issue
   * @param issueId - The ID of the issue to update
   * @param name - The name of the issue to update
   * @param description - The description of the issue to update
   * @param type - The type of the issue to update
   * @param category - The category of the issue to update
   * @param attributes - The attributes of the issue to update
   * @returns The updated issue or null if the issue ID is invalid
   */
  updateIssue = async (
    { issueId, name, description, type, category, attributes, issueClassId, issueStatus, comments }:
    { issueId: string, name?: string, description?: string, type?: string, category?: string, attributes?: string, issueClassId?: string, issueStatus?: string, comments?: string[] }
  ): Promise<Issue> => {
    try {
      const input = {
        name: { set: name },
        description: { set: description },
        type: { set: type },
        category: { set: category },
        attributes: { set: attributes },
        issueStatus: { set: issueStatus },
        comments: { set: comments },
        updatedAt: { set: new Date().toISOString() },
        issueClass: {
          disconnect: {},
          connect: { where: { node: { id: { eq: issueClassId } } } }
        },
      }
      
      const response = await this.dtUtils.performMutation<{ updateIssues: { issues: Issue[] } }>({
        mutation: UPDATE_ISSUE,
        variables: { issueId, input },
        dataPath: '',
        action: 'updateIssue',
        deduplicationKey: `update-issue-${issueId}`
      })
      
      if (!response?.updateIssues?.issues?.length) {
        throw new Error('No issue returned from update operation')
      }
      
      const issue = {
        ...response.updateIssues.issues[0],
        elements: [
          ...(response.updateIssues.issues[0].models || []),
          ...(response.updateIssues.issues[0].components || []),
          ...(response.updateIssues.issues[0].dataFlows || []),
          ...(response.updateIssues.issues[0].securityBoundaries || []),
          ...(response.updateIssues.issues[0].controls || []),
          ...(response.updateIssues.issues[0].data || []),
          ...(response.updateIssues.issues[0].analyses || []),
          ...(response.updateIssues.issues[0].exposures || []),
          ...(response.updateIssues.issues[0].countermeasures || []),
        ] as Element[],
        issueClass: response.updateIssues.issues[0].issueClass && Array.isArray(response.updateIssues.issues[0].issueClass) && response.updateIssues.issues[0].issueClass.length > 0
          ? response.updateIssues.issues[0].issueClass[0]
          : response.updateIssues.issues[0].issueClass,
      }
      return issue
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete an issue
   * @param issueId - The ID of the issue to delete
   * @returns True if the issue was deleted, false otherwise
   */
  deleteIssue = async (
    { issueId }:
    { issueId: string }
  ): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<{ deleteIssues: { nodesDeleted: number, relationshipsDeleted: number } }>({
        mutation: DELETE_ISSUE,
        variables: { id: issueId },
        dataPath: '',
        action: 'deleteIssue',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return response?.deleteIssues?.nodesDeleted > 0 || false
    } catch (error) {
      return false
    }
  }

  /**
   * Add elements to an issue
   * @param issueId - The ID of the issue to add elements to
   * @param elementIds - The IDs of the elements to add to the issue
   * @returns The number of elements added to the issue
   */
  // addElementsToIssue = async (
  //   { issueId, elementIds }:
  //   { issueId: string, elementIds: string[] }
  // ): Promise<number> => {
  //   try {
  //     const response = await this.dtUtils.performMutation<{ addElementsToIssue: { elementsAdded: number } }>({
  //       mutation: ADD_ELEMENTS_TO_ISSUE,
  //       variables: { issueId, elementIds },
  //       dataPath: '',
  //       action: 'addElementsToIssue',
  //       deduplicationKey: `add-elements-to-issue-${issueId}-${elementIds.join(',')}`
  //     })
      
  //     return Number(response?.addElementsToIssue?.elementsAdded || 0)
  //   } catch (error) {
  //     throw error
  //   }
  // }
  addElementsToIssue = async (
    { issueId, elementIds }:
    { issueId: string, elementIds: string[] }
  ): Promise<number> => {
    try {
      const input = {
        models: { connect: { where: { node: { id: { in: elementIds } } } } },
        components: { connect: { where: { node: { id: { in: elementIds } } } } },
        dataFlows: { connect: { where: { node: { id: { in: elementIds } } } } },
        securityBoundaries: { connect: { where: { node: { id: { in: elementIds } } } } },
        controls: { connect: { where: { node: { id: { in: elementIds } } } } },
        data: { connect: { where: { node: { id: { in: elementIds } } } } },
        analyses: { connect: { where: { node: { id: { in: elementIds } } } } },
        exposures: { connect: { where: { node: { id: { in: elementIds } } } } },
        countermeasures: { connect: { where: { node: { id: { in: elementIds } } } } },
      }
      
      const response = await this.dtUtils.performMutation<{ updateIssues: { issues: Issue[] } }>({
        mutation: UPDATE_ISSUE,
        variables: { issueId, input },
        dataPath: '',
        action: 'addElementsToIssue',
        deduplicationKey: `add-elements-to-issue-${issueId}-${elementIds.join(',')}`
      })
      
      return response?.updateIssues?.issues?.length || 0
    } catch (error) {
      throw error
    }
  }

  /**
   * Remove an element from an issue
   * @param issueId - The ID of the issue to remove the element from
   * @param elementId - The ID of the element to remove from the issue
   * @returns True if the element was removed, false otherwise
   */
  removeElementFromIssue = async (
    { issueId, elementId }:
    { issueId: string, elementId: string }
  ): Promise<boolean> => {
    try {
      const response = await this.dtUtils.performMutation<{ removeElementFromIssue: boolean }>({
        mutation: REMOVE_ELEMENT_FROM_ISSUE,
        variables: { issueId, elementId },
        dataPath: '',
        action: 'removeElementFromIssue',
        deduplicationKey: false // Disable deduplication for remove operations
      })
      
      return response?.removeElementFromIssue || false
    } catch (error) {
      throw error
    }
  }
}
