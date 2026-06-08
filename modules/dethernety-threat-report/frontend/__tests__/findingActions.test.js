// Tests for the lifecycle×provenance action state machine (pure). Mirrors the
// dt-ui exposures tab's per-row action set, report-scoped.

import { describe, it, expect } from 'vitest'
import { actionsFor, lifecycleChipFor } from '../lib/findingActions.js'

// Compact helpers to assert the descriptor list by (key) and (event) order.
const keys = (finding) => actionsFor(finding).map((a) => a.key)
const events = (finding) => actionsFor(finding).map((a) => a.event)

describe('actionsFor', () => {
  it('USER finding → delete + issue (no affirm/dispose, no attribute edit)', () => {
    const f = { id: 'e1', name: 'Custom exposure', createdBy: 'USER', dispositionKind: null }
    expect(keys(f)).toEqual(['delete', 'issue'])
    expect(actionsFor(f)[0].accent).toBe('danger')
  })

  it('SYSTEM pending → the full 2×2: affirm, dispose, supersede, issue', () => {
    const f = { id: 'e2', name: 'SQLi', createdBy: 'SYSTEM', dispositionKind: null }
    expect(keys(f)).toEqual(['affirm', 'dispose', 'supersede', 'issue'])
    // Affirm carries the distinct accent so it reads at a glance.
    expect(actionsFor(f)[0].accent).toBe('affirm')
  })

  it('SYSTEM confirmed (AFFIRMED + attributed) → add-note, supersede, issue', () => {
    const f = { id: 'e3', name: 'XSS', createdBy: 'SYSTEM', dispositionKind: 'AFFIRMED', dispositionedBy: 'alice' }
    expect(keys(f)).toEqual(['add-note', 'supersede', 'issue'])
    // No affirm offered on an already-confirmed finding.
    expect(events(f)).not.toContain('affirm')
  })

  it('SYSTEM disposed → edit (opens the dispose dialog) + issue', () => {
    const f = { id: 'e4', name: 'Open redirect', createdBy: 'SYSTEM', dispositionKind: 'RISK_ACCEPTED' }
    expect(keys(f)).toEqual(['edit', 'issue'])
    expect(actionsFor(f)[0].event).toBe('dispose')
  })

  it('SYSTEM stale pending → a single Review that re-opens the dispose dialog', () => {
    const f = { id: 'e5', name: 'Weak cipher', createdBy: 'SYSTEM', dispositionKind: null, dispositionStale: true }
    expect(keys(f)).toEqual(['review', 'issue'])
    expect(actionsFor(f)[0].event).toBe('dispose')
    expect(actionsFor(f)[0].accent).toBe('warn')
  })

  it('SYSTEM stale confirmed → Review re-opens the affirm dialog (add-note)', () => {
    const f = { id: 'e6', name: 'Token reuse', createdBy: 'SYSTEM', dispositionKind: 'AFFIRMED', dispositionedBy: 'bob', dispositionStale: true }
    expect(keys(f)).toEqual(['review', 'issue'])
    expect(actionsFor(f)[0].event).toBe('add-note')
  })

  it('every descriptor carries a label, title and event; empty for nullish', () => {
    const f = { id: 'e7', createdBy: 'SYSTEM', dispositionKind: null }
    for (const a of actionsFor(f)) {
      expect(a.label).toBeTruthy()
      expect(a.title).toBeTruthy()
      expect(a.event).toBeTruthy()
    }
    expect(actionsFor(null)).toEqual([])
    expect(actionsFor(undefined)).toEqual([])
  })
})

describe('lifecycleChipFor', () => {
  it('AFFIRMED + attributed → a "Confirmed" chip', () => {
    const f = { dispositionKind: 'AFFIRMED', dispositionedBy: 'alice' }
    expect(lifecycleChipFor(f)?.text).toBe('Confirmed')
  })

  it('AFFIRMED with no actor (pending) → no chip (forensic guard)', () => {
    expect(lifecycleChipFor({ dispositionKind: 'AFFIRMED', dispositionedBy: null })).toBeNull()
  })

  it('USER-born confirmed (null kind) → no chip (would be noise)', () => {
    expect(lifecycleChipFor({ createdBy: 'USER', dispositionKind: null })).toBeNull()
  })

  it('a disposed finding → no chip', () => {
    expect(lifecycleChipFor({ dispositionKind: 'RISK_ACCEPTED' })).toBeNull()
  })
})
