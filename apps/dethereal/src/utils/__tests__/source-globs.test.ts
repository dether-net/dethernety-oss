import { describe, it, expect } from 'vitest'
import { DISCOVERY_GLOBS } from '../source-globs.js'
import data from '../source-globs.v1.json' with { type: 'json' }

describe('source-globs', () => {
  it('freezes the globs array to prevent runtime mutation', () => {
    expect(Object.isFrozen(DISCOVERY_GLOBS)).toBe(true)
    expect(() => {
      ;(DISCOVERY_GLOBS as string[]).push('evil-glob')
    }).toThrow()
  })

  it('matches the JSON SSOT length exactly', () => {
    expect(DISCOVERY_GLOBS.length).toBe(data.globs.length)
  })

  it('covers each Discovery Sources category from infrastructure-scout.md', () => {
    const coverage: Array<[string, RegExp]> = [
      ['code-structure (package.json)', /package\.json/],
      ['code-structure (go.mod)', /go\.mod/],
      ['iac-terraform', /\*\.tf/],
      ['container-compose', /docker-compose/],
      ['container-dockerfile', /Dockerfile/],
      ['k8s-manifests', /k8s\/|kubernetes\/|manifests\//],
      ['helm', /helm\/|charts\//],
      ['api-openapi', /openapi\./],
      ['api-proto', /\*\.proto/],
      ['api-graphql', /\*\.graphql/],
      ['env-examples', /\.env\.(example|sample|template)/],
      ['paas-heroku', /Procfile|heroku\.yml/],
      ['paas-fly', /fly\.toml/],
      ['iac-pulumi', /Pulumi/],
      ['iac-cdk', /cdk\.json/],
    ]
    for (const [category, pattern] of coverage) {
      const matches = DISCOVERY_GLOBS.filter((g) => pattern.test(g))
      expect(matches.length, `missing coverage for ${category}`).toBeGreaterThan(0)
    }
  })

  it('has no duplicate glob entries', () => {
    const set = new Set(DISCOVERY_GLOBS)
    expect(set.size).toBe(DISCOVERY_GLOBS.length)
  })
})
