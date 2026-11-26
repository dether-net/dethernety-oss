/**
 * The released client against today's module: the contract-1 answers on the module's fixed models, and on the flat
 * segment the contract test uses, go through the validator Dethereal 0.7.0 shipped (a frozen copy). Nothing may be
 * refused or dropped, so a module change that a released Dethereal would reject fails here.
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import type { ExposureState } from '../../triage/exposures.js'
import type { LocalModel } from '../local.js'
import { validateAnswer } from './released-0.7.0/answer.js'

/** The module's sources and fixed models, loaded as the module's tests load them. */
const MODULE = path.resolve(import.meta.dirname, '../../../../../modules/dethernety-hidden-edges')
const load = (rel: string): Promise<any> => import(path.join(MODULE, rel))

/** What a Dethereal run would hold for a model: its local files, its synced ids and its exposure read. */
function contextOf(m: any, options: { excluded?: string[]; include_pending?: boolean }, classes: Map<string, unknown>) {
  const local: LocalModel = { components: new Map(), flows: new Map(), boundaries: new Map(), dataItems: new Map() }
  for (const [id, c] of m.components as Map<string, any>) local.components.set(id, { id, name: id, type: c.type })
  for (const [id, f] of m.flows as Map<string, any>) local.flows.set(id, { id, source: f.source, target: f.target, classId: f.cls?.id ?? null })
  const exposures = new Map<string, ExposureState>()
  for (const [id, e] of m.exposures as Map<string, any>) {
    exposures.set(id, {
      exposure_id: id, name: e.name, type: null, category: null, score: null, attack_vector: null, created_by: e.createdBy, authored_by: null,
      disposition_kind: e.lifecycle === 'confirmed' ? 'AFFIRMED' : null, disposition_reason: null, dispositioned_by: e.lifecycle === 'confirmed' ? 'someone' : null,
      dispositioned_at: null, disposition_stale: null, lifecycle: e.lifecycle, element_id: e.elementId, element_name: e.elementId, element_kind: e.elementKind,
      element_class: null, attack_ids: e.techniques, atlas_ids: [], unresolved_references: null, def_hash: 'h', full_reason: null,
    } as ExposureState)
  }
  return { local, components: new Set(local.components.keys()), exposures, excluded: new Set(options.excluded ?? []), classes: classes as any }
}

describe('the released 0.7.0 validator on the module’s contract-1 answers', () => {
  it('refuses none and drops none, on every fixed model', async () => {
    const { SNAPSHOT_MODELS, contractOneAnswer } = await load('__tests__/contract1-models.ts')
    const { readKindClasses } = await load('src/classes.ts')
    const { MODULE_NAME } = await load('src/contract.ts')
    const module = { id: 'mod-hidden-edges', name: MODULE_NAME }
    const classes = new Map(Object.values(readKindClasses(path.join(MODULE, 'data')) as Record<string, { id: string; name: string }>).map((c) => [c.id, { ...c, module }]))
    for (const entry of SNAPSHOT_MODELS) {
      const { answer, model } = await contractOneAnswer(entry)
      const r = validateAnswer(JSON.stringify(answer), contextOf(model, entry.options, classes))
      expect(r.status, `${entry.name}: ${JSON.stringify(r)}`).toBe('ok')
      if (r.status !== 'ok') continue
      expect([entry.name, r.dropped, r.excluded, r.candidates.length]).toEqual([entry.name, 0, 0, answer.candidates.length])
    }
  })

  it('refuses none and drops none on the flat segment', async () => {
    const { model } = await load('__tests__/model-builder.ts')
    const { contractOneAnswer } = await load('__tests__/contract1-models.ts')
    const { readKindClasses } = await load('src/classes.ts')
    const { MODULE_NAME } = await load('src/contract.ts')
    const module = { id: 'mod-hidden-edges', name: MODULE_NAME }
    const classes = new Map(Object.values(readKindClasses(path.join(MODULE, 'data')) as Record<string, { id: string; name: string }>).map((c) => [c.id, { ...c, module }]))
    const entry = {
      name: 'flat',
      options: { include_pending: true },
      build: () =>
        model()
          .boundary('root', 'Network Perimeter')
          .boundary('SEG', 'Network Segment', 'root', { east_west_within_segment_restricted: false })
          .component('A', 'Application Service', 'PROCESS', 'SEG')
          .component('B', 'Web Server', 'PROCESS', 'SEG')
          .component('D', 'Relational Database', 'STORE', 'SEG')
          .component('X', 'Application Service', 'EXTERNAL_ENTITY', 'root')
          .exposure('x1', 'SEG', 'Lateral movement on a flat tier', ['T1021'])
          .exposure('x2', 'B', 'Remote services reachable', ['T1021']),
    }
    const { answer, model: m } = await contractOneAnswer(entry)
    expect(answer.candidates.length).toBeGreaterThan(0)
    const r = validateAnswer(JSON.stringify(answer), contextOf(m, entry.options, classes))
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect([r.dropped, r.candidates.length]).toEqual([0, answer.candidates.length])
  })
})
