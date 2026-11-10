/**
 * A quick run, scored on its own: a clean one passes every hard gate with its items scored on the priority subset,
 * and each way a quick run can go wrong is caught, planted once into the clean run.
 */
import { describe, it, expect, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeGates, loadGateInput } from '../../utils/gates.js'
import { AnswerSheetError, invocationFor, parseAnswerSheet, promptInMode } from '../answer-sheet.js'
import { h7 } from '../score/h7.js'
import { scoreRun, type ScoreReport } from '../score/score.js'
import { readRegistry } from '../score/prompts.js'
import { controlledElements, quickPromptFindings, quickStateFindings, scopedKey } from '../score/quick.js'
import { eventBuilder } from './helpers.js'
import { buildRun, bundleHashOf, cleanScript, distHashOf, FIXTURE, key, MODEL, MODULE, PROJECT_PATH, REGISTRY, sheet as cleanSheet, withoutCompaction, type Step } from './fixtures/clean-run.js'
import { summarise } from '../score/report.js'
import { editJson } from './helpers.js'

// Each test builds and scores a whole run: slow under a full-suite load.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 600_000 })

const dirs: string[] = []
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
const newTmp = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-score-quick-')))
  dirs.push(d)
  return d
}

const QUICK_STATE = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], revision: 6, mode: 'quick', quickThrough: 8 }

async function score(edit: (s: Step[]) => void = () => {}, options: Parameters<typeof buildRun>[2] = {}): Promise<ScoreReport> {
  const script = cleanScript('quick')
  edit(script)
  const { dir } = await buildRun(path.join(newTmp(), 'run'), script, { quick: true, ...options })
  return scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
}
let cleanRun: Promise<ScoreReport> | undefined
const clean = () => (cleanRun ??= score())
const codes = (r: ScoreReport, gate: string) => r.gates!.find((g) => g.gate === gate)!.findings.map((f) => `${f.verdict}:${f.code}`)
const at = (s: Step[], p: (x: Step) => boolean) => {
  const i = s.findIndex(p)
  if (i < 0) throw new Error('step not found')
  return i
}
const promptAt = (s: Step[], id: string) => at(s, (x) => x.kind === 'prompt' && x.id === id)
const quickStep = (n: number) => (x: Step) => x.kind === 'tool' && x.name === 'model_state' && (x.input as { quick_through?: unknown }).quick_through === n
/** Step 8 recorded by a `transition` to `to` in place of the `mode` call. */
const asTransition = (s: Step[], to: string, extra: { result?: string; isError?: boolean } = {}) => {
  const i = at(s, quickStep(8))
  const step = s[i] as Extract<Step, { kind: 'tool' }>
  s[i] = { ...step, input: { ...step.input, action: 'transition', to }, ...extra }
}

describe('the sheet\'s quick parts', () => {
  const sheetOf = (head: string[], prompt: string[] = []) => parseAnswerSheet(['version: 1', 'invocation:', '  claude: "/x run"', ...head, 'prompts:', '  - id: loop', '    trigger: "x"', '    mandatory: true', '    required: fixture', ...prompt, '    how: typed', '    reply: "a"'].join('\n') + '\n')

  it('reads a mode\'s own invocation, the full run keeping the top-level one', () => {
    const s = sheetOf(['modes:', '  quick:', '    invocation:', '      claude: "/x run --quick"'])
    expect(invocationFor(s, 'quick', 'claude')).toBe('/x run --quick')
    expect(invocationFor(s, 'full', 'claude')).toBe('/x run')
    expect(invocationFor(s, 'baseline', 'claude')).toBeUndefined()
    expect(() => sheetOf(['modes:', '  fast:', '    invocation:'])).toThrow(/a mode must be one of quick, baseline/)
    expect(() => sheetOf(['modes:', '  quick:', '    invocation:', '  quick:'])).toThrow(/listed twice/)
  })

  it('keeps a prompt to the reply modes it names, and refuses a mode it does not know', () => {
    const p = sheetOf([], ['    only_modes: ["bar", "loopback"]']).prompts[0]!
    expect([promptInMode(p, 'bar'), promptInMode(p, 'loopback'), promptInMode(p, 'quick')]).toEqual([true, true, false])
    expect(() => sheetOf([], ['    only_modes: ["full"]'])).toThrow(AnswerSheetError)
  })

  it('never requires an out-of-mode prompt, and fails a run that shows it', () => {
    const s = sheetOf([], ['    only_modes: ["bar", "loopback"]'])
    const shown = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'loop', event: i * 2, complete: true, missing: [], answeredBy: i * 2 + 1, segment: 0 }))
    expect(h7({ sheet: s, shown: [], replies: [], pairs: [], mode: 'quick' }).findings).toEqual([])
    expect(h7({ sheet: s, shown: shown(1), replies: [], pairs: [], mode: 'quick' }).findings.map((f) => f.code)).toEqual(['prompt_out_of_mode'])
    expect(h7({ sheet: s, shown: [], replies: [], pairs: [], mode: 'bar' }).findings.map((f) => f.code)).toEqual(['prompt_not_shown'])
  })
})

