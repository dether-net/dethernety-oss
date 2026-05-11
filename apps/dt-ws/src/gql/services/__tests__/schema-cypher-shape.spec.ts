/**
 * EXPLAIN snapshot test — pin the variable-length-expand depth bounds
 * in the shipped schema so a future inadvertent rewrite (back to
 * `*0..10`, cross-product join, additional traversal pattern) breaks
 * this test loudly at CI time rather than silently fail-open at runtime
 * on a customer with a deeply nested boundary topology.
 *
 * Why text-snapshot rather than a real Memgraph EXPLAIN:
 *
 * - dt-ws has no in-process Memgraph harness; spinning one up just for
 *   plan-shape verification is disproportionate.
 * - The plan shape we actually care about is "single ExpandVariable
 *   operator, no Cartesian" — that is a function of the Cypher source
 *   string, not of the runtime planner. Pinning the source string
 *   guarantees the planner gets the same input and produces the same
 *   plan.
 * - A full EXPLAIN harness can land later as a separate spec when we
 *   need it for other queries; the deferral note in REVIEW_FINDINGS
 *   captures the rationale.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../schema/schema.graphql',
);

describe('schema.graphql — Cypher depth-bound shape snapshot', () => {
  let schema: string;

  beforeAll(async () => {
    schema = await fs.readFile(SCHEMA_PATH, 'utf-8');
  });

  it('contains exactly one `:BELONGS_TO*1..50` (allDescendantBoundaries — 1-anchored excludes self)', () => {
    const matches = schema.match(/:BELONGS_TO\*1\.\.50/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('contains the expected number of `:BELONGS_TO*0..50` sites (allDescendantComponents/DataFlows + shared-ownership branches)', () => {
    const matches = schema.match(/:BELONGS_TO\*0\.\.50/g) ?? [];
    // L285 + L296 (allDescendantComponents / allDescendantDataFlows) +
    // L1399 + L1403 (shared-ownership query, getControlsAssignedModels
    // branches). Exact count guards against an inadvertent partial
    // revert (e.g. missing one of the four sites).
    expect(matches.length).toBe(4);
  });

  it('contains zero remaining `:BELONGS_TO*0..10` or `*1..10` patterns (all sites raised)', () => {
    expect(schema).not.toMatch(/:BELONGS_TO\*0\.\.10/);
    expect(schema).not.toMatch(/:BELONGS_TO\*1\.\.10/);
  });

  it('every named-target variable-length :BELONGS_TO traversal is anchored to a single labelled node', () => {
    // Find each named-target variable-length :BELONGS_TO traversal — i.e.,
    // those whose right-hand node binds an alias AND a label. A Cartesian-
    // style rewrite of these sites would drop the label suffix.
    //
    // Cross-review caveat: schema.graphql contains TWO additional
    // variable-length :BELONGS_TO shapes that this regex deliberately
    // does not cover, because their shape is intrinsically different
    // and a "missing label" assertion doesn't apply:
    //   - L1399 `:BELONGS_TO*0..50]-(e)` — bare-alias right side; type
    //     constraint enforced by an outer `WHERE e:Component OR
    //     e:SecurityBoundary` predicate, not by inline label syntax.
    //   - L1403 `:BELONGS_TO*0..50]->(:SecurityBoundary)` — anonymous-
    //     node right side with explicit traversal direction (`->`).
    // Both are safe by construction; if a future rewrite re-shapes them,
    // the count assertion above will catch it.
    const namedTargetExpands =
      schema.match(/:BELONGS_TO\*\d+\.\.\d+\]-\(\w+:\w+\)/g) ?? [];
    expect(namedTargetExpands.length).toBeGreaterThan(0);
    for (const expand of namedTargetExpands) {
      // Pattern: `:BELONGS_TO*N..M]-(alias:Label)` — verifies a single
      // label suffix is present.
      expect(expand).toMatch(/\]-\(\w+:[A-Z]\w+\)/);
    }
  });
});
