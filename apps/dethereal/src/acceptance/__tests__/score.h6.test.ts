import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { h6, readOnlyCall } from '../score/h6.js'
import type { ShownPrompt } from '../score/prompts.js'
import type { Attribution, OpaqueChange, ParsedRun, TranscriptEvent } from '../transcripts/types.js'
import { eventBuilder } from './helpers.js'

const { ev } = eventBuilder()
const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const call = (tool: string, input: Record<string, unknown>) => ev({ kind: 'server_write', tool, input } as never)

describe('H6: which server calls only read', () => {
  it('counts the platform queries as reads, whatever their action', () => {
    for (const tool of ['dethereal.query_exposures', 'dethereal.query_controls', 'dethereal.query_countermeasures']) {
      expect(readOnlyCall(call(tool, { action: 'list' })), tool).toBe(true)
      expect(readOnlyCall(call(tool, { action: 'rank' })), tool).toBe(true)
    }
  })

  it('keeps the read actions of the older manage tools, for transcripts that used them, and their writes as writes', () => {
    expect(readOnlyCall(call('dethereal.manage_exposures', { action: 'list' }))).toBe(true)
    expect(readOnlyCall(call('dethereal.manage_controls', { action: 'get' }))).toBe(true)
    expect(readOnlyCall(call('dethereal.manage_controls', { action: 'create' }))).toBe(false)
    expect(readOnlyCall(call('dethereal.model_state', { action: 'get' }))).toBe(true)
    expect(readOnlyCall(call('dethereal.model_state_settle', { action: 'settle' }))).toBe(false)
  })
})

describe('H6: when each enricher run counts', () => {
  const bundle = { files: ['infrastructure-scout', 'security-enricher', 'model-reviewer'].map((r) => ({ path: `agents/${r}.md` })) }
  type Beat = string | [string, 'answered' | 'dismissed' | 'compacted']
  /** A run from beats: a role runs an agent to its return; a prompt id is shown and answered unless it says otherwise. */
  const h6Of = (beats: Beat[]) => {
    const b = eventBuilder()
    const events: TranscriptEvent[] = []
    const shown: ShownPrompt[] = []
    beats.forEach((beat, i) => {
      const [name, how] = typeof beat === 'string' ? [beat, 'answered'] : beat
      if (name.includes('-') && !['infrastructure-scout', 'security-enricher', 'model-reviewer'].includes(name)) {
        const asked = b.ev({ kind: 'assistant', text: `[prompt: ${name}] ?` })
        events.push(asked)
        const s: ShownPrompt = { id: name, event: asked.seq, complete: true, missing: [], segment: 0 }
        if (how === 'answered') s.answeredBy = (events.push(b.ev({ kind: 'user', text: 'yes' })), events.at(-1)!.seq)
        else if (how === 'dismissed') s.dismissed = true
        else s.compacted = true
        shown.push(s)
      } else {
        events.push(b.ev({ kind: 'subagent_start', callId: `a${i}`, text: name }), b.ev({ kind: 'subagent_end', callId: `a${i}` }))
      }
    })
    const parsed = { events, reconciliation: { unobserved: [] } } as unknown as ParsedRun
    return h6({ parsed, bundle, shown }).findings.filter((f) => f.code === 'missing_delegation').map((f) => `${f.refs![0]}: ${f.detail}`)
  }
  const head = ['infrastructure-scout', 'discovery-confirm']
  const tail = ['model-reviewer', 'review-record']

  it('reads the classification pass against classification-confirm when it is asked', () => {
    expect(h6Of([...head, 'security-enricher', 'classification-confirm', 'data-items-confirm', 'security-enricher', ...tail])).toEqual([])
    expect(h6Of([...head, 'classification-confirm', 'security-enricher', 'data-items-confirm', 'security-enricher', ...tail]))
      .toEqual(['classification: no run of the enricher before classification-confirm returned'])
  })

  it('reads it against the first data-items-confirm when the pass proposes nothing and asks no classification question', () => {
    expect(h6Of([...head, 'security-enricher', 'crown-jewel-confirm', 'data-items-confirm', 'security-enricher', ...tail])).toEqual([])
    // No classification pass: the enrichment run after the answer does not stand in for it.
    expect(h6Of([...head, 'crown-jewel-confirm', 'data-items-confirm', 'security-enricher', ...tail]))
      .toEqual(['classification: no run of the enricher before data-items-confirm returned'])
  })

  it('does not let a classification-confirm asked only after Step 7 move the classification bound', () => {
    // No classification pass before Step 7; a later return to Step 6 asks classification-confirm.
    expect(h6Of([...head, 'data-items-confirm', 'security-enricher', 'classification-confirm', ...tail]))
      .toEqual(['classification: no run of the enricher before data-items-confirm returned'])
  })

  it('passes a resumed run that asks crown-jewel-confirm before its classification pass', () => {
    expect(h6Of([...head, 'crown-jewel-confirm', 'security-enricher', 'crown-jewel-confirm', 'data-items-confirm', 'security-enricher', ...tail])).toEqual([])
  })

  it('reads the classification pass against the first showing of data-items-confirm, not a later one', () => {
    expect(h6Of([...head, 'data-items-confirm', 'security-enricher', 'data-items-confirm', 'security-enricher', ...tail]))
      .toEqual(['classification: no run of the enricher before data-items-confirm returned'])
  })

  it('does not count a classification pass run again on a resume as enrichment', () => {
    // The session resumed after classification-confirm and ran Step 6 again before Step 7.
    expect(h6Of([...head, 'security-enricher', 'classification-confirm', 'security-enricher', 'data-items-confirm', ...tail]))
      .toEqual(['enrichment: no run of the enricher for enrichment (started after data-items-confirm was first answered) returned'])
  })

  it('does not count a run between a dismissed data-items-confirm and its answer as enrichment', () => {
    expect(h6Of([...head, 'security-enricher', ['data-items-confirm', 'dismissed'], 'security-enricher', 'data-items-confirm', ...tail]))
      .toEqual(['enrichment: no run of the enricher for enrichment (started after data-items-confirm was first answered) returned'])
    expect(h6Of([...head, 'security-enricher', ['data-items-confirm', 'compacted'], 'data-items-confirm', 'security-enricher', ...tail])).toEqual([])
  })

  it('starts enrichment at the first answer, not a later showing of the same question', () => {
    expect(h6Of([...head, 'security-enricher', 'data-items-confirm', 'security-enricher', 'data-items-confirm', ...tail])).toEqual([])
  })
})

