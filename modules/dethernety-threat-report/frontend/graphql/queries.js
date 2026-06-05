// frontend/graphql/queries.js — module-owned GraphQL documents.
//
// These query the module's OWN fields, contributed to the merged schema via the
// backend getSchemaExtension()/getResolvers(). They are issued through the host
// Apollo client (useHostContext().utils.dtUtils), never a module-private client.

import gql from 'graphql-tag'

// The live structural fingerprint of a model's report-relevant content. The
// staleness UX compares this to the fingerprint stored in the open snapshot:
// a mismatch means the model changed since the snapshot was generated.
export const THREAT_REPORT_FINGERPRINT = gql`
  query ThreatReportFingerprint($modelId: ID!) {
    threatReportFingerprint(modelId: $modelId)
  }
`
