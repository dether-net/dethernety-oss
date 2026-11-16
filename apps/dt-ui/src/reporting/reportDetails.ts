import { gql } from 'graphql-tag'
import { getApolloClient } from '@/plugins/apolloClient'

/** An analysis's report details as a report reads them: a key is present only when it holds a value. */
export interface ReportDetails {
  client?: string
  updated?: string
}

interface ReportDetailsRow {
  client: string | null
  updated: string | null
}

export const REPORT_DETAILS = gql`
  query ReportDetails($analysisId: ID!) {
    reportDetails(analysisId: $analysisId) {
      client
      updated
    }
  }
`

const SUGGEST_REPORT_DETAILS = gql`
  query SuggestReportDetails($analysisId: ID!) {
    suggestReportDetails(analysisId: $analysisId) {
      client
      updated
    }
  }
`

const SET_REPORT_DETAILS = gql`
  mutation SetReportDetails($analysisId: ID!, $details: ReportDetailsInput!) {
    setReportDetails(analysisId: $analysisId, details: $details) {
      client
      updated
    }
  }
`

/** A row from the server as a report reads it; null stays null. */
function toReportDetails(row: ReportDetailsRow | null | undefined): ReportDetails | null {
  if (!row) return null
  const details: ReportDetails = {}
  if (typeof row.client === 'string' && row.client !== '') details.client = row.client
  if (typeof row.updated === 'string' && row.updated !== '') details.updated = row.updated
  return details
}

async function query(document: typeof REPORT_DETAILS, field: string, analysisId: string): Promise<ReportDetailsRow | null> {
  const client = await getApolloClient()
  // Read live: the details can change in the dialog at any time, and a report must print the current ones.
  const result = await client.query<Record<string, ReportDetailsRow | null>>({
    query: document,
    variables: { analysisId },
    fetchPolicy: 'network-only',
  })
  return result.data?.[field] ?? null
}

/** The analysis's report details, read live; null when it has none (bound to no element). */
export async function getReportDetails(analysisId: string): Promise<ReportDetails | null> {
  return toReportDetails(await query(REPORT_DETAILS, 'reportDetails', analysisId))
}

/** The newest client name among the other analyses of the same element(s); null when none has one. */
export async function suggestReportDetails(analysisId: string): Promise<ReportDetails | null> {
  return toReportDetails(await query(SUGGEST_REPORT_DETAILS, 'suggestReportDetails', analysisId))
}

/** Sets the client (null clears it); returns the details as stored. */
export async function setReportDetails(analysisId: string, client: string | null): Promise<ReportDetails | null> {
  const apollo = await getApolloClient()
  const result = await apollo.mutate<{ setReportDetails: ReportDetailsRow | null }>({
    mutation: SET_REPORT_DETAILS,
    variables: { analysisId, details: { client } },
  })
  return toReportDetails(result.data?.setReportDetails)
}
