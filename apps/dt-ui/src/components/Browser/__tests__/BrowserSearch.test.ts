// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { ContentIndex, Folder } from '@dethernety/dt-core'
import BrowserSearch from '../BrowserSearch.vue'

// Focusing the field fetches the index and the folders; typing lists the matches while the field has the focus; the
// arrow keys move through the list, Enter or a click opens, Alt+Enter or the row's folder icon shows it in its folder;
// Esc clears the query first. A narrow window shows a magnifier that opens the field. Matching and ranking are tested
// in utils/__tests__/browserSearch.test.ts.

const fetchContentIndex = vi.fn<() => Promise<ContentIndex | null>>()
const fetchFolders = vi.fn(async () => {})
const folders: Folder[] = [{ id: 'pay', name: 'Payments' }]
vi.mock('@/stores/folderStore', () => ({ useFolderStore: () => ({ fetchContentIndex, fetchFolders, folders }) }))

const index: ContentIndex = {
  models: [{ id: 'm1', name: 'Shop', folderId: 'pay' }, { id: 'm2', name: 'Web shop' }],
  controls: [{ id: 'c1', name: 'Shop WAF', folderId: 'pay' }],
}

const fieldFocus = vi.fn()
const FieldStub = {
  name: 'VTextField',
  props: ['modelValue'],
  emits: ['update:modelValue', 'update:focused'],
  setup(_: unknown, { expose }: { expose: (api: Record<string, unknown>) => void }) {
    expose({ focus: fieldFocus })
  },
  template: `<div class="field"><input class="field-input" :value="modelValue"
    @input="$emit('update:modelValue', $event.target.value)"
    @focus="$emit('update:focused', true)" @blur="$emit('update:focused', false)" /></div>`,
}
const ItemStub = {
  props: ['title', 'active'],
  emits: ['click', 'mousedown', 'mouseenter'],
  template: `<div class="option" :data-active="active" @click="$emit('click')" @mouseenter="$emit('mouseenter')">
    {{ title }}|<slot name="subtitle" /><slot name="append" /></div>`,
}
const stubs = {
  'v-text-field': FieldStub,
  'v-btn': { emits: ['click'], template: '<button class="magnifier" @click="$emit(\'click\')" />' },
  'v-sheet': { template: '<div class="sheet"><slot /></div>' },
  'v-list': { template: '<div class="list"><slot /></div>' },
  'v-list-item': ItemStub,
  'v-icon': { emits: ['click'], template: '<i class="icon" @click="$emit(\'click\', $event)" />' },
}

const mountSearch = (compact = false) =>
  mount(BrowserSearch, { props: { compact }, global: { stubs, directives: { tooltip: {} } } })
type Wrapper = ReturnType<typeof mountSearch>

const focus = async (w: Wrapper) => {
  await w.find('.field-input').trigger('focus')
  await flushPromises()
}
const type = async (w: Wrapper, text: string) => {
  await focus(w)
  await w.find('.field-input').setValue(text)
}
const key = (w: Wrapper, k: string, init: Record<string, unknown> = {}) =>
  w.find('.field-input').trigger('keydown', { key: k, ...init })
const options = (w: Wrapper) => w.findAll('.option')
const emitted = (w: Wrapper, name: 'open' | 'show') => (w.emitted(name) ?? []).map(([r]) => (r as { id: string }).id)

beforeEach(() => {
  fetchContentIndex.mockReset()
  fetchFolders.mockClear()
  fieldFocus.mockReset()
  fetchContentIndex.mockResolvedValue(index)
})

