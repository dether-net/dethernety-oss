import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'


export const FIND_ANALYSES = gql`
  query FindAnalysis($condition: AnalysisWhere) {
    analyses(where: $condition) {
			id
			name
			description
			type
			category
      status {
        createdAt
        updatedAt
        status
        interrupts
        messages
        metadata
      }
			analysisClass {
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
      model {
        id
        name
      }
      component {
        id
        name
      }
      dataFlow {
        id
        name
      }
      securityBoundary {
        id
        name
      }
      control {
        id
        name
      }
      data {
        id
        name
      }
      # element {
      #   id
      #   name
      # }
		}
	}
`

export const FIND_ANALYSIS_CLASSES = gql`
  query FindAnalysisClasses($condition: AnalysisClassWhere) {
    analysisClasses(where: $condition) {
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

export const CREATE_ANALYSIS = gql`
  mutation CreateAnalysis(
    $name: String!, $description: String, $elementId: ID!, $analysisClassId: ID!, $type: String, $category: String
  ) {
    createAnalyses(
      input: {
        name: $name
        description: $description
        # element: {
        #   connect: { where: { node: { id: { eq: $elementId } } } }
        # }
        model: {
          connect: { where: { node: { id: { eq: $elementId } } } }
        }
        component: {
          connect: { where: { node: { id: { eq: $elementId } } } }
        }
        dataFlow: {
          connect: { where: { node: { id: { eq: $elementId } } } }
        }
        securityBoundary: {
          connect: { where: { node: { id: { eq: $elementId } } } }
        }
        control: {
          connect: { where: { node: { id: { eq: $elementId } } } }
        }
        data: {
          connect: { where: { node: { id: { eq: $elementId } } } }
        }
        analysisClass: {
          connect: { where: { node: { id: { eq: $analysisClassId } } } }
        }
        type: $type
        category: $category
      }
    ) {
      analyses {
        id
        name
        description
        type
        category
        status {
          createdAt
          updatedAt
          status
          interrupts
          messages
          metadata
        }
        analysisClass {
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

export const DELETE_ANALYSIS = gql`
  mutation DeleteAnalysis($analysisId: String!) {
    deleteAnalysis(analysisId: $analysisId)
  }
`

export const RUN_ANALYSIS = gql`
  mutation RunAnalysis($analysisId: String!, $additionalParams: JSON ) {
    runAnalysis(analysisId: $analysisId, additionalParams: $additionalParams) {
      sessionId
    }
  }
`

export const RESUME_ANALYSIS = gql`
  mutation ResumeAnalysis($analysisId: String!, $userInput: String!) {
    resumeAnalysis(analysisId: $analysisId, userInput: $userInput) {
      sessionId
    }
  }
`

export const GET_ANALYSIS_VALUES = gql`
  query GetAnalysisValues($analysisId: String!, $valueKey: String!) {
    getAnalysisValues(analysisId: $analysisId, valueKey: $valueKey)
  }
`

export const SUBSCRIBE_TO_STREAM = gql`
  subscription SubscribeToStream($sessionId: String!) {
    streamResponse(sessionId: $sessionId) {
      content
      id
    }
  }
`

export const UPDATE_ANALYSIS = gql`
  mutation UpdateAnalysis($analysisId: ID!, $input: AnalysisUpdateInput!) {
    updateAnalyses(where: { id: { eq: $analysisId } }, update: $input) {
      analyses {
        id
        name
        description
        type
        category
        status {
          createdAt
          updatedAt
          status
          interrupts
          messages
          metadata
        }
        analysisClass {
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
    }
  }
`

export const GET_DOCUMENT = gql`
  query GetDocument($analysisId: String!, $filter: JSON!) {
    getDocument(analysisId: $analysisId, filter: $filter)
  }
`

export const START_ANALYSIS_CHAT = gql`
  mutation StartAnalysisChat(
    $analysisId: String!,
    $userQuestion: String!,
  ) {
    startChat (
      analysisId: $analysisId
      userQuestion: $userQuestion
    ) {
      sessionId
    }
  }
`

export const SUBSCRIBE_ANALYSIS_CHAT = gql`
  subscription SubscribeAnalysisChat($sessionId: String!) {
    chatResponse(
      sessionId: $sessionId
    ) {
      content
      id
    }
  }
`