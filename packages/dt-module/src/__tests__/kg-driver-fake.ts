/**
 * A bolt driver fake for the knowledge-graph client tests, and the row shapes it replays.
 *
 * This package deliberately carries no `neo4j-driver` dependency and its tests have no graph, so
 * the session is mocked the same way `db-ops.test.ts` mocks it. What keeps that from testing a
 * fiction is where the row shapes below came from: each one is the **verbatim output** of the
 * corresponding statement run against a real Memgraph during this slice's development — including
 * the detail no amount of reading would have produced, that an integer-valued `score` arrives
 * boxed while a float does not.
 *
 * The file is not collected by vitest (it is not `*.test.ts`) and is excluded from the build.
 */
import { vi } from 'vitest';
import * as fixtures from '../testing/fixtures';
import {
  KG_PRESENCE_PROBE,
  KG_RULES_BY_CLASS_ID,
  KG_THREATS_BY_RULE_ID,
  KG_THREATS_BY_TECHNIQUE_ID,
} from '../kg/queries';

/** A bolt record: `get(key)` answers a projected alias and throws for anything else, as the real
 * driver does — so a mapper reading a field the statement never projected fails here too. */
export function record(fields: Record<string, unknown>) {
  return {
    get(key: string) {
      if (!(key in fields)) throw new Error(`no such column: ${key}`);
      return fields[key];
    },
  };
}

/** A lossless bolt `Integer` duck-type — `low`/`high` plus the two methods the coercion checks. */
export function fakeInt(num: number, opts: { safe?: boolean; str?: string } = {}) {
  return {
    low: num & 0xffffffff,
    high: Math.floor(num / 2 ** 32),
    toNumber: () => num,
    inSafeRange: () => opts.safe ?? true,
    toString: () => opts.str ?? String(num),
  };
}

export interface FakeCall {
  cypher: string;
  params: Record<string, unknown>;
  sessionConfig: unknown;
}

/** What a fake session should do when `run` is called. */
export type RunHandler = (cypher: string, params: Record<string, unknown>) => unknown[];

export interface FakeDriver {
  driver: any;
  /** Every `tx.run`, in order. */
  calls: FakeCall[];
  /** How many sessions were opened, and how many were closed. These must match. */
  sessions: () => number;
  closed: () => number;
}

/**
 * Build a driver whose `executeRead` replays `handler`'s rows.
 *
 * `handler` may throw to simulate a failing read; the session must still be closed, which is what
 * the `sessions()`/`closed()` counters exist to prove.
 */
export function makeKgDriver(handler: RunHandler): FakeDriver {
  const calls: FakeCall[] = [];
  let opened = 0;
  let shut = 0;

  const driver = {
    session: vi.fn((sessionConfig?: unknown) => {
      opened++;
      return {
        executeRead: async (fn: (tx: any) => Promise<unknown>) =>
          fn({
            run: async (cypher: string, params: Record<string, unknown>) => {
              calls.push({ cypher, params, sessionConfig });
              return { records: handler(cypher, params).map((r) => record(r as Record<string, unknown>)) };
            },
          }),
        close: vi.fn(async () => {
          shut++;
        }),
      };
    }),
  };

  return { driver, calls, sessions: () => opened, closed: () => shut };
}

// ── Row shapes, as the live graph returned them ──────────────────────────────────────────────
// Two classes sharing one `ruleId`: the collision the composite key exists for.

export const CLASS_A = 'aaa';
export const CLASS_B = 'bbb';
export const COLLIDING_RULE_ID = 'weak_tls_termination';
export const TECHNIQUE_ID = 'T1040';

/** Every declared field populated, `score` boxed as the graph delivers an integer literal. */
export const ruleRowFull = {
  classId: CLASS_A,
  id: 'kgrule:aaa:weak_tls_termination',
  ruleId: COLLIDING_RULE_ID,
  kind: 'exposure',
  name: 'Weak TLS termination',
  description: 'Terminates TLS below the accepted floor.',
  criticality: 'critical',
  score: fakeInt(9),
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
};

