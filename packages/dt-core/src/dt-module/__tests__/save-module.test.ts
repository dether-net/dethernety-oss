/**
 * SAVE_MODULE must use the explicit `{ set: $attributes }` update form; the
 * bare `{ attributes: $attributes }` fails @neo4j/graphql v7 StringScalarMutations
 * validation and blocks modulesStore.saveModule.
 */
import { describe, it, expect } from 'vitest'
import { SAVE_MODULE } from '../dt-module-gql.js'

describe('SAVE_MODULE', () => {
  it('uses the explicit set form for attributes', () => {
    const m = SAVE_MODULE.loc?.source.body ?? ''
    expect(m).toMatch(/attributes:\s*{\s*set:\s*\$attributes\s*}/)
  })
})