describe('a clean quick run', () => {
  it('passes every hard gate, counts as final, and leaves its quality to the bar', async () => {
    const r = await clean()
    expect(r.problems).toEqual([])
    expect(r.gates?.filter((g) => g.verdict !== 'PASS')).toEqual([])
    expect(r.verdict).toBe('PASS')
    expect(r.countsAsFinal).toBe(true)
    expect(r.marginalReasons).toEqual([])
    // A quick PASS says nothing of quality on its own, and the report says so.
    expect(r.disclosures).toContainEqual(expect.stringMatching(/^quick run: the verdict is the hard gates only/))
  })

  it('may record Step 8 through its transition to ENRICHING, as the tool allows', async () => {
    const r = await score((s) => asTransition(s, 'ENRICHING'))
    expect(r.gates?.filter((g) => g.verdict !== 'PASS')).toEqual([])
    expect(codes(r, 'H2')).toEqual(codes(await clean(), 'H2'))
  })

  it('scores the scoped items on the priority subset, the full key beside them, and marks every item with its role', async () => {
    const r = await clean()
    const item = (id: string) => r.rubric!.find((i) => i.id === id)!
    for (const id of key.quick!.scoped) expect(item(id).quick, id).toMatchObject({ role: 'covered', scoped: true })
    expect(item('assertions.rate')).toMatchObject({ hits: 28, n: 28 })
    expect(item('assertions.rate').quick?.fullKey).toMatchObject({ hits: 30, n: 30 })
    expect(item('red_flags').tally).toEqual({ ok: 10, n: 10 })
    expect(item('downstream.exposures').quick?.role).toBe('relative')
    expect(item('data_items.credential_flags')).toMatchObject({ informational: true, quick: { role: 'informational' } })
    expect(item('components.recall').quick).toEqual({ role: 'covered' })
  })
})

describe('a quick run with the settlement off', () => {
  it('passes every hard gate when its record and its server agree, and fails H2 when they do not', async () => {
    const offRun = await score(() => {}, { settlement: 'off' })
    expect(offRun.problems).toEqual([])
    expect(offRun.gates?.filter((g) => g.verdict !== 'PASS')).toEqual([])
    expect(offRun.verdict).toBe('PASS')
    // The record says off, and the run's server reported the settlement on.
    const { dir } = await buildRun(path.join(newTmp(), 'run'), cleanScript('quick'), { quick: true })
    editJson(path.join(dir, 'run.json'), (r) => { r.settlement = 'off' })
    const mismatched = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(codes(mismatched, 'H2')).toContain('FAIL:settlement_mode_mismatch')
  })
})

