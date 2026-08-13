import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ModulesTable from '@/components/ModulesTable.vue'

describe('ModulesTable', () => {
  it('renders one row per placed module', () => {
    const w = mount(ModulesTable, {
      props: {
        modules: {
          status: 'ok',
          expected: [
            { name: 'alpha', version: '1.0.0', outcome: 'placed' },
            { name: 'beta', version: '2.0.0', outcome: 'failed' },
          ],
        },
      },
    })
    expect(w.findAll('[data-module-row]')).toHaveLength(2)
    expect(w.text()).toContain('alpha')
    expect(w.text()).toContain('failed')
  })

  it('shows an empty state and no rows when nothing was placed', () => {
    const w = mount(ModulesTable, { props: { modules: { status: 'no-assets', expected: [] } } })
    expect(w.findAll('[data-module-row]')).toHaveLength(0)
    expect(w.get('[data-empty="true"]').text()).toContain('No modules were placed')
  })
})
