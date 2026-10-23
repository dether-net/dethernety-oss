import { describe, it } from 'vitest'
import { assertFrontendManifest } from '@dethernety/dt-module/frontend-manifest'
import frontend from '../index.js'
import manifest from '../frontend-manifest.json'

describe('frontend-manifest.json', () => {
  it('declares exactly the components install() registers', async () => {
    await assertFrontendManifest(frontend, manifest)
  })
})
