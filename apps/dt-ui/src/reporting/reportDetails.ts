import { gql } from 'graphql-tag'
import { getApolloClient } from '@/plugins/apolloClient'

/** A field the user added to an analysis's report details. */
export interface ReportDetailField {
  label: string
  value: string
}

/** An analysis's report details as a report reads them: a key is present only when it holds a value. */
export interface ReportDetails {
  client?: string
  author?: string
  project?: string
  /** In the order the user gave them. */
  customFields?: ReportDetailField[]
  updated?: string
}

/** What a save changes: a key given is written, null clears it, and a key left out stays as it is. */
export interface ReportDetailsChanges {
  client?: string | null
  author?: string | null
  project?: string | null
  /** Replaces the whole list; null removes it. */
  customFields?: ReportDetailField[] | null
}

interface ReportDetailsRow {
  client: string | null
  author: string | null
  project: string | null
  customFields: { label: unknown; value: unknown }[] | null
  updated: string | null
}

const FIELDS = `
      client
      author
      project
      customFields {
        label
        value
      }
      updated`

export const REPORT_DETAILS = gql`
  query ReportDetails($analysisId: ID!) {
    reportDetails(analysisId: $analysisId) {${FIELDS}
    }
  }
`

const SUGGEST_REPORT_DETAILS = gql`
  query SuggestReportDetails($analysisId: ID!) {
    suggestReportDetails(analysisId: $analysisId) {${FIELDS}
    }
  }
`

const SET_REPORT_DETAILS = gql`
  mutation SetReportDetails($analysisId: ID!, $details: ReportDetailsInput!) {
    setReportDetails(analysisId: $analysisId, details: $details) {${FIELDS}
    }
  }
`

const text = (value: unknown): value is string => typeof value === 'string' && value !== ''

/**
 * A row from the server as a report reads it; null stays null. A custom field without a text label and value is
 * dropped.
 */
function toReportDetails(row: ReportDetailsRow | null | undefined): ReportDetails | null {
  if (!row) return null
  const details: ReportDetails = {}
  if (text(row.client)) details.client = row.client
  if (text(row.author)) details.author = row.author
  if (text(row.project)) details.project = row.project
  if (Array.isArray(row.customFields)) {
    const fields = row.customFields
      .filter((field) => field !== null && typeof field === 'object' && text(field.label) && text(field.value))
      .map((field) => ({ label: field.label as string, value: field.value as string }))
    if (fields.length > 0) details.customFields = fields
  }
  if (text(row.updated)) details.updated = row.updated
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

/** The newest report details among the other analyses of the same element(s); null when none has any. */
export async function suggestReportDetails(analysisId: string): Promise<ReportDetails | null> {
  return toReportDetails(await query(SUGGEST_REPORT_DETAILS, 'suggestReportDetails', analysisId))
}

/**
 * Saves the changed keys only, so a save leaves what another editor set in other keys; returns the details as stored.
 */
export async function setReportDetails(
  analysisId: string,
  changes: ReportDetailsChanges,
): Promise<ReportDetails | null> {
  const apollo = await getApolloClient()
  const result = await apollo.mutate<{ setReportDetails: ReportDetailsRow | null }>({
    mutation: SET_REPORT_DETAILS,
    variables: { analysisId, details: changes },
  })
  return toReportDetails(result.data?.setReportDetails)
}
