import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const ADD_DATA_FLOW = gql`
  mutation AddDataFlow(
    $name: String!,
    $classId: ID,
    $description: String,
    $source: ID!,
    $target: ID!,
    $sourceHandle: String,
    $targetHandle: String
  ) {
    createDataFlows(
      input: {
        name: $name
        description: $description
        dataFlowClass: {
          connect: {
            where: {
              node: { id: { eq: $classId } }
            }
          }
        }
        source: {
          connect: {
            where: {
              node: { id: { eq: $source } }
            }
          }
        }
        target: {
          connect: {
            where: {
              node: { id: { eq: $target } }
            }
          }
        }
        sourceHandle: $sourceHandle
        targetHandle: $targetHandle
      }
    ) {
      dataFlows {
        id
        name
        description
        source {
          id
        }
        target {
          id
        }
        sourceHandle
        targetHandle
      }
    }
  } 
`

export const UPDATE_DATA_FLOW = gql`
  mutation UpdateDataFlow(
    $dataFlowId: ID!,
    $input: DataFlowUpdateInput!
  ) {
    updateDataFlows(
      where: {
        id: { eq: $dataFlowId }
      }
      update: $input
    ) {
      dataFlows {
        id
        name
        description
        source {
          id
        }
        target {
          id
        }
        controls {
          id
          name
          description
          controlClasses {
            id
            name
            description
            supportedTypes
            supportedCategories
          }
        }
        dataItems {
          id
          name
          description
          dataClass {
            id
            name
          }
          # elements {
          #   id
          # }
        }
        sourceHandle
        targetHandle
      }
    }
  }
`

export const DELETE_DATA_FLOW = gql`
  mutation DeleteDataFlow($dataFlowId: ID!) {
    deleteDataFlows(
      where: { id: { eq: $dataFlowId } }, delete: { exposures: {} }
    ) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`