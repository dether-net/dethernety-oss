/**
 * search_mitre_attack's lookup and match: the mapping of both frameworks' techniques, the exact miss messages,
 * the top_n clamp as sent to the platform, the merge of both frameworks, a degraded vector tier, and the
 * per-action field refusals.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { ToolContext } from '../base-tool.js'
import { manifestTool } from '../manifest.js'
import { searchMitreAttackTool, type MatchResult, type TechniqueRecord } from '../search-mitre-attack.tool.js'

const ctx = (client: unknown): ToolContext => ({ apolloClient: client as ToolContext['apolloClient'], debug: false })
const operationOf = (doc: any): string => doc?.definitions?.[0]?.name?.value ?? ''

const rawTechnique = {
  id: 'node-t1078-001',
  attack_id: 'T1078.001',
  name: 'Default Accounts',
  description: 'Adversaries may obtain and abuse credentials of a default account.',
  attack_decreased: false,
  attack_subtechnique: true,
  attack_version: '1.2',
  ref_url: 'https://attack.mitre.org/techniques/T1078/001',
  parentTechnique: [{ id: 'node-t1078', attack_id: 'T1078', name: 'Valid Accounts' }],
  tactics: [{ name: 'Persistence' }, { name: 'Initial Access' }]
}

const rawAtlas = {
  id: 'node-aml-t0051-000',
  atlas_id: 'AML.T0051.000',
  name: 'Direct',
  description: 'Prompt injection through the user turn.',
  atlas_deprecated: false,
  atlas_subtechnique: true,
  ref_url: 'https://atlas.mitre.org/techniques/AML.T0051.000',
  parentTechnique: [{ id: 'node-aml-t0051', atlas_id: 'AML.T0051', name: 'LLM Prompt Injection' }],
  tactics: [{ name: 'Execution' }]
}

describe('lookup', () => {
  it('maps an ATT&CK technique: internal id, first parent, tactic names', async () => {
    const calls: Array<{ op: string; variables: unknown }> = []
    const fake = { query: async (o: any) => { calls.push({ op: operationOf(o.query), variables: o.variables }); return { data: { mitreAttackTechniques: [rawTechnique] } } } }
    const res = await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'T1078.001' }, ctx(fake))
    expect(res.success, res.error).toBe(true)
    expect(calls).toEqual([{ op: 'LookupTechnique', variables: { attackId: 'T1078.001' } }])
    expect((res.data as { technique: TechniqueRecord }).technique).toEqual({
      id: 'node-t1078-001',
      framework: 'attack',
      attackId: 'T1078.001',
      name: 'Default Accounts',
      description: rawTechnique.description,
      deprecated: null,
      decreasedUsage: false,
      subtechnique: true,
      version: '1.2',
      refUrl: rawTechnique.ref_url,
      parentTechnique: { id: 'node-t1078', attackId: 'T1078', name: 'Valid Accounts' },
      tacticNames: ['Persistence', 'Initial Access']
    })
  })

  it('reports an ATT&CK technique used less as decreasedUsage, never as deprecated', async () => {
    const fake = { query: async () => ({ data: { mitreAttackTechniques: [{ ...rawTechnique, attack_decreased: true }] } }) }
    const technique = ((await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'T1078.001' }, ctx(fake))).data as { technique: TechniqueRecord }).technique
    expect(technique).toMatchObject({ decreasedUsage: true, deprecated: null })
  })

  it('an AML. id looks up the ATLAS technique, with no version', async () => {
    const ops: string[] = []
    const fake = { query: async (o: any) => { ops.push(operationOf(o.query)); return { data: { mitreAtlasTechniques: [rawAtlas] } } } }
    const res = await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'AML.T0051.000' }, ctx(fake))
    expect(ops).toEqual(['LookupAtlasTechnique'])
    expect((res.data as { technique: TechniqueRecord }).technique).toEqual({
      id: 'node-aml-t0051-000',
      framework: 'atlas',
      attackId: 'AML.T0051.000',
      name: 'Direct',
      description: 'Prompt injection through the user turn.',
      deprecated: false,
      decreasedUsage: null,
      subtechnique: true,
      version: null,
      refUrl: 'https://atlas.mitre.org/techniques/AML.T0051.000',
      parentTechnique: { id: 'node-aml-t0051', attackId: 'AML.T0051', name: 'LLM Prompt Injection' },
      tacticNames: ['Execution']
    })
  })

  it('the ATLAS prefix is case-sensitive: aml. is looked up as ATT&CK', async () => {
    const ops: string[] = []
    const fake = { query: async (o: any) => { ops.push(operationOf(o.query)); return { data: { mitreAttackTechniques: [] } } } }
    await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'aml.T0051' }, ctx(fake))
    expect(ops).toEqual(['LookupTechnique'])
  })

  it('a technique with no parent maps the parent to null', async () => {
    const fake = { query: async () => ({ data: { mitreAttackTechniques: [{ ...rawTechnique, attack_subtechnique: false, parentTechnique: [] }] } }) }
    const res = await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'T1078' }, ctx(fake))
    expect((res.data as { technique: TechniqueRecord }).technique.parentTechnique).toBeNull()
  })

  it('an ATT&CK miss gives the exact message', async () => {
    const fake = { query: async () => ({ data: { mitreAttackTechniques: [] } }) }
    const res = await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'T9999.999' }, ctx(fake))
    expect(res).toEqual({ success: false, error: 'No technique with attack_id T9999.999 exists on the platform.', data: { codes: ['not_found'] } })
  })

  it('an ATLAS miss gives its own message', async () => {
    const fake = { query: async () => ({ data: { mitreAtlasTechniques: [] } }) }
    const res = await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'AML.T9999' }, ctx(fake))
    expect(res).toEqual({ success: false, error: 'No ATLAS technique with atlas_id AML.T9999 exists on the platform.', data: { codes: ['not_found'] } })
  })
})

const cand = (mitreId: string, matchType: string, similarityScore: number | null, kind = 'ATTACK_TECHNIQUE') => ({
  mitreId, name: mitreId, description: null, tactic: null, kind, matchType, similarityScore
})

/** A platform that answers each kind with its own candidates, and records what it was asked. */
function fakeByKind(byKind: Record<string, ReturnType<typeof cand>[]>, extra: { vectorAvailable?: boolean; vectorDisabledReason?: string | null } = {}) {
  const inputs: Array<{ kind: string; topN: number; queries: Array<{ query: string }> }> = []
  const fake = {
    query: async (o: any) => {
      const input = o.variables.input
      inputs.push(input)
      const query = input.queries[0].query
      const candidates = byKind[input.kind] ?? []
      return {
        data: {
          matchMitreTechniques: {
            matches: candidates.length ? [{ query, candidates }] : [],
            unmatched: candidates.length ? [] : [query],
            vectorAvailable: extra.vectorAvailable ?? true,
            vectorDisabledReason: extra.vectorDisabledReason ?? null
          }
        }
      }
    }
  }
  return { fake, inputs }
}

