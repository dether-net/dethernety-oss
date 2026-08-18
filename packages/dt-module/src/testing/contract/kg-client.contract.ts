/**
 * The knowledge-graph client suite — written once, run against every implementation.
 *
 * This is the executable form of the interface's central claim: a consumer cannot tell which
 * implementation it has. The suite knows nothing about graphs or HTTP; it asks the interface's
 * questions and asserts the interface's answers, so a caller of `runKgClientSuite` supplies a
 * client and gets the same verdict either way.
 *
 * Callers pass a label so the reporter names which implementation each result belongs to — a run
 * that collected only one of them proves nothing about the other, and that has to be visible.
 *
 * Separate from the wire-protocol suite next door on purpose: that one asserts properties of a
 * *service* (which routes carry a credential, which statuses the outcomes take) and is
 * parameterized by a transport. Running it twice would prove nothing, because only one of the two
 * implementations speaks HTTP at all.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { KgClient } from '../../interfaces/kg-client-interface';
import {
  KG_CLASS_ID,
  KG_COLLIDING_RULE_ID,
  KG_COUNTERMEASURE_RULE_ID,
  KG_OTHER_CLASS_ID,
  KG_TECHNIQUE_ID,
  KG_UNMATCHED_CLASS_ID,
  kgRefKey,
} from '../fixtures';

export interface KgClientHarness {
  /** Shown in the reporter, so both parameterisations are distinguishable in a run. */
  label: string;
  /** A fresh client per test — cold caches, no state carried between assertions. */
  makeClient: () => KgClient | Promise<KgClient>;
  /** The bearer to pass. Ignored by an implementation that has no service to authenticate to. */
  token?: string;
}

/** Entries as an array, so equality is order-sensitive — a strictly stronger check than comparing
 * the maps, and the one that catches an implementation reordering a caller's keys. */
function entries<T>(map: Map<string, T[]>): Array<[string, T[]]> {
  return [...map.entries()];
}

/**
 * The one rule under a key, named rather than positioned.
 *
 * KEY ORDER is the contract's (the client seeds its map from the requested keys, so it is asserted
 * above and everywhere else). ORDER WITHIN A KEY is not: no named query declares one, neither
 * implementation imposes one, and the graph-backed run showed why that matters — Memgraph returned
 * the class's two rules in an order the fixture did not write them in, so `const [rule] = …` picked
 * the countermeasure and asserted it was the exposure. Selecting by `ruleId` says what the assertion
 * always meant. Declaring an ordering instead would be a contract change made to satisfy a test,
 * binding both implementations and the service's cross-slice merge for a property no consumer reads.
 */
function ruleNamed<T extends { ruleId: string }>(rules: T[], ruleId: string): T {
  const found = rules.find((r) => r.ruleId === ruleId);
  if (!found) throw new Error(`fixture rule "${ruleId}" is missing from the answer`);
  return found;
}

