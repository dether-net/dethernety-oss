import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
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

/**
 * The category test above asserts the glob *strings* mention `kubernetes/`.
 * That passes even when no real manifest path matches — which is exactly how
 * root-anchored k8s globs shipped while every nested layout went unseen.
 *
 * These cases match real paths through git itself, because `detect-drift.js`
 * resolves these globs as git `:(glob)` pathspecs. A JS matcher would be an
 * approximation: picomatch lets a leading `**​/` match zero directories, git
 * does not, and that difference is the whole bug.
 */
describe('source-globs — real path matching (git :(glob) semantics)', () => {
  let repo: string

  const covered = (p: string): boolean => {
    const out = execFileSync(
      'git',
      ['ls-files', '--', ...DISCOVERY_GLOBS.map((g) => `:(glob)${g}`)],
      { cwd: repo, encoding: 'utf8' },
    )
    return out.split('\n').includes(p)
  }

  // Layouts taken from real projects, not invented. Google's Online Boutique
  // alone ships kubernetes-manifests/, kustomize/, helm-chart/ and
  // istio-manifests/ — none of which the pre-fix globs matched.
  const shouldMatch = [
    'kubernetes-manifests/cartservice.yaml',
    'vendored/kubernetes-manifests/cartservice.yaml',
    'istio-manifests/frontend-gateway.yaml',
    'manifests/deploy.yaml',
    'nested/manifests/deploy.yaml',
    'k8s/deployment.yaml',
    'services/api/k8s/deployment.yaml',
    'kubernetes/deployment.yml',
    'kustomize/base/deployment.yaml',
    'nested/kustomize/overlays/prod/patch.yaml',
    'helm-chart/values.yaml',
    'helm-chart/templates/deployment.yaml',
    'helm/Chart.yaml',
    'charts/api/templates/deployment.yml',
    'nested/charts/api/values.yaml',
    'services/api/Dockerfile',
    'services/api/package.json',
    'infra/main.tf',
  ]

  // Guards the fix against over-broadening into every yaml in the tree.
  const shouldNotMatch = [
    '.github/workflows/ci.yaml',
    'docs/architecture-notes.yaml',
    'src/fixtures/sample-response.yaml',
    'README.md',
  ]

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'dethereal-globs-'))
    execFileSync('git', ['init', '-q'], { cwd: repo })
    for (const p of [...shouldMatch, ...shouldNotMatch]) {
      mkdirSync(join(repo, dirname(p)), { recursive: true })
      writeFileSync(join(repo, p), '# fixture\n')
    }
    execFileSync('git', ['add', '-A'], { cwd: repo })
  })

  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it.each(shouldMatch)('covers %s', (p) => {
    expect(covered(p), `no glob matches ${p}`).toBe(true)
  })

  it.each(shouldNotMatch)('does not over-match %s', (p) => {
    expect(covered(p), `${p} should not be treated as a source file`).toBe(false)
  })
})