describe('match', () => {
  it('clamps top_n to 1–20, default 5, as sent to the platform', async () => {
    const sent = async (top_n?: number) => {
      const { fake, inputs } = fakeByKind({})
      const res = await searchMitreAttackTool.run({ action: 'match', query: 'q', ...(top_n !== undefined ? { top_n } : {}) }, ctx(fake))
      expect(res.success, res.error).toBe(true)
      return inputs[0]!.topN
    }
    expect(await sent()).toBe(5)
    expect(await sent(0)).toBe(1)
    expect(await sent(-3)).toBe(1)
    expect(await sent(50)).toBe(20)
    expect(await sent(7)).toBe(7)
  })

  it('searches ATT&CK only by default, and ATLAS on request', async () => {
    const attack = fakeByKind({ ATTACK_TECHNIQUE: [cand('T1190', 'NAME_MATCH', null)] })
    await searchMitreAttackTool.run({ action: 'match', query: 'q' }, ctx(attack.fake))
    expect(attack.inputs.map((i) => i.kind)).toEqual(['ATTACK_TECHNIQUE'])
    expect(attack.inputs[0]!.queries).toEqual([{ query: 'q' }])

    const atlas = fakeByKind({ ATLAS_TECHNIQUE: [cand('AML.T0051', 'VECTOR_SIMILARITY', 0.6, 'ATLAS_TECHNIQUE')] })
    const res = await searchMitreAttackTool.run({ action: 'match', query: 'q', framework: 'atlas' }, ctx(atlas.fake))
    expect(atlas.inputs.map((i) => i.kind)).toEqual(['ATLAS_TECHNIQUE'])
    expect((res.data as MatchResult).candidates.map((c) => c.mitreId)).toEqual(['AML.T0051'])
  })

  it('both: one call per framework, merged by tier and then similarity, capped at top_n', async () => {
    const { fake, inputs } = fakeByKind({
      ATTACK_TECHNIQUE: [cand('T1588.007', 'VECTOR_SIMILARITY', 0.46), cand('T1190', 'NAME_MATCH', null)],
      ATLAS_TECHNIQUE: [cand('AML.T0051.001', 'VECTOR_SIMILARITY', 0.67, 'ATLAS_TECHNIQUE'), cand('AML.T0051', 'VECTOR_SIMILARITY', 0.65, 'ATLAS_TECHNIQUE')]
    })
    const res = await searchMitreAttackTool.run({ action: 'match', query: 'q', framework: 'both', top_n: 3 }, ctx(fake))
    expect(inputs.map((i) => i.kind).sort()).toEqual(['ATLAS_TECHNIQUE', 'ATTACK_TECHNIQUE'])
    const data = res.data as MatchResult
    expect(data.candidates.map((c) => c.mitreId)).toEqual(['T1190', 'AML.T0051.001', 'AML.T0051'])
    expect(data.unmatched).toEqual([])
  })

  it('both: unmatched only when neither framework matched', async () => {
    const one = fakeByKind({ ATLAS_TECHNIQUE: [cand('AML.T0051', 'VECTOR_SIMILARITY', 0.6, 'ATLAS_TECHNIQUE')] })
    const res = await searchMitreAttackTool.run({ action: 'match', query: 'q', framework: 'both' }, ctx(one.fake))
    expect((res.data as MatchResult).unmatched).toEqual([])
    const none = fakeByKind({})
    const res2 = await searchMitreAttackTool.run({ action: 'match', query: 'q', framework: 'both' }, ctx(none.fake))
    expect((res2.data as MatchResult).unmatched).toEqual(['q'])
    expect((res2.data as MatchResult).candidates).toEqual([])
  })

  it('passes a degraded vector tier through, and candidates carry no internal id', async () => {
    const fake = {
      query: async () => ({
        data: {
          matchMitreTechniques: {
            matches: [{ query: 'credential stuffing', candidates: [{ ...cand('T1110.004', 'NAME_MATCH', null), id: 'node-leak', tactic: 'Credential Access' }] }],
            unmatched: [],
            vectorAvailable: false,
            vectorDisabledReason: 'EMBEDDING_DISABLED'
          }
        }
      })
    }
    const res = await searchMitreAttackTool.run({ action: 'match', query: 'credential stuffing' }, ctx(fake))
    expect(res.success, res.error).toBe(true)
    const data = res.data as MatchResult
    expect(data).toMatchObject({ query: 'credential stuffing', vectorAvailable: false, vectorDisabledReason: 'EMBEDDING_DISABLED', unmatched: [] })
    expect(data.candidates).toEqual([
      { mitreId: 'T1110.004', name: 'T1110.004', description: null, tactic: 'Credential Access', kind: 'ATTACK_TECHNIQUE', matchType: 'NAME_MATCH', similarityScore: null }
    ])
  })

  it('both: the vector tier is available only when it is in both frameworks', async () => {
    const replies = [
      { matches: [], unmatched: ['q'], vectorAvailable: true, vectorDisabledReason: null },
      { matches: [], unmatched: ['q'], vectorAvailable: false, vectorDisabledReason: 'NO_ATLAS_EMBEDDINGS' },
    ]
    const fake = { query: async () => ({ data: { matchMitreTechniques: replies.shift() } }) }
    const res = await searchMitreAttackTool.run({ action: 'match', query: 'q', framework: 'both' }, ctx(fake))
    expect(res.data).toMatchObject({ vectorAvailable: false, vectorDisabledReason: 'NO_ATLAS_EMBEDDINGS' })
  })

  it('a reply with no match data is a failure', async () => {
    const fake = { query: async () => ({ data: {} }) }
    const res = await searchMitreAttackTool.run({ action: 'match', query: 'q' }, ctx(fake))
    expect(res).toEqual({ success: false, error: 'matchMitreTechniques returned no data' })
  })
})

