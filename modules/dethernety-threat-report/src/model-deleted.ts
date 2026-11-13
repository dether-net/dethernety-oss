/** The module name the platform registers this module under (its classes hang off this `:Module` node). */
export const MODULE_NAME = 'dethernety-threat-report';

/**
 * This module's analyses among the deleted model's, deleted with their edges, the report snapshot with them. The
 * platform passes every analysis the model owned, whichever module made it; only those whose class this module holds
 * (or held, for a retired class) are matched, so another module's analysis is never touched. Each is looked up by id,
 * and DISTINCT keeps one row per node for the count.
 */
export const Q_DELETE_MODEL_ANALYSES = `
UNWIND $analysisIds AS id
MATCH (a:Analysis {id: id})-[:IS_INSTANCE_OF]->(:AnalysisClass)<-[:HAS_CLASS|HAS_ORPHANED_CLASS]-(:Module {name: $module})
WITH DISTINCT a
OPTIONAL MATCH (a)-[r]-()
WITH a, count(r) AS rels
DETACH DELETE a
RETURN count(*) AS nodesDeleted, sum(rels) AS relationshipsDeleted
`;

/** What a model delete removed, folded into the platform's deletion stats. */
export type DeleteCounts = { nodesDeleted: number; relationshipsDeleted: number };

const toNumber = (v: any): number => (v == null ? 0 : typeof v.toNumber === 'function' ? v.toNumber() : Number(v));

/**
 * DTModule.onModelDeleted's work: runs on the platform's own delete transaction, so it commits or rolls back with the
 * model, and touches nothing off `tx`. Idempotent: a retried transaction runs it again over nodes already gone, which
 * match nothing.
 */
export async function deleteModelAnalyses(
  tx: { run: (query: string, params: Record<string, unknown>) => Promise<{ records: Array<{ get: (key: string) => unknown }> }> },
  analysisIds: string[],
): Promise<DeleteCounts> {
  if (!analysisIds.length) return { nodesDeleted: 0, relationshipsDeleted: 0 };
  const res = await tx.run(Q_DELETE_MODEL_ANALYSES, { analysisIds, module: MODULE_NAME });
  const row = res.records[0];
  return { nodesDeleted: toNumber(row?.get('nodesDeleted')), relationshipsDeleted: toNumber(row?.get('relationshipsDeleted')) };
}
