/**
 * The Modules page's health table, orphaned-classes panel and identity event timeline draw at full
 * opacity: dimmed to 80% over the page, their text fell below AA contrast on the light theme, and so
 * did their de-emphasised text on the dark theme. Two of them use auto-imported Vue APIs the test build
 * does not provide, so this reads their templates rather than mounting them.
 */
import { describe, it, expect } from 'vitest'
import moduleHealthTable from '../ModuleHealthTable.vue?raw'
import orphanedClassesPanel from '../OrphanedClassesPanel.vue?raw'
import identityEventTimeline from '../IdentityEventTimeline.vue?raw'

const template = (source: string) => source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>'))
// An `opacity-N` token anywhere in the template, static or bound; `border-opacity-N` only tints a border.
const dimming = /(?<![\w-])opacity-\d+/g

describe('Modules page panels', () => {
  it.each([
    ['ModuleHealthTable.vue', moduleHealthTable],
    ['OrphanedClassesPanel.vue', orphanedClassesPanel],
    ['IdentityEventTimeline.vue', identityEventTimeline],
  ])('%s dims nothing', (_, source) => {
    const markup = template(source)
    expect(markup.length).toBeGreaterThan(0)
    expect(markup.match(dimming) ?? []).toEqual([])
  })
})
