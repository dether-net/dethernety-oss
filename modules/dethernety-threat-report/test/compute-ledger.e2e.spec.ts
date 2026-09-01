// `computeLedger` against a real engine — the graph-level proof for the ledger query.
//
// Every defect this pins is an engine behaviour that returns plausible-but-wrong data and never
// errors, so nothing but real engine output can distinguish a correct ledger from a broken one. A
// stub cannot reach any of them: the bug IS the aggregation semantics. Three were measured on
// Memgraph 3.8.1 while writing this (the query's docstring names them):
//
//   1. `collect(DISTINCT <map>)` does not dedupe when any map VALUE is null.
//   2. A `List<Map>` carried as a grouping key does not collapse, multiplying the element rows.
//   3. A list comprehension whose map does two or more BARE property accesses on the loop variable
//      returns the FIRST element repeated — right count, wrong contents.
//
// (3) is why every assertion below compares IDENTITIES, not lengths. The first version of this spec
// asserted lengths, and it passed against a ledger that reported `[e1, e1]` for `[e1, e2]` — the
// correct count of the wrong data. Lengths cannot see a substitution.
//
// `LEGACY_LEDGER_QUERY` is the pre-fix shape, frozen as a non-vacuity fixture: its only job is to
// prove this seed actually triggers the defects, so a green suite cannot mean "the seed was never
// duplicated". It is history and is not expected to track the source.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Driver } from 'neo4j-driver';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
// Default export — the class itself is not named-exported.
import DethernetyThreatReportModule from '../src/DethernetyThreatReportModule';

const MODEL = 'm-ledger';

const LEGACY_LEDGER_QUERY = `MATCH (m:Model {id: $modelId})
  OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(b:SecurityBoundary)
  WITH m, collect(DISTINCT b) AS bs
  OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(c:Component)
  WITH m, bs, collect(DISTINCT c) AS cs
  OPTIONAL MATCH (m)-[:CONTAINS]->(d:Data)
  WITH m, bs, cs, collect(DISTINCT d) AS ds
  OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(:Component)-[:FLOWS]-(df:DataFlow)
  WITH bs + cs + ds + collect(DISTINCT df) AS els
  UNWIND (CASE WHEN size(els) = 0 THEN [null] ELSE els END) AS el
  WITH el WHERE el IS NOT NULL
  WITH el, [lbl IN labels(el) WHERE lbl IN ['Component', 'DataFlow', 'SecurityBoundary', 'Data']][0] AS elType
  OPTIONAL MATCH (el)-[:HAS_EXPOSURE]->(ex:Exposure)
  WITH el, elType, collect(DISTINCT CASE WHEN ex IS NULL THEN NULL ELSE {
    id: ex.id, name: ex.name, score: ex.score, attackVector: ex.attackVector,
    description: ex.description, type: ex.type, category: ex.category } END) AS findings
  OPTIONAL MATCH (ctrl:Control)-[:SUPPORTS]->(el)
  WITH el, elType, findings, collect(DISTINCT CASE WHEN ctrl IS NULL THEN NULL ELSE {
    id: ctrl.id, name: ctrl.name, type: ctrl.type, category: ctrl.category } END) AS controls
  RETURN collect({ id: el.id, name: el.name, type: elType, findings: findings, supportingControls: controls }) AS ledger`;

