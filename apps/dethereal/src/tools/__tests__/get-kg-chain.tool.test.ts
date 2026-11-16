/**
 * get_kg_chain over a stubbed client, through `run` as the server calls it: the input rules, the probe's answers and
 * its failure, chain and evaluate, and the latch a failed read sets and a probe clears.
 */
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { CombinedGraphQLErrors } from '@apollo/client'
import type { ToolContext } from '../base-tool.js'
import { GetKgChainTool, getKgChainTool, type EvaluateResult, type KgUnavailableResult } from '../get-kg-chain.tool.js'
import { EVALUATE_FRAMING, KG_CAPABILITY, KG_CHAIN, type RawKgRule } from '../../triage/kg.js'
import {
  KG_ABSENT_MARKER,
  KG_LOSS_NOTICE,
  KG_NO_DATA_NOTICE,
  KG_NOT_AVAILABLE_NOTICE,
  kgProbeFailureNotice,
} from '../../triage/notices.js'

const CLASS_ID = '01170208-db8f-4c1b-8e29-636bf6d220b8'

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
    mitreRefs: '[]',
    reads: [{ name: 'server_certificate_validated', title: 'Server certificate validated', category: 'transport' }],
    addresses: [],
    ...overrides,
  }
}
const ruleA = makeRule({})

type QueryFn = (options: { query: unknown; variables?: Record<string, unknown> }) => Promise<unknown>
const contextWith = (query: QueryFn): ToolContext => ({ apolloClient: { query } as never, debug: false })
const answering = (data: unknown) => vi.fn<QueryFn>(async () => ({ data }))
const throwing = (error: unknown) =>
  vi.fn<QueryFn>(async () => {
    throw error
  })
const combined = (code: string, message = 'Internal server error') =>
  new CombinedGraphQLErrors({ errors: [{ message, extensions: { code } }] })

describe('get_kg_chain input', () => {
  const tool = new GetKgChainTool()
  const ctx = contextWith(answering({ kgRules: [] }))

  it('chain and evaluate need a class id; evaluate also needs a rule name and attributes', async () => {
    const noClass = await tool.run({ action: 'chain' }, ctx)
    expect(noClass.success).toBe(false)
    expect(noClass.error).toContain('\\"class_id\\" is required for \\"chain\\"')
    const noRule = await tool.run({ action: 'evaluate', class_id: 'x', attributes: {} }, ctx)
    expect(noRule.error).toContain('\\"rule_name\\" is required for \\"evaluate\\"')
    const noAttrs = await tool.run({ action: 'evaluate', class_id: 'x', rule_name: 'r' }, ctx)
    expect(noAttrs.error).toContain('\\"attributes\\" is required for \\"evaluate\\"')
  })

  it('refuses an unknown key, a malformed class id, an over-long rule name and attributes that are not an object', async () => {
    expect((await tool.run({ action: 'probe', extra: 1 }, ctx)).success).toBe(false)
    expect((await tool.run({ action: 'chain', class_id: 'a b' }, ctx)).success).toBe(false)
    expect((await tool.run({ action: 'chain', class_id: 'x'.repeat(129) }, ctx)).success).toBe(false)
    expect((await tool.run({ action: 'chain', class_id: 'x', rule_name: 'r'.repeat(201) }, ctx)).success).toBe(false)
    for (const attributes of [[1], 'x', null, 3]) {
      expect((await tool.run({ action: 'evaluate', class_id: 'x', rule_name: 'r', attributes }, ctx)).success).toBe(false)
    }
  })

  it('advertises attributes as an object of values, like a record', () => {
    const schema = z.toJSONSchema(tool.inputSchema, { target: 'draft-07' }) as { properties: Record<string, Record<string, unknown>> }
    expect(schema.properties.attributes).toMatchObject({ type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} })
    expect(schema.properties.action).toMatchObject({ enum: ['probe', 'chain', 'evaluate'] })
  })
})

