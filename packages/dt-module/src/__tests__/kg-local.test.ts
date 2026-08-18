/**
 * The knowledge-graph client over a local graph.
 *
 * Every assertion here has a failure mode behind it, and the ones worth reading twice are the
 * collision (a rule id shared by two classes must not merge), the availability guard (a graph with
 * no knowledge-graph nodes must refuse, never answer empty), and the null discipline (a dropped
 * field and a null field are indistinguishable to `toEqual` unless the fixture forces the point).
 *
 * The row shapes come from a real Memgraph — see `kg-driver-fake.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  KG_ALL_QUERIES,
  KG_PRESENCE_PROBE,
  KG_RULES_BY_CLASS_ID,
  KG_THREATS_BY_RULE_ID,
  KG_THREATS_BY_TECHNIQUE_ID,
} from '../kg/queries';
import { LocalKgClient } from '../kg/local-client';
import { kgRefKey } from '../kg/keys';
import { KgUnavailableError } from '../kg/unavailable-client';
import { KG_KEY_SEPARATOR } from '../interfaces/kg-client-interface';
import {
  CLASS_A,
  CLASS_B,
  COLLIDING_RULE_ID,
  TECHNIQUE_ID,
  fakeInt,
  makeKgDriver,
  probeRow,
  ruleRowFull,
  ruleRowSparse,
  threatRowFull,
  threatRowSparse,
} from './kg-driver-fake';

/** A client over a graph that answers the probe and returns `rows` for everything else. */
function clientOver(rows: unknown[], opts: { databaseName?: string } = {}) {
  const fake = makeKgDriver((cypher) => (cypher === KG_PRESENCE_PROBE ? [probeRow] : rows));
  return { client: new LocalKgClient({ driver: fake.driver, ...opts }), fake };
}

/** Calls that are not the probe — the ones a query test cares about. */
function queryCalls(fake: ReturnType<typeof makeKgDriver>) {
  return fake.calls.filter((c) => c.cypher !== KG_PRESENCE_PROBE);
}

describe('LocalKgClient — the declared field set survives', () => {
  it('maps a fully populated rule, unboxing the integer score', async () => {
    const { client } = clientOver([ruleRowFull]);
    const rules = (await client.rulesByClassId([CLASS_A])).get(CLASS_A)!;
    expect(rules).toEqual([
      {
        id: 'kgrule:aaa:weak_tls_termination',
        ruleId: COLLIDING_RULE_ID,
        classId: CLASS_A,
        name: 'Weak TLS termination',
        kind: 'exposure',
        description: 'Terminates TLS below the accepted floor.',
        criticality: 'critical',
        // A lossless bolt Integer reaching a caller would serialise as {"low":9,"high":0}.
        score: 9,
        attackVector: 'NETWORK',
        conditionGroups: '[[{"attribute":"flow_tls_encrypted","operator":"is_false"}]]',
        mitreRefs: '[{"label":"MitreAttackTechnique","property":"attack_id","value":"T1040"}]',
        reads: [
          {
            name: 'flow_tls_encrypted',
            title: 'Flow TLS Encrypted',
            description: 'Whether the flow is carried over TLS.',
            category: 'RULE_INPUT',
          },
        ],
      },
    ]);
  });

  it('maps a sparse rule to explicit nulls, never to absent keys', async () => {
    // `toEqual` treats {name: undefined} and {} as equal, so this is asserted key by key: a client
    // that dropped a field instead of nulling it would otherwise pass the object comparison.
    const { client } = clientOver([ruleRowSparse]);
    const [rule] = (await client.rulesByClassId([CLASS_B])).get(CLASS_B)!;
    for (const field of ['description', 'criticality', 'attackVector', 'conditionGroups', 'mitreRefs'] as const) {
      expect(rule).toHaveProperty(field, null);
    }
    expect(rule.score).toBe(7.5);
    expect(rule.reads).toEqual([]);
  });

  it('maps a fully populated threat, and an empty derivedFrom stays empty', async () => {
    const { client } = clientOver([threatRowFull, threatRowSparse]);
    const byRef = await client.threatsByRuleId([
      { classId: CLASS_A, ruleId: COLLIDING_RULE_ID },
      { classId: CLASS_B, ruleId: COLLIDING_RULE_ID },
    ]);
    const [full] = byRef.get(kgRefKey(CLASS_A, COLLIDING_RULE_ID))!;
    expect(full.slug).toBe('cleartext-interception');
    expect(full.techniqueIds).toEqual(['T1040', 'T1557']);
    expect(full.derivedFrom).toEqual([
      {
        id: 'SC-8',
        kind: 'nist',
        title: 'NIST SP 800-53 SC-8',
        canonicalUrl: 'https://example.invalid/sc-8',
        synthesis: 'Protect the confidentiality and integrity of transmitted information.',
        accessed: '2026-05-28',
        resolved: true,
      },
    ]);

    const [sparse] = byRef.get(kgRefKey(CLASS_B, COLLIDING_RULE_ID))!;
    expect(sparse.derivedFrom).toEqual([]);
    expect(sparse.techniqueIds).toBeNull();
    expect(sparse).toHaveProperty('name', null);
  });

  it('resolves a score beyond the safe range to null rather than to a string', async () => {
    // The shared coercion preserves such a value as an exact decimal string, which is not a score.
    // No real score is anywhere near 2^53, so the row is corrupt and says so by being null.
    const { client } = clientOver([{ ...ruleRowFull, score: fakeInt(0, { safe: false, str: '9007199254740993' }) }]);
    const [rule] = (await client.rulesByClassId([CLASS_A])).get(CLASS_A)!;
    expect(rule.score).toBeNull();
  });

  it('narrows an unrecognised rule kind to null rather than widening the declared type', async () => {
    const { client } = clientOver([{ ...ruleRowFull, kind: 'advisory' }]);
    const [rule] = (await client.rulesByClassId([CLASS_A])).get(CLASS_A)!;
    expect(rule.kind).toBeNull();
  });
});

