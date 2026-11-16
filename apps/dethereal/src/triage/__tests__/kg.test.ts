/**
 * The knowledge-graph helpers: the capability fold, the error classification and its sentences, the tolerant JSON
 * parse, the malformed-groups mark, and the chain assembled from rules.
 *
 * Every error case builds a real Apollo error: `.is()` tests a brand, so an object literal never matches, and a suite
 * of literals would pass over a classifier that recognises nothing the client throws.
 */
import { describe, it, expect } from 'vitest'
import { CombinedGraphQLErrors, ServerError } from '@apollo/client'
import { registerSecret } from '../../auth/redact.js'
import { KG_ABSENT_MARKER, KG_NO_DATA_NOTICE, KG_NOT_AVAILABLE_NOTICE } from '../notices.js'
import {
  EVALUATE_FRAMING,
  buildKgChain,
  conditionGroupsMalformed,
  describeKgFailure,
  foldCapability,
  graphQLErrorCode,
  isValidationFailure,
  kgAbsent,
  parseJsonArrayTolerant,
  type RawKgRule,
  type RawKgThreat,
} from '../kg.js'

const CLASS_ID = '01170208-db8f-4c1b-8e29-636bf6d220b8'

const corpusPoodle = {
  id: 'CVE-2014-3566',
  kind: 'cve',
  title: 'POODLE',
  canonicalUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2014-3566',
  synthesis: "The POODLE flaw exploits SSL 3.0's CBC padding to decrypt session material.",
  accessed: '2026-06-01',
  resolved: true,
}
const corpusNist = {
  id: 'SC-8',
  kind: 'nist',
  title: 'Transmission Confidentiality and Integrity',
  canonicalUrl: 'https://csrc.nist.gov/SC-8',
  synthesis: 'Protect transmitted information from interception and modification.',
  accessed: '2026-06-01',
  resolved: true,
}

const threatAitm: RawKgThreat = {
  id: `kgthreat:${CLASS_ID}:adversary-in-the-middle`,
  slug: 'adversary-in-the-middle',
  name: 'Adversary-in-the-Middle',
  description: 'An attacker positioned on the network path intercepts unvalidated TLS sessions.',
  attackSurface: 'network',
  techniqueIds: ['T1557', 'T1553.004'],
  techniqueProvenance: JSON.stringify([{ id: 'T1557', tier: 'provisional', sourceKind: 'first-party' }]),
  derivedFrom: [corpusPoodle, corpusNist],
}

const threatCleartext: RawKgThreat = {
  id: `kgthreat:${CLASS_ID}:cleartext-transport`,
  slug: 'cleartext-transport',
  name: 'Cleartext transport',
  description: 'Traffic downgraded to cleartext exposes credentials in transit.',
  attackSurface: 'network',
  techniqueIds: ['T1040'],
  techniqueProvenance: null,
  derivedFrom: [corpusPoodle],
}

