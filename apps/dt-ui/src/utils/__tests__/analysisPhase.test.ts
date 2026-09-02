import { describe, it, expect } from 'vitest'
import type { AnalysisStatus } from '@dethernety/dt-core'
import {
  phaseOf,
  PHASE_LABELS,
  PHASE_COLOR,
  PHASE_PRIMARY,
  phaseShowsDelete,
  phaseShowsRerun,
  phaseShowsBadge,
  errorReason,
  badgePhaseOf,
  badgePhaseForElement,
  type AnalysisPhase,
} from '../analysisPhase'

const ALL_PHASES: AnalysisPhase[] = ['ready', 'working', 'paused', 'done', 'failed']

// Minimal status factory — phaseOf only reads `status` and `hasDocument`.
const status = (s: string, hasDocument?: boolean): AnalysisStatus => ({
  createdAt: '',
  updatedAt: '',
  status: s,
  hasDocument,
  interrupts: {},
  messages: [],
  metadata: {},
})

describe('phaseOf', () => {
  it('maps interrupted → paused (regardless of hasDocument)', () => {
    expect(phaseOf(status('interrupted'))).toBe('paused')
    expect(phaseOf(status('interrupted', true))).toBe('paused')
  })

  it('maps busy and running → working', () => {
    expect(phaseOf(status('busy'))).toBe('working')
    expect(phaseOf(status('running'))).toBe('working')
  })

  it('maps error and failed → failed', () => {
    expect(phaseOf(status('error'))).toBe('failed')
    expect(phaseOf(status('failed'))).toBe('failed')
  })

  it('maps idle + completed result → done', () => {
    expect(phaseOf(status('idle', true))).toBe('done')
  })

  it('maps idle without a result → ready', () => {
    expect(phaseOf(status('idle', false))).toBe('ready')
    expect(phaseOf(status('idle'))).toBe('ready')
  })

  it('defaults a missing status object to ready', () => {
    expect(phaseOf(undefined)).toBe('ready')
    expect(phaseOf(null)).toBe('ready')
  })

  it('treats an unrecognised status like idle (ready, or done with a result)', () => {
    expect(phaseOf(status('something-new'))).toBe('ready')
    expect(phaseOf(status('something-new', true))).toBe('done')
  })
})

describe('PHASE_LABELS', () => {
  it('labels every phase', () => {
    expect(PHASE_LABELS.ready).toBe('Ready')
    expect(PHASE_LABELS.working).toBe('Working')
    expect(PHASE_LABELS.paused).toBe('Paused')
    expect(PHASE_LABELS.done).toBe('Done')
    expect(PHASE_LABELS.failed).toBe('Failed')
  })
})

describe('PHASE_COLOR', () => {
  it('has a colour entry for every phase', () => {
    for (const p of ALL_PHASES) expect(PHASE_COLOR).toHaveProperty(p)
  })

  it('highlights Paused (warning) and Failed (error), neutral for Ready', () => {
    expect(PHASE_COLOR.paused).toBe('warning')
    expect(PHASE_COLOR.failed).toBe('error')
    expect(PHASE_COLOR.ready).toBe('')
  })
})

describe('PHASE_PRIMARY', () => {
  it('maps each phase to its forward action and icon', () => {
    expect(PHASE_PRIMARY.ready).toMatchObject({ label: 'Run', action: 'run', icon: 'mdi-play' })
    expect(PHASE_PRIMARY.working).toMatchObject({ action: 'viewProgress', icon: 'mdi-eye-outline' })
    expect(PHASE_PRIMARY.paused).toMatchObject({ label: 'Answer', action: 'answer', icon: 'mdi-forum-outline' })
    expect(PHASE_PRIMARY.done).toMatchObject({ action: 'viewResults', icon: 'mdi-arrow-right-bold' })
    expect(PHASE_PRIMARY.failed).toMatchObject({ label: 'Retry', action: 'retry', icon: 'mdi-refresh' })
  })

  it('marks only Ready and Failed as mutating', () => {
    expect(PHASE_PRIMARY.ready.mutate).toBe(true)
    expect(PHASE_PRIMARY.failed.mutate).toBe(true)
    expect(PHASE_PRIMARY.working.mutate).toBe(false)
    expect(PHASE_PRIMARY.paused.mutate).toBe(false)
    expect(PHASE_PRIMARY.done.mutate).toBe(false)
  })
})