/** The same `ruleId` on the other class, every optional property absent and `reads` empty. */
export const ruleRowSparse = {
  classId: CLASS_B,
  id: 'kgrule:bbb:weak_tls_termination',
  ruleId: COLLIDING_RULE_ID,
  kind: 'exposure',
  name: 'Weak TLS termination at the proxy',
  description: null,
  criticality: null,
  score: 7.5,
  attackVector: null,
  conditionGroups: null,
  mitreRefs: null,
  reads: [],
};

export const threatRowFull = {
  classId: CLASS_A,
  ruleId: COLLIDING_RULE_ID,
  techniqueId: TECHNIQUE_ID,
  id: 'kgthreat:aaa:cleartext-interception',
  slug: 'cleartext-interception',
  name: 'Cleartext interception',
  description: 'An on-path attacker reads the flow.',
  attackSurface: 'network',
  techniqueIds: ['T1040', 'T1557'],
  techniqueProvenance: '[{"id":"T1040","tier":"canon"}]',
  derivedFrom: [
    {
      id: 'SC-8',
      kind: 'nist',
      title: 'NIST SP 800-53 SC-8',
      canonicalUrl: 'https://example.invalid/sc-8',
      synthesis: 'Protect the confidentiality and integrity of transmitted information.',
      accessed: '2026-05-28',
      resolved: true,
    },
  ],
};

export const threatRowSparse = {
  classId: CLASS_B,
  ruleId: COLLIDING_RULE_ID,
  techniqueId: TECHNIQUE_ID,
  id: 'kgthreat:bbb:downgrade',
  slug: 'downgrade',
  name: null,
  description: null,
  attackSurface: null,
  techniqueIds: null,
  techniqueProvenance: null,
  derivedFrom: [],
};

/** One row from the presence probe. Its contents are never read — only whether it exists. */
export const probeRow = { k: { labels: ['KgClass'] } };

// ── The shared-fixture adapter ───────────────────────────────────────────────────────────────
// Lets the local client answer from the SAME fixtures the mock service serves, which is what
// makes running one client suite against both implementations possible in a package that has no
// graph. Rows are built to each statement's `RETURN` aliases — the projection, not the payload
// type, because that is what the client actually reads.
//
// What this is not: an execution of the Cypher. The statements were verified against a live engine
// when they were written; this replays their output shape so the two clients can be compared.

/** A driver that answers the three statements from the fixture tables. */
export function makeFixtureDriver(): FakeDriver {
  return makeKgDriver((cypher, params) => {
    if (cypher === KG_PRESENCE_PROBE) return [probeRow];

    if (cypher === KG_RULES_BY_CLASS_ID) {
      const kind = params.kind as string | null;
      return (params.classIds as string[]).flatMap((classId) =>
        (fixtures.kgRulesByClassIdAnswer[classId] ?? [])
          .filter((rule) => kind === null || rule.kind === kind)
          // `classId` is projected from the requested key, exactly as the statement does.
          .map((rule) => ({ ...rule, classId })),
      );
    }

    if (cypher === KG_THREATS_BY_RULE_ID) {
      return (params.ruleRefs as Array<{ classId: string; ruleId: string }>).flatMap((ref) =>
        (fixtures.kgThreatsByRuleIdAnswer[fixtures.kgRefKey(ref.classId, ref.ruleId)] ?? []).map((threat) => ({
          ...threat,
          classId: ref.classId,
          ruleId: ref.ruleId,
        })),
      );
    }

    if (cypher === KG_THREATS_BY_TECHNIQUE_ID) {
      return (params.techniqueIds as string[]).flatMap((techniqueId) =>
        (fixtures.kgThreatsByTechniqueIdAnswer[techniqueId] ?? []).map((threat) => ({ ...threat, techniqueId })),
      );
    }

    throw new Error(`the fixture driver was handed a statement it does not know: ${cypher.slice(0, 60)}`);
  });
}