describe('get_kg_chain description', () => {
  it('names the answers that carry the marker, and those that carry none', () => {
    expect(getKgChainTool.description).toContain('kg_absent, a failed probe, and an unavailable or unread chain carry marker, the mark to copy into the proposals table as given; covered: false and rule_found: false carry none.')
  })

  it('says what each action returns, and uses no tier, subscription or command wording', () => {
    const text = getKgChainTool.description + JSON.stringify(z.toJSONSchema(getKgChainTool.inputSchema, { target: 'draft-07' }))
    for (const word of ['probe', 'chain', 'evaluate', 'kg_present', 'module_not_loaded', 'not_entitled', 'no_data', 'covered', 'unavailable']) {
      expect(text).toContain(word)
    }
    expect(text).not.toMatch(/mechanical|authored|subscription|entitlement|(?<!not_)entitled|triage|\/dethereal:|DETHERNETY_URL|dossier/i)
  })
})

describe('probe', () => {
  const probe = (query: QueryFn, tool = new GetKgChainTool()) => tool.run({ action: 'probe' }, contextWith(query))

  it('asks the capability document', async () => {
    const query = answering({ kgCapability: { available: true, entitled: true } })
    await probe(query)
    expect(query).toHaveBeenCalledWith({ query: KG_CAPABILITY })
  })

  it('available and entitled is present', async () => {
    const r = await probe(answering({ kgCapability: { available: true, entitled: true } }))
    expect(r).toEqual({ success: true, data: { regime: 'kg_present' } })
  })

  it('not available is no data', async () => {
    const r = await probe(answering({ kgCapability: { available: false, entitled: false } }))
    expect(r).toEqual({ success: true, data: { regime: 'kg_absent', reason: 'no_data', notice: KG_NO_DATA_NOTICE, marker: KG_ABSENT_MARKER } })
  })

  it('available but not entitled is not entitled', async () => {
    const r = await probe(answering({ kgCapability: { available: true, entitled: false } }))
    expect(r).toEqual({ success: true, data: { regime: 'kg_absent', reason: 'not_entitled', notice: KG_NOT_AVAILABLE_NOTICE, marker: KG_ABSENT_MARKER } })
  })

  it('an answer without the capability is a probe failure: the state is unknown, never absent', async () => {
    for (const data of [{}, undefined, { kgCapability: null }, { kgCapability: { available: true } }, { kgCapability: { available: 'yes', entitled: true } }]) {
      const r = await probe(answering(data))
      expect(r.success, JSON.stringify(data)).toBe(false)
      expect(r.error).toBe('the KG capability probe failed: the platform returned no capability answer')
      expect(r.data).toEqual({ codes: ['kg_probe_failed'], notice: kgProbeFailureNotice(r.error!), marker: KG_ABSENT_MARKER })
      expect(JSON.stringify(r)).not.toContain('no_data')
    }
  })

  it('a validation failure means the module is not loaded', async () => {
    const r = await probe(throwing(combined('GRAPHQL_VALIDATION_FAILED', 'Cannot query field "kgCapability" on type "Query".')))
    expect(r).toEqual({
      success: true,
      data: { regime: 'kg_absent', reason: 'module_not_loaded', notice: KG_NOT_AVAILABLE_NOTICE, marker: KG_ABSENT_MARKER },
    })
  })

  it('a platform fault is a tool failure with its cause, a code and the notice, never absence', async () => {
    const r = await probe(throwing(combined('MODULE_RESOLVER_ERROR')))
    expect(r.success).toBe(false)
    expect(r.error).not.toBe('Internal server error')
    expect(r.error).toContain('Query.kgCapability')
    expect(r.error).not.toContain('Query.kgRules')
    expect(r.data).toEqual({ codes: ['kg_probe_failed'], notice: kgProbeFailureNotice(r.error!), marker: KG_ABSENT_MARKER })
    expect(JSON.stringify(r)).not.toContain('kg_absent')
  })

  it('a refused session is a tool failure that points at the login tool', async () => {
    const r = await probe(throwing(combined('UNAUTHENTICATED')))
    expect(r.success).toBe(false)
    expect(r.error).toBe('the platform refused this session. Call the "login" tool, then retry.')
    expect(r.data).toMatchObject({ codes: ['kg_probe_failed'] })
  })

  it('a transport failure carries its message', async () => {
    const r = await probe(throwing(new Error('fetch failed')))
    expect(r).toMatchObject({ success: false, error: 'the KG capability probe failed: fetch failed', data: { codes: ['kg_probe_failed'] } })
  })
})