describe('LocalKgClient — every requested key is present', () => {
  it('gives a key that matched nothing an empty array, and invents no key', async () => {
    const { client } = clientOver([ruleRowFull]);
    const map = await client.rulesByClassId([CLASS_A, 'no-such-class']);
    expect([...map.keys()]).toEqual([CLASS_A, 'no-such-class']);
    expect(map.get('no-such-class')).toEqual([]);
    expect(map.has(CLASS_B)).toBe(false);
  });

  it('keeps two classes sharing one ruleId apart, under composite keys', async () => {
    // `ruleId` is unique only within a class. A flat key merges these two, and one class's threats
    // are attributed to the other — silently, which is the whole reason the key is composite.
    const { client } = clientOver([threatRowFull, threatRowSparse]);
    const map = await client.threatsByRuleId([
      { classId: CLASS_A, ruleId: COLLIDING_RULE_ID },
      { classId: CLASS_B, ruleId: COLLIDING_RULE_ID },
    ]);
    expect(map.size).toBe(2);
    expect(map.get(CLASS_A + KG_KEY_SEPARATOR + COLLIDING_RULE_ID)![0].id).toBe('kgthreat:aaa:cleartext-interception');
    expect(map.get(CLASS_B + KG_KEY_SEPARATOR + COLLIDING_RULE_ID)![0].id).toBe('kgthreat:bbb:downgrade');
  });

  it('groups threats under the technique that was asked for', async () => {
    const { client } = clientOver([threatRowFull]);
    const map = await client.threatsByTechniqueId([TECHNIQUE_ID, 'T9999']);
    expect(map.get(TECHNIQUE_ID)).toHaveLength(1);
    expect(map.get('T9999')).toEqual([]);
  });
});

