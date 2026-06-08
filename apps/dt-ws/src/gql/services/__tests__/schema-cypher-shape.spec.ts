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

  it('contains the expected number of `:BELONGS_TO*0..50` sites (allDescendantComponents/DataFlows + shared-ownership branches + issue element→model resolution)', () => {
    const matches = schema.match(/:BELONGS_TO\*0\.\.50/g) ?? [];
    // 4 pre-existing: allDescendantComponents / allDescendantDataFlows +
    // the two getControlsAssignedModels shared-ownership branches.
    // 4 added by Issue.elementsWithExtendedInfo's directed model-resolution
    // routes — element→boundary→model, the element's DataFlow→component leg,
    // and the same two again for an exposure's host element. Exact count guards
    // against an inadvertent partial revert AND against the undirected
    // multi-relationship expansion (the issue create/update hang) creeping back.
    expect(matches.length).toBe(8);
  });

  it('contains zero remaining `:BELONGS_TO*0..10` or `*1..10` patterns (all sites raised)', () => {
    expect(schema).not.toMatch(/:BELONGS_TO\*0\.\.10/);
    expect(schema).not.toMatch(/:BELONGS_TO\*1\.\.10/);
  });

  it('contains no undirected multi-relationship variable-length expansion (the issue create/update hang) and no fully-unbounded `*1..`', () => {
    // Regression guard for the elementsWithExtendedInfo timeout: an undirected
    // six-relationship variable-length walk to (:Model) exploded on hub
    // elements (e.g. a busy DataFlow) and aborted at the transaction timeout.
    // These assertions are intentionally broader than the :BELONGS_TO-only
    // checks above — which that relationship-type union slipped straight past.
    expect(schema).not.toMatch(
      /CONTAINS\|BELONGS_TO\|FLOWS\|HANDLES\|HAS_EXPOSURE\|ANALYZED_BY/,
    );
    // No `*1..10` on ANY relationship, not just :BELONGS_TO.
    expect(schema).not.toMatch(/\*1\.\.10/);
    // No fully-unbounded upper bound (e.g. getNotRepreseningModels' prior `*1..`).
    expect(schema).not.toMatch(/\*1\.\.\]/);
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
    //   - Issue.elementsWithExtendedInfo's four model-resolution routes —
    //     same anonymous-directed `]->(:SecurityBoundary)` shape as L1403.
    // These are safe by construction; if a future rewrite re-shapes them,
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

/**
 * Provenance immutability guardrail.
 *
 * Both `createdBy` and `authoredBy` on `Exposure` and `Countermeasure`
 * carry `@populatedBy(operations: [CREATE])` (callback stamps the field
 * server-side at create) AND `@settable(onUpdate: false)` (strips the
 * field from the auto-generated UPDATE input shape entirely).
 *
 * Why both:
 * - `@populatedBy(operations: [CREATE])` removes the field from the
 *   CREATE input — clients can't forge it at create time.
 * - `@settable(onUpdate: false)` removes the field from the UPDATE input
 *   — clients can't overwrite it after the fact via `*Update` mutations.
 *
 * Without the @settable directive, an authenticated client could call
 * `updateExposures(where: { id_EQ: "x" }, update: { createdBy_SET: "SYSTEM",
 * authoredBy_SET: "<victim>" })` and (a) impersonate another user, or
 * (b) flip a USER-authored finding to SYSTEM so it gets swept by
 * ElementBindingService on the next class-rebinding pass.
 *
 * These string-snapshot assertions catch:
 * - Accidental removal of @settable from any of the four fields.
 * - Accidental loss of @populatedBy on the same fields.
 * - Accidental sprawl of @settable(onUpdate: false) onto unrelated fields
 *   (exact-count assertion).
 *
 * The end-to-end runtime contract — that GraphQL validation actually
 * rejects `createdBy_SET` / `authoredBy_SET` on the UPDATE input — is
 * proven by the UPDATE-path negative tests in
 * `test/integration/provenance.e2e-spec.ts`.
 */
describe('schema.graphql — provenance field immutability guardrails', () => {
  let schema: string;

  beforeAll(async () => {
    schema = await fs.readFile(SCHEMA_PATH, 'utf-8');
  });

  it('every @populatedBy on a provenance callback is followed by @settable(onUpdate: false)', () => {
    // Capture each populatedBy line and the line immediately after it.
    // The schema convention puts these directives on adjacent lines below
    // the field declaration. If a future refactor reorders or removes the
    // adjacent @settable, this regex fails loudly.
    const provenancePopulatedBy = schema.match(
      /@populatedBy\(callback: "(stampCreatedByUserOnCreate|populateAuthoredByOnCreate)", operations: \[CREATE\]\)\s*\n\s*@settable\(onUpdate: false\)/g,
    ) ?? [];
    // Exposure: createdBy + authoredBy = 2 sites.
    // Countermeasure: createdBy + authoredBy = 2 sites.
    expect(provenancePopulatedBy.length).toBe(4);
  });

  it('@settable(onUpdate: false) appears exactly 4 times (sprawl guard)', () => {
    // Total count must equal the four provenance fields. Any additional
    // occurrence indicates someone added @settable elsewhere — that may
    // be legitimate, but should force a deliberate update of this test
    // so that future readers know the count grew on purpose.
    const settableLockdowns = schema.match(/@settable\(onUpdate: false\)/g) ?? [];
    expect(settableLockdowns.length).toBe(4);
  });

  it('createdBy and authoredBy each have @populatedBy on Exposure and Countermeasure (no callback drift)', () => {
    const stampCreated = schema.match(
      /@populatedBy\(callback: "stampCreatedByUserOnCreate", operations: \[CREATE\]\)/g,
    ) ?? [];
    // One on Exposure.createdBy, one on Countermeasure.createdBy.
    expect(stampCreated.length).toBe(2);

    const populateAuthored = schema.match(
      /@populatedBy\(callback: "populateAuthoredByOnCreate", operations: \[CREATE\]\)/g,
    ) ?? [];
    // One on Exposure.authoredBy, one on Countermeasure.authoredBy.
    expect(populateAuthored.length).toBe(2);
  });
});
