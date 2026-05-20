/**
 * useRecentTechniques unit tests.
 *
 * Mirrors useRecentClasses.test.ts harness verbatim. Storage key shape, MRU
 * dedup, defer-until-defined guard, and userId fallback are all covered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'

const mockAuthStore: { user: { id: string } | undefined } = { user: { id: 'u1' } }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => mockAuthStore,
}))

import { useRecentTechniques, type TechniqueRecord } from '../useRecentTechniques'

const storage = new Map<string, string>()
const getItem = vi.fn((key: string) => storage.get(key) ?? null)
const setItem = vi.fn((key: string, value: string) => { storage.set(key, value) })
const removeItem = vi.fn((key: string) => { storage.delete(key) })

beforeEach(() => {
  storage.clear()
  getItem.mockClear()
  setItem.mockClear()
  removeItem.mockClear()
  mockAuthStore.user = { id: 'u1' }
  vi.stubGlobal('localStorage', { getItem, setItem, removeItem })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const sample: TechniqueRecord = {
  mitreId: 'T1003',
  name: 'OS Credential Dumping',
  tactic: 'Credential Access',
  kind: 'ATTACK_TECHNIQUE',
}

describe('useRecentTechniques — initial state', () => {
  it('starts empty when localStorage is empty', async () => {
    const { recent } = useRecentTechniques(ref('model-1'), ref('ATTACK_TECHNIQUE'))
    await nextTick()
    expect(recent.value).toEqual([])
  })

  it('reads existing records on first paint', async () => {
    storage.set('recentTechniques:u1:model-1:ATTACK_TECHNIQUE', JSON.stringify([sample]))
    const { recent } = useRecentTechniques(ref('model-1'), ref('ATTACK_TECHNIQUE'))
    await nextTick()
    expect(recent.value).toEqual([sample])
  })

  it('treats malformed JSON as empty', async () => {
    storage.set('recentTechniques:u1:model-1:ATTACK_TECHNIQUE', '{broken')
    const { recent } = useRecentTechniques(ref('model-1'), ref('ATTACK_TECHNIQUE'))
    await nextTick()
    expect(recent.value).toEqual([])
  })
})

describe('useRecentTechniques.push', () => {
  it('prepends, dedupes by mitreId, and caps at 8', async () => {
    const { recent, push } = useRecentTechniques(ref('model-1'), ref('ATTACK_TECHNIQUE'))
    await nextTick()
    for (let i = 1; i <= 9; i++) {
      push({ mitreId: `T${1000 + i}`, name: `Technique ${i}`, kind: 'ATTACK_TECHNIQUE' })
    }
    expect(recent.value.length).toBe(8)
    expect(recent.value[0].mitreId).toBe('T1009')
    expect(recent.value.map(r => r.mitreId)).not.toContain('T1001')

    push({ mitreId: 'T1005', name: 'Technique 5', kind: 'ATTACK_TECHNIQUE' })
    expect(recent.value.length).toBe(8)
    expect(recent.value[0].mitreId).toBe('T1005')
    expect(recent.value.filter(r => r.mitreId === 'T1005').length).toBe(1)
  })

  it('persists with the expected storage-key format', async () => {
    const { push } = useRecentTechniques(ref('model-1'), ref('ATTACK_TECHNIQUE'))
    await nextTick()
    push(sample)
    expect(setItem).toHaveBeenCalledWith(
      'recentTechniques:u1:model-1:ATTACK_TECHNIQUE',
      JSON.stringify([sample]),
    )
  })

  it('scopes by kind — same modelId, different kind, separate buckets', async () => {
    const { push } = useRecentTechniques(ref('model-1'), ref('DEFEND_TECHNIQUE'))
    await nextTick()
    push({ mitreId: 'D3-PMAD', name: 'PMAD', kind: 'DEFEND_TECHNIQUE' })
    expect(setItem).toHaveBeenCalledWith(
      'recentTechniques:u1:model-1:DEFEND_TECHNIQUE',
      expect.any(String),
    )
  })
})

describe('useRecentTechniques.clear', () => {
  it('removes the storage entry and empties recent', async () => {
    storage.set('recentTechniques:u1:model-1:ATTACK_TECHNIQUE', JSON.stringify([sample]))
    const { recent, clear } = useRecentTechniques(ref('model-1'), ref('ATTACK_TECHNIQUE'))
    await nextTick()
    expect(recent.value).toEqual([sample])
    clear()
    expect(recent.value).toEqual([])
    expect(removeItem).toHaveBeenCalledWith('recentTechniques:u1:model-1:ATTACK_TECHNIQUE')
  })
})

describe('useRecentTechniques — defer-until-defined guard', () => {
  it('does not read/write localStorage when modelId is undefined', async () => {
    const modelId = ref<string | undefined>(undefined)
    const { recent, push, clear } = useRecentTechniques(modelId, ref('ATTACK_TECHNIQUE'))
    await nextTick()

    expect(recent.value).toEqual([])
    push(sample)
    expect(setItem).not.toHaveBeenCalled()
    expect(recent.value).toEqual([])
    clear()
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('starts reading once modelId becomes defined', async () => {
    storage.set('recentTechniques:u1:model-2:ATTACK_TECHNIQUE', JSON.stringify([sample]))
    const modelId = ref<string | undefined>(undefined)
    const { recent } = useRecentTechniques(modelId, ref('ATTACK_TECHNIQUE'))
    await nextTick()
    expect(recent.value).toEqual([])

    modelId.value = 'model-2'
    await nextTick()
    expect(recent.value).toEqual([sample])
  })
})

describe('useRecentTechniques — userId fallback', () => {
  it('uses "anonymous" when authStore.user is undefined', async () => {
    mockAuthStore.user = undefined
    const { push } = useRecentTechniques(ref('model-1'), ref('ATTACK_TECHNIQUE'))
    await nextTick()
    push(sample)
    expect(setItem).toHaveBeenCalledWith(
      'recentTechniques:anonymous:model-1:ATTACK_TECHNIQUE',
      expect.any(String),
    )
  })
})
