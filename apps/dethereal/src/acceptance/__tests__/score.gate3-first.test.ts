/**
 * The first Gate 3 of a run that follows the sheet, read from the run's own gates result before the first
 * loop-back: only the fields the platform facts settle may fail there.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { failureGaps, gapFields, gate3First, type Gate3FirstInput } from '../score/gate3-first.js'
import { matchModel, readRunModel, type RunModel } from '../score/match.js'
import type { ShownPrompt } from '../score/prompts.js'
import type { Bridge } from '../score/bridges.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { CEILING_FAILURES, FIXTURE, gatesResult, key, sheet } from './fixtures/clean-run.js'
import { eventBuilder } from './helpers.js'

const ROOT = '/work/project'
const MODEL_DIR = `${ROOT}/threat-model`
const keyRun = readRunModel(path.join(FIXTURE, 'key', 'model'))
const matching = matchModel(keyRun, key, { byClass: false })

type Failing = Parameters<typeof gatesResult>[0]
interface Scene { failing?: Failing; result?: string; actor?: string; dir?: string; action?: string; isError?: boolean; writeBetween?: boolean; shown?: boolean; earlier?: Failing; between?: Partial<TranscriptEvent>; said?: string; saidAfter?: string }

/** A gates result where only the given criterion fails, with the list given. */
function withCriterion(criterion: string, failing: Array<{ id: string; detail?: string }>): string {
  const r = JSON.parse(gatesResult({}))
  r.gate3.verdict = 'FAIL'
  r.gate3.criteria[criterion] = { verdict: 'FAIL', failing, failing_total: failing.length }
  return JSON.stringify(r)
}

function scene(o: Scene = {}, extra: Partial<Gate3FirstInput> = {}) {
  const { ev } = eventBuilder()
  const events: TranscriptEvent[] = []
  const actor = o.actor ?? 'main'
  if (o.said) events.push(ev({ kind: 'user', text: o.said }))
  if (o.earlier) {
    events.push(ev({ kind: 'tool_call', tool: 'dethereal.validate_model_json', callId: 'g0', input: { action: 'gates', directory_path: MODEL_DIR } }))
    events.push(ev({ kind: 'tool_result', tool: 'dethereal.validate_model_json', callId: 'g0', text: gatesResult(o.earlier) }))
  }
  events.push(ev({ kind: 'tool_call', actor, tool: 'dethereal.validate_model_json', callId: 'g1', input: { action: o.action ?? 'gates', directory_path: o.dir ?? MODEL_DIR } }))
  events.push(ev({ kind: 'tool_result', actor, tool: 'dethereal.validate_model_json', callId: 'g1', isError: !!o.isError, text: o.result ?? gatesResult(o.failing ?? CEILING_FAILURES) }))
  if (o.saidAfter) events.push(ev({ kind: 'user', text: o.saidAfter }))
  if (o.writeBetween) events.push(ev({ kind: 'file_write', tool: 'Write', path: 'threat-model/attributes/components/c-edge-gateway.json' }))
  if (o.between) events.push(ev({ kind: 'server_write', ...o.between } as TranscriptEvent))
  const asked = ev({ kind: 'assistant', text: '[prompt: gate3-loopback] Loop back?' })
  events.push(asked, ev({ kind: 'user', text: 'loop back. …' }))
  const shown = (o.shown ?? true ? [{ id: 'gate3-loopback', event: asked.seq, complete: true, missing: [], answeredBy: asked.seq + 1, segment: 0 }] : []) as ShownPrompt[]
  const input: Gate3FirstInput = { events, shown, key, matching, run: keyRun, pushes: [], modelRel: 'threat-model', projectRoot: ROOT, ...extra }
  return gate3First(input).map((f) => `${f.verdict}:${f.code}`)
}

describe('the failure detail', () => {
  it('names the missing and the placeholder fields', () => {
    expect(gapFields('placeholder: a, b; missing: c')).toEqual({ missing: ['c'], placeholder: ['a', 'b'] })
    expect(gapFields('30/39 fields answered')).toEqual({ missing: [], placeholder: [] })
    expect(gapFields(undefined)).toEqual({ missing: [], placeholder: [] })
    // A reply that gives the field lists (and no detail) is read from the lists; an older reply from its detail.
    expect(failureGaps({ id: 'f-1', missing: ['auth_failure_mode'] })).toEqual({ missing: ['auth_failure_mode'], placeholder: [] })
    expect(failureGaps({ id: 'f-1', missing: [], placeholder: ['x'], detail: 'missing: y' })).toEqual({ missing: [], placeholder: ['x'] })
    expect(failureGaps({ id: 'f-1', detail: 'missing: y' })).toEqual({ missing: ['y'], placeholder: [] })
  })
})