describe('H6: a quick run with nothing left to classify', () => {
  const bundle = { files: ['infrastructure-scout', 'security-enricher', 'model-reviewer'].map((r) => ({ path: `agents/${r}.md` })) }
  const MODEL = 'threat-models/orderdesk'
  type Reading = { open?: unknown; dir?: string; actor?: string; isError?: boolean; action?: string; text?: string }
  /**
   * A change to a model file: a replayed edit with its changed leaves (none: one the replay could not follow), a move
   * onto it, a shell or server write with the paths it may touch, a change the harness saw and the replay did not, or
   * one the replay found when it saw the file again (`since`: -1 unexplained, or the event the file became unknown).
   */
  type Change = { write: string; pointers?: string[]; move?: true; touches?: string[]; tool?: string; by?: 'shell' | 'server' | 'unobserved' | 'opaque'; since?: number }
  /**
   * A run from beats: a role runs an agent to its return; a prompt id is shown and answered; a reading is a `quality`
   * call and its result; a change writes a model file.
   */
  const h6Of = (beats: Array<string | Reading | Change>, { quick = true, noModel = false, projectRoot = '/p' as string | null } = {}) => {
    const b = eventBuilder()
    const events: TranscriptEvent[] = []
    const shown: ShownPrompt[] = []
    const attributions: Attribution[] = []
    const unobserved: Array<{ path: string; harnessEvent: number; window: [number, number]; shellInWindow: boolean }> = []
    const opaque: OpaqueChange[] = []
    beats.forEach((beat, i) => {
      if (typeof beat === 'object' && 'write' in beat) {
        const file = `${MODEL}/${beat.write}`
        const touches = beat.touches ?? [file]
        if (beat.by === 'shell') events.push(b.ev({ kind: 'shell', writesModel: true, touches }))
        else if (beat.by === 'server') {
          const tool = beat.tool ?? 'dethereal.update_model'
          events.push(b.ev({ kind: 'tool_call', tool, callId: `w${i}`, input: { action: 'update', directory_path: MODEL } }))
          events.push(b.ev({ kind: 'server_write', tool, callId: `w${i}`, touches }))
        } else if (beat.by === 'unobserved' || beat.by === 'opaque') {
          const at = b.ev({ kind: 'assistant', text: '…' })
          events.push(at)
          if (beat.by === 'unobserved') unobserved.push({ path: file, harnessEvent: at.seq, window: [at.seq - 1, at.seq + 1], shellInWindow: false })
          else opaque.push({ path: file, since: beat.since ?? -1, resyncedAt: at.seq, pointer: '/defaultBoundary/components/0/id', before: undefined, after: 'c-new' })
        } else if (beat.move) {
          events.push(b.ev({ kind: 'file_write', path: `${MODEL}/new.json`, fileOp: { op: 'move', to: file } }))
        } else {
          const w = b.ev({ kind: 'file_write', path: file })
          events.push(w)
          for (const pointer of beat.pointers ?? []) attributions.push({ path: file, pointer, before: undefined, after: true, event: w.seq, actor: 'main' })
        }
      } else if (typeof beat === 'object') {
        const actor = beat.actor ?? 'main'
        const input = { action: beat.action ?? 'quality', directory_path: beat.dir ?? MODEL }
        const text = beat.text ?? JSON.stringify({ quality_score: 40, attribute_residual: { elements_unclassified: 2, unclassified_open: beat.open ?? 0 } })
        events.push(b.ev({ kind: 'tool_call', actor, actorId: actor, tool: 'dethereal.validate_model_json', callId: `q${i}`, input }))
        events.push(b.ev({ kind: 'tool_result', actor, actorId: actor, tool: 'dethereal.validate_model_json', callId: `q${i}`, text, ...(beat.isError ? { isError: true } : {}) }))
      } else if (beat.includes('-') && !['infrastructure-scout', 'security-enricher', 'model-reviewer'].includes(beat)) {
        const asked = b.ev({ kind: 'assistant', text: `[prompt: ${beat}] ?` })
        events.push(asked, b.ev({ kind: 'user', text: 'yes' }))
        shown.push({ id: beat, event: asked.seq, complete: true, missing: [], segment: 0, answeredBy: events.at(-1)!.seq })
      } else {
        events.push(b.ev({ kind: 'subagent_start', callId: `a${i}`, text: beat }), b.ev({ kind: 'subagent_end', callId: `a${i}` }))
      }
    })
    const parsed = { events, attributions, opaque, reconciliation: { unobserved } } as unknown as ParsedRun
    return h6({ parsed, bundle, shown, quick, ...(noModel ? {} : { modelRel: MODEL }), projectRoot }).findings
      .filter((f) => f.code === 'missing_delegation').map((f) => f.refs![0])
  }
  const head = ['infrastructure-scout', 'discovery-confirm']
  const tail = ['data-items-confirm', 'security-enricher', 'model-reviewer', 'push-consent']
  const skip = (reading: Reading = {}) => [...head, reading, 'crown-jewel-confirm', ...tail]
  const crownJewels: Change = { write: 'structure.json', pointers: ['/defaultBoundary/boundaries/2/components/0/crownJewel'] }

  it('skips the classification pass on a zero reading of the model before the first data-items-confirm', () => {
    expect(h6Of(skip())).toEqual([])
    // The path absolute, under the project root; or relative to it, with a trailing slash.
    expect(h6Of(skip({ dir: `/p/${MODEL}` }))).toEqual([])
    expect(h6Of(skip({ dir: `${MODEL}/` }))).toEqual([])
    // A nonzero reading taken earlier is superseded by the last one.
    expect(h6Of([...head, { open: 2 }, { open: 0 }, 'crown-jewel-confirm', ...tail])).toEqual([])
    // Without a known project root, an absolute path names the model by its ending.
    expect(h6Of(skip({ dir: `/anywhere/${MODEL}` }), { projectRoot: null })).toEqual([])
  })

  it('keeps the reading through the crown-jewel flags Step 6 writes after it, and writes to files that do not decide it', () => {
    expect(h6Of([...head, {}, 'crown-jewel-confirm', crownJewels, { write: '.dethereal/scope.json', pointers: ['/crown_jewel_elements/orders/0'] },
      { write: '.dethereal/state.json', by: 'server', tool: 'dethereal.model_state', touches: [`${MODEL}/.dethereal/`] },
      { write: 'attributes/', by: 'server', tool: 'dethereal.generate_attribute_stubs', touches: [`${MODEL}/attributes/`, `${MODEL}/.dethereal/`] },
      { write: 'notes.md', by: 'shell', touches: [`${MODEL}/notes.md`] }, ...tail])).toEqual([])
    // A change found later, but made before the reading, was in the model the reading read.
    expect(h6Of([...head, { write: 'structure.json', by: 'server' }, {}, { write: 'structure.json', by: 'opaque', since: 5 }, 'crown-jewel-confirm', ...tail])).toEqual([])
    // A write after the first data-items-confirm is Step 7's own.
    expect(h6Of([...head, {}, 'crown-jewel-confirm', 'data-items-confirm', { write: 'data-items.json', pointers: ['/dataItems/0/id'] },
      'security-enricher', 'model-reviewer', 'push-consent'])).toEqual([])
  })

  it('does not trust a reading the model changed after, before the first data-items-confirm', () => {
    for (const change of [
      { write: 'structure.json', pointers: ['/defaultBoundary/boundaries/2/components/3/id'] },
      { write: 'structure.json', pointers: ['/defaultBoundary/boundaries/2/components/0/crownJewel', '/defaultBoundary/boundaries/2/components/0/classData/id'] },
      { write: 'dataflows.json', pointers: ['/dataFlows/4/id'] },
      { write: 'data-items.json', pointers: ['/dataItems/0/classData'] },
      // A crown-jewel flag counts only in structure.json, where Step 6 writes it.
      { write: 'data-items.json', pointers: ['/dataItems/0/crownJewel'] },
      { write: '.dethereal/discovery.json', pointers: ['/left_unclassified/2/id'] },
      { write: 'structure.json' },
      { write: 'structure.json', move: true },
      { write: '.dethereal/discovery.json', move: true },
      { write: 'structure.json', by: 'shell' },
      { write: 'structure.json', by: 'shell', touches: [`${MODEL}/`] },
      { write: 'structure.json', by: 'shell', touches: ['*'] },
      { write: 'structure.json', by: 'shell', touches: [] },
      { write: 'dataflows.json', by: 'server', touches: [`${MODEL}/`, `${MODEL}.backup-*`] },
      { write: 'structure.json', by: 'server', tool: 'dethereal.model_state_settle', touches: [`${MODEL}/`] },
      { write: 'structure.json', by: 'server', tool: 'dethereal.some_new_tool', touches: ['*'] },
      { write: 'structure.json', by: 'unobserved' },
      { write: 'structure.json', by: 'opaque' },
    ] as Change[]) {
      expect(h6Of([...head, {}, 'crown-jewel-confirm', change, ...tail]), JSON.stringify(change)).toEqual(['classification'])
    }
    // A reading taken again after the change stands.
    expect(h6Of([...head, { open: 0 }, { write: 'structure.json', pointers: ['/defaultBoundary/boundaries/2/components/3/id'] }, {}, 'crown-jewel-confirm', ...tail])).toEqual([])
  })

  it('never skips it in a full run', () => {
    expect(h6Of([...head, {}, 'crown-jewel-confirm', 'data-items-confirm', 'security-enricher', 'model-reviewer', 'review-record'], { quick: false }))
      .toEqual(['classification'])
  })

  it('does not skip it on a nonzero reading, or a last reading that is nonzero', () => {
    expect(h6Of(skip({ open: 1 }))).toEqual(['classification'])
    expect(h6Of([...head, { open: 0 }, { open: 3 }, 'crown-jewel-confirm', ...tail])).toEqual(['classification'])
  })

  it('does not skip it with no reading, or none it can trust', () => {
    expect(h6Of([...head, 'crown-jewel-confirm', ...tail])).toEqual(['classification'])
    for (const r of [
      { isError: true },
      { actor: 'security-enricher' },
      { dir: 'threat-models/other' },
      { dir: '/elsewhere/threat-models/orderdesk' },
      { action: 'gates' },
      { text: 'not json' },
      { text: JSON.stringify({ quality_score: 40, attribute_residual: { elements_unclassified: 0 } }) },
      { open: '0' },
      { text: JSON.stringify({ error: 'failed', data: { attribute_residual: { unclassified_open: 0 } } }) },
    ] as Reading[]) {
      expect(h6Of(skip(r)), JSON.stringify(r)).toEqual(['classification'])
    }
    // A reading after the first data-items-confirm comes too late.
    expect(h6Of([...head, 'crown-jewel-confirm', 'data-items-confirm', {}, 'security-enricher', 'model-reviewer', 'push-consent'])).toEqual(['classification'])
    // Without the model directory nothing can be read on it.
    expect(h6Of(skip(), { noModel: true })).toEqual(['classification'])
    // With no data-items-confirm shown there is no bound to read before.
    expect(h6Of([...head, {}, 'crown-jewel-confirm', 'model-reviewer', 'push-consent'])).toContain('classification')
  })

  it('does not skip it when a classification question was shown', () => {
    expect(h6Of([...head, {}, 'classification-confirm', 'crown-jewel-confirm', ...tail])).toEqual(['classification'])
    expect(h6Of([...head, {}, 'classification-gap', 'crown-jewel-confirm', ...tail])).toEqual(['classification'])
    // Shown only later, after Step 7, it still shows the pass was not skipped for want of anything to classify.
    expect(h6Of([...head, {}, 'crown-jewel-confirm', 'data-items-confirm', 'classification-confirm', 'security-enricher', 'model-reviewer', 'push-consent'])).toEqual(['classification'])
  })

  it('leaves the other delegations required', () => {
    expect(h6Of([...head, {}, 'crown-jewel-confirm', 'data-items-confirm', 'model-reviewer', 'push-consent'])).toEqual(['enrichment'])
    expect(h6Of([{}, 'discovery-confirm', 'crown-jewel-confirm', ...tail])).toEqual(['scout'])
  })
})

