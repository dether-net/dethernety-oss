import { describe, it, expect } from 'vitest'
import { DEFAULT_FILE_NAMES } from '@dethernety/dt-core'
import { MANIFEST_FILE } from '../path-confinement.js'

describe('path-confinement', () => {
  it('uses the model library manifest file name without loading the library', () => {
    expect(MANIFEST_FILE).toBe(DEFAULT_FILE_NAMES.manifest)
  })
})
