import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const GET_BOUNDARY_CLASS = gql`
  query GetBoundary($boundaryId: ID!) {
    securityBoundaries( where: {
      id: { eq: $boundaryId }
    }) {
      id
      name
      description
      securityBoundaryClass {
        id
        name
        description
        type
        category
        template
        guide
        module {
          id
          name
        }
      }
    }
  }
`

export const GET_COMPONENT_CLASS = gql`
  query GetComponent($componentId: ID!) {
    components( where: {
      id: { eq: $componentId }
    }) {
      id
      name
      description
      componentClass {
        id
        name
        description
        type
        category
        template
        guide
        module {
          id
          name
        }
      }
    }
  }
`

export const GET_DATA_FLOW_CLASS = gql`
  query GetDataFlow($dataFlowId: ID!) {
    dataFlows( where: {
      id: { eq: $dataFlowId }
    }) {
      id
      name
      description
      dataFlowClass {
        id
        name
        description
        type
        category
        template
        guide
        module {
          id
          name
        }
      }
    }
  }
`

export const GET_DATA_CLASS_BY_ID = gql`
  query GetDataClass($dataClassId: ID!) {
    dataClasses( where: { id: { eq: $dataClassId } }) {
      id
      name
      description
      type
      category
      template
      guide
      module {
        id
        name
      }
    }
  }
`
export const GET_CONTROL_CLASS_BY_ID = gql`
  query GetControlClass($classId: ID!) {
    controlClasses( where: { id: { eq: $classId } }) {
      id
      name
      description
      type
      category
      template
      guide
    }
  }
`

export const SET_INSTANTIATION_ATTRIBUTES = gql`
  mutation setAttributes(
    $componentId: String!,
    $classId: String!,
    $attributes: JSON!
  ) {
    setInstantiationAttributes(
      componentId: $componentId
      classId: $classId
      attributes: $attributes
    ) 
  }
`

export const GET_ATTRIBUTES_FROM_CLASS_RELATIONSHIP = gql`
  query GetAttributes($componentId: String!, $classId: String!) {
    getAttributesFromClassRel (
      componentId: $componentId
      classId: $classId
    )
  }
`

export const GET_CONTROL_CLASSES = gql`
query GetControlClasses(
  $moduleWhere: ModuleWhere,
  $classWhere: ControlClassWhere
) {
  modules(where: $moduleWhere) {
    controlClasses(where: $classWhere) {
      id
      name
      description
      supportedTypes
      supportedCategories
      module {
        id
        name
        description
      }
    }
  }
}
`