/**
 * Contract 2 as Dethereal checks it: the module's real answers on its fixed models pass whole, in both contracts;
 * refusals are read before the contract; and each rule of the extended answer drops the candidate (or refuses the
 * answer, for the envelope) when one input breaks it.
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import type { ExposureState } from '../../triage/exposures.js'
import { validateAnswer } from '../answer.js'
import type { LocalModel } from '../local.js'

const MODULE = path.resolve(import.meta.dirname, '../../../../../modules/dethernety-hidden-edges')
const load = (rel: string): Promise<any> => import(path.join(MODULE, rel))

/** What a Dethereal run would hold for a folded model: its local files, its synced ids and its exposure read. */
async function contextOf(m: any, options: { excluded?: string[] }) {
  const local: LocalModel = { components: new Map(), flows: new Map(), boundaries: new Map(), dataItems: new Map() }
  for (const [id, c] of m.components as Map<string, any>) local.components.set(id, { id, name: id, type: c.type })
  for (const [id, f] of m.flows as Map<string, any>) local.flows.set(id, { id, source: f.source, target: f.target, classId: f.cls?.id ?? null })
  for (const id of (m.boundaries as Map<string, any>).keys()) local.boundaries.set(id, { id, name: id })
  for (const id of (m.dataItems as Map<string, any>).keys()) local.dataItems.set(id, { id, name: id })
  const exposures = new Map<string, ExposureState>()
  for (const [id, e] of m.exposures as Map<string, any>) {
    exposures.set(id, {
      exposure_id: id, name: e.name, type: null, category: null, score: null, attack_vector: null, created_by: e.createdBy, authored_by: null,
      disposition_kind: e.lifecycle === 'confirmed' ? 'AFFIRMED' : null, disposition_reason: null, dispositioned_by: e.lifecycle === 'confirmed' ? 'someone' : null,
      dispositioned_at: null, disposition_stale: null, lifecycle: e.lifecycle, element_id: e.elementId, element_name: e.elementId, element_kind: e.elementKind,
      element_class: null, attack_ids: e.techniques, atlas_ids: [], unresolved_references: null, def_hash: 'h', full_reason: null,
    } as ExposureState)
  }
  const { readKindClasses } = await load('src/classes.ts')
  const { MODULE_NAME } = await load('src/contract.ts')
  const module = { id: 'mod-hidden-edges', name: MODULE_NAME }
  const classes = new Map(Object.values(readKindClasses(path.join(MODULE, 'data')) as Record<string, { id: string; name: string }>).map((c) => [c.id, { ...c, module }]))
  return { local, components: new Set(local.components.keys()), exposures, excluded: new Set(options.excluded ?? []), classes: classes as any }
}

/** The module's answer on one of its fixed models, in a contract, with the context a run would check it in. */
async function fixed(name: string, contract: 1 | 2, sizeLimit?: number) {
  const { SNAPSHOT_MODELS, answerFor } = await load('__tests__/contract1-models.ts')
  const entry = SNAPSHOT_MODELS.find((m: any) => m.name === name)
  const { answer, model } = await answerFor(entry, contract, sizeLimit)
  return { answer, ctx: await contextOf(model, entry.options) }
}

describe('the module’s real answers', () => {
  it('pass whole in both contracts, on every fixed model, each candidate with its explanation under 2', async () => {
    const { SNAPSHOT_MODELS } = await load('__tests__/contract1-models.ts')
    for (const e of SNAPSHOT_MODELS) {
      for (const contract of [1, 2] as const) {
        const { answer, ctx } = await fixed(e.name, contract)
        const r = validateAnswer(JSON.stringify(answer), ctx, contract)
        expect(r.status, `${e.name} ${contract}: ${JSON.stringify(r)}`).toBe('ok')
        if (r.status !== 'ok') continue
        expect([e.name, contract, r.dropped, r.candidates.length]).toEqual([e.name, contract, 0, answer.candidates.length])
        expect(r.header.contract).toBe(contract)
        if (contract === 2) {
          expect(r.candidates.every((c) => c.explain && 'parts' in c.explain)).toBe(true)
          expect(r.header.limits?.per_kind_budget).toBe(50)
          expect(Object.keys(r.header.rationale ?? {}).length).toBeGreaterThan(0)
        } else expect(r.candidates.every((c) => c.explain === undefined)).toBe(true)
      }
    }
  })

  it('takes an answer the module trimmed for size: explanations left out, every candidate kept', async () => {
    const { answer, ctx } = await fixed('fanout', 2, 10)
    expect(JSON.stringify(answer).length).toBeLessThan(1024 * 1024)
    const r = validateAnswer(JSON.stringify(answer), ctx, 2)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.candidates.map((c) => c.explain)).toEqual(answer.candidates.map(() => ({ omitted: 'size' })))
  })
})

