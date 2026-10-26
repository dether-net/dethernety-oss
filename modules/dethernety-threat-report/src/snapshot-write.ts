/**
 * Snapshot write — replaces an analysis's report snapshot on its Analysis node.
 *
 * Single-statement SET ⇒ atomic snapshot replacement. It runs in a write transaction, not as an
 * auto-commit: two runs of one analysis write the same node, Memgraph answers the second with a
 * transient conflict, and only a transaction function retries it, so the last run to commit wins.
 */

import type { ManagedTransaction, Session } from 'neo4j-driver';

export interface ThreatReportSnapshotWrite {
  analysisId: string;
  /** The snapshot doc, serialised. */
  doc: string;
  generatedAt: string;
  fingerprint: string;
}

/**
 * Replace an analysis's report snapshot. Answers false when the Analysis node is missing: the MATCH
 * yields zero rows and the SET silently no-ops, so the caller must not report success.
 */
export async function writeThreatReportSnapshot(
  session: Session,
  write: ThreatReportSnapshotWrite,
): Promise<boolean> {
  const result = await session.executeWrite((tx: ManagedTransaction) =>
    tx.run(
      `MATCH (a:Analysis {id: $analysisId})
       SET a.threatReportDoc = $doc,
           a.threatReportGeneratedAt = $generatedAt,
           a.threatReportFingerprint = $fingerprint
       RETURN a.id AS id`,
      write,
    ),
  );
  return result.records.length > 0;
}