describe('chain', () => {
  it('reads the class by id and returns its rules', async () => {
    const query = answering({ kgRules: [ruleA] })
    const r = await new GetKgChainTool().run({ action: 'chain', class_id: CLASS_ID }, contextWith(query))
    expect(query).toHaveBeenCalledWith({ query: KG_CHAIN, variables: { classId: CLASS_ID } })
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ covered: true, classId: CLASS_ID, rules: [{ ruleId: 'cert_validation' }], threats: [], corpus: [] })
  })

  it('a class with no rules is not covered', async () => {
    const r = await new GetKgChainTool().run({ action: 'chain', class_id: 'nope' }, contextWith(answering({ kgRules: [] })))
    expect(r.data).toEqual({ covered: false, classId: 'nope' })
  })

  it('a read with no rules list is a tool error, never covered: false, and does not latch', async () => {
    for (const action of ['chain', 'evaluate'] as const) {
      for (const data of [undefined, {}, { kgRules: null }, { kgRules: 'x' }]) {
        const tool = new GetKgChainTool()
        const r = await tool.run({ action, class_id: 'nope', ...(action === 'evaluate' ? { rule_name: 'r', attributes: {} } : {}) }, contextWith(answering(data)))
        expect(r).toEqual({ success: false, error: 'the KG chain read returned no rules list: whether the class has rules is unknown; retry', data: { codes: ['kg_chain_unread'], marker: KG_ABSENT_MARKER } })
        expect((await tool.run({ action: 'chain', class_id: 'nope' }, contextWith(answering({ kgRules: [] })))).data).toEqual({ covered: false, classId: 'nope' })
      }
    }
  })

  it('marks a rule with malformed groups', async () => {
    const r = await new GetKgChainTool().run(
      { action: 'chain', class_id: CLASS_ID },
      contextWith(answering({ kgRules: [makeRule({ conditionGroups: '[[{"attribute": broken' })] })),
    )
    expect(r.data).toMatchObject({ rules: [{ conditionGroups: [], malformed: true }] })
  })
})