describe('phase predicates', () => {
  it('phaseShowsDelete: Ready/Done/Failed only (hidden while in flight)', () => {
    expect(phaseShowsDelete('ready')).toBe(true)
    expect(phaseShowsDelete('done')).toBe(true)
    expect(phaseShowsDelete('failed')).toBe(true)
    expect(phaseShowsDelete('working')).toBe(false)
    expect(phaseShowsDelete('paused')).toBe(false)
  })

  it('phaseShowsRerun: Done/Failed only', () => {
    expect(phaseShowsRerun('done')).toBe(true)
    expect(phaseShowsRerun('failed')).toBe(true)
    expect(phaseShowsRerun('ready')).toBe(false)
    expect(phaseShowsRerun('working')).toBe(false)
    expect(phaseShowsRerun('paused')).toBe(false)
  })

  it('phaseShowsBadge: Paused only', () => {
    expect(phaseShowsBadge('paused')).toBe(true)
    for (const p of ALL_PHASES.filter(x => x !== 'paused')) expect(phaseShowsBadge(p)).toBe(false)
  })
})

describe('errorReason', () => {
  const generic = 'Analysis failed. Retry, or check the logs for details.'

  it('surfaces a short metadata.error string', () => {
    expect(errorReason({ ...status('failed'), metadata: { error: 'boom' } })).toBe('boom')
  })

  it('collapses whitespace to a single line and caps the length', () => {
    const multiline = { ...status('failed'), metadata: { error: 'line one\n   line two\tend' } }
    expect(errorReason(multiline)).toBe('line one line two end')

    const long = { ...status('failed'), metadata: { error: 'x'.repeat(500) } }
    const out = errorReason(long)
    expect(out.length).toBe(160)
    expect(out.endsWith('…')).toBe(true)
  })

  it('never surfaces raw messages[] content (only metadata.error)', () => {
    // messages can carry unredacted agent/LLM output — it must not leak to the UI.
    const s = {
      ...status('failed'),
      metadata: {},
      messages: [{ content: 'internal stack trace at host db-prod-1' }] as unknown as object[],
    }
    expect(errorReason(s)).toBe(generic)
  })

  it('falls back to a generic line for empty / missing / null', () => {
    expect(errorReason(status('failed'))).toBe(generic)
    expect(errorReason(undefined)).toBe(generic)
    expect(errorReason(null)).toBe(generic)
    expect(errorReason({ ...status('failed'), metadata: { error: '   ' } })).toBe(generic)
  })
})

describe('badgePhaseOf', () => {
  it('returns null for no analyses at all', () => {
    expect(badgePhaseOf([])).toBeNull()
  })

  it('never badges the steady states (ready / done)', () => {
    expect(badgePhaseOf([status('idle'), status('idle', true)])).toBeNull()
    expect(badgePhaseOf([undefined, null])).toBeNull()
  })

  it('badges paused ahead of everything else', () => {
    // Paused is the only phase blocking on the user, so it wins even when a run
    // is live and another has failed.
    expect(badgePhaseOf([status('running'), status('failed'), status('interrupted')])).toBe('paused')
  })

  it('badges working ahead of failed', () => {
    expect(badgePhaseOf([status('failed'), status('busy')])).toBe('working')
  })

  it('badges failed when nothing is paused or running', () => {
    expect(badgePhaseOf([status('idle', true), status('error')])).toBe('failed')
  })

  it('pairs with PHASE_COLOR to give the dot the status chip’s colour', () => {
    expect(PHASE_COLOR[badgePhaseOf([status('interrupted')])!]).toBe('warning')
    expect(PHASE_COLOR[badgePhaseOf([status('running')])!]).toBe('info')
    expect(PHASE_COLOR[badgePhaseOf([status('failed')])!]).toBe('error')
  })
})

describe('badgePhaseForElement', () => {
  // Shaped the way dt-core's findAnalyses actually returns a row: `model` stays
  // the raw relationship LIST the platform sends, and the single `element` is
  // derived from its first entry. A helper that joined on `model.id` would see
  // undefined here and match nothing — which is the bug this shape exists to pin.
  const row = (elementId: string, s: string): any => ({
    id: `a-${elementId}-${s}`,
    model: [{ id: elementId, name: 'CloudShop' }],
    element: { id: elementId, name: 'CloudShop' },
    status: status(s),
  })

  it('joins on element, not on the model relationship list', () => {
    const rows = [row('m1', 'interrupted')]
    expect(badgePhaseForElement(rows, 'm1')).toBe('paused')
    // The regression guard: `model` is an array, so `model.id` is undefined and
    // any join through it would silently return null for a genuinely paused run.
    expect(rows[0].model.id).toBeUndefined()
  })

  it('ignores analyses belonging to another element', () => {
    expect(badgePhaseForElement([row('m2', 'interrupted')], 'm1')).toBeNull()
  })

  it('applies the precedence across a mixed set for one element', () => {
    const rows = [row('m1', 'failed'), row('m1', 'running'), row('m2', 'interrupted')]
    expect(badgePhaseForElement(rows, 'm1')).toBe('working')
  })

  it('returns null for a missing element id rather than matching undefined ids', () => {
    expect(badgePhaseForElement([{ id: 'x', status: status('interrupted') } as any], null)).toBeNull()
  })

  it('returns null for an empty store', () => {
    expect(badgePhaseForElement([], 'm1')).toBeNull()
  })
})
