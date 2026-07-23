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
      module {
        id
        name
      }
    }
  }
`

export const GET_COMPONENT_CLASS_BY_ID = gql`
  query GetComponentClassById($classId: ID!) {
    componentClasses( where: { id: { eq: $classId } }) {
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

export const GET_BOUNDARY_CLASS_BY_ID = gql`
  query GetBoundaryClassById($classId: ID!) {
    securityBoundaryClasses( where: { id: { eq: $classId } }) {
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

export const GET_DATA_FLOW_CLASS_BY_ID = gql`
  query GetDataFlowClassById($classId: ID!) {
    dataFlowClasses( where: { id: { eq: $classId } }) {
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
    ) {
      success
    }
  }
`

/**
 * Picker save path sibling mutation that additionally selects
 * `staleFlippedCount` for the
 * "N need review" badge on SettingsExposuresTab. Backend Cypher is unchanged;
 * the resolver always counts the flipped dispositions. The existing
 * SET_INSTANTIATION_ATTRIBUTES query stays the way it is for the 4 internal
 * callers (dt-update / dt-update-split / dt-control / dt-control-library) so
 * their `Promise<boolean>` surface doesn't drift.
 */
export const SET_INSTANTIATION_ATTRIBUTES_WITH_STALE_COUNT = gql`
  mutation setAttributesWithStaleCount(
    $componentId: String!,
    $classId: String!,
    $attributes: JSON!
  ) {
    setInstantiationAttributes(
      componentId: $componentId
      classId: $classId
      attributes: $attributes
    ) {
      success
      staleFlippedCount
      errorCode
      errorMessage
    }
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

export const MATCH_CLASSES = gql`
  query MatchClasses($input: MatchClassesInput!) {
    matchClasses(input: $input) {
      matches {
        elementName
        candidates {
          classId
          className
          classDescription
          classCategory
          classType
          moduleId
          moduleName
          matchType
          confidence
          similarityScore
        }
      }
      unmatched
      vectorAvailable
    }
  }
`

export const LIST_CLASSES = gql`
  query ListClasses($input: ListClassesInput!) {
    listClasses(input: $input) {
      items {
        classId
        className
        classDescription
        classCategory
        classType
        moduleId
        moduleName
        matchType
        confidence
        similarityScore
      }
      totalCount
      facetCounts {
        categories {
          value
          count
        }
        modules {
          moduleId
          moduleName
          count
        }
        types {
          value
          count
        }
      }
    }
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

export const CHANGE_ELEMENT_BINDING = gql`
  mutation ChangeElementBinding($elementId: ID!, $target: ElementBindingInput!) {
    changeElementBinding(elementId: $elementId, target: $target) {
      success
      elementId
      targetBinding {
        __typename
        ... on ClassBinding { classIds }
        ... on RepresentedModelBinding { modelId }
      }
      deltas {
        deletedDerivedExposures
        instantiatedDerivedExposures
        preservedCustomExposures
        deletedDerivedCountermeasures
        instantiatedDerivedCountermeasures
        preservedCustomCountermeasures
      }
      errorCode
      errorMessage
    }
  }
`