describe('H6: the enrichment applier', () => {
  // The roles the shipped Claude bundle installs, as a run's bundle.json lists them.
  const bundle = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'bundles', 'claude', 'bundle.json'), 'utf8')) as { files: Array<{ path: string }> }
  /** Step 8 as the workflow runs it: the enricher, the relay answered, the applier writing attributes, then the review. */
  const step8 = ({ reviewed, applierDuringReview = false }: { reviewed: 'review-record' | 'push-consent'; applierDuringReview?: boolean }) => {
    const late = applierDuringReview
    const b = eventBuilder()
    const events: TranscriptEvent[] = []
    const shown: ShownPrompt[] = []
    const agent = (role: string, body: (actor: string) => TranscriptEvent[] = () => []) => {
      const id = `c${events.length}`
      events.push(b.ev({ kind: 'subagent_start', callId: id, text: role }))
      events.push(...body(role))
      events.push(b.ev({ kind: 'subagent_end', callId: id }))
    }
    const ask = (id: string) => {
      const asked = b.ev({ kind: 'assistant', text: `[prompt: ${id}] ?` })
      events.push(asked)
      events.push(b.ev({ kind: 'user', text: 'yes' }))
      shown.push({ id, event: asked.seq, complete: true, missing: [], segment: 0, answeredBy: events.at(-1)!.seq })
    }
    const write = (actor: string) => b.ev({ kind: 'file_write', actor, actorId: actor, path: 'threat-model/attributes/components/c-web.json' })
    agent('infrastructure-scout'); ask('discovery-confirm')
    agent('security-enricher'); ask('classification-confirm'); ask('data-items-confirm')
    agent('security-enricher'); ask('enrichment-relay')
    if (!late) agent('enrichment-applier', (actor) => [write(actor)])
    const start = b.ev({ kind: 'subagent_start', callId: 'review', text: 'model-reviewer' })
    events.push(start)
    if (late) agent('enrichment-applier', (actor) => [write(actor)])
    events.push(b.ev({ kind: 'subagent_end', callId: 'review' }))
    ask(reviewed)
    const parsed = { events, reconciliation: { unobserved: [] } } as unknown as ParsedRun
    return h6({ parsed, bundle, shown, quick: reviewed === 'push-consent' }).findings.map((f) => `${f.verdict}:${f.code}`)
  }

  it('is a role the shipped bundle installs, and its writes before the review count against no one', () => {
    expect(step8({ reviewed: 'review-record' })).toEqual([])
    expect(step8({ reviewed: 'push-consent' })).toEqual([])
  })

  it('fails a quick run whose applier writes after the review started', () => {
    expect(step8({ reviewed: 'push-consent', applierDuringReview: true })).toContain('FAIL:write_after_review')
  })
})
