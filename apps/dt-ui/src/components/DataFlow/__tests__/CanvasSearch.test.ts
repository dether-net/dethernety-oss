// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { Edge, Node } from '@vue-flow/core'
import CanvasSearch from '../CanvasSearch.vue'
import type { CanvasSearchResult } from '@/utils/flowSearch'

// Typing searches the canvas and reports every match (the editor lights them); the list shows while the field has the
// focus, and the query outlives the focus; the arrow keys move through the list and Enter or a click picks; Esc and
// the close icon close without picking; however the search closes or opens, it starts again empty. Matching and its
// ranking are tested in utils/__tests__/flowSearch.test.ts.

const node = (id: string, type: string, label: string): Node => ({ id, type, position: { x: 0, y: 0 }, data: { label } })
const nodes = [node('web', 'PROCESS', 'Web server'), node('db', 'STORE', 'Web cache'), node('dmz', 'BOUNDARY', 'DMZ')]
const edges: Edge[] = [{ id: 'f1', source: 'web', target: 'db', label: 'Cache write' }]

const fieldFocus = vi.fn()
// The text field as far as the search uses it: the query, the focus state, the close icon's slot and focus().
const FieldStub = {
  name: 'VTextField',
  props: ['modelValue'],
  emits: ['update:modelValue', 'update:focused'],
  setup(_: unknown, { expose }: { expose: (api: Record<string, unknown>) => void }) {
    expose({ focus: fieldFocus })
  },
  template: `<div class="field">
    <input class="field-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)"
      @focus="$emit('update:focused', true)" @blur="$emit('update:focused', false)" />
    <slot name="append-inner" />
  </div>`,
}
const ItemStub = {
  props: ['title', 'subtitle', 'active'],
  emits: ['click', 'mousedown', 'mouseenter'],
  template: '<div class="option" :data-active="active" @click="$emit(\'click\')" @mouseenter="$emit(\'mouseenter\')">{{ title }}<slot name="append" /></div>',
}
const stubs = {
  'v-text-field': FieldStub,
  'v-sheet': { template: '<div class="sheet"><slot /></div>' },
  'v-list': { template: '<div class="list"><slot /></div>' },
  'v-list-item': ItemStub,
  'v-icon': { emits: ['click'], template: '<i @click="$emit(\'click\', $event)" />' },
}

const open = (props: Partial<{ modelValue: boolean, nodes: Node[], edges: Edge[] }> = {}) =>
  mount(CanvasSearch, { props: { modelValue: true, nodes, edges, rootLabel: 'Root', ...props }, global: { stubs } })
type Wrapper = ReturnType<typeof open>

const lastMatches = (w: Wrapper) => w.emitted('matches')?.at(-1)?.[0] as CanvasSearchResult[] | null
const matchedIds = (w: Wrapper) => (lastMatches(w) ?? []).map(m => m.id).sort()
const type = async (w: Wrapper, text: string) => {
  await w.find('.field-input').trigger('focus')
  await w.find('.field-input').setValue(text)
}
const key = (w: Wrapper, k: string) => w.find('.field-input').trigger('keydown', { key: k })
const options = (w: Wrapper) => w.findAll('.option')