describe('LocalKgClient — what reaches the driver', () => {
  it('binds $kind on every call, null when the caller did not filter', async () => {
    // Memgraph rejects a statement referencing a parameter the call omitted; it does not default
    // it to null. Verified against 3.8 — "Parameter $kind not provided."
    const { client, fake } = clientOver([ruleRowFull]);
    await client.rulesByClassId([CLASS_A]);
    await client.rulesByClassId([CLASS_A], { kind: 'countermeasure' });
    const [unfiltered, filtered] = queryCalls(fake);
    expect(unfiltered.params).toEqual({ classIds: [CLASS_A], kind: null });
    expect(filtered.params).toEqual({ classIds: [CLASS_A], kind: 'countermeasure' });
  });

  it('sends refs as pairs, not as joined strings — the join is the map key, not the local wire', async () => {
    const { client, fake } = clientOver([threatRowFull]);
    await client.threatsByRuleId([{ classId: CLASS_A, ruleId: COLLIDING_RULE_ID }]);
    expect(queryCalls(fake)[0].params).toEqual({ ruleRefs: [{ classId: CLASS_A, ruleId: COLLIDING_RULE_ID }] });
  });

  it('drops repeated keys before they reach the query', async () => {
    // The statements group on their key, so a repeat collapses in Cypher and changes nothing here.
    // It is dropped for the other implementation, where each key sent spends one of the request's
    // bounded slots and one unit of the caller's ceiling — twice, for one answer.
    const fake = makeKgDriver((cypher) => {
      if (cypher === KG_PRESENCE_PROBE) return [probeRow];
      return cypher === KG_RULES_BY_CLASS_ID ? [ruleRowFull] : [threatRowFull];
    });
    const client = new LocalKgClient({ driver: fake.driver });
    await client.rulesByClassId([CLASS_A, CLASS_A]);
    await client.threatsByRuleId([
      { classId: CLASS_A, ruleId: COLLIDING_RULE_ID },
      { classId: CLASS_A, ruleId: COLLIDING_RULE_ID },
    ]);
    expect(queryCalls(fake)[0].params.classIds).toEqual([CLASS_A]);
    expect(queryCalls(fake)[1].params.ruleRefs).toHaveLength(1);
  });

  it('answers an empty request with an empty map and opens no session at all', async () => {
    // The other implementation must do the same: the wire rejects an empty key set outright, so a
    // client that forwarded one would turn "nothing to ask" into a protocol error.
    const { client, fake } = clientOver([ruleRowFull]);
    expect(await client.rulesByClassId([])).toEqual(new Map());
    expect(await client.threatsByRuleId([])).toEqual(new Map());
    expect(await client.threatsByTechniqueId([])).toEqual(new Map());
    expect(fake.sessions()).toBe(0);
  });

  it('names the database only when it has one, and closes every session it opens', async () => {
    const scoped = clientOver([ruleRowFull], { databaseName: 'tenant-db' });
    await scoped.client.rulesByClassId([CLASS_A]);
    expect(queryCalls(scoped.fake)[0].sessionConfig).toEqual({ database: 'tenant-db' });
    expect(scoped.fake.sessions()).toBe(scoped.fake.closed());

    const dflt = clientOver([ruleRowFull]);
    await dflt.client.rulesByClassId([CLASS_A]);
    // Not `{database: undefined}` — Memgraph rejects a session naming a database it does not have.
    expect(queryCalls(dflt.fake)[0].sessionConfig).toEqual({});
  });

  it('closes the session when the read throws', async () => {
    const fake = makeKgDriver(() => {
      throw new Error('bolt exploded');
    });
    const client = new LocalKgClient({ driver: fake.driver });
    await expect(client.capability()).rejects.toThrow('bolt exploded');
    expect(fake.sessions()).toBe(1);
    expect(fake.closed()).toBe(1);
  });
});