describe('evaluate', () => {
  const evaluate = (rules: RawKgRule[], input: Record<string, unknown>) =>
    new GetKgChainTool().run({ action: 'evaluate', class_id: CLASS_ID, ...input }, contextWith(answering({ kgRules: rules })))

  it('an unknown rule is not found, and the class is covered only when it has rules', async () => {
    expect((await evaluate([], { rule_name: 'x', attributes: {} })).data).toEqual({ covered: false, classId: CLASS_ID, rule_found: false })
    expect((await evaluate([ruleA], { rule_name: 'no such rule', attributes: {} })).data).toEqual({ covered: true, classId: CLASS_ID, rule_found: false })
  })

  it('refuses inputs an action does not take', async () => {
    const tool = new GetKgChainTool()
    for (const input of [{ action: 'probe', class_id: CLASS_ID }, { action: 'probe', rule_name: 'x' }, { action: 'chain', class_id: CLASS_ID, attributes: {} }]) {
      expect((await tool.run(input, contextWith(answering({ kgRules: [] })))).error, JSON.stringify(input)).toMatch(/^Invalid input/)
    }
  })

  it('keeps a failure on one line, at most 300 characters', async () => {
    const tool = new GetKgChainTool()
    const failing = { debug: false, apolloClient: { query: async () => { throw new Error(`boom\n${'x'.repeat(1000)}`) } } } as unknown as ToolContext
    const probe = await tool.run({ action: 'probe' }, failing)
    expect(probe.error).not.toMatch(/\n/)
    expect(probe.error!.length).toBeLessThanOrEqual(300)
    const chain = await tool.run({ action: 'chain', class_id: CLASS_ID }, failing)
    const reason = (chain.data as { reason: string }).reason
    expect(reason).not.toMatch(/\n/)
    expect(reason.length).toBeLessThanOrEqual(300)
  })

  it('evaluates the named rule, with the framing and the time', async () => {
    const r = await evaluate([ruleA], { rule_name: ruleA.name, attributes: { server_certificate_validated: false, tls_enabled: true } })
    expect(r.success).toBe(true)
    const ev = r.data as EvaluateResult
    expect(ev).toMatchObject({ covered: true, classId: CLASS_ID, ruleId: 'cert_validation', ruleName: ruleA.name, framing: EVALUATE_FRAMING })
    expect(Number.isNaN(Date.parse(ev.evaluatedAt))).toBe(false)
    expect(ev.verdicts).toEqual([{ groupIndex: 0, verdict: 'holds' }, { groupIndex: 1, verdict: 'fails' }])
    expect(ev.satisfied).toEqual([0])
    expect(ev.unevaluable).toEqual([])
    expect(ev.deltas).toHaveLength(1)
    expect(ev.deltas[0]).toMatchObject({ attribute: 'server_certificate_validated', relation: 'set', target: true, sufficientAlone: true, groupIndex: 0 })
  })

  it('a missing attribute satisfies a negated operator and fails the rest', async () => {
    const rule = makeRule({ conditionGroups: JSON.stringify([[{ attribute: 'a', operator: 'is_false' }], [{ attribute: 'a', operator: 'is_true' }]]) })
    const ev = (await evaluate([rule], { rule_name: rule.name, attributes: {} })).data as EvaluateResult
    expect(ev.verdicts).toEqual([{ groupIndex: 0, verdict: 'holds' }, { groupIndex: 1, verdict: 'fails' }])
  })

  it('a type mismatch is unevaluable', async () => {
    const rule = makeRule({ conditionGroups: JSON.stringify([[{ attribute: 'n', operator: 'gt', value: 3 }]]) })
    const ev = (await evaluate([rule], { rule_name: rule.name, attributes: { n: 'many' } })).data as EvaluateResult
    expect(ev.unevaluable).toEqual([0])
    expect(ev.satisfied).toEqual([])
  })

  it('reports the same group indexes as chain', async () => {
    const rule = makeRule({
      conditionGroups: JSON.stringify(['x', [], [{ attribute: 'a', operator: 'is_true' }], [{ attribute: 'b', operator: 'is_true' }]]),
    })
    const tool = new GetKgChainTool()
    const ctx = contextWith(answering({ kgRules: [rule] }))
    const chain = (await tool.run({ action: 'chain', class_id: CLASS_ID }, ctx)).data as { rules: Array<{ conditionGroups: Array<Array<{ attribute: string }>> }> }
    const ev = (await tool.run({ action: 'evaluate', class_id: CLASS_ID, rule_name: rule.name, attributes: { b: true } }, ctx)).data as EvaluateResult
    const groups = chain.rules[0]!.conditionGroups
    expect(ev.verdicts).toHaveLength(groups.length)
    expect(ev.satisfied).toHaveLength(1)
    expect(groups[ev.satisfied[0]!]![0]!.attribute).toBe('b')
  })

  it('malformed groups give an empty evaluation, still covered', async () => {
    const rule = makeRule({ conditionGroups: '[[{"attribute": broken' })
    const ev = (await evaluate([rule], { rule_name: rule.name, attributes: {} })).data as EvaluateResult
    expect(ev).toMatchObject({ covered: true, verdicts: [], satisfied: [], unevaluable: [], deltas: [] })
  })

  it('__proto__ is an ordinary attribute key; inherited keys are not attributes', async () => {
    const rule = makeRule({ conditionGroups: JSON.stringify([[{ attribute: '__proto__', operator: 'is_true' }], [{ attribute: 'constructor', operator: 'exists' }]]) })
    const attributes = JSON.parse('{"__proto__": true}') as Record<string, unknown>
    expect(Object.hasOwn(attributes, '__proto__')).toBe(true)
    const ev = (await evaluate([rule], { rule_name: rule.name, attributes })).data as EvaluateResult
    // `constructor` is inherited from Object.prototype, never an own key, so group 1 fails as absent.
    expect(ev.verdicts).toEqual([{ groupIndex: 0, verdict: 'holds' }, { groupIndex: 1, verdict: 'fails' }])
    const off = (await evaluate([rule], { rule_name: rule.name, attributes: JSON.parse('{"__proto__": false}') })).data as EvaluateResult
    expect(off.verdicts[0]).toEqual({ groupIndex: 0, verdict: 'fails' })
  })
})