describe('a quick run the kit did not compact', () => {
  it('passes, its post-compaction check not run rather than passed', async () => {
    const r = await score(withoutCompaction)
    expect(r.problems).toEqual([])
    expect(r.verdict).toBe('PASS')
    expect(r.countsAsFinal).toBe(true)
    expect(r.gates!.map((g) => g.gate)).not.toContain('post-compaction')
    expect(r.notRun).toEqual(['post-compaction: the main session was never compacted'])
    expect(summarise(r)).toContain('not run: post-compaction: the main session was never compacted')
  })

  it('still checks the segment after a compaction Claude Code started on its own', async () => {
    const auto = (s: Step[]) => {
      const where = s.findIndex((x) => x.kind === 'compact')
      withoutCompaction(s)
      s.splice(where, 0, { kind: 'compact', trigger: 'auto' })
      return where
    }
    const r = await score((s) => { auto(s) })
    expect(r.problems).toEqual([])
    expect(r.notRun).toBeUndefined()
    expect(r.gates!.find((g) => g.gate === 'post-compaction')?.verdict).toBe('PASS')
    // The state read after the compaction left out: the next model write comes first.
    const unread = await score((s) => {
      const where = auto(s)
      s.splice(where + 1 + s.slice(where + 1).findIndex((x) => x.kind === 'tool' && x.name === 'model_state'), 1)
    })
    expect(codes(unread, 'post-compaction')).toContain('FAIL:no_state_reread')
  })
})

describe('the quick part of the key', () => {
  it('holds the priority subset the Step 8 snapshot takes on the key model before enrichment', async () => {
    const dir = path.join(newTmp(), 'model')
    fs.cpSync(path.join(FIXTURE, 'key', 'model'), dir, { recursive: true })
    const blank = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) blank(p)
        else editJson(p, (doc) => { for (const k of Object.keys(doc.attributes ?? {})) doc.attributes[k] = null })
      }
    }
    blank(path.join(dir, 'attributes'))
    const g = computeGates(await loadGateInput(dir)).gate3
    const failing = (['C2', 'C8'] as const).flatMap((c) => g.criteria[c].failing.map((f) => f.id))
    const labels = g.report.tier_members.labels
    const crownJewels = (key.crown_jewels as { elements: Record<string, string[]> }).elements
    const snapshot = new Set([...failing, ...labels.crown_jewels.map((x) => x.id), ...Object.values(crownJewels).flat(), ...labels.cross_boundary.map((x) => x.id)])
    expect([...key.quick!.priority].sort()).toEqual([...snapshot].sort())
  })

  it('names every rubric item a role, and scopes only covered items', async () => {
    const r = await clean()
    const q = key.quick!
    for (const i of r.rubric!) expect(q.covered.includes(i.id) || q.informational.includes(i.id), i.id).toBe(true)
    for (const id of [...q.scoped, ...q.relative_only]) expect(q.covered, id).toContain(id)
  })

  it('drops from the scoped key what rests outside the subset, and only that', () => {
    const scoped = scopedKey(key)
    const gone = (a: Array<{ id: string }>, b: Array<{ id: string }>) => a.filter((x) => !b.some((y) => y.id === x.id)).map((x) => x.id)
    expect(gone(key.attribute_assertions, scoped.attribute_assertions)).toEqual(['pii-in-logs', 'webhook-signature-deny'])
    expect(gone(key.red_flags, scoped.red_flags)).toEqual(['pii-in-logs'])
    expect(scoped.credentials.shared).toEqual(key.credentials.shared)
  })
})

