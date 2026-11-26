/**
 * The module's real answer through Dethereal's checks: candidates the open-source matching core produces for a flat
 * segment, each with its kind's class as the module reads it from its class files, pass validation whole (their
 * classes, facts, fields and shape), so a change on either side shows here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import type { ExposureState } from '../../triage/exposures.js'
import { validateAnswer } from '../answer.js'
import { HIDDEN_EDGES_MODULE } from '../contract.js'
import { readLocalModel } from '../local.js'
import { syncedModel } from './fixture.js'

/** The module's own sources, loaded as the module's tests load them (they are not this package's to type-check). */
const MODULE = path.resolve(import.meta.dirname, '../../../../../modules/dethernety-hidden-edges')
const load = (rel: string): Promise<any> => import(path.join(MODULE, rel))

let tmp: string
beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'he-contract-')))
  fs.mkdirSync(path.join(tmp, 'repo'))
  initProjectRoot({ cwd: path.join(tmp, 'repo'), env: {} })
})
afterEach(() => {
  resetProjectRoot()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const FLAT = 'Lateral movement on a flat tier'
const exposure = (id: string, element: string, kind: ExposureState['element_kind'], confirmed: boolean): ExposureState => ({
  exposure_id: id, name: FLAT, type: null, category: null, score: null, attack_vector: null, created_by: 'SYSTEM', authored_by: null,
  disposition_kind: confirmed ? 'AFFIRMED' : null, disposition_reason: null, dispositioned_by: confirmed ? 'someone' : null, dispositioned_at: null,
  disposition_stale: null, lifecycle: confirmed ? 'confirmed' : 'pending', element_id: element, element_name: element, element_kind: kind,
  element_class: null, attack_ids: ['T1021'], atlas_ids: [], unresolved_references: null, def_hash: 'h', full_reason: null,
})

describe('the module’s answer, as Dethereal checks it', () => {
  it('passes whole, an in-zone candidate with its own-exposure fact included', async () => {
    const { EDGE_KIND_TABLE } = await load('src/edge-kinds.table.ts')
    const { validateTable } = await load('src/table.ts')
    const { generateCandidates } = await load('src/generate.ts')
    const { CONTRACT_VERSION, MODULE_NAME, MODULE_VERSION, tableHash } = await load('src/contract.ts')
    const { readKindClasses } = await load('src/classes.ts')
    const { model } = await load('__tests__/model-builder.ts')
    const m = model()
      .boundary('root', 'Network Perimeter')
      .boundary('SEG', 'Network Segment', 'root', { east_west_within_segment_restricted: false })
      .component('A', 'Application Service', 'PROCESS', 'SEG')
      .component('B', 'Web Server', 'PROCESS', 'SEG')
      .component('D', 'Relational Database', 'STORE', 'SEG')
      .component('X', 'Application Service', 'EXTERNAL_ENTITY', 'root')
      .exposure('x1', 'SEG', FLAT, ['T1021'])
      .exposure('x2', 'B', 'Remote services reachable', ['T1021'])
      .fold()
    const generated = await generateCandidates(m, validateTable(EDGE_KIND_TABLE))
    expect(generated.candidates.length).toBeGreaterThan(0)
    // The module's classes, as its class files hold them and the platform loads them.
    const kindClasses: Record<string, { id: string; name: string }> = readKindClasses(path.join(MODULE, 'data'))
    const module = { id: 'mod-hidden-edges', name: MODULE_NAME }
    const classes = new Map(Object.values(kindClasses).map((c) => [c.id, { ...c, module }]))
    const raw = JSON.stringify({
      contract: CONTRACT_VERSION, module: MODULE_NAME, version: MODULE_VERSION, table_hash: tableHash(EDGE_KIND_TABLE),
      regime: { kg: 'kg_absent', reason: 'unavailable' }, candidates: generated.candidates.map((c: any) => ({ ...c, class: kindClasses[c.kind] })), counts: generated.counts,
    })
    const dir = await syncedModel(path.join(tmp, 'repo'), 'contract')
    const exposures = new Map([['x1', exposure('x1', 'SEG', 'securityBoundary', true)], ['x2', exposure('x2', 'B', 'component', true)]])
    const r = validateAnswer(raw, { local: await readLocalModel(dir), components: new Set(['A', 'B', 'D', 'X']), exposures, excluded: new Set(), classes })
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.dropped).toBe(0)
    expect(r.candidates.length).toBe(generated.candidates.length)
    expect(r.candidates.some((c) => c.facts.some((f) => f.startsWith('exposure:')))).toBe(true)
    for (const c of r.candidates) expect(c.class).toEqual({ ...kindClasses[c.kind], module })
    // Dethereal knows the module by the name the module answers with.
    expect(HIDDEN_EDGES_MODULE).toBe(MODULE_NAME)
  })

  it('writes into each class only fields its template declares, with values its template allows', async () => {
    const { BASE_FIELDS, CAPABILITIES, DETHEREAL_FIELDS, KIND_FIELDS, KINDS, PRIVILEGES, RESERVED_FIELDS, TIERS } = await import('../contract.js')
    expect(fs.readdirSync(path.join(MODULE, 'data', 'dethernety-hidden-edges', 'dataFlow')).sort()).toEqual([...KINDS].sort())
    for (const kind of KINDS) {
      const dir = path.join(MODULE, 'data', 'dethernety-hidden-edges', 'dataFlow', kind)
      const props = JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8')).schema.properties
      for (const f of [...BASE_FIELDS, ...DETHEREAL_FIELDS]) expect(props[f], `${kind} ${f}`).toBeTruthy()
      expect(props.required_capability.enum).toEqual([...CAPABILITIES])
      expect(props.required_privilege.enum).toEqual([...PRIVILEGES])
      expect(props.granted_privilege.enum).toEqual([...PRIVILEGES])
      expect(props.tier.enum).toEqual([...TIERS])
      expect(props.proposed_by.enum).toEqual(['rule', 'operator'])
      expect(props.hidden_edge_kind.enum).toEqual([kind])
      // the fields a flow of this class counts as declared without its template: exactly its schema's
      expect(new Set(Object.keys(props))).toEqual(new Set([...RESERVED_FIELDS, ...Object.keys(KIND_FIELDS[kind]!)]))
      for (const [f, allowed] of Object.entries(KIND_FIELDS[kind]!)) expect(props[f].enum, `${kind} ${f}`).toEqual([...allowed])
      expect(props.technique_ids.maxItems).toBe(10)
      expect(props.rationale.maxLength).toBe(1000)
    }
  })
})
