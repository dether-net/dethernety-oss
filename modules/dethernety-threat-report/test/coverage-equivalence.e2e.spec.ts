// gradedCoverage, the report's coverage input, computed live on the shared equivalence fixture.
//
// dethernety-coverage-tools pins its aggregation to `__tests__/fixtures/equivalence/` from recorded
// query rows, so its own suite never runs the Cypher. This spec runs the module's real queries on
// a Memgraph seeded with that fixture's `seed.cypher` and requires the result to equal its
// `expected.json`, field for field.
//
// It exists because the tactic columns are built from a list comprehension over tactic nodes, and
// Memgraph 3.8 returns the FIRST element's bare properties for every element when the comprehension
// builds a map literal (defect 3 in compute-ledger.e2e.spec.ts). A technique with three tactics then
// reports one tactic three times, which only real engine output can show. The fixture's T9001 carries
// three tactics whose matrix order differs from their alphabetical order, so the comparison also pins
// the order.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { startMemgraph, MemgraphHandle } from './memgraph-container';
// Default export — the class itself is not named-exported.
import DethernetyCoverageToolsModule from '../../dethernety-coverage-tools/src/DethernetyCoverageToolsModule';

const FIXTURE = new URL('../../dethernety-coverage-tools/__tests__/fixtures/equivalence/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, FIXTURE), 'utf8');

/** Canonical JSON: objects with sorted keys, arrays in place. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, (value as any)[k]]))
      : value,
  );

describe('gradedCoverage on the equivalence fixture (Memgraph)', () => {
  let mg: MemgraphHandle;

  beforeAll(async () => {
    mg = await startMemgraph();
    const statements = read('seed.cypher')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const session = mg.driver.session();
    try {
      for (const statement of statements) await session.run(statement);
    } finally {
      await session.close();
    }
  });

  afterAll(async () => {
    await mg?.stop();
  });

  it('computes exactly expected.json, tactic objects and their matrix order included', async () => {
    const logger = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
    const module = new DethernetyCoverageToolsModule(mg.driver, logger as any);
    const expected = JSON.parse(read('expected.json'));
    // computeGradedCoverage is the resolver's body; generatedAt is the only wall-clock field.
    const result = await (module as any).computeGradedCoverage(expected.modelId);
    result.generatedAt = expected.generatedAt;

    const t9001 = result.exposures.flatMap((e: any) => e.techniques).find((t: any) => t.techniqueId === 'T9001');
    expect(t9001.tactics.map((t: any) => t.id)).toEqual(['TA0001', 'TA0005', 'TA0112']);
    expect(canonical(result)).toBe(canonical(expected));
  });

  // Data ingested before tactics carried matrix_order: the columns fall back to tactic-id order,
  // and the module says so instead of presenting that order as the matrix.
  it('without matrix_order, orders tactics by id and warns that the data predates matrix order', async () => {
    const session = mg.driver.session();
    try {
      await session.run('MATCH (t:MitreAttackTactic) REMOVE t.matrix_order');
      const warnings: string[] = [];
      const logger = { log() {}, warn: (m: string) => warnings.push(m), error() {}, debug() {}, verbose() {} };
      const module = new DethernetyCoverageToolsModule(mg.driver, logger as any);
      const result = await (module as any).computeGradedCoverage(JSON.parse(read('expected.json')).modelId);

      const t9001 = result.exposures.flatMap((e: any) => e.techniques).find((t: any) => t.techniqueId === 'T9001');
      expect(t9001.tactics.map((t: any) => t.id)).toEqual(['TA0001', 'TA0005', 'TA0112']);
      expect(warnings.some((w) => w.includes('have no matrix_order'))).toBe(true);
    } finally {
      await session.run(
        `UNWIND [['TA0001',2],['TA0004',5],['TA0005',6],['TA0112',7],['TA0010',13],['TA0006',8]] AS p
         MATCH (t:MitreAttackTactic {attack_id: p[0]}) SET t.matrix_order = p[1]`,
      );
      await session.close();
    }
  });
});
