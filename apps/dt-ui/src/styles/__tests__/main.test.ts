/**
 * The global stylesheet's tonal-alert rules: Vuetify draws a tonal alert's text and icon in its type
 * colour, unreadable on the app's surfaces, so main.scss redraws them in the surface's text colour and
 * leaves the tinted underlay alone. A tonal alert on the page background brings its own surface.
 */
import { describe, it, expect } from 'vitest'
import scss from '../main.scss?raw'
import modulesPage from '@/pages/modules.vue?raw'
import blockedInstallsBanner from '@/components/Modules/BlockedInstallsBanner.vue?raw'

/** Each selector of the stylesheet's plain rules, with its declarations as property → value. */
function declarations(source: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>()
  const css = source.replace(/\/\/.*$/gm, '')
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>()
    for (const decl of body.split(';')) {
      const at = decl.indexOf(':')
      if (at > 0) decls.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim())
    }
    for (const selector of selectors.split(',')) rules.set(selector.trim(), decls)
  }
  return rules
}

const rules = declarations(scss)

describe('main.scss', () => {
  it("draws a tonal alert's text and icon in the surface's text colour", () => {
    for (const selector of ['.v-alert--variant-tonal > .v-alert__prepend', '.v-alert--variant-tonal > .v-alert__content']) {
      expect(rules.get(selector)?.get('color')).toBe('rgb(var(--v-theme-on-surface))')
    }
  })

  it('leaves the tonal underlay alone', () => {
    expect([...rules.keys()].filter((selector) => selector.includes('v-alert__underlay'))).toEqual([])
  })

  it('gives a surface-alert the surface as its background', () => {
    expect(rules.get('.v-alert.surface-alert')?.get('background')).toBe('rgb(var(--v-theme-surface))')
  })
})

describe('tonal alerts on the page background', () => {
  it.each([
    ['the Modules page admin notice', modulesPage, 'Operations requires admin role'],
    ['the blocked-installs banner', blockedInstallsBanner, 'blocked installs'],
  ])('%s brings its own surface', (_, source, text) => {
    const alert = source.slice(source.lastIndexOf('<v-alert', source.indexOf(text)), source.indexOf(text))
    expect(alert).toContain('variant="tonal"')
    expect(alert).toMatch(/\bclass="(?:[^"]*\s)?surface-alert\b/)
  })
})
