import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export const ADD_DATA_ITEM = gql`
  mutation AddData($input: [DataCreateInput!]!) {
    createData(input: $input) {
      data {
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
    }
  }
  `


export const UPDATE_DATA_ITEM = gql`
  mutation UpdateData($dataId: ID!, $input: DataUpdateInput!) {
    updateData(
      where: {
        id: { eq: $dataId }
      }
      update: $input
    ) {
      data {
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
    }
  }
`

export const DELETE_DATA_ITEM = gql`
  mutation DeleteData($dataId: ID!) {
    deleteExposures(where: { element: { some: { id: { eq: $dataId }}}}) {
      nodesDeleted
      relationshipsDeleted
    }
    deleteAnalyses(where: { element: { some: { id: { eq: $dataId }}}}) {
      nodesDeleted
      relationshipsDeleted
    }
    deleteData(
      where: { id: { eq: $dataId } }
      # , delete: { exposures: {} }
    ) {
      nodesDeleted
      relationshipsDeleted
    }
  }
`