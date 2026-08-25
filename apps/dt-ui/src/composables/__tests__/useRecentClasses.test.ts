/**
 * Unit tests for useRecentClasses — picker's local-storage recent-picks helper.
 * Mocks useAuthStore (to control user.id) and stubs `localStorage` as a global
 * since dt-ui's vitest runs in `environment: 'node'` (no `Storage` constructor).
 * Establishes the composable-test pattern for dt-ui.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'

const mockAuthStore: { user: { id: string } | undefined } = { user: { id: 'u1' } }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => mockAuthStore,
}))

import { useRecentClasses, type ClassRecord } from '../useRecentClasses'

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

const sample: ClassRecord = { classId: 'cls-1', className: 'AuthService', classCategory: 'security', moduleName: 'mod-1' }

describe('useRecentClasses — initial state', () => {
  it('starts empty when localStorage is empty for the key', async () => {
    const { recent } = useRecentClasses(ref('model-1'), ref('COMPONENT'))
    await nextTick()
    expect(recent.value).toEqual([])
  })

  it('reads existing records from localStorage on first paint', async () => {
    storage.set('recentClasses:u1:model-1:COMPONENT:_', JSON.stringify([sample]))
    const { recent } = useRecentClasses(ref('model-1'), ref('COMPONENT'))
    await nextTick()
    expect(recent.value).toEqual([sample])
  })

  it('treats malformed JSON as empty', async () => {
    storage.set('recentClasses:u1:model-1:COMPONENT:_', 'not-json-{')
    const { recent } = useRecentClasses(ref('model-1'), ref('COMPONENT'))
    await nextTick()
    expect(recent.value).toEqual([])
  })
})

describe('useRecentClasses.push', () => {
  it('prepends, dedupes by classId, and caps at 8', async () => {
    const { recent, push } = useRecentClasses(ref('model-1'), ref('COMPONENT'))
    await nextTick()
    for (let i = 1; i <= 9; i++) {
      push({ classId: `cls-${i}`, className: `Class ${i}` })
    }
    expect(recent.value.length).toBe(8)
    expect(recent.value[0].classId).toBe('cls-9')
    expect(recent.value.map(r => r.classId)).not.toContain('cls-1')

    push({ classId: 'cls-5', className: 'Class 5' })
    expect(recent.value.length).toBe(8)
    expect(recent.value[0].classId).toBe('cls-5')
    expect(recent.value.filter(r => r.classId === 'cls-5').length).toBe(1)
  })

  it('persists the next array to localStorage under the expected key', async () => {
    const { push } = useRecentClasses(ref('model-1'), ref('COMPONENT'))
    await nextTick()
    push(sample)
    expect(setItem).toHaveBeenCalledWith(
      'recentClasses:u1:model-1:COMPONENT:_',
      JSON.stringify([sample]),
    )
  })
})

describe('useRecentClasses.clear', () => {
  it('removes the storage entry and empties recent', async () => {
    storage.set('recentClasses:u1:model-1:COMPONENT:_', JSON.stringify([sample]))
    const { recent, clear } = useRecentClasses(ref('model-1'), ref('COMPONENT'))
    await nextTick()
    expect(recent.value).toEqual([sample])
    clear()
    expect(recent.value).toEqual([])
    expect(removeItem).toHaveBeenCalledWith('recentClasses:u1:model-1:COMPONENT:_')
  })
})

describe('useRecentClasses — defer-until-defined guard', () => {
  it('does not read/write localStorage when modelId is undefined', async () => {
    const modelId = ref<string | undefined>(undefined)
    const { recent, push, clear } = useRecentClasses(modelId, ref('COMPONENT'))
    await nextTick()

    expect(recent.value).toEqual([])
    push(sample)
    expect(setItem).not.toHaveBeenCalled()
    expect(recent.value).toEqual([])
    clear()
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('starts reading once modelId becomes defined', async () => {
    storage.set('recentClasses:u1:model-2:COMPONENT:_', JSON.stringify([sample]))
    const modelId = ref<string | undefined>(undefined)
    const { recent } = useRecentClasses(modelId, ref('COMPONENT'))
    await nextTick()
    expect(recent.value).toEqual([])

    modelId.value = 'model-2'
    await nextTick()
    expect(recent.value).toEqual([sample])
  })
})

describe('useRecentClasses — userId fallback', () => {
  it('uses "anonymous" when authStore.user is undefined', async () => {
    mockAuthStore.user = undefined
    const { push } = useRecentClasses(ref('model-1'), ref('COMPONENT'))
    await nextTick()
    push(sample)
    expect(setItem).toHaveBeenCalledWith(
      'recentClasses:anonymous:model-1:COMPONENT:_',
      expect.any(String),
    )
  })
})

describe('useRecentClasses — componentType bucketing', () => {
  it('keeps PROCESS and STORE recents in separate buckets', () => {
    const processPick: ClassRecord = { classId: 'c-proc', className: 'API Service' }
    storage.set('recentClasses:u1:model-1:COMPONENT:PROCESS', JSON.stringify([processPick]))

    const { recent: asProcess } = useRecentClasses(ref('model-1'), ref('COMPONENT'), ref('PROCESS'))
    expect(asProcess.value).toEqual([processPick])

    // A STORE element must not be offered the PROCESS pick — its own bucket is empty.
    const { recent: asStore } = useRecentClasses(ref('model-1'), ref('COMPONENT'), ref('STORE'))
    expect(asStore.value).toEqual([])
  })

  it('writes into the bucket for the element type in play', () => {
    const { push } = useRecentClasses(ref('model-1'), ref('COMPONENT'), ref('EXTERNAL_ENTITY'))
    push({ classId: 'c-ext', className: 'Third-party API' })

    expect(setItem).toHaveBeenCalledWith(
      'recentClasses:u1:model-1:COMPONENT:EXTERNAL_ENTITY',
      expect.any(String),
    )
  })

  it('falls back to the type-less bucket for labels that have no component type', () => {
    const { push } = useRecentClasses(ref('model-1'), ref('SECURITY_BOUNDARY'))
    push({ classId: 'c-b', className: 'DMZ' })

    expect(setItem).toHaveBeenCalledWith(
      'recentClasses:u1:model-1:SECURITY_BOUNDARY:_',
      expect.any(String),
    )
  })

  it('re-reads when the element type changes under the same model', async () => {
    const type = ref<string>('PROCESS')
    storage.set('recentClasses:u1:model-1:COMPONENT:PROCESS', JSON.stringify([{ classId: 'p', className: 'P' }]))
    storage.set('recentClasses:u1:model-1:COMPONENT:STORE', JSON.stringify([{ classId: 's', className: 'S' }]))

    const { recent } = useRecentClasses(ref('model-1'), ref('COMPONENT'), type)
    await nextTick()
    expect(recent.value.map(r => r.classId)).toEqual(['p'])

    // Selecting a different element in the settings panel swaps the type in place.
    type.value = 'STORE'
    await nextTick()
    expect(recent.value.map(r => r.classId)).toEqual(['s'])
  })
})
