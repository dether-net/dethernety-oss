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
        description
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
mutation UpdateControl($controlId: ID!, $input: ControlUpdateInput!) {
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
      supportedComponents { id name type }
      supportedBoundaries { id name }
      supportedDataFlows { id name }
      countermeasures {
        id
        name
        type
        score
        createdBy
        authoredBy
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
        configuredCoverage
        noMitreChain
        coveragePct
      }
    }
  }
`

export const CONTROL_CANDIDATES_FOR_TYPE = gql`
  query ControlCandidatesForType($elementTypes: [ComponentType!]!, $moduleIds: [ID!]) {
    controlCandidatesForType(elementTypes: $elementTypes, moduleIds: $moduleIds) {
      controlId
      controlName
      classes {
        classId
        className
        moduleId
        moduleName
        compatible
        countermeasureCount
      }
      totalCountermeasures
      assignedElementIds
    }
  }
`

/**
 * Batched fetch returning class metadata for a set of Control ids.
 *
 * Returns `{ id, name, controlClasses: [{ id, name, module: { id } }] }` only —
 * per-instance IS_INSTANCE_OF edge attributes are NOT exposed by the
 * auto-generated `controlClasses` resolver. Use
 * `GET_CONTROL_INSTANTIATION_ATTRIBUTES` for that payload.
 */
export const GET_CONTROLS_BY_IDS = gql`
  query GetControlsByIds($ids: [ID!]!) {
    controls(where: { id: { in: $ids } }) {
      id
      name
      controlClasses {
        id
        name
        module {
          id
          name
        }
      }
    }
  }
`

/**
 * Batched lookup of the live set of Model IDs that reference each given
 * Control via SUPPORTS edges. Backs the shared-ownership safety check
 * (CONTROL_LIBRARY.md §6).
 */
export const GET_CONTROLS_ASSIGNED_MODELS = gql`
  query GetControlsAssignedModels($controlIds: [ID!]!) {
    getControlsAssignedModels(controlIds: $controlIds) {
      controlId
      modelIds
    }
  }
`

/**
 * Batched lookup of per-(Control, ControlClass) instantiation attributes
 * (IS_INSTANCE_OF edge properties). Backs the control-library pull and the
 * brownfield push Step B refresh (CONTROL_LIBRARY.md §7).
 */
export const GET_CONTROL_INSTANTIATION_ATTRIBUTES = gql`
  query GetControlInstantiationAttributes($controlIds: [ID!]!) {
    getControlInstantiationAttributes(controlIds: $controlIds) {
      controlId
      classId
      attributes
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
        supportedComponents { id name type }
        supportedBoundaries { id name }
        supportedDataFlows { id name }
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
