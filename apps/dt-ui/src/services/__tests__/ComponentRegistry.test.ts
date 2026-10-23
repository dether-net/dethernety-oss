import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed } from 'vue'
import { ComponentRegistry } from '../ComponentRegistry'

describe('ComponentRegistry', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('re-runs computed lookups when a key is registered later, and when it goes', () => {
    const registry = new ComponentRegistry()
    const found = computed(() => registry.get('late_view'))
    const has = computed(() => registry.hasComponent('late_view'))
    const all = computed(() => registry.getAvailableComponents())
    expect([found.value, has.value, all.value]).toEqual([undefined, false, []])
    registry.register('late_view', { name: 'late' }, 'late-module')
    expect([found.value, has.value, all.value]).toEqual([{ name: 'late' }, true, ['late_view']])
    registry.unregisterModule('late-module')
    expect([found.value, has.value, all.value]).toEqual([undefined, false, []])
  })

  it('keeps a computed over one key stable when another key is registered', () => {
    const registry = new ComponentRegistry()
    const component = { name: 'a' }
    registry.register('a_view', component)
    let runs = 0
    const found = computed(() => registry.get('a_view'))
    const derived = computed(() => {
      runs++
      return found.value
    })
    expect(derived.value).toBe(component)
    registry.register('b_view', { name: 'b' })
    expect(derived.value).toBe(component)
    expect(runs).toBe(1)
  })

  it('gives a scoped view that registers and unregisters only owned keys and exposes no state', () => {
    const registry = new ComponentRegistry()
    registry.register('theirs_view', { name: 'theirs' }, 'theirs')
    const refused = vi.fn()
    const scoped = registry.scoped(key => key.startsWith('mine_'), refused)
    scoped.register('mine_view', { name: 'mine' }, 'mine')
    scoped.register('theirs_view', { name: 'hijack' }, 'mine')
    scoped.unregister('theirs_view')
    scoped.unregisterModule('theirs')
    expect(registry.get('theirs_view')).toEqual({ name: 'theirs' })
    expect(registry.get('mine_view')).toEqual({ name: 'mine' })
    expect(refused.mock.calls.map(c => c[0])).toEqual(['theirs_view', 'theirs_view'])
    expect(Object.keys(scoped)).not.toContain('components')
    expect(Object.getPrototypeOf(scoped)).toBe(Object.prototype)
  })
})
