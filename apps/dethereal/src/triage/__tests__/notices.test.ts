/**
 * The knowledge-graph texts triage shows, byte for byte: a change to any of them needs the operator's approval.
 */
import { describe, it, expect } from 'vitest'
import { registerSecret } from '../../auth/redact.js'
import { KG_ABSENT_MARKER, KG_LOSS_NOTICE, KG_NO_DATA_NOTICE, KG_NOT_AVAILABLE_NOTICE, kgProbeFailureNotice } from '../notices.js'

describe('the knowledge-graph notices', () => {
  it('pins the not-available notice', () => {
    expect(KG_NOT_AVAILABLE_NOTICE).toBe(
      "Knowledge graph: not available here. Triage works from the platform's findings and the source files only, so its proposals are less precise, with no cross-examination and no remediation task list. The Dethernety knowledge graph, part of the subscription, adds the reasoning chains behind each finding.",
    )
  })

  it('pins the no-data notice', () => {
    expect(KG_NO_DATA_NOTICE).toBe("Knowledge graph: installed, but it holds no data yet. This run works from the platform's findings and the source files only.")
  })

  it('pins the loss notice', () => {
    expect(KG_LOSS_NOTICE).toBe("Knowledge graph: it stopped answering during this run; the rest of the run works from the platform's findings and the source files only.")
  })

  it('pins the marker', () => {
    expect(KG_ABSENT_MARKER).toBe('[no knowledge-graph evidence]')
  })

  it('pins the probe-failure line', () => {
    expect(kgProbeFailureNotice('the platform did not answer within 10 s')).toBe(
      'Knowledge graph: its status could not be checked, so this run does not use it. Cause: the platform did not answer within 10 s.',
    )
  })
})

describe('the probe-failure cause', () => {
  it('is put on one line, without its own full stop', () => {
    expect(kgProbeFailureNotice('first line\n  second line...')).toBe('Knowledge graph: its status could not be checked, so this run does not use it. Cause: first line second line.')
  })

  it('is cut to 300 characters', () => {
    const notice = kgProbeFailureNotice('c'.repeat(500))
    const cause = notice.slice(notice.indexOf('Cause: ') + 'Cause: '.length, -1)
    expect(cause).toHaveLength(300)
    expect(cause.endsWith('…')).toBe(true)
  })

  it('has every session secret redacted', () => {
    const secret = 'session-secret-value-0123456789abcdef'
    registerSecret(secret)
    expect(kgProbeFailureNotice(`request failed with ${secret}`)).not.toContain(secret)
  })

  it('says unknown when there is none', () => {
    expect(kgProbeFailureNotice('  ')).toBe('Knowledge graph: its status could not be checked, so this run does not use it. Cause: unknown.')
  })
})
