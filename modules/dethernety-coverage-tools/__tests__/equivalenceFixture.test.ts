/**
 * Cross-implementation equivalence fixture — the OSS pin.
 *
 * `fixtures/equivalence/` holds one seeded-graph scenario (`seed.cypher`),
 * the rows the module's four queries return for it (`rows.json`), and the
 * aggregated `CoverageResult` (`expected.json`). This test pins THIS
 * implementation's aggregator to the fixture; a sibling implementation of
 * the same contract pins itself to the very same files against a live
 * seeded graph. Spec drift therefore breaks visibly on whichever side
 * moved — a change here must update the fixture and the sibling in one
 * sweep, never silently diverge.
 *
 * The comparison is byte-level: canonical (sorted-key) JSON of the actual
 * result must equal canonical JSON of `expected.json`, with `generatedAt`
 * pinned through the input.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { aggregateCoverage, AggregateInput, CoverageResult } from '../src/aggregateCoverage';

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/equivalence/${name}`, import.meta.url), 'utf8'));

/** Canonical JSON: objects with sorted keys, arrays in place. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, (value as any)[k]]))
      : value,
  );

describe('equivalence fixture (shared cross-implementation contract)', () => {
  const rows = read('rows.json') as AggregateInput;
  const expected = read('expected.json') as CoverageResult;

  it('aggregateCoverage reproduces expected.json byte-for-byte', () => {
    const result = aggregateCoverage(rows);
    expect(JSON.parse(canonical(result))).toEqual(JSON.parse(canonical(expected)));
    expect(canonical(result)).toBe(canonical(expected));
  });

  it('the fixture exercises every contract dimension', () => {
    const byId = Object.fromEntries(expected.exposures.map((e) => [e.exposureId, e]));
    const allFacts = expected.exposures.flatMap((e) => e.techniques.flatMap((t) => t.tiers));

    // All three tiers present.
    for (const tier of ['DIRECT', 'INDIRECT_MITIGATION', 'INDIRECT_D3FEND']) {
      expect(allFacts.some((f) => f.tier === tier)).toBe(true);
    }
    // A soft exposure and an uncovered technique are both represented.
    expect(expected.exposures.some((e) => e.soft)).toBe(true);
    expect(expected.exposures.some((e) => e.techniques.some((t) => !t.covered))).toBe(true);
    // A Data-element exposure.
    expect(expected.exposures.some((e) => e.elementKind === 'Data')).toBe(true);
    // Detect-only technique: covered, yet no PREVENT fact at any tier.
    const detectOnly = byId['exp-db-exfil'].techniques[0];
    expect(detectOnly.covered).toBe(true);
    expect(detectOnly.tiers.every((f) => f.function === 'DETECT')).toBe(true);
    // Sub-technique row: covered via the parent's mitigation, with inherited tactics.
    const sub = byId['exp-web-cloudacct'].techniques[0];
    expect(sub.techniqueId).toBe('T9002.004');
    expect(sub.tiers.some((f) => f.tier === 'INDIRECT_MITIGATION')).toBe(true);
    expect(sub.tactics).toEqual(['Initial Access', 'Privilege Escalation']);
    // Both-function D3FEND evidence on the same technique.
    const rce = byId['exp-web-rce'].techniques[0];
    const d3fFns = rce.tiers.filter((f) => f.tier === 'INDIRECT_D3FEND').map((f) => f.function);
    expect(d3fFns.sort()).toEqual(['DETECT', 'PREVENT']);
    // Disposition-agnostic: the risk-accepted countermeasure is still credited.
    expect(allFacts.some((f) => f.countermeasureIds.includes('cm-vault'))).toBe(true);
    // Element scoping: the countermeasure whose control supports a DIFFERENT
    // element is credited nowhere.
    expect(allFacts.some((f) => f.countermeasureIds.includes('cm-other'))).toBe(false);
  });
});