describe('the first Gate 3 against the ceiling', () => {
  it('passes the ceiling, a part of it, and nothing at all', () => {
    expect(scene()).toEqual([])
    expect(scene({ failing: { C3: CEILING_FAILURES.C3!.slice(0, 2) } })).toEqual([])
    expect(scene({ failing: {} })).toEqual([])
  })

  it('fails a placeholder, a field the facts do not settle, an element outside the ceiling, and every other criterion', () => {
    expect(scene({ failing: { ...CEILING_FAILURES, C8: [{ id: 'c-edge-gateway', detail: 'placeholder: implicit_deny_enabled' }] } })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    // A stand-in beside a field the facts do settle is still a stand-in.
    expect(scene({ failing: { C8: [{ id: 'c-edge-gateway', detail: 'placeholder: monitoring_tools; missing: implicit_deny_enabled' }] } })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    expect(scene({ failing: { C3: [{ id: 'f-gateway-logs', detail: 'missing: auth_failure_mode, required_credentials' }] } })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    expect(scene({ failing: { C8: [{ id: 'c-bastion', detail: 'missing: implicit_deny_enabled' }] } })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    expect(scene({ failing: { C9: [{ id: 'f-gateway-logs', detail: 'missing: auth_failure_mode' }] } })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    expect(scene({ failing: { C2: [{ id: 'c-bastion', detail: '20/27 fields answered' }] } })).toEqual([])
  })

  it('leaves to review an element the final model lacks, and one no key element stands for that fails only where the ceiling does', () => {
    expect(scene({ failing: { C3: [{ id: 'f-gone', detail: 'missing: auth_failure_mode' }] } })).toEqual(['needs-review:gate3_first_unkeyed'])
    const run: RunModel = { ...keyRun, flows: [...keyRun.flows, { id: 'f-extra-logs', name: 'Extra logs', source: 'c-orders-api', target: 'x-logplatform', dataItemIds: [] }] }
    expect(scene({ failing: { C3: [{ id: 'f-extra-logs', detail: 'missing: auth_failure_mode' }] } }, { run })).toEqual(['needs-review:gate3_first_unkeyed'])
    expect(scene({ failing: { C3: [{ id: 'f-extra-logs', detail: 'missing: encryption_in_transit' }] } }, { run })).toEqual(['FAIL:gate3_first_outside_ceiling'])
  })

  it('reads a load balancer hop as the key flow it carries', () => {
    const run: RunModel = { ...keyRun, flows: [...keyRun.flows, { id: 'f-hop', name: 'To the log balancer', source: 'c-edge-gateway', target: 'c-lb', dataItemIds: [] }] }
    const bridges = [{ keyId: 'f-gateway-logs', hops: [{ id: 'f-hop' }, { id: 'f-hop-2' }] }] as unknown as Bridge[]
    expect(scene({ failing: { C3: [{ id: 'f-hop', detail: 'missing: auth_failure_mode' }] } }, { run, bridges })).toEqual([])
  })

  it('follows an element through a push that renamed it after the result', () => {
    const pushes = [{ seq: 10, map: new Map([['f-gateway-logs-local', 'f-gateway-logs']]) }]
    expect(scene({ failing: { C3: [{ id: 'f-gateway-logs-local', detail: 'missing: auth_failure_mode' }] } }, { pushes })).toEqual([])
    expect(scene({ failing: { C3: [{ id: 'f-gateway-logs-local', detail: 'missing: auth_failure_mode' }] } })).toEqual(['needs-review:gate3_first_unkeyed'])
  })

  it('fails a criterion the ceiling does not name, or one failing with nothing listed, as a whole', () => {
    // C5 fails with an empty list; C6 lists crown jewels by name, not elements.
    expect(scene({ failing: { ...CEILING_FAILURES } , result: withCriterion('C5', []) })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    expect(scene({ result: withCriterion('C6', [{ id: 'customer order records' }]) })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    expect(scene({ result: withCriterion('C3', []) })).toEqual(['FAIL:gate3_first_outside_ceiling'])
  })

  it('reads the admin listener as the orders API it belongs to', () => {
    const api = keyRun.components.find((c) => c.id === 'c-orders-api')!
    const run: RunModel = { ...keyRun, components: [...keyRun.components, { ...api, id: 'c-admin', name: 'Orders API admin listener' }] }
    const m = matchModel(run, key, { byClass: false })
    expect(m.components.get('c-admin')).toBe('c-orders-api-admin')
    expect(scene({ failing: { C8: [{ id: 'c-admin', detail: 'missing: implicit_deny_enabled' }] } }, { run, matching: m })).toEqual([])
    expect(scene({ failing: { C8: [{ id: 'c-admin', detail: 'missing: implicit_deny_enabled, monitoring_tools' }] } }, { run, matching: m })).toEqual(['FAIL:gate3_first_outside_ceiling'])
  })

  it('leaves an unkeyed element to review only beside a ceiling element', () => {
    const extraFlow = (target: string): RunModel => ({ ...keyRun, flows: [...keyRun.flows, { id: 'f-extra', name: 'Extra', source: 'c-orders-api', target, dataItemIds: [] }] })
    expect(scene({ failing: { C3: [{ id: 'f-extra', detail: 'missing: auth_failure_mode' }] } }, { run: extraFlow('x-idp') })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    // Into the payment vendor, beside the vendor flow the ceiling names.
    expect(scene({ failing: { C3: [{ id: 'f-extra', detail: 'missing: auth_failure_mode' }] } }, { run: extraFlow('x-payvendor') })).toEqual(['needs-review:gate3_first_unkeyed'])
    const gateway = keyRun.components.find((c) => c.id === 'c-edge-gateway')!
    const bastion = keyRun.components.find((c) => c.id === 'c-bastion')!
    const extraIn = (boundaryId: string): RunModel => ({ ...keyRun, components: [...keyRun.components, { id: 'c-extra', name: 'Sidecar', boundaryId, dataItemIds: [] } as never] })
    expect(scene({ failing: { C8: [{ id: 'c-extra', detail: 'missing: implicit_deny_enabled' }] } }, { run: extraIn(gateway.boundaryId) })).toEqual(['needs-review:gate3_first_unkeyed'])
    expect(scene({ failing: { C8: [{ id: 'c-extra', detail: 'missing: implicit_deny_enabled' }] } }, { run: extraIn(bastion.boundaryId) })).toEqual(['FAIL:gate3_first_outside_ceiling'])
  })

  it('leaves a cut-short list to review', () => {
    const result = JSON.parse(gatesResult({ C3: CEILING_FAILURES.C3!.slice(0, 1) }))
    result.gate3.criteria.C3.failing_total = 7
    expect(scene({ result: JSON.stringify(result) })).toEqual(['needs-review:gate3_first_truncated'])
  })
})

describe('a ceiling field whose fact was already given', () => {
  const relay = sheet.prompts.find((p) => p.id === 'enrichment-relay')!
  const fact = (id: string) => relay.facts.find((f) => f.id === id)!.text

  it('fails at the first Gate 3 once an operator reply before the result gave its fact', () => {
    // The ingest-key fact settles the log flows' failure mode: given at the relay, the run had it.
    expect(scene({ said: `Accept all.\n- ${fact('F2')}` })).toEqual(['FAIL:gate3_first_outside_ceiling'])
    // The enforcement fact settles C8 alone: C3 stays open for its own fact.
    const c8Only = scene({ said: `- ${fact('F1')}`, failing: { C3: CEILING_FAILURES.C3! } })
    expect(c8Only).toEqual([])
    expect(scene({ said: `- ${fact('F1')}`, failing: { C8: CEILING_FAILURES.C8! } })).toEqual(['FAIL:gate3_first_outside_ceiling'])
  })

  it('is still excused when the fact came after the result, or in other words', () => {
    expect(scene({ saidAfter: `- ${fact('F2')}` })).toEqual([])
    expect(scene({ said: 'The log platform probably checks its keys.' })).toEqual([])
  })
})

describe('which gates result is the first Gate 3', () => {
  it('reads only the main session on the model, with nothing written after it', () => {
    expect(scene({ actor: 'dethereal:model-reviewer' })).toEqual(['needs-review:gate3_first_unread'])
    expect(scene({ dir: `${ROOT}/another-model` })).toEqual(['needs-review:gate3_first_unread'])
    expect(scene({ action: 'quality' })).toEqual(['needs-review:gate3_first_unread'])
    expect(scene({ isError: true })).toEqual(['needs-review:gate3_first_unread'])
    expect(scene({ result: 'not json' })).toEqual(['needs-review:gate3_first_unread'])
    expect(scene({ writeBetween: true })).toEqual(['needs-review:gate3_first_unread'])
  })

  it('reads the last result before the loop-back, not an earlier one', () => {
    expect(scene({ earlier: { C1: [{ id: 'c-orders-db' }] } })).toEqual([])
    expect(scene({ earlier: CEILING_FAILURES, failing: { C1: [{ id: 'c-orders-db' }] } })).toEqual(['FAIL:gate3_first_outside_ceiling'])
  })

  it('counts only a write that changed this model, and reads a relative model path', () => {
    expect(scene({ between: { tool: 'dethereal.model_state_settle', touches: ['threat-model/structure.json'] } })).toEqual(['needs-review:gate3_first_unread'])
    expect(scene({ between: { tool: 'dethereal.model_state_settle', touches: ['other-model/structure.json'] } })).toEqual([])
    expect(scene({ between: { kind: 'shell', writesModel: true, denied: 'user-rejected' } })).toEqual([])
    expect(scene({ between: { kind: 'shell', writesModel: true } })).toEqual(['needs-review:gate3_first_unread'])
    expect(scene({ dir: './threat-model' })).toEqual([])
  })

  it('carries ids only through pushes after the result', () => {
    const early = [{ seq: 0, map: new Map([['f-gateway-logs', 'f-renamed']]) }]
    expect(scene({ failing: { C3: [{ id: 'f-gateway-logs', detail: 'missing: auth_failure_mode' }] } }, { pushes: early })).toEqual([])
  })

  it('names the model by its path when the project root is unknown', () => {
    expect(scene({}, { projectRoot: null })).toEqual([])
    expect(scene({ dir: '/elsewhere/another-model' }, { projectRoot: null })).toEqual(['needs-review:gate3_first_unread'])
  })

  it('says nothing when the loop-back was never asked', () => {
    expect(scene({ shown: false, failing: { C1: [{ id: 'c-orders-db' }] } })).toEqual([])
  })
})
