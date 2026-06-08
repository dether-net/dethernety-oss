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
})
