/**
 * Knowledge-graph fixtures for the in-process mock and the kg contract suite. Every name is
 * fictional (`acme-*`) — protocol examples, not real content.
 *
 * Two slices at one knowledge-graph version: one the fixture caller holds and one it does not,
 * so the "unentitled is never empty" distinction has something to be asserted against.
 *
 * The answers below populate every field the client contract declares on at least one row and
 * leave it explicitly `null` on another. That is deliberate: a suite whose fixture never
 * exercises a field cannot detect an implementation that drops it, and detecting exactly that is
 * what the suite is for.
 */
import type { KgRule, KgThreat } from '../../interfaces/kg-client-interface';
import { KG_KEY_SEPARATOR } from '../../interfaces/kg-client-interface';
import type { DenialInfo, RecallInfo } from '../../remote/errors';

/**
 * The knowledge-graph version every kg request addresses. Deliberately NOT the module content
 * pin: the two advance on separate axes, and sharing one constant here would hide a client that
 * confused them.
 */
export const KG_VERSION = 'sha256:77aa11bb22cc33dd44ee55ff66007788990011aabbccddeeff00112233445566';

/** The slice every entitled fixture caller holds. */
export const KG_SLICE_KEY = 'acme-compute-kg';
/** The second published slice. Held by the full caller, not by the narrowed one. */
export const KG_UNENTITLED_SLICE_KEY = 'acme-premium-kg';

/**
 * A second entitled caller, holding only the compute slice.
 *
 * Two callers who are both entitled but to *different* slices is the scenario that makes the
 * caller-scoped cache testable at all. Without it a cache test can only show that two callers each
 * reached the service — not that each received its own answer, which is the failure that matters:
 * an entitled caller served the thinner result computed for a less-entitled one.
 */
export const KG_NARROWED_TOKEN = 'fixture-token-kg-narrowed';

/** Class ids the fixture rules hang off. The second exists to exercise the composite key. */
export const KG_CLASS_ID = 'acme-compute.virtual-machine';
export const KG_OTHER_CLASS_ID = 'acme-compute.load-balancer';

/**
 * A rule slug that appears on BOTH fixture classes. `ruleId` is unique only within a class, so a
 * flat key would merge these two rules' threats into one entry — which is the defect the
 * composite key exists to prevent, and it cannot be regression-tested without a collision here.
 */
export const KG_COLLIDING_RULE_ID = 'weak-transport-encryption';

/**
 * The second rule on the first class — the countermeasure, and the one scored with an INTEGER.
 *
 * Exported because a suite has to be able to ask for it by name. It was reachable only positionally
 * before, which meant the integer score below was in the fixture for a reason nothing asserted.
 */
export const KG_COUNTERMEASURE_RULE_ID = 'enforce-modern-tls';

export const KG_TECHNIQUE_ID = 'T1040';

/** `classId` + `ruleId`, joined as the contract joins them. */
export function kgRefKey(classId: string, ruleId: string): string {
  return classId + KG_KEY_SEPARATOR + ruleId;
}

/**
 * `GET /v1/kg/queries` — the named-query registry, the contract itself.
 *
 * `maxItems` mirrors what the service publishes rather than picking a round number: the client chunks
 * to whatever it reads here, so a fixture declaring a different bound would exercise a chunking width
 * no deployment uses. The bound is sized by what a single response may weigh, not by what a caller
 * might reasonably ask for.
 */
export const kgRegistry = {
  protocol: '1',
  queries: [
    {
      name: 'rulesByClassId',
      description: 'Knowledge-graph rules addressing the given classes.',
      parameters: {
        classIds: { type: 'array', items: 'string', maxItems: 100 },
        // The optional filter, declared. A mock that omits a parameter the service publishes is a
        // stand-in for a NARROWER contract than the real one — so a client reading the registry to
        // decide whether it may send `kind` would decide differently against the two, which is
        // precisely the difference a mock exists to eliminate.
        kind: { type: 'string', enum: ['exposure', 'countermeasure'] },
      },
      privacy: { sends: 'Class identifiers from entitled content.', freeText: false },
    },
    {
      name: 'threatsByRuleId',
      description: 'Threats addressed by the given rules.',
      parameters: { ruleRefs: { type: 'array', items: 'string', maxItems: 100 } },
      privacy: { sends: 'Class and rule identifiers from entitled content.', freeText: false },
    },
    {
      name: 'threatsByTechniqueId',
      description: 'Threats associated with the given ATT&CK technique ids.',
      parameters: { techniqueIds: { type: 'array', items: 'string', maxItems: 100 } },
      privacy: { sends: 'Public ATT&CK technique identifiers.', freeText: false },
    },
  ],
};

