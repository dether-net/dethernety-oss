import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StatusHero from '@/components/StatusHero.vue'
import type { StateView } from '@/api'

function stateWith(failures: StateView['failures']): StateView {
  return {
    initRan: true,
    tag: 'v0.5.0',
    modules: {
      status: 'ok',
      expected: [
        { name: 'a', version: '1', outcome: 'placed' },
        { name: 'b', version: '1', outcome: 'skipped' },
      ],
    },
    ingest: { status: 'ok', statements: 26262 },
    failures,
  }
}

describe('StatusHero', () => {
  it('reads healthy with no failures, and shows the metrics', () => {
    const w = mount(StatusHero, { props: { state: stateWith([]) } })
    expect(w.attributes('data-verdict')).toBe('healthy')
    expect(w.text()).toContain('Healthy')
    expect(w.text()).toContain('2/2 placed') // both placed+skipped count as placed
    expect(w.text()).toContain('26,262 statements')
    w.unmount()
  })

  it('reads degraded when only non-severe failures are present', () => {
    const w = mount(StatusHero, { props: { state: stateWith([{ kind: 'init-not-run', message: 'x' }]) } })
    expect(w.attributes('data-verdict')).toBe('degraded')
    expect(w.text()).toContain('Degraded')
    w.unmount()
  })

  it('reads fault when a severe failure is present', () => {
    const w = mount(StatusHero, {
      props: { state: stateWith([{ kind: 'fewer-modules-registered', message: 'x', modules: ['b'] }]) },
    })
    expect(w.attributes('data-verdict')).toBe('fault')
    expect(w.text()).toContain('Fault')
    w.unmount()
  })
})
