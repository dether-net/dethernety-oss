// @vitest-environment happy-dom
/**
 * The shared test setup drops one class of Vue warning — the harness's "Failed to resolve
 * component" — and nothing else. Both halves are pinned: a filter that swallowed every warning
 * would make the first assertion pass just as well, and hide real defects with it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, resolveComponent } from 'vue'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the shared test setup', () => {
  it('drops the warning for a component the test harness does not register', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(defineComponent({ render: () => h(resolveComponent('v-card')) }))
    expect(warn).not.toHaveBeenCalled()
  })

  it('still prints every other Vue warning, as Vue formats it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A prop of the wrong type is a real defect, and its warning must reach the console.
    const Child = defineComponent({ props: { count: { type: Number } }, render: () => h('div') })
    // Cast past the type check on purpose: the wrong type is the point, and only the runtime warns.
    mount(defineComponent({ render: () => h(Child, { count: 'not a number' as unknown as number }) }))
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[Vue warn\]: Invalid prop/)
  })
})
