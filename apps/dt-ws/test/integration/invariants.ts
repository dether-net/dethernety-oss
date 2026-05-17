// Shared invariant assertions for integration test suites that touch the
// class-binding lifecycle. Extracted from element-binding.e2e-spec.ts so
// provenance.e2e-spec.ts and any future binding-related spec can adopt
// the same `afterEach` global assertion.
//
// Each helper opens a session, runs a Cypher query, asserts a global graph
// invariant, and closes the session. Use them as `afterEach(async () => {
// await assertMutualExclusion(driver); })`.
//
// `expect` is a Jest global in the e2e test environment (jest-e2e.json
// inherits the jest globals); no explicit import is needed.

/**
 * Mutual-exclusion invariant.
 *
 * No element carries both an `IS_INSTANCE_OF` edge to a non-Issue, non-Analysis
 * `*Class` AND a `REPRESENTS_MODEL` edge to a Model. Issue/Analysis classes are
 * exempt — analyses can legitimately carry both.
 *
 * Returns silently on success; throws a Jest expectation failure on violation.
 */
export async function assertMutualExclusion(driver: any): Promise<void> {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (e)-[:IS_INSTANCE_OF]->(k)
         WHERE any(l IN labels(k) WHERE l ENDS WITH 'Class' AND l <> 'IssueClass' AND l <> 'AnalysisClass')
       MATCH (e)-[:REPRESENTS_MODEL]->(:Model)
       RETURN COUNT(DISTINCT e) AS violations`,
    );
    const v = result.records[0].get('violations');
    const n = typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
    expect(n).toBe(0);
  } finally {
    await session.close();
  }
}