// Six elements reachable by the module's own traversal: the top boundary (its *0..50 walk includes it
// at zero hops), a nested boundary, a component under each, model-contained Data, and a DataFlow on a
// component. b2/d1/f1 carry nothing — the empty-array regression guard. c2 carries e4, the
// fully-populated exposure that pins the tuple index mapping.
//
// The nulls are the point, not incidental colour: e1/e3 leave score/attackVector/type/category unset,
// which is the ordinary state of an active finding, and ctrl1 leaves type/category unset, which is the
// state of every control the compliance module creates. Populate them and defect (1) stops firing.
const SEED = `
  CREATE (m:Model {id: '${MODEL}', name: 'Ledger Model'})
  CREATE (b1:SecurityBoundary {id: 'b1', name: 'Perimeter'})
  CREATE (b2:SecurityBoundary {id: 'b2', name: 'Inner'})
  CREATE (c1:Component {id: 'c1', name: 'Payments API'})
  CREATE (c2:Component {id: 'c2', name: 'Quiet Service'})
  CREATE (d1:Data {id: 'd1', name: 'Card Data'})
  CREATE (f1:DataFlow {id: 'f1', name: 'Checkout Flow'})
  CREATE (m)-[:CONTAINS]->(b1)
  CREATE (m)-[:CONTAINS]->(d1)
  CREATE (b2)-[:BELONGS_TO]->(b1)
  CREATE (c1)-[:BELONGS_TO]->(b1)
  CREATE (c2)-[:BELONGS_TO]->(b2)
  CREATE (c1)-[:FLOWS]->(f1)

  CREATE (e1:Exposure {id: 'e1', name: 'Weak auth', tags: ['auth', 'idp'], references: ['CWE-287']})
  CREATE (e2:Exposure {id: 'e2', name: 'Open port', score: 7.5, attackVector: 'NETWORK',
                       type: 'network', category: 'exposure', tags: ['net']})
  CREATE (e3:Exposure {id: 'e3', name: 'Flat network'})
  // Every field populated with a DISTINCT value, so a tuple index swap cannot alias one onto another.
  CREATE (e4:Exposure {id: 'e4', name: 'n-e4', score: 3.5, attackVector: 'av-e4',
                       description: 'd-e4', type: 't-e4', category: 'cat-e4',
                       references: ['ref-e4'], mitigationSuggestions: ['ms-e4'],
                       detectionMethods: ['dm-e4'], tags: ['tag-e4'],
                       createdBy: 'cb-e4', authoredBy: 'ab-e4',
                       dispositionKind: 'dk-e4', dispositionReason: 'dr-e4',
                       dispositionedBy: 'db-e4', dispositionStale: true})
  CREATE (c2)-[:HAS_EXPOSURE]->(e4)
  CREATE (c1)-[:HAS_EXPOSURE]->(e1)
  CREATE (c1)-[:HAS_EXPOSURE]->(e2)
  CREATE (b1)-[:HAS_EXPOSURE]->(e3)

  CREATE (ctrl1:Control {id: 'ctrl1', name: 'MFA'})
  CREATE (ctrl2:Control {id: 'ctrl2', name: 'WAF', type: 'technical', category: 'preventive'})

  // THREE parallel SUPPORTS edges for one pair — what the duplicate-edge writers produced before they
  // were fixed, and what is still on disk until the repair runs.
  CREATE (ctrl1)-[:SUPPORTS]->(c1)
  CREATE (ctrl1)-[:SUPPORTS]->(c1)
  CREATE (ctrl1)-[:SUPPORTS]->(c1)
  CREATE (ctrl2)-[:SUPPORTS]->(c1)
  CREATE (ctrl1)-[:SUPPORTS]->(b1)
  CREATE (ctrl1)-[:SUPPORTS]->(b1)
`;

// The truth the graph encodes, by IDENTITY. Independent of any query.
const TRUTH: Record<string, { type: string; name: string; findings: string[]; controls: string[] }> = {
  b1: { type: 'SecurityBoundary', name: 'Perimeter', findings: ['e3'], controls: ['ctrl1'] },
  b2: { type: 'SecurityBoundary', name: 'Inner', findings: [], controls: [] },
  c1: { type: 'Component', name: 'Payments API', findings: ['e1', 'e2'], controls: ['ctrl1', 'ctrl2'] },
  c2: { type: 'Component', name: 'Quiet Service', findings: ['e4'], controls: [] },
  d1: { type: 'Data', name: 'Card Data', findings: [], controls: [] },
  f1: { type: 'DataFlow', name: 'Checkout Flow', findings: [], controls: [] },
};