describe('BrowserSearch', () => {
  it('fetches the index, and the folders for their paths, each time the field gains the focus', async () => {
    const w = mountSearch()
    expect(fetchContentIndex).not.toHaveBeenCalled()
    await focus(w)
    await w.find('.field-input').trigger('blur')
    await focus(w)
    expect(fetchContentIndex).toHaveBeenCalledTimes(2)
    expect(fetchFolders).toHaveBeenCalledTimes(2)
    expect(fetchFolders).toHaveBeenCalledWith({ quiet: true })
  })

  it('keeps the field when the window narrows while it is in use, so the list cannot outlive it', async () => {
    const w = mountSearch()
    await type(w, 'shop')
    await w.setProps({ compact: true })
    expect(w.find('.field').exists()).toBe(true)
    expect(w.find('.magnifier').exists()).toBe(false)
  })

  it('folds into the magnifier when the window narrows while it is not in use', async () => {
    const w = mountSearch()
    await w.setProps({ compact: true })
    expect(w.find('.field').exists()).toBe(false)
    expect(w.find('.magnifier').exists()).toBe(true)
  })

  it('lists models and controls from every folder, with their kind and path, only while focused with a query', async () => {
    const w = mountSearch()
    await focus(w)
    expect(w.find('.sheet').exists()).toBe(false)
    await w.find('.field-input').setValue('shop')
    expect(options(w).map(o => o.text())).toEqual([
      expect.stringContaining('Shop|Home / PaymentsModel'),
      expect.stringContaining('Shop WAF|Home / PaymentsControl'),
      expect.stringContaining('Web shop|HomeModel'),
    ])
    await w.find('.field-input').trigger('blur')
    expect(w.find('.sheet').exists()).toBe(false)
  })

  it('says so when nothing matches, and when the index could not be fetched', async () => {
    const w = mountSearch()
    await type(w, 'zzz')
    expect(w.find('.sheet').text()).toBe('No matches')

    fetchContentIndex.mockResolvedValue(null)
    const failed = mountSearch()
    await type(failed, 'shop')
    expect(failed.find('.sheet').text()).toContain('unavailable')
  })

  it('keeps the last index when a later fetch fails', async () => {
    const w = mountSearch()
    await focus(w)
    await w.find('.field-input').trigger('blur')
    fetchContentIndex.mockResolvedValue(null)
    await type(w, 'shop')
    expect(options(w)).toHaveLength(3)
  })

  it('ignores an earlier fetch that answers after a later one', async () => {
    let answerFirst: (v: ContentIndex) => void = () => {}
    fetchContentIndex.mockImplementationOnce(() => new Promise(resolve => { answerFirst = resolve }))
    const w = mountSearch()
    await focus(w)
    await w.find('.field-input').trigger('blur')
    fetchContentIndex.mockResolvedValueOnce({ models: [{ id: 'new', name: 'Shop two' }], controls: [] })
    await type(w, 'shop')
    answerFirst(index)
    await flushPromises()
    expect(options(w).map(o => o.text())).toEqual([expect.stringContaining('Shop two')])
  })

  it('moves through the list with the arrow keys, wrapping both ways, and Enter opens the active result', async () => {
    const w = mountSearch()
    await type(w, 'shop')
    await key(w, 'ArrowDown')
    await key(w, 'Enter')
    // Three results: down twice more wraps to the first, up from the first wraps to the last.
    await key(w, 'ArrowDown')
    await key(w, 'ArrowDown')
    await key(w, 'ArrowUp')
    await key(w, 'Enter')
    expect(emitted(w, 'open')).toEqual(['c1', 'm2'])
  })

  it('Alt+Enter and the folder icon show a result in its folder; a click opens it', async () => {
    const w = mountSearch()
    await type(w, 'shop')
    await key(w, 'Enter', { altKey: true })
    await options(w)[2].find('.icon:last-child').trigger('click')
    await options(w)[1].trigger('click')
    expect(emitted(w, 'show')).toEqual(['m1', 'm2'])
    expect(emitted(w, 'open')).toEqual(['c1'])
  })

  it('showing a result in its folder leaves the field, so the list folds away, and keeps the query', async () => {
    // In the document and really focused, so that leaving the field fires its blur.
    const w = mount(BrowserSearch, {
      props: {},
      attachTo: document.body,
      global: { stubs, directives: { tooltip: {} } },
    })
    const input = w.find('.field-input').element as HTMLInputElement
    input.focus()
    await flushPromises()
    await w.find('.field-input').setValue('shop')
    expect(w.find('.sheet').exists()).toBe(true)
    await key(w, 'Enter', { altKey: true })
    expect(emitted(w, 'show')).toEqual(['m1'])
    expect(w.find('.sheet').exists()).toBe(false)
    expect(input.value).toBe('shop')
    w.unmount()
  })

  it('the field\'s clear button empties the query (it sets null, which the search takes as no text)', async () => {
    const w = mountSearch()
    await type(w, 'shop')
    w.findComponent({ name: 'VTextField' }).vm.$emit('update:modelValue', null)
    await flushPromises()
    expect((w.find('.field-input').element as HTMLInputElement).value).toBe('')
    expect(w.find('.sheet').exists()).toBe(false)
  })

  it('Esc clears the query first', async () => {
    const w = mountSearch()
    await type(w, 'shop')
    await key(w, 'Escape')
    expect((w.find('.field-input').element as HTMLInputElement).value).toBe('')
    expect(w.find('.sheet').exists()).toBe(false)
  })

  it('in a narrow window shows a magnifier that opens the field, which folds back when left empty', async () => {
    const w = mountSearch(true)
    expect(w.find('.field').exists()).toBe(false)
    await w.find('.magnifier').trigger('click')
    expect(w.find('.field').exists()).toBe(true)
    expect(fieldFocus).toHaveBeenCalled()
    await focus(w)
    await w.find('.field-input').trigger('blur')
    expect(w.find('.field').exists()).toBe(false)
    expect(w.find('.magnifier').exists()).toBe(true)
  })

  it('in a narrow window keeps the field open when it is left with a query', async () => {
    const w = mountSearch(true)
    await w.find('.magnifier').trigger('click')
    await type(w, 'shop')
    await w.find('.field-input').trigger('blur')
    expect(w.find('.field').exists()).toBe(true)
  })
})