function makeRule(overrides: Partial<RawKgRule>): RawKgRule {
  return {
    id: `kgrule:${CLASS_ID}:cert_validation`,
    ruleId: 'cert_validation',
    name: 'Adversary-in-the-Middle via skipped certificate validation',
    kind: 'exposure',
    criticality: 'high',
    score: 7.4,
    attackVector: 'NETWORK',
    conditionGroups: JSON.stringify([
      [{ attribute: 'server_certificate_validated', operator: 'is_false' }],
      [{ attribute: 'tls_enabled', operator: 'is_false' }],
    ]),
    mitreRefs: JSON.stringify([
      { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1557', justification: 'AiTM is the direct consequence.' },
    ]),
    reads: [
      { name: 'server_certificate_validated', title: 'Server certificate validated', category: 'transport' },
      { name: 'tls_enabled', title: 'TLS enabled', category: 'transport' },
    ],
    addresses: [threatAitm],
    ...overrides,
  }
}

const ruleA = makeRule({})
const ruleB = makeRule({
  id: `kgrule:${CLASS_ID}:tls_strip`,
  ruleId: 'tls_strip',
  name: 'Cleartext transport / TLS strip',
  conditionGroups: JSON.stringify([[{ attribute: 'tls_enabled', operator: 'is_false' }]]),
  mitreRefs: JSON.stringify([{ label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1040' }]),
  reads: [{ name: 'tls_enabled', title: 'TLS enabled', category: 'transport' }],
  addresses: [threatAitm, threatCleartext],
})

const combined = (code: string, message = 'Internal server error') =>
  new CombinedGraphQLErrors({ errors: [{ message, extensions: { code } }] })
const serverError = (bodyText: string) =>
  new ServerError('Response not successful: Received status code 400', { response: new Response(bodyText, { status: 400 }), bodyText })

describe('foldCapability', () => {
  it('available and entitled is present', () => {
    expect(foldCapability({ available: true, entitled: true })).toEqual({ regime: 'kg_present' })
  })

  it('not available is no data, with the no-data notice and the marker', () => {
    expect(foldCapability({ available: false, entitled: false })).toEqual({
      regime: 'kg_absent', reason: 'no_data', notice: KG_NO_DATA_NOTICE, marker: KG_ABSENT_MARKER,
    })
  })

  it('available but not entitled is its own reason, never no data', () => {
    expect(foldCapability({ available: true, entitled: false })).toEqual({
      regime: 'kg_absent', reason: 'not_entitled', notice: KG_NOT_AVAILABLE_NOTICE, marker: KG_ABSENT_MARKER,
    })
  })

  it('a missing or partial answer is unknown, neither present nor absent', () => {
    for (const cap of [undefined, null, { available: true }, { entitled: true }, { available: 1, entitled: true }]) {
      expect(foldCapability(cap as never), JSON.stringify(cap)).toBeNull()
    }
  })

  it('a module that is not loaded shows the not-available notice', () => {
    expect(kgAbsent('module_not_loaded')).toEqual({
      regime: 'kg_absent', reason: 'module_not_loaded', notice: KG_NOT_AVAILABLE_NOTICE, marker: KG_ABSENT_MARKER,
    })
  })
})

describe('isValidationFailure', () => {
  it('recognises a validation failure in a GraphQL error response', () => {
    expect(isValidationFailure(combined('GRAPHQL_VALIDATION_FAILED', 'Cannot query field "kgCapability" on type "Query".'))).toBe(true)
  })

  it('does not take a platform fault or a refusal for a missing module', () => {
    expect(isValidationFailure(combined('MODULE_RESOLVER_ERROR'))).toBe(false)
    expect(isValidationFailure(combined('INTERNAL_SERVER_ERROR'))).toBe(false)
    expect(isValidationFailure(combined('UNAUTHENTICATED'))).toBe(false)
  })

  it('reads a validation failure out of a server error body, and never throws on a body it cannot parse', () => {
    expect(isValidationFailure(serverError(JSON.stringify({ errors: [{ extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] })))).toBe(true)
    expect(isValidationFailure(serverError('<html>502 Bad Gateway</html>'))).toBe(false)
    expect(isValidationFailure(serverError(''))).toBe(false)
  })

  it('leaves anything that is not an Apollo error alone', () => {
    expect(isValidationFailure(new Error('fetch failed'))).toBe(false)
    expect(isValidationFailure('string error')).toBe(false)
    expect(isValidationFailure(null)).toBe(false)
    expect(graphQLErrorCode(null)).toBeUndefined()
  })
})

describe('describeKgFailure', () => {
  it('names a module fault on the platform, the field, and where the cause is logged', () => {
    for (const code of ['MODULE_RESOLVER_ERROR', 'MODULE_RESOLVER_TIMEOUT']) {
      const probe = describeKgFailure(combined(code), 'probe')
      expect(probe).toBe(
        `the platform's knowledge-graph module failed its capability query (${code}). The cause is in the platform log as "Module resolver <module>:Query.kgCapability failed"; the KG evidence tier is unavailable for this run.`,
      )
      const chain = describeKgFailure(combined(code), 'chain')
      expect(chain).toContain('chain query')
      expect(chain).toContain('Query.kgRules')
      expect(chain).not.toContain('Query.kgCapability')
    }
  })

  it('sends a refused session to the login tool, and names no command or variable', () => {
    for (const surface of ['probe', 'chain'] as const) {
      const got = describeKgFailure(combined('UNAUTHENTICATED'), surface)
      expect(got).toBe('the platform refused this session. Call the "login" tool, then retry.')
      expect(got).not.toMatch(/\/dethereal:|DETHERNETY_URL/)
    }
  })

  it('falls back to the message, with the code when there is one', () => {
    expect(describeKgFailure(new Error('fetch failed'), 'probe')).toBe('the KG capability probe failed: fetch failed')
    expect(describeKgFailure(new Error('fetch failed'), 'chain')).toBe('the KG chain read failed: fetch failed')
    expect(describeKgFailure(combined('INTERNAL_SERVER_ERROR', 'boom'), 'chain')).toBe('the KG chain read failed: boom (INTERNAL_SERVER_ERROR)')
    expect(describeKgFailure('plain', 'probe')).toBe('the KG capability probe failed: plain')
  })

  it('redacts a registered session secret the platform echoed back', () => {
    const secret = 'kg-test-bearer-0123456789abcdef'
    registerSecret(secret)
    const got = describeKgFailure(new Error(`refused Authorization: Bearer ${secret}`), 'probe')
    expect(got).not.toContain(secret)
    expect(got).toContain('[redacted]')
  })
})

describe('parseJsonArrayTolerant', () => {
  it('parses an array, and folds an absent value to the empty array', () => {
    expect(parseJsonArrayTolerant('[1,{"a":2}]')).toEqual([1, { a: 2 }])
    expect(parseJsonArrayTolerant(null)).toEqual([])
    expect(parseJsonArrayTolerant(undefined)).toEqual([])
  })

  it('carries malformed JSON, or a value that is not an array, verbatim under _raw', () => {
    expect(parseJsonArrayTolerant('{"not terminated')).toEqual({ _raw: '{"not terminated' })
    expect(parseJsonArrayTolerant('{"an":"object"}')).toEqual({ _raw: '{"an":"object"}' })
    expect(parseJsonArrayTolerant('42')).toEqual({ _raw: '42' })
  })
})

describe('conditionGroupsMalformed', () => {
  it('is false for an array of arrays, including empty ones, and for an absent value', () => {
    expect(conditionGroupsMalformed('[[{"attribute":"a","operator":"is_false"}],[]]')).toBe(false)
    expect(conditionGroupsMalformed('[]')).toBe(false)
    expect(conditionGroupsMalformed(null)).toBe(false)
    expect(conditionGroupsMalformed(undefined)).toBe(false)
  })

  it('is true for unparseable JSON, a non-array, or an array with a non-array entry', () => {
    expect(conditionGroupsMalformed('[[{"attribute": broken')).toBe(true)
    expect(conditionGroupsMalformed('')).toBe(true)
    expect(conditionGroupsMalformed('{"a":1}')).toBe(true)
    expect(conditionGroupsMalformed('[[{"attribute":"a","operator":"is_false"}],"x"]')).toBe(true)
  })
})

describe('buildKgChain', () => {
  it('a class with no rules is not covered', () => {
    expect(buildKgChain([], 'no-such-class')).toEqual({ covered: false, classId: 'no-such-class' })
  })

  it('keeps authored prose out of the rules and in the threats, corpus and MITRE references', () => {
    const chain = buildKgChain([ruleA, ruleB], CLASS_ID)
    if (!chain.covered) throw new Error('expected a covered chain')
    const rulesJson = JSON.stringify(chain.rules)
    const authoredJson = JSON.stringify({ threats: chain.threats, corpus: chain.corpus, refs: chain.ruleMitreRefs })
    for (const prose of [
      threatAitm.description!, threatCleartext.description!, corpusPoodle.synthesis, corpusNist.synthesis,
      corpusPoodle.canonicalUrl, 'provisional', 'AiTM is the direct consequence.',
    ]) {
      expect(rulesJson).not.toContain(prose)
      expect(authoredJson).toContain(prose)
    }
    expect(chain.rules).toHaveLength(2)
    expect(chain.rules[0]).toEqual({
      ruleId: 'cert_validation',
      name: 'Adversary-in-the-Middle via skipped certificate validation',
      kind: 'exposure',
      conditionGroups: [
        [{ attribute: 'server_certificate_validated', operator: 'is_false' }],
        [{ attribute: 'tls_enabled', operator: 'is_false' }],
      ],
      readAttributes: [
        { name: 'server_certificate_validated', title: 'Server certificate validated', category: 'transport' },
        { name: 'tls_enabled', title: 'TLS enabled', category: 'transport' },
      ],
    })
    expect(chain.rules[0]).not.toHaveProperty('malformed')
  })

  it('lists a threat once across rules and a source once across threats; MITRE references stay per rule', () => {
    const chain = buildKgChain([ruleA, ruleB], CLASS_ID)
    if (!chain.covered) throw new Error('expected a covered chain')
    expect(chain.threats.map((t) => t.slug).sort()).toEqual(['adversary-in-the-middle', 'cleartext-transport'])
    expect(chain.corpus.map((c) => c.id).sort()).toEqual(['CVE-2014-3566', 'SC-8'])
    expect(chain.corpus.find((c) => c.id === 'SC-8')).toEqual(corpusNist)
    expect(chain.ruleMitreRefs.map((r) => r.ruleId)).toEqual(['cert_validation', 'tls_strip'])
  })

  it('keeps a null technique provenance null and parses a present one', () => {
    const chain = buildKgChain([ruleA, ruleB], CLASS_ID)
    if (!chain.covered) throw new Error('expected a covered chain')
    const bySlug = new Map(chain.threats.map((t) => [t.slug, t]))
    expect(bySlug.get('cleartext-transport')!.techniqueProvenance).toBeNull()
    expect(bySlug.get('adversary-in-the-middle')!.techniqueProvenance).toEqual([{ id: 'T1557', tier: 'provisional', sourceKind: 'first-party' }])
    expect(buildKgChain([makeRule({ addresses: [{ ...threatAitm, techniqueProvenance: '{bad' }] })], CLASS_ID)).toMatchObject({
      threats: [{ techniqueProvenance: { _raw: '{bad' } }],
    })
  })

  it('marks a rule whose stored groups are not an array of arrays, keeping the groups it can parse', () => {
    const broken = buildKgChain([makeRule({ conditionGroups: '[[{"attribute": broken' })], CLASS_ID)
    expect(broken).toMatchObject({ rules: [{ conditionGroups: [], malformed: true }] })
    const partly = buildKgChain(
      [makeRule({ conditionGroups: JSON.stringify(['x', [{ attribute: 'tls_enabled', operator: 'is_false' }]]) })],
      CLASS_ID,
    )
    expect(partly).toMatchObject({ rules: [{ conditionGroups: [[{ attribute: 'tls_enabled', operator: 'is_false' }]], malformed: true }] })
    const refs = buildKgChain([makeRule({ mitreRefs: 'nope' })], CLASS_ID)
    expect(refs).toMatchObject({ ruleMitreRefs: [{ ruleId: 'cert_validation', refs: { _raw: 'nope' } }] })
  })

  it('a rule name narrows every list; one that matches nothing keeps the class covered with empty lists', () => {
    const filtered = buildKgChain([ruleA, ruleB], CLASS_ID, 'Cleartext transport / TLS strip')
    expect(filtered).toMatchObject({ covered: true, rules: [{ ruleId: 'tls_strip' }], ruleMitreRefs: [{ ruleId: 'tls_strip' }] })
    expect(buildKgChain([ruleA, ruleB], CLASS_ID, 'no such rule')).toEqual({
      covered: true, classId: CLASS_ID, rules: [], threats: [], corpus: [], ruleMitreRefs: [],
    })
  })
})

describe('EVALUATE_FRAMING', () => {
  it('is the counterfactual framing, byte for byte', () => {
    expect(EVALUATE_FRAMING).toBe(
      "This rule's recorded condition, evaluated against the supplied attribute values as of the run — a counterfactual statement, never \"the platform fired because\".",
    )
  })
})