describe('LocalKgClient — capability', () => {
  it('reports available and entitled, with no slices', async () => {
    // `entitled` is true against the pull of the zero beside it: there is no entitlement gate on a
    // graph the deployment already holds, and a false here would report every local deployment as
    // locked. `sliceCount` is a property of a served corpus, not a statement about access.
    const { client } = clientOver([]);
    expect(await client.capability()).toEqual({ available: true, entitled: true, sliceCount: 0 });
  });

  it('is memoised — two calls, one round trip', async () => {
    const { client, fake } = clientOver([]);
    await client.capability();
    await client.capability();
    expect(fake.calls.filter((c) => c.cypher === KG_PRESENCE_PROBE)).toHaveLength(1);
  });

  it('does not memoise a failure, so a transient outage is not permanent', async () => {
    let fail = true;
    const fake = makeKgDriver((cypher) => {
      if (cypher === KG_PRESENCE_PROBE && fail) throw new Error('graph down');
      return [probeRow];
    });
    const client = new LocalKgClient({ driver: fake.driver });
    await expect(client.capability()).rejects.toThrow('graph down');
    fail = false;
    expect(await client.capability()).toEqual({ available: true, entitled: true, sliceCount: 0 });
  });

  it('surfaces a driver failure rather than reporting it as an absent graph', async () => {
    // "The graph is broken" and "there is no knowledge graph here" are different answers, and only
    // the consumer knows whether it wants to degrade. Swallowing this would decide for it.
    const fake = makeKgDriver(() => {
      throw new Error('connection refused');
    });
    await expect(new LocalKgClient({ driver: fake.driver }).capability()).rejects.toThrow('connection refused');
  });
});

describe('LocalKgClient — a graph with no knowledge-graph nodes', () => {
  /** A graph that answers, and has no `KgClass` in it. The plain deployment. */
  function bareGraph() {
    const fake = makeKgDriver(() => []);
    return { client: new LocalKgClient({ driver: fake.driver }), fake };
  }

  it('reports unavailable rather than empty', async () => {
    expect(await bareGraph().client.capability()).toEqual({ available: false, entitled: true, sliceCount: 0 });
  });

  it('refuses every query instead of answering nothing', async () => {
    // This is the whole point. Running the statements against labels that are not there returns
    // empty, and empty is indistinguishable from "your keys matched nothing" — a deployment
    // reporting that its knowledge graph found nothing, when it never had one to ask.
    const { client } = bareGraph();
    await expect(client.rulesByClassId([CLASS_A])).rejects.toBeInstanceOf(KgUnavailableError);
    await expect(client.threatsByRuleId([{ classId: CLASS_A, ruleId: COLLIDING_RULE_ID }])).rejects.toBeInstanceOf(
      KgUnavailableError,
    );
    await expect(client.threatsByTechniqueId([TECHNIQUE_ID])).rejects.toBeInstanceOf(KgUnavailableError);
  });

  it('refuses without re-probing, and without running the query', async () => {
    const { client, fake } = bareGraph();
    await client.capability();
    await expect(client.rulesByClassId([CLASS_A])).rejects.toThrow(KgUnavailableError);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].cypher).toBe(KG_PRESENCE_PROBE);
  });
});

describe('the Cypher keeps the disciplines it was moved with', () => {
  // Asserted over the query text so they are constraints rather than comments. Both hold on
  // Memgraph specifically, and both would fail silently — with plausible-looking output — if lost.

  it('expands no variable-length path', () => {
    // The premise the whole serving design rests on: the deepest shape is a fixed join, which is
    // why the corpus can be served from something other than a graph database at all.
    for (const q of KG_ALL_QUERIES) {
      expect(q).not.toMatch(/\[\s*:?\w*\s*\*/);
      expect(q).not.toMatch(/\*\s*\d*\s*\.\./);
    }
  });

  it('uses no NOT EXISTS{} in a projection', () => {
    for (const q of KG_ALL_QUERIES) {
      expect(q).not.toMatch(/NOT\s+EXISTS\s*\{/i);
    }
  });

  it('interpolates nothing — every caller-supplied value is a bound parameter', () => {
    for (const q of KG_ALL_QUERIES) {
      expect(q).not.toContain('${');
    }
  });

  it('keys every query — none of them can be asked for everything', () => {
    for (const q of [KG_RULES_BY_CLASS_ID, KG_THREATS_BY_RULE_ID, KG_THREATS_BY_TECHNIQUE_ID]) {
      expect(q).toMatch(/^\s*UNWIND \$\w+ AS /);
    }
  });
});