interface LedgerRow {
  id: string;
  name: string;
  type: string;
  findings: Array<Record<string, unknown>>;
  supportingControls: Array<Record<string, unknown>>;
}

let mg: MemgraphHandle;
let driver: Driver;

const makeModule = () =>
  new DethernetyThreatReportModule(driver, {
    log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {},
  } as never);

// `computeLedger` is private; reaching it directly is deliberate. Going through generate() would drag
// in the digest, the snapshot write and the analysis lifecycle — none of which these defects live in —
// and would make a red test ambiguous about which layer broke.
const ledgerOf = (): Promise<LedgerRow[]> =>
  (makeModule() as unknown as { computeLedger: (id: string) => Promise<LedgerRow[]> }).computeLedger(MODEL);

const run = async (cypher: string, params: Record<string, unknown> = {}) => {
  const session = driver.session();
  try { return await session.run(cypher, params); } finally { await session.close(); }
};

// One comparable string per element: identities, sorted. This is what catches a substitution.
const fingerprint = (rows: Array<{ id: string; findings: Array<{ id: string }>; supportingControls: Array<{ id: string }> }>) =>
  rows
    .map((el) => `${el.id} f=[${el.findings.map((f) => f.id).sort().join(',')}]` +
                 ` c=[${el.supportingControls.map((c) => c.id).sort().join(',')}]`)
    .sort();

const TRUTH_FINGERPRINT = Object.entries(TRUTH)
  .map(([id, t]) => `${id} f=[${t.findings.join(',')}] c=[${t.controls.join(',')}]`)
  .sort();

beforeAll(async () => {
  mg = await startMemgraph();
  driver = mg.driver;
}, 200_000);

afterAll(async () => { await mg?.stop(); });

beforeEach(async () => {
  await clearGraph(driver);
  await run(SEED);
});

