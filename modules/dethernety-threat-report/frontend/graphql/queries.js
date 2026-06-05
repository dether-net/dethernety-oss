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

// Graded, element-scoped, disposition-AGNOSTIC MITRE coverage facts, contributed
// by the sibling `dethernety-coverage-tools` module (a manifest dependency) into
// the merged schema and returned as a JSON-encoded string. The report parses it
// and layers the disposition filter, tier-segregated bucketing, the detect-only
// reduction, and the no-% honest presentation on top (the honesty layer stays in
// the report). The field is ABSENT when coverage-tools isn't deployed — the
// fetcher degrades to null and the report simply ships without the ① matrix.
export const GRADED_COVERAGE = gql`
  query GradedCoverage($modelId: ID!) {
    gradedCoverage(modelId: $modelId)
  }
`