describe('the vocabularies', () => {
  it('know every role and relation of the module’s table', async () => {
    const { ROLES, RELATIONS } = await import('../explain.js')
    const { ROLES: moduleRoles, PEER_RELATIONS } = await load('src/table.ts')
    expect([...ROLES].sort()).toEqual([...moduleRoles].sort())
    expect([...RELATIONS].sort()).toEqual([...PEER_RELATIONS].sort())
  })
})

describe('refusals and the contract', () => {
  const refusal = (contract: number, code = 'options_invalid') => JSON.stringify({ contract, module: 'dethernety-hidden-edges', version: '0.1.2', refusal: { code, detail: 'options has an unknown key' } })

  it('reads a refusal in contract 1 or the contract asked before the contract check', async () => {
    const { ctx } = await fixed('segment', 2)
    expect(validateAnswer(refusal(1), ctx, 2)).toMatchObject({ status: 'refused', code: 'module_options_invalid' })
    expect(validateAnswer(refusal(2, 'busy'), ctx, 2)).toMatchObject({ status: 'refused', code: 'module_busy' })
    expect(validateAnswer(refusal(3), ctx, 2)).toMatchObject({ status: 'refused', code: 'contract_mismatch' })
  })

  it('refuses an answer in another contract than the one asked', async () => {
    const one = await fixed('segment', 1)
    const two = await fixed('segment', 2)
    expect(validateAnswer(JSON.stringify(one.answer), one.ctx, 2)).toMatchObject({ status: 'refused', code: 'contract_mismatch' })
    expect(validateAnswer(JSON.stringify(two.answer), two.ctx, 1)).toMatchObject({ status: 'refused', code: 'contract_mismatch' })
  })
})