/** `GET /v1/kg/versions` — public, newest first. */
export const kgVersionsResponse = {
  latest: KG_VERSION,
  versions: [{ id: KG_VERSION, releasedAt: '2026-08-16T00:00:00Z' }],
};

/** `GET /v1/kg/versions/{version}` — public; names and identifiers only, never content. */
export const kgSlicesResponse = {
  version: KG_VERSION,
  slices: [
    { key: KG_SLICE_KEY, name: 'Compute knowledge' },
    { key: KG_UNENTITLED_SLICE_KEY, name: 'Premium knowledge' },
  ],
};

/**
 * `GET /v1/kg/versions/{version}/capability` — the entitled caller's answer.
 *
 * A **wire** shape, not the client's `KgCapability`: the protocol names the third field
 * `entitledSliceCount`, and the client calls it `sliceCount` because local mode has no entitled
 * slices to count. Typing this fixture as the client's interface is what let the two diverge
 * unnoticed — the mock served a field the protocol does not define and omitted one it does.
 */
export interface KgCapabilityWire {
  available: boolean;
  entitled: boolean;
  entitledSliceCount?: number;
}

/** The full caller: both published slices. */
export const kgCapabilityResponse: KgCapabilityWire = {
  available: true,
  entitled: true,
  entitledSliceCount: 2,
};

/** The narrowed caller: the compute slice only — the premium one is not theirs. */
export const kgCapabilityNarrowed: KgCapabilityWire = {
  available: true,
  entitled: true,
  entitledSliceCount: 1,
};

/**
 * The caller who holds nothing — ANSWERED, not refused.
 *
 * `available: true` and `entitled: false` is the whole distinction this route carries: a graph
 * exists here and this caller may not read it. Collapsing it into a `403` (which the mock used to
 * do) leaves a consumer unable to tell that from "there is no graph", which is the difference
 * between "your subscription would restore this" and "this deployment has no such content".
 */
export const kgCapabilityUnentitled: KgCapabilityWire = {
  available: true,
  entitled: false,
  entitledSliceCount: 0,
};

const readsTlsEnabled = {
  name: 'transport_encryption_enabled',
  title: 'Transport encryption enabled',
  description: 'Whether the flow is carried over TLS.',
  category: 'RULE_INPUT',
};

/** Every field populated. */
const ruleFull: KgRule = {
  id: 'kgrule:' + KG_CLASS_ID + ':' + KG_COLLIDING_RULE_ID,
  ruleId: KG_COLLIDING_RULE_ID,
  classId: KG_CLASS_ID,
  name: 'Weak transport encryption',
  kind: 'exposure',
  description: 'The flow negotiates a cipher suite below the accepted floor.',
  criticality: 'high',
  score: 7.5,
  attackVector: 'NETWORK',
  conditionGroups: '[[{"attribute":"transport_encryption_enabled","operator":"is_false"}]]',
  mitreRefs: '[{"label":"MitreAttackTechnique","property":"attack_id","value":"T1040"}]',
  reads: [readsTlsEnabled],
};

/**
 * A second rule on the SAME class, of the other kind.
 *
 * It exists so the class carries more than one rule, which two properties depend on and which a
 * one-rule-per-class fixture cannot express at all: that a consumer resolving a class's threats
 * makes one batched request rather than one per rule, and that filtering by kind actually narrows
 * something. Both are silently un-testable without it — the batched and the per-rule shapes issue
 * the same number of calls when there is only ever one rule to loop over.
 */
const ruleCountermeasure: KgRule = {
  id: 'kgrule:' + KG_CLASS_ID + ':' + KG_COUNTERMEASURE_RULE_ID,
  ruleId: KG_COUNTERMEASURE_RULE_ID,
  classId: KG_CLASS_ID,
  name: 'Enforce modern TLS',
  kind: 'countermeasure',
  description: 'Reject cipher suites below the accepted floor.',
  criticality: 'medium',
  score: 4,
  attackVector: null,
  conditionGroups: '[[{"attribute":"transport_encryption_enabled","operator":"is_true"}]]',
  mitreRefs: null,
  reads: [readsTlsEnabled],
};

/**
 * The same `ruleId` on a different class, and every nullable field left null. Two jobs: it is the
 * collision that makes the composite key observable, and it is the row that would expose an
 * implementation quietly substituting `undefined` for an absent value.
 */
const ruleSparse: KgRule = {
  id: 'kgrule:' + KG_OTHER_CLASS_ID + ':' + KG_COLLIDING_RULE_ID,
  ruleId: KG_COLLIDING_RULE_ID,
  classId: KG_OTHER_CLASS_ID,
  name: null,
  kind: null,
  description: null,
  criticality: null,
  score: null,
  attackVector: null,
  conditionGroups: null,
  mitreRefs: null,
  reads: [],
};