describe('a quick run is caught', () => {
  const registry = readRegistry(REGISTRY)

  it('asking what its mode never asks: the loop-back, the scope question', async () => {
    for (const id of ['gate3-loopback', 'enrich-scope']) {
      const r = await score((s) => s.splice(promptAt(s, 'push-consent'), 0, { kind: 'prompt', id }))
      expect(codes(r, 'H7'), id).toContain('FAIL:prompt_out_of_mode')
    }
  })

  it('running the control pass', async () => {
    const r = await score((s) => s.splice(promptAt(s, 'push-consent'), 0, { kind: 'tool', name: 'manage_controls', input: { action: 'create', name: 'WAF' } }))
    expect(codes(r, 'H7')).toContain('FAIL:control_pass_in_quick')
  })

  it('never asking the relay\'s questions for the operator\'s facts', async () => {
    const r = await score((s) => {
      const i = promptAt(s, 'enrichment-relay')
      s[i] = { kind: 'prompt', id: 'enrichment-relay', text: `[prompt: enrichment-relay] ${(registry.get('enrichment-relay')?.requires ?? []).join(' ')}` }
    })
    expect(codes(r, 'H7').filter((c) => c === 'FAIL:fact_never_asked')).toHaveLength(key.quick!.facts_expected.length)
  })

  it('never marking the model quick, or stopping before Step 8 was recorded', async () => {
    const unmarked = await score((s) => s.splice(at(s, (x) => x.kind === 'tool' && (x.input as { mode?: unknown }).mode === 'quick'), 1), { state: { ...QUICK_STATE, mode: undefined } })
    expect(codes(unmarked, 'H2')).toContain('FAIL:not_marked_quick')
    const unfinished = await score((s) => s.splice(at(s, quickStep(8)), 1), { state: { ...QUICK_STATE, quickThrough: 7 } })
    expect(codes(unfinished, 'H2')).toEqual(expect.arrayContaining(['FAIL:quick_unfinished', 'FAIL:quick_through_unseen']))
  })

  it('recording Step 8 before the relay was answered', async () => {
    const r = await score((s) => {
      const [step] = s.splice(at(s, quickStep(8)), 1)
      s.splice(promptAt(s, 'enrichment-relay'), 0, step!)
    })
    expect(codes(r, 'H2')).toContain('FAIL:quick_through_early')
  })

  it('recording Step 8 through a transition to any state but ENRICHING, or one the tool refused', async () => {
    const elsewhere = await score((s) => asTransition(s, 'STRUCTURE_COMPLETE'))
    expect(codes(elsewhere, 'H2')).toContain('FAIL:quick_through_unseen')
    const refused = await score((s) => asTransition(s, 'ENRICHING', { result: '{"error":"quick_through is recorded on a quick model only"}', isError: true }))
    expect(refused.gates!.find((g) => g.gate === 'H2')!.findings).toContainEqual(expect.objectContaining({ code: 'quick_through_unseen', detail: expect.stringMatching(/did not succeed/) }))
  })

  it('claiming REVIEWED, or holding a waiver', async () => {
    const reviewed = await score(() => {}, { state: { ...QUICK_STATE, currentState: 'REVIEWED', completedStates: [...QUICK_STATE.completedStates, 'ENRICHING', 'REVIEWED'] } })
    expect(codes(reviewed, 'H2')).toContain('FAIL:quick_reviewed')
    const waived = await score(() => {}, { state: { ...QUICK_STATE, waivers: [{ criterion: 'C2', element_ids: ['c-orders-db'], reason: 'x', fingerprints: {} }] } })
    expect(codes(waived, 'H2')).toContain('FAIL:quick_waiver')
  })

  it('leaving the priority subset short of Gate 3\'s floors', async () => {
    const r = await score(() => {}, { mutate: (m) => editJson(path.join(m, 'attributes', 'components', 'c-edge-gateway.json'), (doc) => { for (const k of Object.keys(doc.attributes)) doc.attributes[k] = null }) })
    expect(codes(r, 'H2')).toContain('FAIL:priority_incomplete')
  })

  it('reviewing a model it then changed before publishing', async () => {
    const r = await score((s) => s.splice(promptAt(s, 'push-consent'), 0, { kind: 'write', files: ['dataflows.json'] }))
    expect(codes(r, 'H6')).toContain('FAIL:write_after_review')
  })

  it('reviewing before the enrichment returned, or writing as the reviewer', async () => {
    const early = await score((s) => {
      // The review runs before the Step 8 enricher, which returns after it started.
      const [reviewer] = s.splice(at(s, (x) => x.kind === 'agent' && x.role === 'model-reviewer'), 1)
      s.splice(at(s, quickStep(7)) + 1, 0, reviewer!)
    })
    expect(codes(early, 'H6')).toContain('FAIL:review_before_enrichment')
    const wrote = await score((s) => {
      const i = at(s, (x) => x.kind === 'agent' && x.role === 'model-reviewer')
      s[i] = { kind: 'agent', role: 'model-reviewer', writes: [{ file: 'dataflows.json', content: fs.readFileSync(path.join(FIXTURE, 'key', 'model', 'dataflows.json'), 'utf8') }] }
    })
    expect(codes(wrote, 'H6')).toContain('FAIL:reviewer_wrote')
  })

  it('running the control pass silently: a control on the final model, a control file', async () => {
    const named = await score(() => {}, { mutate: (m) => editJson(path.join(m, 'structure.json'), (st) => { st.defaultBoundary.boundaries[0].components[0].controls = [{ name: 'WAF', source: 'docs' }] }) })
    expect(codes(named, 'H7')).toContain('FAIL:control_pass_in_quick')
    const filed = await score((s) => s.splice(promptAt(s, 'push-consent'), 0, { kind: 'write-content', file: 'controls/c-waf.json', content: '{}' }))
    expect(codes(filed, 'H7')).toContain('FAIL:control_pass_in_quick')
  })

  it('recording Step 8 while an enricher of it was still to run', async () => {
    const r = await score((s) => s.splice(at(s, quickStep(8)) + 1, 0, { kind: 'agent', role: 'security-enricher' }))
    expect(codes(r, 'H2')).toContain('FAIL:quick_through_early')
  })

  it('remapping crown jewels after the review', async () => {
    const r = await score((s) => s.splice(promptAt(s, 'push-consent'), 0, { kind: 'write', files: ['.dethereal/scope.json'] }))
    expect(codes(r, 'H6')).toContain('FAIL:write_after_review')
  })

  it('on a key with no quick block, as invalid', async () => {
    const fixtures = path.join(newTmp(), 'fixtures')
    fs.cpSync(FIXTURE, path.join(fixtures, 'synthetic'), { recursive: true })
    editJson(path.join(fixtures, 'synthetic', 'key', 'expected.json'), (k) => { delete k.quick })
    const { dir } = await buildRun(path.join(newTmp(), 'run'), cleanScript('quick'), { quick: true })
    const r = await scoreRun(dir, { moduleDataDir: MODULE, fixturesDir: fixtures, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.verdict).toBe('INVALID')
    expect(r.problems?.map((p) => p.code)).toEqual(['no_quick_key'])
  })

  it('opening on the full invocation', async () => {
    const r = await score((s) => {
      s[0] = { kind: 'user', prompt: 'invocation', text: `<command-name>/dethereal:threat-model</command-name>\n<command-args>Threat-model this repository: the OrderDesk service in the current directory.</command-args>` }
    })
    expect(r.verdict).toBe('INVALID')
    expect(r.problems?.map((p) => p.code)).toContain('invocation_mismatch')
  })
})

describe('the quick checks, alone', () => {
  const { ev } = eventBuilder()

  it('fail any waiver, and leave a cut-short priority list to review', () => {
    const state = { claimed_state: 'ENRICHING', mode: 'quick', quick_through: 8 }
    const criteria = { C2: { verdict: 'FAIL', failing: [{ id: 'x-unmatched' }], failing_total: 4 } }
    expect(quickStateFindings(key, state, { criteria, waived_total: 0 }, undefined).map((f) => `${f.verdict}:${f.code}`)).toEqual(['needs-review:priority_truncated'])
    expect(quickStateFindings(key, state, { criteria: {}, waived_total: 2 }, undefined).map((f) => f.code)).toEqual(['quick_waiver'])
    expect(quickStateFindings(key, state, { criteria: {} }, undefined, 1).map((f) => f.code)).toEqual(['quick_waiver'])
  })

  it('read a controls-mode delegation as the control pass, and a fact the sheet lacks as a fixture fault', () => {
    const events = [ev({ kind: 'subagent_start', input: { subagent_type: 'dethereal:security-enricher', prompt: 'Run enrich --focus controls on the model.' } })]
    expect(quickPromptFindings(cleanSheet, { ...key, quick: { ...key.quick!, facts_expected: [] } }, events, []).map((f) => f.code)).toEqual(['control_pass_in_quick'])
    expect(quickPromptFindings(cleanSheet, { ...key, quick: { ...key.quick!, facts_expected: ['F9'] } }, [], []).map((f) => `${f.verdict}:${f.code}`)).toEqual(['needs-review:fact_unknown'])
  })

  it('find the elements that carry controls, at any depth', () => {
    expect(controlledElements({ defaultBoundary: { id: 'b', components: [{ id: 'c1', controls: [] }, { id: 'c2', controls: [{ name: 'x' }] }] } }, [{ id: 'f1', controls: [{ name: 'y' }] }])).toEqual(['c2', 'f1'])
  })
})

void MODEL
void PROJECT_PATH
