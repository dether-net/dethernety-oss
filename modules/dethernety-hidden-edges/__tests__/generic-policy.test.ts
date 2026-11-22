/**
 * The generic policy every hidden-edge class carries, evaluated by the platform's own
 * engine against its tests.json cases, plus the properties a case list cannot show.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { lintPolicySource, RegoEngine } from '@dethernety/dt-module'
// The parity gate's own census (a new count/regex.match site over `input` fails CI), imported from the
// gate's harness rather than copied, so the two cannot drift. The policy reads input only through
// object.get guards; this asserts the census stays empty, it does not prove the guards.
import { builtinInputSites } from '../../../packages/dt-module/test/rego-parity/harness.mjs'

const DIR = path.resolve(__dirname, '..', 'class-template')
const source = readFileSync(path.join(DIR, 'policies.rego'), 'utf8')
const cases: Array<{ name: string; input: unknown; expectedExposures: string[] }> = JSON.parse(
  readFileSync(path.join(DIR, 'tests.json'), 'utf8'),
)

const engine = new RegoEngine()
const KEY = 'hidden-edges/class-template'
engine.register(KEY, source)
afterAll(() => engine.dispose())

type Finding = {
  name: string
  category: string
  criticality: string
  score: number
  type: string
  attack_vector: string
  exploited_by: Array<{ label: string; property: string; value: string; attributes: object }>
}
const evaluate = (input: unknown) => engine.evaluate<Finding>(KEY, 'exposures', input)

describe('the generic hidden-edge policy', () => {
  it('has the expected case list', () => {
    expect(cases.map((c) => c.name)).toEqual([
      'Minimal Input', 'One Technique', 'Ten Techniques', 'Eleven Techniques', 'Malformed Ids',
      'Malformed Ids Count Toward The Ten', 'Wrong-Typed Input', 'Wrong-Typed Tier', 'Repeated Id',
    ])
  })

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(evaluate(c.input).map((f) => f.name).sort()).toEqual([...c.expectedExposures].sort())
  })

  it('puts every exposure in category Inferred Path, linked to its own technique only', () => {
    const findings = evaluate({ technique_ids: ['T1021', 'T1611'] })
    expect(findings).toHaveLength(2)
    for (const f of findings) {
      expect(f.category).toBe('Inferred Path')
      expect(f.type).toBe('EXPOSURE')
      expect(f.exploited_by).toEqual([{ label: 'MitreAttackTechnique', property: 'attack_id', value: f.name.replace(/^Inferred [a-z ]+ path: /, ''), attributes: {} }])
    }
  })

  it('takes criticality and score from what the path grants at its target, never from the tier', () => {
    const at = (granted: unknown, tier: unknown = 'low') => evaluate({ technique_ids: ['T1021'], granted_privilege: granted, tier })[0]
    expect([at('none').criticality, at('none').score]).toEqual(['low', 3])
    expect([at('user').criticality, at('user').score]).toEqual(['medium', 5])
    expect([at('admin').criticality, at('admin').score]).toEqual(['high', 7.5])
    expect([at('system').criticality, at('system').score]).toEqual(['critical', 9])
    expect(at('system', 'high').criticality).toBe(at('system', 'low').criticality)
    expect([at('root').criticality, at(undefined).criticality]).toEqual(['medium', 'medium'])
  })

  it('names the kind and states the confidence and the privilege it grants, from the fixed values only', () => {
    const f = evaluate({ technique_ids: ['T1021'], hidden_edge_kind: 'remote-service', tier: 'medium', granted_privilege: 'admin' })[0]
    expect(f.name).toBe('Inferred remote service path: T1021')
    expect(f.description).toMatch(/Confidence: medium; grants admin at the target\.$/)
    const other = evaluate({ technique_ids: ['T1021'], hidden_edge_kind: 'SECRET-CANARY', tier: 'SECRET-CANARY', granted_privilege: 'SECRET-CANARY' })[0]
    expect(other.name).toBe('Inferred hidden edge path: T1021')
    expect(other.description).toMatch(/Confidence: low; grants unstated at the target\.$/)
  })

  it('is LOCAL for a host escape, ADJACENT for a credential capture, and NETWORK otherwise', () => {
    expect(evaluate({ technique_ids: ['T1611'], hidden_edge_kind: 'host-escape' })[0].attack_vector).toBe('LOCAL')
    expect(evaluate({ technique_ids: ['T1040'], hidden_edge_kind: 'credential-capture' })[0].attack_vector).toBe('ADJACENT')
    expect(evaluate({ technique_ids: ['T1021'], hidden_edge_kind: 'remote-service' })[0].attack_vector).toBe('NETWORK')
    expect(evaluate({ technique_ids: ['T1021'] })[0].attack_vector).toBe('NETWORK')
  })

  it('states no review status, and copies no other input into a finding', () => {
    expect(evaluate({ technique_ids: ['T1021'] })[0].description).not.toMatch(/review/i)
    const findings = evaluate({ technique_ids: ['T1021'], rationale: 'SECRET-CANARY', source_exposure_ids: ['SECRET-CANARY'] })
    expect(JSON.stringify(findings)).not.toContain('SECRET-CANARY')
  })

  it('passes the policy lint and adds no builtin site over input to the parity census', () => {
    expect(lintPolicySource(source)).toEqual({ errors: [], warnings: [] })
    expect(builtinInputSites(source)).toEqual([])
  })
})
