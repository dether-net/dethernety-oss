import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_CONTROLS = gql`
  query GetControls($query: ControlWhere) {
    controls(where: $query) {
      id
      name
      description
      controlClasses {
        id
        name
        supportedTypes
        supportedCategories
        module {
          id
          name
          description
        }
      }
      folder {
        id
        name
      }
    }
    modules{
      id
      name
    }
  }
`


export const CREATE_CONTROL = gql`
mutation CreateControl($input: [ControlCreateInput!]!) {
  createControls(input: $input) {
    controls {
      id
      name
      description
      controlClasses {
        id
        name
        supportedTypes
        supportedCategories
        module {
          id
          name
          description
        }
      }
      folder {
        id
        name
      }
    }
  }
}
`

export const DELETE_CONTROL = gql`
mutation DeleteControl($controlId: ID! ){
  deleteCountermeasures(
    where: {
      control: {
        some: {
          id: { eq: $controlId }
        }
      }
    }
  ) {
    nodesDeleted
    relationshipsDeleted
  }
  deleteControls(
    where: {id: { eq: $controlId }}
    #, delete: { countermeasures: {} }
  ) {
    nodesDeleted
    relationshipsDeleted
  }
}
`
export const UPDATE_CONTROL = gql`
mutation UpdateControl($controlId: ID!, $input: ControlUpdateInput!, $countermeasureDeletion: CountermeasureWhere) {
  deleteCountermeasures(
    where: $countermeasureDeletion
  ) {
    nodesDeleted
    relationshipsDeleted
  }
  updateControls(
    where: {
      id: { eq: $controlId }
    }
    update: $input
  ) {
    controls {
      id
      name
      description
      controlClasses {
        id
        name
        type
        category
        supportedTypes
        supportedCategories
        module {
          id
          name
          description
        }
      }
      folder {
        id
        name
      }
    }
  }
}
`

export const FIND_CONTROLS = gql`
  query FindControls($condition: ControlWhere) {
    controls(where: $condition) {
      id
      name
      description
      type
      category
      controlClasses {
        id
        name
        type
        category
        supportedTypes
        supportedCategories
        module {
          id
          name
        }
      }
      elements {
        ... on Component { id name type }
        ... on SecurityBoundary { id name }
        ... on DataFlow { id name }
        ... on Model { id name }
      }
      countermeasures {
        id
        name
        type
        score
      }
      folder {
        id
        name
      }
    }
  }
`

export const CONTROL_IDS_BY_ELEMENTS = gql`
  query ControlIdsByElements($elementIds: [ID!]!) {
    controlIdsByElements(elementIds: $elementIds)
  }
`

export const CONTROL_GAPS = gql`
  query ControlGaps($input: ControlGapsInput!) {
    controlGaps(input: $input) {
      unmitigatedExposures {
        elementId
        elementName
        exposureId
        exposureName
        attackTechniques { id name }
        recommendedMitigations { id name }
      }
      unaddressableExposures {
        elementId
        elementName
        exposureId
        exposureName
        attackTechniques { id name }
        mitreMitigations { id name }
      }
      recommendedControls {
        controlId
        controlName
        controlClassId
        controlClassName
        d3fendTechniques { id name }
        addressesCount
        elementsAffected { id name }
      }
      coverageSummary {
        totalExposures
        mitigated
        unmitigated
        unaddressable
        coveragePct
      }
    }
  }
`

export const ASSIGN_CONTROL_TO_ELEMENTS = gql`
  mutation AssignControlToElements($controlId: ID!, $input: ControlUpdateInput!) {
    updateControls(
      where: { id: { eq: $controlId } }
      update: $input
    ) {
      controls {
        id
        name
        description
        type
        category
        elements {
          ... on Component { id name type }
          ... on SecurityBoundary { id name }
          ... on DataFlow { id name }
          ... on Model { id name }
        }
        controlClasses {
          id
          name
          type
          category
          supportedTypes
          supportedCategories
          module {
            id
            name
          }
        }
        folder {
          id
          name
        }
      }
    }
  }
`
