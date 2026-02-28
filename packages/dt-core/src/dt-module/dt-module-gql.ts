import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_MODULES = gql`
  query {
    modules{
      id
      name
      description
      version
      attributes
      template
      componentClasses {
        id
        name
        description
        type
        category
      }
      dataFlowClasses {
        id
        name
        description
        type
        category
      }
      securityBoundaryClasses {
        id
        name
        description
        type
        category
      }
      controlClasses {
        id
        name
        description
        type
        category
      }
      dataClasses {
        id
        name
        description
        type
        category
      }
    }
  }
`

export const GET_MODULE_BY_ID = gql`
  query GetModuleById($moduleId: ID!) {
    modules(where: {id: { eq: $moduleId }}) {
      id
      name
      description
      version
      attributes
      template
      componentClasses {
        id
        name
        description
        type
        category
      }
      dataFlowClasses {
        id
        name
        description
        type
        category
      }
      securityBoundaryClasses {
        id
        name
        description
        type
        category
      }
      controlClasses {
        id
        name
        description
        type
        category
      }
      dataClasses {
        id
        name
        description
        type
        category
      }
    }
  }
`
export const GET_MODULE_BY_NAME = gql`
  query GetModuleByName($moduleName: String!) {
    modules(where: {name: { eq: $moduleName }}) {
      id
      name
      description
      version
      attributes
      template
      componentClasses {
        id
        name
        description
        type
        category
      }
      dataFlowClasses {
        id
        name
        description
        type
        category
      }
      securityBoundaryClasses {
        id
        name
        description
        type
        category
      }
      controlClasses {
        id
        name
        description
        type
        category
      }
      dataClasses {
        id
        name
        description
        type
        category
      }
    }
  }
`

export const SAVE_MODULE = gql`
  mutation SaveModule($moduleId: ID!, $attributes: String!) {
    updateModules(where: {id: { eq: $moduleId }}, update: {attributes: $attributes}) {
      modules {
        id
        name
        description
        version
        attributes
        template
        componentClasses {
          id
          name
          description
          type
          category
        }
        dataFlowClasses {
          id
          name
          description
          type
          category
        }
        securityBoundaryClasses {
          id
          name
          description
          type
          category
        }
        controlClasses {
          id
          name
          description
          type
          category
        }
        dataClasses {
          id
          name
          description
          type
          category
        }
      }
    }
  }
`

export const RESET_MODULE = gql`
  mutation ResetModule($moduleId: ID!) {
    resetModule(moduleId: $moduleId)
  }
`

export const GET_AVAILABLE_FRONTEND_MODULES = gql`
  query GetAvailableFrontendModules {
    getAvailableFrontendModules
  }
`

export const GET_MODULE_FRONTEND_BUNDLE = gql`
  query GetModuleFrontendBundle($moduleName: String!) {
    getModuleFrontendBundle(moduleName: $moduleName)
  }
`