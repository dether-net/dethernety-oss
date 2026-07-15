// @vitest-environment happy-dom
// (the store transitively imports authStore, which reads sessionStorage at load)

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDispositionDialogStore } from '../dispositionDialogStore'
import type { DispositionableFinding } from '@/composables/useFindingDisposition'

const finding: DispositionableFinding = { id: 'e1', name: 'Open bucket', dispositionKind: null }

describe('dispositionDialogStore.open', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('default (dispose) mode → lockKind false, kind from finding, EXPOSURE default', () => {
    const store = useDispositionDialogStore()
    store.open({ finding })
    expect(store.state.show).toBe(true)
    expect(store.state.lockKind).toBe(false)
    expect(store.state.initialKind).toBeNull()
    expect(store.findingType).toBe('EXPOSURE')
  })

  it('affirm mode → lockKind true, initialKind AFFIRMED, honours findingType', () => {
    const store = useDispositionDialogStore()
    store.open({ finding, findingType: 'COUNTERMEASURE', mode: 'affirm' })
    expect(store.state.show).toBe(true)
    expect(store.state.lockKind).toBe(true)
    expect(store.state.initialKind).toBe('AFFIRMED')
    expect(store.findingType).toBe('COUNTERMEASURE')
  })

  it('prefillReason seeds the editable reason when the finding has none (dispose mode)', () => {
    const store = useDispositionDialogStore()
    store.open({ finding, prefillReason: 'Suggested note' })
    expect(store.state.initialReason).toBe('Suggested note')
  })

  it('prefillReason is appended after a blank line when a reason already exists (affirm mode)', () => {
    const store = useDispositionDialogStore()
    const withReason: DispositionableFinding = { ...finding, dispositionReason: 'Author wrote this' }
    store.open({ finding: withReason, mode: 'affirm', prefillReason: 'Suggested note' })
    expect(store.state.initialReason).toBe('Author wrote this\n\nSuggested note')
  })

  it('absent prefillReason → initialReason is exactly the finding reason (no behavior change)', () => {
    const store = useDispositionDialogStore()
    const withReason: DispositionableFinding = { ...finding, dispositionReason: 'Author wrote this' }
    store.open({ finding: withReason })
    expect(store.state.initialReason).toBe('Author wrote this')
  })
})
