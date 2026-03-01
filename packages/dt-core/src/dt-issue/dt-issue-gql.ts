import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const FIND_ISSUES = gql`
  query FindIssues($condition: IssueWhere) {
    issues(where: $condition) {
      id
      name
      description
      type
      category
      lastSyncAt
      createdAt
      updatedAt
      syncedAttributes
      issueStatus
      comments
      elementsWithExtendedInfo {
        id
        name
        description
        type
        element_type
        category
        model_id
        model_name
        model_description
        exposed_component_id
        exposed_component_name
        exposed_component_description
      }
      issueClass {
        id
        name
        description
        type
        category
        template
      }
      models {
        id
        name
        description
      }
      components {
        id
        name
        description
      }
      dataFlows {
        id
        name
        description
      }
      securityBoundaries {
        id
        name
        description
      }
      controls {
        id
        name
        description
      }
      data {
        id
        name
        description
      }
      analyses {
        id
        name
        description
      }
      exposures {
        id
        name
        description
      }
      countermeasures {
        id
        name
        description
      }
      # elements {
      #   id
      #   name
      #   description
      # }
    }
  }
`

export const FIND_ISSUE_CLASSES = gql`
  query FindIssueClasses($condition: IssueClassWhere) {
    issueClasses(where: $condition) {
      id
      name
      description
      type
      category
      module {
        id
        name
      }
    }
  }
`

export const CREATE_ISSUE = gql`
  mutation CreateIssues($input: [IssueCreateInput!]!) {
    createIssues(
      input: $input
    ) {
      issues {
        id
        name
        description
        type
        category
        lastSyncAt
        createdAt
        updatedAt
        syncedAttributes
        issueStatus
        comments
        elementsWithExtendedInfo {
          id
          name
          description
          type
          element_type
          category
          model_id
          model_name
          model_description
          exposed_component_id
          exposed_component_name
          exposed_component_description
        }
        issueClass {
          id
          name
          description
          type
          category
          template
        }
        models {
          id
          name
          description
        }
        components {
          id
          name
          description
        }
        dataFlows {
          id
          name
          description
        }
        securityBoundaries {
          id
          name
          description
        }
        controls {
          id
          name
          description
        }
        data {
          id
          name
          description
        }
        analyses {
          id
          name
          description
        }
        exposures {
          id
          name
          description
        }
        countermeasures {
          id
          name
          description
        }
        # elements {
        #   id
        #   name
        #   description
        # }
      }
    }
  }
`

export const UPDATE_ISSUE = gql`
  mutation UpdateIssue($issueId: ID!, $input: IssueUpdateInput!) {
    updateIssues(where: { id: { eq: $issueId } }, update: $input) {
      issues {
        id
        name
        description
        type
        category
        lastSyncAt
        createdAt
        updatedAt
        issueStatus
        syncedAttributes
        comments
        elementsWithExtendedInfo {
          id
          name
          description
          type
          element_type
          category
          model_id
          model_name
          model_description
          exposed_component_id
          exposed_component_name
          exposed_component_description
        }
        issueClass {
          id
          name
          description
          type
          category
          template
        }
        models {
          id
          name
          description
        }
        components {
          id
          name
          description
        }
        securityBoundaries {
          id
          name
          description
        }
        controls {
          id
          name
          description
        }
        data {
          id
          name
          description
        }
        analyses {
          id
          name
          description
        }
        exposures {
          id
          name
          description
        }
        countermeasures {
          id
          name
          description
        }
      }
    }
  }
`

export const DELETE_ISSUE = gql`
  mutation DeleteIssue($id: ID!) {
    deleteIssues(where: { id: { eq: $id } }) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`

export const ADD_ELEMENTS_TO_ISSUE = gql`
  mutation AddElementsToIssue($issueId: String!, $elementIds: [String!]!) {
    addElementsToIssue(issueId: $issueId, elementIds: $elementIds) {
      elementsAdded
    }
  }
`

export const REMOVE_ELEMENT_FROM_ISSUE = gql`
  mutation RemoveElementFromIssue($issueId: String!, $elementId: String!) {
    removeElementFromIssue(issueId: $issueId, elementId: $elementId)
  }
`