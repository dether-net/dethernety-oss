// @vitest-environment happy-dom
/**
 * The identity migration panel draws at full opacity: dimmed to 80%, its body text and the tonal
 * alerts inside it fell below AA contrast on the light theme, and its secondary text button on the
 * dark theme.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/stores/modulesStore', () => ({ useModulesStore: () => ({}) }))

import IdentityMigrationPanel from '../IdentityMigrationPanel.vue'

describe('IdentityMigrationPanel', () => {
  it('is not dimmed', () => {
    const wrapper = mount(IdentityMigrationPanel)
    const classes = wrapper.classes()
    expect(classes).toContain('rounded-lg')
    expect(classes.filter((name) => name.startsWith('opacity-'))).toEqual([])
  })
})