describe('computeLedger — multiplicity and identity against a real engine', () => {
  it('THE DEFECT — the pre-fix shape disagrees with the graph on this same seed', async () => {
    // Non-vacuity. If this ever goes green the seed stopped exercising the defects, and every
    // assertion below is worthless whether or not it passes.
    const rows = (await run(LEGACY_LEDGER_QUERY, { modelId: MODEL })).records[0].get('ledger') as LedgerRow[];
    expect(rows.length).toBeGreaterThan(Object.keys(TRUTH).length);
    expect(fingerprint(rows)).not.toEqual(TRUTH_FINGERPRINT);
  });

  it('THE FIX — the whole ledger matches the graph, element for element', async () => {
    expect(fingerprint(await ledgerOf())).toEqual(TRUTH_FINGERPRINT);
  });

  it('one row per element, with the right type and name', async () => {
    const rows = await ledgerOf();
    expect(rows).toHaveLength(Object.keys(TRUTH).length);
    for (const row of rows) {
      expect(TRUTH[row.id], `unexpected element ${row.id}`).toBeDefined();
      expect(row.type).toBe(TRUTH[row.id].type);
      // `el.name` is a second bare property access on the row binding, alongside `el.id`. Pinned
      // because that is the shape defect (3) punishes inside a comprehension.
      expect(row.name).toBe(TRUTH[row.id].name);
    }
  });

  it('a pair carrying 3 parallel SUPPORTS edges yields ONE control, and the OTHER control survives', async () => {
    // The row the report renders as "Controls present (N)". Pre-fix it read 3 for a single control,
    // beside a mismatch count that deduped correctly — a self-contradictory card. And the naive fix
    // read 2 with ctrl2 replaced by a second copy of ctrl1, which is worse.
    const c1 = (await ledgerOf()).find((r) => r.id === 'c1')!;
    expect(c1.supportingControls.map((c) => c.id).sort()).toEqual(['ctrl1', 'ctrl2']);
    expect(c1.supportingControls.map((c) => c.name).sort()).toEqual(['MFA', 'WAF']);
  });

  it('null-valued fields survive dedupe rather than being coalesced away', async () => {
    // Dedupe happens on a scalar TUPLE, so nulls stay null. A `coalesce`-everything fix would also
    // dedupe, but it would silently turn "not scored" into a placeholder score.
    const c1 = (await ledgerOf()).find((r) => r.id === 'c1')!;
    const e1 = c1.findings.find((f) => f.id === 'e1')!;
    const e2 = c1.findings.find((f) => f.id === 'e2')!;
    expect(e1.score).toBeNull();
    expect(e1.attackVector).toBeNull();
    expect(e2.score).toBe(7.5);
    expect(e2.attackVector).toBe('NETWORK');
    expect(c1.supportingControls.find((c) => c.id === 'ctrl1')!.type).toBeNull();
    expect(c1.supportingControls.find((c) => c.id === 'ctrl2')!.type).toBe('technical');
  });

  it('list-valued finding fields survive the tuple round trip', async () => {
    // `tags` / `references` are nested lists inside the DISTINCT tuple — the one part of the tuple
    // form that could plausibly have broken dedupe or flattened.
    const c1 = (await ledgerOf()).find((r) => r.id === 'c1')!;
    expect(c1.findings.find((f) => f.id === 'e1')!.tags).toEqual(['auth', 'idp']);
    expect(c1.findings.find((f) => f.id === 'e2')!.tags).toEqual(['net']);
  });

  it('is idempotent under further duplication — more parallel edges change nothing', async () => {
    const before = fingerprint(await ledgerOf());
    await run(`MATCH (ctrl:Control {id: 'ctrl1'}), (c:Component {id: 'c1'})
               CREATE (ctrl)-[:SUPPORTS]->(c) CREATE (ctrl)-[:SUPPORTS]->(c)`);
    expect(fingerprint(await ledgerOf())).toEqual(before);
  });

  it('an element with no exposures and no controls yields empty arrays', async () => {
    // The `CASE WHEN … IS NULL` guard on both collects is the only thing standing between this and a
    // phantom all-null finding, because a TUPLE of nulls is not null and `collect` will not skip it.
    const b2 = (await ledgerOf()).find((r) => r.id === 'b2')!;
    expect(b2.findings).toEqual([]);
    expect(b2.supportingControls).toEqual([]);
  });

  it('every tuple index maps to the field it claims', async () => {
    // The tuple form trades map-building for positional indexing, so index drift is its whole risk:
    // swap two indices and the ledger reports a score as a name, silently. e4 populates every field
    // with a distinct value so no swap can alias one onto another.
    const e4 = (await ledgerOf()).find((r) => r.id === 'c2')!.findings.find((f) => f.id === 'e4')!;
    expect(e4).toEqual({
      id: 'e4', name: 'n-e4', score: 3.5, attackVector: 'av-e4', description: 'd-e4',
      type: 't-e4', category: 'cat-e4', references: ['ref-e4'],
      mitigationSuggestions: ['ms-e4'], detectionMethods: ['dm-e4'], tags: ['tag-e4'],
      createdBy: 'cb-e4', authoredBy: 'ab-e4', dispositionKind: 'dk-e4',
      dispositionReason: 'dr-e4', dispositionedBy: 'db-e4', dispositionedAt: null,
      dispositionStale: true,
    });
  });

  it('every control tuple index maps to the field it claims', async () => {
    const ctrl2 = (await ledgerOf()).find((r) => r.id === 'c1')!
      .supportingControls.find((c) => c.id === 'ctrl2')!;
    expect(ctrl2).toEqual({ id: 'ctrl2', name: 'WAF', type: 'technical', category: 'preventive' });
  });

  it('a model with no elements yields an empty ledger, not a phantom row', async () => {
    await clearGraph(driver);
    await run(`CREATE (:Model {id: '${MODEL}', name: 'Empty'})`);
    expect(await ledgerOf()).toEqual([]);
  });
});