export function runKgClientSuite(harness: KgClientHarness): void {
  describe(`KgClient contract — ${harness.label}`, () => {
    let client: KgClient;
    const token = harness.token;

    beforeEach(async () => {
      client = await harness.makeClient();
    });

    it('returns rules keyed by the class that was asked for', async () => {
      const map = await client.rulesByClassId([KG_CLASS_ID], undefined, token);
      expect(entries(map).map(([k]) => k)).toEqual([KG_CLASS_ID]);
      const rule = ruleNamed(map.get(KG_CLASS_ID)!, KG_COLLIDING_RULE_ID);
      // The full declared field set, asserted as a whole. A field dropped by one implementation
      // and kept by the other is exactly the difference a consumer would eventually notice as
      // "the cloud one is missing something", long after the cause stopped being obvious.
      expect(rule).toEqual({
        id: expect.any(String),
        ruleId: KG_COLLIDING_RULE_ID,
        classId: KG_CLASS_ID,
        name: expect.any(String),
        kind: 'exposure',
        description: expect.any(String),
        criticality: expect.any(String),
        score: expect.any(Number),
        attackVector: expect.any(String),
        conditionGroups: expect.any(String),
        mitreRefs: expect.any(String),
        reads: [
          {
            name: expect.any(String),
            title: expect.any(String),
            description: expect.any(String),
            category: expect.any(String),
          },
        ],
      });
    });

    it('returns explicit nulls, never absent keys, for a sparse row', async () => {
      // `toEqual` treats a missing key and an undefined one as equal, so the point has to be made
      // field by field or an implementation that simply omitted them would pass.
      const map = await client.rulesByClassId([KG_OTHER_CLASS_ID], undefined, token);
      const rule = ruleNamed(map.get(KG_OTHER_CLASS_ID)!, KG_COLLIDING_RULE_ID);
      for (const field of ['name', 'kind', 'description', 'criticality', 'score', 'attackVector', 'conditionGroups', 'mitreRefs'] as const) {
        expect(rule).toHaveProperty(field, null);
      }
      expect(rule.reads).toEqual([]);
    });

    it('gives a key that matched nothing an empty array, in the position it was asked in', async () => {
      const map = await client.rulesByClassId([KG_UNMATCHED_CLASS_ID, KG_CLASS_ID], undefined, token);
      expect(entries(map).map(([k]) => k)).toEqual([KG_UNMATCHED_CLASS_ID, KG_CLASS_ID]);
      expect(map.get(KG_UNMATCHED_CLASS_ID)).toEqual([]);
      expect(map.get(KG_CLASS_ID)!.length).toBeGreaterThan(0);
    });

    it('keeps one ruleId on two classes apart, under composite keys', async () => {
      const map = await client.threatsByRuleId(
        [
          { classId: KG_CLASS_ID, ruleId: KG_COLLIDING_RULE_ID },
          { classId: KG_OTHER_CLASS_ID, ruleId: KG_COLLIDING_RULE_ID },
        ],
        token,
      );
      expect(entries(map).map(([k]) => k)).toEqual([
        kgRefKey(KG_CLASS_ID, KG_COLLIDING_RULE_ID),
        kgRefKey(KG_OTHER_CLASS_ID, KG_COLLIDING_RULE_ID),
      ]);
      const [a] = map.get(kgRefKey(KG_CLASS_ID, KG_COLLIDING_RULE_ID))!;
      const [b] = map.get(kgRefKey(KG_OTHER_CLASS_ID, KG_COLLIDING_RULE_ID))!;
      expect(a.id).not.toBe(b.id);
    });

    it('returns the full threat field set, including an empty derivedFrom', async () => {
      const map = await client.threatsByRuleId(
        [
          { classId: KG_CLASS_ID, ruleId: KG_COLLIDING_RULE_ID },
          { classId: KG_OTHER_CLASS_ID, ruleId: KG_COLLIDING_RULE_ID },
        ],
        token,
      );
      const [full] = map.get(kgRefKey(KG_CLASS_ID, KG_COLLIDING_RULE_ID))!;
      expect(full.slug).toEqual(expect.any(String));
      expect(full.techniqueIds).toEqual([KG_TECHNIQUE_ID]);
      expect(full.derivedFrom).toEqual([
        {
          id: expect.any(String),
          kind: expect.any(String),
          title: expect.any(String),
          canonicalUrl: expect.any(String),
          synthesis: expect.any(String),
          accessed: expect.any(String),
          resolved: true,
        },
      ]);

      const [sparse] = map.get(kgRefKey(KG_OTHER_CLASS_ID, KG_COLLIDING_RULE_ID))!;
      expect(sparse.derivedFrom).toEqual([]);
      expect(sparse).toHaveProperty('techniqueIds', null);
    });

    it('returns threats keyed by technique id', async () => {
      const map = await client.threatsByTechniqueId([KG_TECHNIQUE_ID, 'T9999'], token);
      expect(entries(map).map(([k]) => k)).toEqual([KG_TECHNIQUE_ID, 'T9999']);
      expect(map.get(KG_TECHNIQUE_ID)!.length).toBeGreaterThan(0);
      expect(map.get('T9999')).toEqual([]);
    });

    it('collapses a repeated key to one entry, without doubling its matches', async () => {
      const once = await client.rulesByClassId([KG_CLASS_ID], undefined, token);
      const twice = await client.rulesByClassId([KG_CLASS_ID, KG_CLASS_ID], undefined, token);
      expect(entries(twice).map(([k]) => k)).toEqual([KG_CLASS_ID]);
      // Against the un-repeated answer rather than against a hard-coded count: what must hold is
      // that repeating a key changes nothing, not that the fixture happens to carry N rules.
      expect(twice.get(KG_CLASS_ID)).toEqual(once.get(KG_CLASS_ID));
    });

    it('answers an empty request with an empty map', async () => {
      // Not an error, and not a request: the wire rejects an empty key set outright, so an
      // implementation that forwarded one would turn "nothing to ask" into a protocol failure.
      expect(await client.rulesByClassId([], undefined, token)).toEqual(new Map());
      expect(await client.threatsByRuleId([], token)).toEqual(new Map());
      expect(await client.threatsByTechniqueId([], token)).toEqual(new Map());
    });

    it('narrows by kind without dropping any requested key', async () => {
      // Two things at once, because both fail the same way. The filter must actually narrow — the
      // fixture's first class carries one rule of each kind, so a filter that did nothing would
      // return both. And it must not narrow the *keys*: a class whose rules were all filtered out
      // still has to appear, or the caller cannot tell it from a class nobody asked about.
      const filtered = await client.rulesByClassId([KG_CLASS_ID, KG_OTHER_CLASS_ID], { kind: 'exposure' }, token);
      const unfiltered = await client.rulesByClassId([KG_CLASS_ID, KG_OTHER_CLASS_ID], undefined, token);
      expect(entries(filtered).map(([k]) => k)).toEqual(entries(unfiltered).map(([k]) => k));
      expect(unfiltered.get(KG_CLASS_ID)!.length).toBeGreaterThan(filtered.get(KG_CLASS_ID)!.length);
      expect(filtered.get(KG_CLASS_ID)!.every((r) => r.kind === 'exposure')).toBe(true);
    });

    it('unboxes an integer-authored score to a plain number', async () => {
      // Its own case, because the full-field assertion above lands on the FLOAT-scored rule and
      // `expect.any(Number)` is satisfied by 7.5 whatever the implementation does with 4.
      //
      // This is the one field where the two implementations genuinely do different work. A graph
      // returns an integer property as a lossless bolt `Integer`, which `JSON.stringify` renders
      // `{"low":4,"high":0}` — a shape that reaches a report as a score nobody can read, and that
      // no `toEqual` against `expect.any(Number)` on the other rule would ever notice. The wire
      // returns a number already, so only one side has anything to get wrong, which is exactly why
      // it has to be asserted rather than assumed to be shared.
      const map = await client.rulesByClassId([KG_CLASS_ID], { kind: 'countermeasure' }, token);
      const rule = ruleNamed(map.get(KG_CLASS_ID)!, KG_COUNTERMEASURE_RULE_ID);
      expect(rule.score).toBe(4);
      expect(typeof rule.score).toBe('number');
    });

    it('reports itself available and entitled', async () => {
      const capability = await client.capability(token);
      expect(capability.available).toBe(true);
      expect(capability.entitled).toBe(true);
      expect(capability.sliceCount).toEqual(expect.any(Number));
    });
  });
}