describe('the latch', () => {
  const chainFrom = (tool: GetKgChainTool, query: QueryFn) => tool.run({ action: 'chain', class_id: CLASS_ID }, contextWith(query))

  it('the first failed read answers unavailable with the loss notice; later reads answer without asking', async () => {
    const tool = new GetKgChainTool()
    const failing = throwing(combined('MODULE_RESOLVER_ERROR'))
    const first = await chainFrom(tool, failing)
    expect(first.success).toBe(true)
    expect(first.error).toBeUndefined()
    const data = first.data as KgUnavailableResult
    expect(data).toMatchObject({ unavailable: true, latched: true, classId: CLASS_ID, loss_notice: KG_LOSS_NOTICE, marker: KG_ABSENT_MARKER })
    expect(data.reason).toContain('Query.kgRules')
    expect(data.reason).not.toContain('Query.kgCapability')
    expect(data).not.toHaveProperty('covered')

    const healthy = answering({ kgRules: [ruleA] })
    const later = await chainFrom(tool, healthy)
    expect(later).toEqual({ success: true, data: { unavailable: true, latched: true, classId: CLASS_ID, reason: data.reason, marker: KG_ABSENT_MARKER } })
    const laterEval = await tool.run({ action: 'evaluate', class_id: 'other', rule_name: ruleA.name, attributes: {} }, contextWith(healthy))
    expect(laterEval).toEqual({ success: true, data: { unavailable: true, latched: true, classId: 'other', reason: data.reason, marker: KG_ABSENT_MARKER } })
    expect(healthy).not.toHaveBeenCalled()
    expect(failing).toHaveBeenCalledTimes(1)
  })

  it('a validation failure latches as module_not_loaded, never covered: false', async () => {
    const r = await chainFrom(new GetKgChainTool(), throwing(combined('GRAPHQL_VALIDATION_FAILED', 'Cannot query field "kgRules" on type "Query".')))
    expect(r).toEqual({
      success: true,
      data: { unavailable: true, latched: true, classId: CLASS_ID, reason: 'module_not_loaded', loss_notice: KG_LOSS_NOTICE, marker: KG_ABSENT_MARKER },
    })
  })

  it('evaluate sets the latch as chain does', async () => {
    const tool = new GetKgChainTool()
    const r = await tool.run(
      { action: 'evaluate', class_id: CLASS_ID, rule_name: ruleA.name, attributes: {} },
      contextWith(throwing(new Error('fetch failed'))),
    )
    expect(r.data).toEqual({ unavailable: true, latched: true, classId: CLASS_ID, reason: 'the KG chain read failed: fetch failed', loss_notice: KG_LOSS_NOTICE, marker: KG_ABSENT_MARKER })
    const healthy = answering({ kgRules: [ruleA] })
    expect((await chainFrom(tool, healthy)).data).toMatchObject({ unavailable: true, latched: true })
    expect(healthy).not.toHaveBeenCalled()
  })

  it('a refused session is a tool error naming login, and does not latch', async () => {
    const tool = new GetKgChainTool()
    const r = await chainFrom(tool, throwing(combined('UNAUTHENTICATED')))
    expect(r).toEqual({ success: false, error: 'the platform refused this session. Call the "login" tool, then retry.' })
    const after = await chainFrom(tool, answering({ kgRules: [ruleA] }))
    expect((after.data as { covered: boolean }).covered).toBe(true)
  })

  it('a probe clears the latch, whatever it answers', async () => {
    const tool = new GetKgChainTool()
    await chainFrom(tool, throwing(new Error('fetch failed')))
    await tool.run({ action: 'probe' }, contextWith(throwing(new Error('still down'))))
    const healthy = answering({ kgRules: [ruleA] })
    const after = await chainFrom(tool, healthy)
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(after.data).toMatchObject({ covered: true, rules: [{ ruleId: 'cert_validation' }] })
  })

  it('the latch belongs to the tool instance', async () => {
    const latched = new GetKgChainTool()
    await chainFrom(latched, throwing(new Error('fetch failed')))
    const fresh = answering({ kgRules: [] })
    expect((await chainFrom(new GetKgChainTool(), fresh)).data).toEqual({ covered: false, classId: CLASS_ID })
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('a failed probe never latches chain', async () => {
    const tool = new GetKgChainTool()
    await tool.run({ action: 'probe' }, contextWith(throwing(combined('MODULE_RESOLVER_ERROR'))))
    const healthy = answering({ kgRules: [] })
    await chainFrom(tool, healthy)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