describe('CanvasSearch', () => {
  it('renders nothing while closed, and reports no matches', () => {
    const w = open({ modelValue: false })
    expect(w.find('.canvas-search').exists()).toBe(false)
    expect(lastMatches(w)).toBeNull()
  })

  it('reports no matches and shows no list until something is typed', async () => {
    const w = open()
    await w.find('.field-input').trigger('focus')
    expect(lastMatches(w)).toBeNull()
    expect(w.find('.sheet').exists()).toBe(false)
  })

  it('reports every match as the query changes, and lists them', async () => {
    const w = open()
    await type(w, 'web')
    expect(matchedIds(w)).toEqual(['db', 'web'])
    expect(options(w)).toHaveLength(2)
    await w.find('.field-input').setValue('cache')
    expect(matchedIds(w)).toEqual(['db', 'f1'])
  })

  it('labels each result with the editor\'s own type names', async () => {
    const w = open()
    await type(w, 'e')
    const text = w.find('.list').text()
    for (const label of ['Process', 'Store', 'Data Flow']) expect(text).toContain(label)
  })

  it('leaves the list\'s keys alone while the list is hidden, and on the close icon', async () => {
    const w = open()
    await type(w, 'web')
    await w.find('.field-input').trigger('blur')
    await key(w, 'Enter')
    await key(w, 'ArrowDown')
    expect(w.emitted('pick')).toBeUndefined()
    await w.find('.canvas-search-close').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pick')).toBeUndefined()
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('closes from the close icon with Space too', async () => {
    const w = open()
    await type(w, 'web')
    await w.find('.canvas-search-close').trigger('keydown', { key: ' ' })
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('leaves keys to an input method while it composes', async () => {
    const w = open()
    await type(w, 'web')
    await w.find('.field-input').trigger('keydown', { key: 'Enter', isComposing: true })
    await w.find('.field-input').trigger('keydown', { key: 'Escape', keyCode: 229 })
    expect(w.emitted('pick')).toBeUndefined()
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('keeps the active result a listed one when the canvas changes under the query', async () => {
    const w = open()
    await type(w, 'web')
    await key(w, 'ArrowDown')
    await w.setProps({ nodes: nodes.filter(n => n.id !== 'db') })
    expect(options(w)).toHaveLength(1)
    expect(options(w)[0].attributes('data-active')).toBe('true')
    await key(w, 'Enter')
    expect(w.emitted('pick')?.[0]?.[0]).toMatchObject({ id: 'web' })
  })

  it('says so for a query with no matches, and reports an empty list so nothing dims', async () => {
    const w = open()
    await type(w, 'nothing like it')
    expect(lastMatches(w)).toEqual([])
    expect(w.find('.canvas-search-empty').text()).toBe('No matches')
  })

  it('keeps the query and the matches when the field loses the focus, hiding only the list', async () => {
    const w = open()
    await type(w, 'web')
    await w.find('.field-input').trigger('blur')
    expect(w.find('.sheet').exists()).toBe(false)
    expect(matchedIds(w)).toEqual(['db', 'web'])
    await w.find('.field-input').trigger('focus')
    expect(options(w)).toHaveLength(2)
  })

  it('lists at most 50 results, and reports them all', async () => {
    const many = Array.from({ length: 70 }, (_, i) => node(`n${i}`, 'PROCESS', `Worker ${i}`))
    const w = open({ nodes: many, edges: [] })
    await type(w, 'worker')
    expect(options(w)).toHaveLength(50)
    expect(lastMatches(w)).toHaveLength(70)
  })

  it('moves through the list with the arrow keys, wrapping, and picks the active result with Enter', async () => {
    const w = open()
    await type(w, 'web')
    const listed = lastMatches(w) ?? []
    expect(options(w)[0].attributes('data-active')).toBe('true')
    await key(w, 'ArrowDown')
    expect(options(w)[1].attributes('data-active')).toBe('true')
    await key(w, 'ArrowDown')
    expect(options(w)[0].attributes('data-active')).toBe('true')
    await key(w, 'ArrowUp')
    await key(w, 'Enter')
    expect(w.emitted('pick')?.[0]).toEqual([listed[1]])
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('starts each new query on its first result', async () => {
    const w = open()
    await type(w, 'web')
    await key(w, 'ArrowDown')
    await w.find('.field-input').setValue('we')
    expect(options(w)[0].attributes('data-active')).toBe('true')
  })

  it('picks a clicked result', async () => {
    const w = open()
    await type(w, 'dmz')
    await options(w)[0].trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toMatchObject({ id: 'dmz' })
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('ignores Enter with nothing listed', async () => {
    const w = open()
    await type(w, 'nothing like it')
    await key(w, 'Enter')
    expect(w.emitted('pick')).toBeUndefined()
  })

  it('closes on Esc without picking, and stops the key there', async () => {
    const w = open()
    await type(w, 'web')
    let reachedWindow = false
    const onWindow = () => { reachedWindow = true }
    window.addEventListener('keydown', onWindow)
    w.find('.field-input').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    window.removeEventListener('keydown', onWindow)
    await nextTick()
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
    expect(w.emitted('pick')).toBeUndefined()
    expect(reachedWindow).toBe(false)
  })

  it('closes from the close icon', async () => {
    const w = open()
    await type(w, 'web')
    await w.find('.canvas-search-close').trigger('click')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('starts again empty however it was closed, a pick or the editor closing it included', async () => {
    const w = open()
    await type(w, 'web')
    await w.setProps({ modelValue: false })
    expect(lastMatches(w)).toBeNull()
    await w.setProps({ modelValue: true })
    expect(lastMatches(w)).toBeNull()
    expect((w.find('.field-input').element as HTMLInputElement).value).toBe('')
  })

  it('puts the cursor in the field when asked', async () => {
    fieldFocus.mockClear()
    const w = open()
    ;(w.vm as unknown as { focus: () => void }).focus()
    await nextTick()
    expect(fieldFocus).toHaveBeenCalled()
  })
})
