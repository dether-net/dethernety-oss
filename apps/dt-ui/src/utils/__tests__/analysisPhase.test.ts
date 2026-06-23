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