describe('schema', () => {
  const parse = (input: unknown) => searchMitreAttackTool.inputSchema.safeParse(input)

  it.each([
    [{ action: 'lookup' }, 'attack_id'],
    [{ action: 'match' }, 'query'],
    [{ action: 'match', query: 'x'.repeat(501) }, 'query'],
    [{ action: 'match', query: 'q', framework: 'd3fend' }, 'framework'],
    [{ action: 'match', query: 'q', top_n: 2.5 }, 'top_n'],
    [{ action: 'match', query: 'q', attack_id: 'T1078' }, 'attack_id'],
    [{ action: 'match', query: 'q', tactic_id: 'TA0001' }, 'tactic_id'],
    [{ action: 'lookup', attack_id: 'T1078', query: 'q' }, 'query'],
    [{ action: 'lookup', attack_id: 'T1078', framework: 'atlas' }, 'framework'],
    [{ action: 'lookup', attack_id: 'T1078', top_n: 3 }, 'top_n'],
    [{ action: 'search', query: 'q', framework: 'both' }, 'framework'],
    [{ action: 'technique', attack_id: 'T1078', top_n: 3 }, 'top_n'],
    [{ action: 'tactics', framework: 'attack' }, 'framework'],
  ])('refuses %j at %s', (input, field) => {
    const r = parse(input)
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((i) => i.path[0])).toContain(field)
  })

  it.each([
    { action: 'lookup', attack_id: 'T1078.001' },
    { action: 'lookup', attack_id: 'AML.T0051' },
    { action: 'match', query: 'x'.repeat(500) },
    { action: 'match', query: 'q', framework: 'both', top_n: 100 },
    { action: 'search', query: 'x'.repeat(600) },
  ])('accepts %j', (input) => {
    expect(parse(input).success).toBe(true)
  })

  it('a refused input never reaches the platform', async () => {
    let called = false
    const fake = { query: async () => { called = true; return { data: {} } } }
    const res = await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'T1078', top_n: 3 }, ctx(fake))
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/top_n.{0,4} does not apply to .{0,4}lookup/)
    expect(called).toBe(false)
  })
})

describe('manifest', () => {
  it('lists exactly the actions and inputs the schema takes', () => {
    const json = z.toJSONSchema(searchMitreAttackTool.inputSchema, { target: 'draft-07' }) as { properties: Record<string, { enum?: string[] }> }
    const entry = manifestTool('search_mitre_attack')!
    expect(Object.keys(json.properties).sort()).toEqual(Object.keys(entry.inputs).sort())
    expect([...json.properties.action!.enum!].sort()).toEqual([...entry.actions!].sort())
  })
})