const corpusFull = {
  id: 'NIST-SP-800-52',
  kind: 'nist',
  title: 'NIST SP 800-52 Rev 2',
  canonicalUrl: 'https://example.invalid/nist/sp-800-52',
  synthesis: 'Guidance on the selection and configuration of TLS implementations.',
  accessed: '2026-08-01',
  resolved: true,
};

/** The threat the full rule addresses, every field populated. */
const threatFull: KgThreat = {
  id: 'kgthreat:' + KG_CLASS_ID + ':cleartext-interception',
  slug: 'cleartext-interception',
  name: 'Cleartext interception',
  description: 'An on-path attacker reads the flow because it is not encrypted.',
  attackSurface: 'network',
  techniqueIds: [KG_TECHNIQUE_ID],
  techniqueProvenance: '[{"id":"' + KG_TECHNIQUE_ID + '","tier":"canon"}]',
  derivedFrom: [corpusFull],
};

/** The sparse counterpart — `slug` is non-null by contract, everything optional is null. */
const threatSparse: KgThreat = {
  id: 'kgthreat:' + KG_OTHER_CLASS_ID + ':downgrade',
  slug: 'downgrade',
  name: null,
  description: null,
  attackSurface: null,
  techniqueIds: null,
  techniqueProvenance: null,
  derivedFrom: [],
};

/** `rulesByClassId` — grouped by input key, as the protocol requires. */
export const kgRulesByClassIdAnswer: Record<string, KgRule[]> = {
  [KG_CLASS_ID]: [ruleFull, ruleCountermeasure],
  [KG_OTHER_CLASS_ID]: [ruleSparse],
};

/**
 * `threatsByRuleId` — keyed by the joined composite. The two entries share a `ruleId` and differ
 * only in `classId`, so a flat-keyed implementation collapses them and the suite sees it.
 */
export const kgThreatsByRuleIdAnswer: Record<string, KgThreat[]> = {
  [kgRefKey(KG_CLASS_ID, KG_COLLIDING_RULE_ID)]: [threatFull],
  [kgRefKey(KG_OTHER_CLASS_ID, KG_COLLIDING_RULE_ID)]: [threatSparse],
};

export const kgThreatsByTechniqueIdAnswer: Record<string, KgThreat[]> = {
  [KG_TECHNIQUE_ID]: [threatFull],
};

/** A key that resolves to nothing — present in the map, carrying an empty array. */
export const KG_UNMATCHED_CLASS_ID = 'acme-compute.nothing-here';

/**
 * The keys whose matches live in the premium slice.
 *
 * A caller holding only the compute slice gets `[]` for these — **present in the envelope with an
 * empty match set, never a `403`**. That is the protocol read precisely: a caller with *no*
 * knowledge-graph entitlement is refused, but a key that happens to resolve only inside a slice
 * they do not hold is simply not matched. Conflating the two would turn every partially-entitled
 * query into a denial.
 */
export const KG_PREMIUM_KEYS = [
  KG_OTHER_CLASS_ID,
  kgRefKey(KG_OTHER_CLASS_ID, KG_COLLIDING_RULE_ID),
];

/** The denial a `403` on this surface carries. `subject.kind` is what makes it a kg denial. */
export const kgDenial: DenialInfo = {
  subject: { kind: 'kg', id: KG_UNENTITLED_SLICE_KEY },
  message: {
    title: 'Knowledge graph not included',
    body: 'This deployment’s subscription does not include the premium knowledge slice.',
    actionLabel: 'View plans',
    actionUrl: 'https://portal.acme.example/plans',
  },
};

/** The `recalled` block a `410 version_recalled` carries on this surface. */
export const kgRecall: RecallInfo = {
  moduleKey: KG_SLICE_KEY,
  version: KG_VERSION,
  reason: 'A slice shipped with an unresolved corpus reference; re-pin to the next version.',
  recalledAt: '2026-08-16T00:00:00Z',
  supersededBy: 'sha256:88bb22cc33dd44ee55ff66007788990011aabbccddeeff001122334455667788',
};

/**
 * Compile-time checks. These live here rather than in a test file on purpose: `__tests__` is
 * excluded from the build and vitest strips types, so a type assertion there is checked by
 * nothing. This file IS compiled, which makes `pnpm build` the type test.
 */
// @ts-expect-error — `reads` is required; a rule without it is not a KgRule.
const _missingReads: KgRule = { ...ruleSparse, reads: undefined };
// @ts-expect-error — `slug` is non-null by contract, matching the local schema.
const _nullSlug: KgThreat = { ...threatSparse, slug: null };
void _missingReads;
void _nullSlug;
