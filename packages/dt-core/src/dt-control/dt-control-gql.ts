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
