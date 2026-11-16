/**
 * search_mitre_attack's lookup, match and techniques_by_tactic, get_mitre_defend's techniques_by_tactic, and
 * manage_analyses results, against a running platform, the one named for it (live-platform.ts). Read-only:
 * nothing is written, so there is nothing to clean up.
 *
 * Runs only with DETHEREAL_TRIAGE_LIVE=1 and DETHERNETY_URL naming a platform with authentication disabled or a live session in this HOME
 * (live-platform.ts); once switched on, a platform it cannot use fails the suite.
 */
import { describe, it, expect } from 'vitest'
import { searchMitreAttackTool, type MatchResult, type TechniqueRecord } from '../../tools/search-mitre-attack.tool.js'
import { getMitreDefendTool } from '../../tools/get-mitre-defend.tool.js'
import { manageAnalysesTool } from '../../tools/manage-analyses.tool.js'
import { listModelsTool } from '../../tools/list-models.tool.js'

import { liveContext, livePlatform } from './live-platform.js'

const platform = await livePlatform()

describe.runIf(platform.enabled)('search_mitre_attack lookup and match on a live platform', () => {
  const context = liveContext

  it('runs on a platform named for it, signed in or with authentication disabled', () => {
    if (platform.problem) throw new Error(platform.problem)
  })

  it.skipIf(!!platform.problem)('lookup: a sub-technique with its parent and tactics, and the exact miss', async () => {
    const hit = await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'T1078.001' }, await context())
    expect(hit.success, hit.error).toBe(true)
    const { technique } = hit.data as { technique: TechniqueRecord }
    expect(technique.id).toBeTruthy()
    expect(technique).toMatchObject({ framework: 'attack', attackId: 'T1078.001', subtechnique: true })
    expect(technique.parentTechnique?.attackId).toBe('T1078')
    expect(technique.tacticNames.length).toBeGreaterThanOrEqual(1)

    const miss = await searchMitreAttackTool.run({ action: 'lookup', attack_id: 'T9999.999' }, await context())
    expect(miss).toEqual({ success: false, error: 'No technique with attack_id T9999.999 exists on the platform.', data: { codes: ['not_found'] } })
  }, 30_000)

  it.skipIf(!!platform.problem)('techniques_by_tactic: an ATT&CK tactic id gives its techniques, each under that tactic', async () => {
    const tactics = await searchMitreAttackTool.run({ action: 'tactics' }, await context())
    expect(tactics.success, tactics.error).toBe(true)
    const tactic = (tactics.data as { tactics: Array<{ attack_id: string; name: string }> }).tactics.find((t) => t.attack_id === 'TA0008')
    expect(tactic, 'TA0008 among the tactics').toBeDefined()
    const res = await searchMitreAttackTool.run({ action: 'techniques_by_tactic', tactic_id: 'TA0008' }, await context())
    expect(res.success, res.error).toBe(true)
    const { techniques } = res.data as { techniques: Array<{ attack_id: string }> }
    expect(techniques.length).toBeGreaterThanOrEqual(1)
    for (const t of techniques) {
      const hit = await searchMitreAttackTool.run({ action: 'lookup', attack_id: t.attack_id }, await context())
      expect(hit.success, hit.error).toBe(true)
      expect((hit.data as { technique: TechniqueRecord }).technique.tacticNames, t.attack_id).toContain(tactic!.name)
    }
  }, 60_000)

  it.skipIf(!!platform.problem)('get_mitre_defend techniques_by_tactic: a tactic by its name gives its techniques, as by its node id', async () => {
    const tactics = await getMitreDefendTool.run({ action: 'tactics' }, await context())
    expect(tactics.success, tactics.error).toBe(true)
    const harden = (tactics.data as { tactics: Array<{ id: string; name: string }> }).tactics.find((t) => t.name === 'Harden')
    expect(harden, 'Harden among the D3FEND tactics').toBeDefined()
    const byName = await getMitreDefendTool.run({ action: 'techniques_by_tactic', tactic_id: 'Harden' }, await context())
    expect(byName.success, byName.error).toBe(true)
    const techniques = (byName.data as { techniques: unknown[] }).techniques
    expect(techniques.length).toBeGreaterThanOrEqual(1)
    const byId = await getMitreDefendTool.run({ action: 'techniques_by_tactic', tactic_id: harden!.id }, await context())
    expect((byId.data as { techniques: unknown[] }).techniques).toHaveLength(techniques.length)
  }, 60_000)

  it.skipIf(!!platform.problem)('manage_analyses results: an analysis the platform lists gives its document, or no_results, never an error as its results', async () => {
    const models = await listModelsTool.run({}, await context())
    expect(models.success, models.error).toBe(true)
    let read = 0
    let documents = 0
    for (const model of ((models.data as { models: Array<{ id: string }> }).models ?? []).slice(0, 20)) {
      const listed = await manageAnalysesTool.run({ action: 'list', element_id: model.id }, await context())
      expect(listed.success, listed.error).toBe(true)
      for (const analysis of (listed.data as { analyses: Array<{ id: string }> }).analyses.slice(0, 5)) {
        const r = await manageAnalysesTool.run({ action: 'results', analysis_id: analysis.id }, await context())
        expect(r.success, r.error).toBe(true)
        const data = r.data as { status?: string; results?: Record<string, unknown> }
        read++
        if (data.status !== 'no_results') {
          expect(Object.keys(data.results ?? {})).not.toEqual(['error'])
          documents++
        }
      }
      if (documents) break
    }
    // Every analysis answering no_results is what a broken read would look like too: say so rather than pass quietly.
    if (!documents) console.warn(`[triage-exposures] ${read} analyses read, none with a document: manage_analyses results not shown working live`)
  }, 180_000)

  it.skipIf(!!platform.problem)('match: tagged candidates within top_n, and an exact id through the exact tier', async () => {
    const res = await searchMitreAttackTool.run({ action: 'match', query: 'credential stuffing', top_n: 3 }, await context())
    expect(res.success, res.error).toBe(true)
    const data = res.data as MatchResult
    expect(data.candidates.length).toBeGreaterThanOrEqual(1)
    expect(data.candidates.length).toBeLessThanOrEqual(3)
    for (const c of data.candidates) {
      expect(['EXACT_ID', 'PREFIX_ID', 'NAME_MATCH', 'DESCRIPTION_MATCH', 'VECTOR_SIMILARITY']).toContain(c.matchType)
      expect(c).not.toHaveProperty('id')
    }
    expect(typeof data.vectorAvailable).toBe('boolean')

    const exact = await searchMitreAttackTool.run({ action: 'match', query: 'T1078.001', top_n: 1 }, await context())
    expect((exact.data as MatchResult).candidates[0]).toMatchObject({ mitreId: 'T1078.001', matchType: 'EXACT_ID' })
  }, 30_000)
})