describe('each rule of the extended answer', () => {
  /** A fixed model's contract-2 answer with one change to one candidate (or its envelope, or the run's read), checked. */
  async function changed(change: (a: any, c: any) => void, pick: { model?: string; kind?: string; source?: string; target?: string } = {}, read?: (ctx: any) => void) {
    const { answer, ctx } = await fixed(pick.model ?? 'segment', 2)
    const a = JSON.parse(JSON.stringify(answer))
    const c = a.candidates.find((x: any) => x.kind === (pick.kind ?? x.kind) && x.source === (pick.source ?? 'A') && x.target === (pick.target ?? 'B'))
    change(a, c)
    read?.(ctx)
    return { r: validateAnswer(JSON.stringify(a), ctx, 2), total: a.candidates.length }
  }
  const drops = async (why: string, change: (a: any, c: any) => void, pick?: Parameters<typeof changed>[1], read?: (ctx: any) => void) => {
    const { r, total } = await changed(change, pick, read)
    expect(r.status, why).toBe('ok')
    if (r.status === 'ok') expect([why, r.dropped, r.candidates.length]).toEqual([why, 1, total - 1])
  }
  const refusesAnswer = async (why: string, change: (a: any, c: any) => void) => {
    expect((await changed(change)).r, why).toMatchObject({ status: 'refused', code: 'answer_invalid' })
  }
  const part = (c: any) => c.explain.parts[0]

  it('drops a candidate whose explanation is missing or of an unknown shape', async () => {
    await drops('no explain', (_a, c) => delete c.explain)
    await drops('an unknown key', (_a, c) => (c.explain.extra = 1))
    await drops('an unknown omission', (_a, c) => (c.explain = { omitted: 'time' }))
    await drops('no parts', (_a, c) => (c.explain.parts = []))
    await drops('more than three parts', (_a, c) => (c.explain.parts = [part(c), part(c), part(c), part(c)]))
    await drops('a total below the parts', (_a, c) => (c.explain.parts_total = 0))
    await drops('a malformed crown jewel', (_a, c) => (c.explain.crown_jewel = { source: 'yes', target: false }))
  })

  it('drops a candidate whose part does not hold to the candidate or to what the run read', async () => {
    await drops('another row', (_a, c) => (part(c).row = 'host-escape/he-1'))
    await drops('an unknown role', (_a, c) => (part(c).role = 'other'))
    await drops('an unknown relation', (_a, c) => (part(c).relation = 'other'))
    await drops('another starting point', (_a, c) => (part(c).foothold = 'U'))
    await drops('another reached end', (_a, c) => (part(c).reached = 'A'))
    await drops('a finding the run did not read', (_a, c) => (part(c).exposure = 'nowhere'))
    // a finding of the read, at its own element and techniques: only the rule on cited findings is broken
    await drops('a finding not the candidate’s', (_a, c) => Object.assign(part(c), { exposure: 'r', anchor: 'k1', matched: ['T1558.004'] }))
    await drops('an anchor not the finding’s element', (_a, c) => (part(c).anchor = 'B'))
    await drops('a technique the finding does not cite', (_a, c) => (part(c).matched = ['T1190']))
    await drops('a path not the candidate’s', (_a, c) => (part(c).path = 'T1190'))
    await drops('an anchored end with no flow', (_a, c) => ((part(c).anchored_end = 'A'), (part(c).flow = null)))
    await drops('a flow the run did not read', (_a, c) => (part(c).flow = 'nowhere'))
    await drops('a shared element that is no boundary', (_a, c) => (part(c).shared = 'A'))
    await drops('an item the run did not read', (_a, c) => (part(c).item = 'nowhere'))
    await drops('an unknown low reason', (_a, c) => (part(c).low = 'other'))
    await drops('a tier the candidate does not have', (_a, c) => (part(c).tier = 'low'))
    await drops('no technique that chose the row', (_a, c) => (part(c).matched = []))
    await drops('more than 32 techniques', (_a, c) => (part(c).matched = Array.from({ length: 33 }, () => 'T1021')))
    // a finding past the cited cut, so only the part rests on it: disposed, it holds nothing
    await drops('a part’s finding since disposed', (_a, c) => (c.explain.parts[0].exposure = 'x54'), { model: 'fanout' }, (ctx) => {
      ctx.exposures.get('x54').disposition_kind = 'NOT_APPLICABLE'
      ctx.exposures.get('x54').lifecycle = 'disposed'
    })
    await drops('an anchored end that is not an end of its flow', (_a, c) => (part(c).anchored_end = 'B'), { kind: 'credential-reuse', source: 'B', target: 'A' })
  })

  it('checks a part’s finding against the cited list only where the list was not cut, and holds the total to the list', async () => {
    // past the cut, a finding of the read beyond the fifty listed may anchor a part
    const past = await changed((_a, c) => (c.explain.parts[0].exposure = 'x54'), { model: 'fanout' })
    expect(past.r.status === 'ok' && past.r.dropped).toBe(0)
    // a total over fifty beside a short list is a forged cut
    await drops('a total over the cap beside a short list', (_a, c) => ((c.exposure_ids = c.exposure_ids.slice(0, 1)), (c.totals.exposure_ids = 51), (c.explain.parts[0].exposure = c.exposure_ids[0])), { model: 'fanout' })
    await drops('a total below its list', (_a, c) => (c.totals.exposure_ids = 0))
    // a list padded with one finding repeated cannot pass for a cut one
    await drops('a padded list', (_a, c) => {
      c.exposure_ids = Array.from({ length: 50 }, () => c.exposure_ids[0])
      c.totals.exposure_ids = 51
      Object.assign(c.explain.parts[0], { exposure: 'r', anchor: 'k1', matched: ['T1558.004'] })
    })
  })

  it('refuses a part on an inferred edge: its finding on one, or its flow one', async () => {
    const hiddenEdgeClass = (ctx: any) => [...ctx.classes.keys()][0]
    // a finding past the cut on a flow of the read: kept on an ordinary flow, dropped on an inferred edge
    const onFlow = (hidden: boolean) => (ctx: any) => {
      ctx.local.flows.set('fz', { id: 'fz', source: 'A', target: 'B', classId: hidden ? hiddenEdgeClass(ctx) : null })
      ctx.exposures.set('zf', { ...ctx.exposures.get('x00'), exposure_id: 'zf', element_id: 'fz', element_kind: 'dataFlow' })
    }
    const toZf = (_a: any, c: any) => Object.assign(c.explain.parts[0], { exposure: 'zf', anchor: 'fz' })
    const ordinary = await changed(toZf, { model: 'fanout' }, onFlow(false))
    expect(ordinary.r.status === 'ok' && ordinary.r.dropped).toBe(0)
    await drops('a finding on an inferred edge', toZf, { model: 'fanout' }, onFlow(true))
    await drops('a part naming an inferred edge as its flow', (_a, c) => Object.assign(part(c), { flow: 'k1', anchored_end: null }), { kind: 'credential-reuse', source: 'B', target: 'A' }, (ctx) => (ctx.local.flows.get('k1').classId = hiddenEdgeClass(ctx)))
  })

  it('drops a candidate whose basis or facts break their grammar', async () => {
    await drops('a basis with an unknown cap', (_a, c) => (part(c).basis.caps = ['other']))
    await drops('more gates stated than there are', (_a, c) => (part(c).basis.gates_stated = part(c).basis.gates + 1))
    await drops('a basis with a missing key', (_a, c) => delete part(c).basis.high_reachable)
    await drops('a basis not confirmed on a confirmed finding', (_a, c) => (part(c).basis.confirmed = false))
    await drops('a pending cap on a confirmed finding', (_a, c) => part(c).basis.caps.push('pending'))
    await drops('a low relation cap without a low reason', (_a, c) => part(c).basis.caps.push('low_relation'))
    await drops('a low reason without its cap', (_a, c) => (part(c).low = 'perimeter_only'))
    await drops('no gate with gates', (_a, c) => part(c).basis.caps.push('no_gate'))
    await drops('more than twelve facts', (_a, c) => (part(c).facts = Array.from({ length: 13 }, () => part(c).facts[0])))
    await drops('a facts total below the facts', (_a, c) => (part(c).facts_total = 0))
    await drops('a fact of an unknown effect', (_a, c) => (part(c).facts[0].effect = 'other'))
    await drops('a fact on an element the run did not read', (_a, c) => (part(c).facts[0].at = ['attributes:nowhere#x']))
    await drops('a fact naming no locator', (_a, c) => (part(c).facts[0].at = []))
    await drops('a fact value that is an object', (_a, c) => (part(c).facts[0].value = { x: 1 }))
    await drops('a fact value with a control character', (_a, c) => (part(c).facts[0].value = 'a\u0007b'))
    await drops('a fact value over 64 characters', (_a, c) => (part(c).facts[0].value = 'x'.repeat(65)))
    await drops('a gate index out of range', (_a, c) => (part(c).facts[0].gate = 24))
    await drops('a single-attribute effect naming several', (_a, c) => (part(c).facts[0] = { at: ['attributes:SEG#a', 'attributes:SEG#b'], value: null, effect: 'meets_gate', gate: 0 }))
    await drops('the knowledge graph’s step on an attribute', (_a, c) => (part(c).facts[0] = { at: ['attributes:SEG#a'], value: null, effect: 'kg_lowered' }))
    await drops('a target’s own finding on another element', (_a, c) => (part(c).facts[0] = { at: ['exposure:x'], value: null, effect: 'own_target_finding' }))
    await drops('a value on a control', (_a, c) => (part(c).facts[0] = { at: ['control:k'], value: true, effect: 'lowers' }))
    await drops('a value on a group', (_a, c) => (part(c).facts[0] = { at: ['attributes:SEG#a', 'attributes:SEG#b'], value: true, effect: 'lowers' }))
    await drops('an attribute effect on a finding', (_a, c) => (part(c).facts[0] = { at: ['exposure:x'], value: null, effect: 'context' }))
    await drops('a raise by a control', (_a, c) => (part(c).facts[0] = { at: ['control:k'], value: null, effect: 'raises' }))
    await drops('a gate index past the gates', (_a, c) => (part(c).facts[0].gate = part(c).basis.gates))
    await drops('the knowledge graph’s step on a candidate it did not lower', (_a, c) => part(c).facts.push({ at: ['kg:rule:x'], value: null, effect: 'kg_lowered' }))
    // a pending finding on the same target: only this candidate's fact names it
    await drops('a target’s own finding not confirmed', (_a, c) => (part(c).facts[0] = { at: ['exposure:yp'], value: null, effect: 'own_target_finding' }), {}, (ctx) => {
      ctx.exposures.set('yp', { ...ctx.exposures.get('y'), exposure_id: 'yp', disposition_kind: null, dispositioned_by: null, lifecycle: 'pending' })
    })
  })

  it('drops a candidate whose remedies break their grammar', async () => {
    await drops('more than five', (_a, c) => (c.explain.remedies = Array.from({ length: 6 }, () => c.explain.remedies[0])))
    await drops('an unknown outcome', (_a, c) => (c.explain.remedies[0].outcome = 'other'))
    await drops('a set on an element the run did not read', (_a, c) => (c.explain.remedies[0] = { set: [{ at: 'attributes:nowhere#x' }], outcome: 'removes' }))
    await drops('an empty set', (_a, c) => (c.explain.remedies[0] = { set: [], outcome: 'removes' }))
    await drops('a cleared finding the run did not read', (_a, c) => (c.explain.remedies[0] = { set: [{ at: 'attributes:SEG#x' }], outcome: 'removes', clears_finding: 'nowhere' }))
    await drops('a control on an element the run did not read', (_a, c) => (c.explain.remedies[0] = { control_classes: ['Firewall Policy'], attributes_true: [], item_classes: [], on: 'nowhere', outcome: 'removes' }))
    await drops('a control with no class', (_a, c) => (c.explain.remedies[0] = { control_classes: [], attributes_true: [], item_classes: [], on: 'B', outcome: 'removes' }))
    await drops('a total below the remedies', (_a, c) => (c.explain.remedies_total = 0))
    await drops('a set on something not an attribute', (_a, c) => (c.explain.remedies[0] = { set: [{ at: 'control:k' }], outcome: 'removes' }))
    await drops('a set on two elements', (_a, c) => (c.explain.remedies[0] = { set: [{ at: 'attributes:SEG#a' }, { at: 'attributes:AL#b' }], outcome: 'removes' }))
    await drops('a cleared finding on another element', (_a, c) => (c.explain.remedies[0] = { set: [{ at: 'attributes:AL#a' }], outcome: 'removes', clears_finding: 'x' }))
    await drops('a lowering not below the parts', (_a, c) => (c.explain.remedies[0] = { set: [{ at: 'attributes:SEG#a' }], outcome: 'lowers_to:medium' }), { kind: 'remote-service', source: 'U', target: 'A' })
  })

  it('ignores the limits of a kind it does not know, and drops and counts a candidate of one, as contract 1 does', async () => {
    const { r } = await changed((a) => (a.limits.by_kind.other = { listed: 0, not_listed: 'x' }))
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.header.limits?.by_kind.other).toBeUndefined()
      expect(r.dropped).toBe(0)
    }
    // its class one a known kind names too: the candidate is dropped, the answer kept
    await drops('an unknown kind', (a, c) => {
      c.kind = 'lateral-tool'
      a.limits.by_kind['lateral-tool'] = { listed: 1, not_listed: 0, pairs_capped: 0, anchors_over_budget: 0 }
    })
    const one = await fixed('segment', 1)
    const a = JSON.parse(JSON.stringify(one.answer))
    a.candidates[0].kind = 'lateral-tool'
    const r1 = validateAnswer(JSON.stringify(a), one.ctx, 1)
    expect(r1.status === 'ok' && [r1.dropped, r1.candidates.length]).toEqual([1, a.candidates.length - 1])
  })

  it('takes remedies left out for time', async () => {
    const { r } = await changed((_a, c) => ((c.explain.remedies = null), (c.explain.remedies_total = 0)))
    expect(r.status === 'ok' && r.dropped).toBe(0)
  })

  it('refuses an answer whose mode or limits are malformed, and drops only a bad rationale entry', async () => {
    await refusesAnswer('a recheck answer', (a) => (a.mode = 'recheck'))
    await refusesAnswer('no mode', (a) => delete a.mode)
    await refusesAnswer('limits with an unknown key', (a) => (a.limits.extra = 1))
    await refusesAnswer('a negative count', (a) => (a.limits.by_kind['remote-service'].listed = -1))
    await refusesAnswer('a rationale that is no object', (a) => (a.rationale = []))
    await refusesAnswer('limits without a key', (a) => delete a.limits.remedies_skipped)
    const { r } = await changed((a) => {
      a.rationale['remote-service/rs-1'] = 'line\nbreak'
      a.rationale['not a row'] = 'text'
      // a row of the table no kept candidate uses
      a.rationale['host-escape/he-1'] = 'text'
    })
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.header.rationale?.['remote-service/rs-1']).toBeUndefined()
      expect(r.header.rationale?.['not a row']).toBeUndefined()
      expect(r.header.rationale?.['host-escape/he-1']).toBeUndefined()
      expect(Object.keys(r.header.rationale ?? {}).length).toBeGreaterThan(0)
      expect(r.dropped).toBe(0)
    }
  })
})
