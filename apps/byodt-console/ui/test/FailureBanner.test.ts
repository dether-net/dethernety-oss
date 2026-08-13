import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FailureBanner from '@/components/FailureBanner.vue'

describe('FailureBanner', () => {
  it('flags a fetch/ingest failure as severe and shows its message', () => {
    const w = mount(FailureBanner, {
      props: { failure: { kind: 'ingest-failed', message: 'the data ingest failed — no MITRE corpus' } },
    })
    expect(w.text()).toContain('the data ingest failed — no MITRE corpus')
    expect(w.get('[data-kind="ingest-failed"]').attributes('data-severe')).toBe('true')
  })

  it('names the affected modules for fewer-modules-registered', () => {
    const w = mount(FailureBanner, {
      props: {
        failure: {
          kind: 'fewer-modules-registered',
          message: 'the console placed modules the platform did not register',
          modules: ['dethernety-general', 'dethernety-threat-report'],
        },
      },
    })
    expect(w.text()).toContain('dethernety-general')
    expect(w.text()).toContain('dethernety-threat-report')
    expect(w.get('[data-kind]').attributes('data-severe')).toBe('true')
  })

  it('treats init-not-run as a non-severe warning', () => {
    const w = mount(FailureBanner, {
      props: { failure: { kind: 'init-not-run', message: 'the init one-shot has not written its state' } },
    })
    expect(w.get('[data-kind]').attributes('data-severe')).toBe('false')
  })
})
