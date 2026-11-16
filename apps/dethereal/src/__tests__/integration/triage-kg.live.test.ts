/**
 * get_kg_chain and get_class_guide against a running platform, the one named for it (live-platform.ts). Read-only: probe,
 * chain, evaluate and class guide reads, no platform writes; the task-list case writes only into a temporary model
 * directory of its own.
 *
 * Runs only with DETHEREAL_TRIAGE_LIVE=1 and DETHERNETY_URL naming a platform whose /config reports
 * authentication disabled, or the server holding a live session for it in this HOME (live-platform.ts); once switched on, a platform it cannot use fails the suite. The chain and
 * evaluate checks skip when the probe reports no knowledge graph, which is a supported deployment.
 *
 * DETHEREAL_TRIAGE_EXPECT_REGIME (module_not_loaded, not_entitled, no_data or kg_present) names the regime the
 * platform was set up to give: the probe must answer it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gql } from '@apollo/client'
import { lintRemediationText } from '@dethernety/dt-module/remediation-honesty'
import { triageReviewTool } from '../../tools/triage-review.tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { cleanText, QUOTE_MIN } from '../../triage/tasks.js'
import { GetKgChainTool, type EvaluateResult, type KgUnavailableResult } from '../../tools/get-kg-chain.tool.js'
import { getClassGuideTool, type GetClassGuideOutput } from '../../tools/get-class-guide.tool.js'
import { getClassesTool } from '../../tools/get-classes.tool.js'
import type { ToolContext } from '../../tools/base-tool.js'
import type { KgChain, KgProbeResult } from '../../triage/kg.js'
import { liveContext, livePlatform } from './live-platform.js'

const platform = await livePlatform()
const REGIMES = ['module_not_loaded', 'not_entitled', 'no_data', 'kg_present'] as const
const expected = process.env.DETHEREAL_TRIAGE_EXPECT_REGIME || undefined

const SAMPLE_GUIDED_CLASSES = gql`
  query {
    componentClasses(limit: 25) {
      id
      guide
    }
  }
`

const UNKNOWN_CLASS = '00000000-0000-4000-8000-000000000000'

/** The most classes the search for a covered class reads a chain for. */
const COVERED_SEARCH_CAP = 50
/** Component class types as get_classes reports them: a component class without a type of its own reports COMPONENT. */
const COMPONENT_TYPES = ['PROCESS', 'STORE', 'EXTERNAL_ENTITY', 'COMPONENT']

type Predicate = { attribute: string; operator: string; value?: unknown }

/**
 * A class the knowledge graph covers, found as the product reads it: the platform's classes from get_classes, component
 * classes first, then the rest, each by id; a chain is read for each, up to the cap, and the first covered one counts.
 * Rules are never read without a class: the platform refuses that.
 */
async function coveredClass(tool: GetKgChainTool, context: ToolContext): Promise<string> {
  const classes: Array<{ id: string; type?: string }> = []
  for (let offset: number | undefined = 0; offset !== undefined; ) {
    const page = await getClassesTool.run({ fields: ['id', 'type'], limit: 200, offset }, context)
    if (!page.success) throw new Error(`get_classes failed: ${page.error}`)
    const data = page.data as { classes: Array<{ id: string; type?: string }>; next_offset?: number }
    classes.push(...data.classes)
    offset = data.next_offset
  }
  const rank = (c: { type?: string }): number => (COMPONENT_TYPES.includes(c.type ?? '') ? 0 : 1)
  const ids = [...new Set(classes.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((c) => c.id))]
  const read = ids.slice(0, COVERED_SEARCH_CAP)
  for (const classId of read) {
    const res = await tool.run({ action: 'chain', class_id: classId }, context)
    if (!res.success) throw new Error(`get_kg_chain chain failed for ${classId}: ${res.error}`)
    // A read that failed latches: every later chain answers it, so it is never read as a catalogue without coverage.
    if ('unavailable' in (res.data as object)) throw new Error(`get_kg_chain chain unavailable for ${classId}: ${(res.data as KgUnavailableResult).reason}`)
    if ((res.data as KgChain).covered) return classId
  }
  throw new Error(`this platform's catalogue has no class the knowledge graph covers among the first ${read.length} read (cap ${COVERED_SEARCH_CAP}) of its ${ids.length} classes`)
}

describe.runIf(platform.enabled)('knowledge-graph tools against the named platform', () => {
  it('runs on a platform named for it, signed in or with authentication disabled, and a known expected regime if one is set', () => {
    if (platform.problem) throw new Error(platform.problem)
    if (expected !== undefined && !(REGIMES as readonly string[]).includes(expected)) throw new Error(`DETHEREAL_TRIAGE_EXPECT_REGIME is one of ${REGIMES.join(', ')}, not ${expected}`)
  })

  it.skipIf(!!platform.problem)('probe gives a definite regime, the expected one when set; chain and evaluate answer for a covered and an uncovered class', async () => {
    const context = await liveContext()
    const tool = new GetKgChainTool()

    const probe = await tool.run({ action: 'probe' }, context)
    expect(probe.success).toBe(true)
    const regime = probe.data as KgProbeResult
    if (expected !== undefined) expect(regime.regime === 'kg_present' ? 'kg_present' : regime.reason).toBe(expected)
    if (regime.regime === 'kg_absent') {
      expect(['module_not_loaded', 'no_data', 'not_entitled']).toContain(regime.reason)
      console.warn(`[triage-kg] kg_absent (${regime.reason}): chain and evaluate not checked`)
      return
    }
    expect(regime).toEqual({ regime: 'kg_present' })

    const classId = await coveredClass(tool, context)

    const res = await tool.run({ action: 'chain', class_id: classId }, context)
    expect(res.success).toBe(true)
    const chain = res.data as KgChain
    if (!chain.covered) throw new Error('expected the discovered class to be covered')
    expect(chain.classId).toBe(classId)
    expect(chain.rules.length).toBeGreaterThanOrEqual(1)
    const rule = chain.rules[0]!
    expect(rule.malformed).toBeUndefined()
    expect(rule.conditionGroups.length).toBeGreaterThanOrEqual(1)
    expect(rule.readAttributes.length).toBeGreaterThanOrEqual(1)
    expect(chain.threats.length).toBeGreaterThanOrEqual(1)
    const provenanced = chain.threats.find((t) => t.techniqueProvenance !== null)
    if (provenanced) expect(Array.isArray(provenanced.techniqueProvenance)).toBe(true)
    expect(chain.corpus.some((c) => c.synthesis || c.canonicalUrl)).toBe(true)

    const uncovered = await tool.run({ action: 'chain', class_id: UNKNOWN_CLASS }, context)
    expect(uncovered).toEqual({ success: true, data: { covered: false, classId: UNKNOWN_CLASS } })

    // Platform attribute values are not readable over GraphQL, so the map satisfies the rule's first group.
    const groups = rule.conditionGroups as Predicate[][]
    const attrs: Record<string, unknown> = {}
    for (const pred of groups[0]!) {
      if (pred.operator === 'is_false' || pred.operator === 'not_exists') attrs[pred.attribute] = false
      else if (pred.operator === 'is_true' || pred.operator === 'exists') attrs[pred.attribute] = true
      else if (pred.value !== undefined) attrs[pred.attribute] = pred.value
    }
    const evRes = await tool.run({ action: 'evaluate', class_id: classId, rule_name: rule.name, attributes: attrs }, context)
    expect(evRes.success).toBe(true)
    const ev = evRes.data as EvaluateResult
    expect(ev.covered).toBe(true)
    expect(ev.ruleName).toBe(rule.name)
    expect(ev.verdicts).toHaveLength(groups.length)
    expect(ev.satisfied.length).toBeGreaterThanOrEqual(1)
    expect(ev.deltas.length).toBe(ev.satisfied.length)
    expect(ev.deltas.every((d) => d.sufficientAlone === (ev.satisfied.length === 1))).toBe(true)
    expect(ev.framing).toContain('counterfactual')

    // Operators that type the attribute, so an object there is unevaluable. Not `in`: like Rego `attr in [...]`, it decides any present value.
    const typed = new Set(['gt', 'gte', 'lt', 'lte', 'has_element', 'not_has_element', 'count_eq', 'contains'])
    let target: { ruleName: string; groupIndex: number; attribute: string } | undefined
    outer: for (const r of chain.rules) {
      for (let gi = 0; gi < r.conditionGroups.length; gi++) {
        for (const pred of r.conditionGroups[gi]!) {
          if (typed.has(pred.operator)) {
            target = { ruleName: r.name, groupIndex: gi, attribute: pred.attribute }
            break outer
          }
        }
      }
    }
    if (target) {
      const bad = await tool.run(
        { action: 'evaluate', class_id: classId, rule_name: target.ruleName, attributes: { [target.attribute]: { not: 'a comparable value' } } },
        context,
      )
      expect(bad.success).toBe(true)
      expect((bad.data as EvaluateResult).unevaluable).toContain(target.groupIndex)
    } else {
      console.warn('[triage-kg] no rule with a typed operator: unevaluable not checked live')
    }

    const unknownRule = await tool.run({ action: 'evaluate', class_id: classId, rule_name: 'no such rule name', attributes: {} }, context)
    expect(unknownRule).toEqual({ success: true, data: { covered: true, classId, rule_found: false } })
  }, 60_000)

  it.skipIf(!!platform.problem)('class guide returns authored steps without the security impact; no guidance gives no entries', async () => {
    const context = await liveContext()
    const sample = (await context.apolloClient!.query({ query: SAMPLE_GUIDED_CLASSES })) as {
      data?: { componentClasses?: Array<{ id: string; guide: unknown }> }
    }
    let target: { classId: string; keys: string[]; rawHadImpact: boolean } | undefined
    for (const c of sample.data?.componentClasses ?? []) {
      if (typeof c.guide !== 'string' || c.guide.length < 10) continue
      try {
        const parsed = JSON.parse(c.guide) as Array<{ option_name?: string; how_to_obtain?: unknown[]; security_impact?: string }>
        if (!Array.isArray(parsed)) continue
        const usable = parsed.filter((e) => typeof e?.option_name === 'string' && Array.isArray(e.how_to_obtain) && e.how_to_obtain.length > 0)
        if (usable.length >= 2) {
          target = { classId: c.id, keys: usable.slice(0, 2).map((e) => e.option_name!), rawHadImpact: usable.some((e) => typeof e.security_impact === 'string') }
          break
        }
      } catch {
        continue
      }
    }
    if (!target) {
      console.warn('[triage-kg] no guided component class on this platform: class guide not checked')
      return
    }

    const r = await getClassGuideTool.run({ class_id: target.classId, element_kind: 'component', attribute_keys: target.keys }, context)
    expect(r.success).toBe(true)
    const { entries } = r.data as GetClassGuideOutput
    expect(entries.length).toBe(target.keys.length)
    for (const e of entries) {
      expect(target.keys).toContain(e.optionName)
      expect(e.howToObtain[0]!.instruction.length).toBeGreaterThan(0)
    }
    // The strip, checked against a guide that really carried the field.
    expect(target.rawHadImpact).toBe(true)
    const serialized = JSON.stringify(r.data)
    expect(serialized).not.toContain('security_impact')
    expect(serialized).not.toContain('securityImpact')

    const unmatched = await getClassGuideTool.run(
      { class_id: target.classId, element_kind: 'component', attribute_keys: ['no_such_attribute_key'] },
      context,
    )
    expect(unmatched).toEqual({ success: true, data: { entries: [] } })
    const missing = await getClassGuideTool.run({ class_id: UNKNOWN_CLASS, element_kind: 'component', attribute_keys: ['x'] }, context)
    expect(missing).toEqual({ success: true, data: { entries: [] } })
  }, 60_000)

  it.skipIf(!!platform.problem)('the task list quotes a real guide line whole and is written; a claim of its own is refused', async () => {
    const context = await liveContext()
    const sample = (await context.apolloClient!.query({ query: SAMPLE_GUIDED_CLASSES })) as {
      data?: { componentClasses?: Array<{ id: string; guide: unknown }> }
    }
    // A guided component class and one of its fields long enough to quote, preferring one that holds a listed word,
    // which only the quote rule lets through.
    let pick: { classId: string; key: string; quote: string } | undefined
    for (const c of sample.data?.componentClasses ?? []) {
      if (typeof c.guide !== 'string') continue
      let parsed: unknown
      try {
        parsed = JSON.parse(c.guide)
      } catch {
        continue
      }
      if (!Array.isArray(parsed)) continue
      for (const e of parsed as Array<{ option_name?: unknown; how_to_obtain?: Array<{ instruction?: unknown; expected_output?: unknown }> }>) {
        if (typeof e?.option_name !== 'string' || !Array.isArray(e.how_to_obtain)) continue
        for (const step of e.how_to_obtain) {
          // A step with no instruction is no guidance: the tool drops it, so its fields are never quotable.
          if (typeof step?.instruction !== 'string' || step.instruction.length === 0) continue
          for (const field of [step.instruction, step.expected_output]) {
            if (typeof field !== 'string' || cleanText(field).length < QUOTE_MIN) continue
            const candidate = { classId: c.id, key: e.option_name, quote: cleanText(field) }
            if (lintRemediationText(candidate.quote).length) pick = candidate
            else pick ??= candidate
          }
        }
      }
      if (pick && lintRemediationText(pick.quote).length) break
    }
    if (!pick) {
      console.warn('[triage-kg] no guided component class on this platform: the task-list quote not checked')
      return
    }
    console.log(`[triage-kg] task-list quote ${lintRemediationText(pick.quote).length ? 'holds a listed word' : 'holds no listed word'}`)

    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'triage-tasks-live-')))
    try {
      initProjectRoot({ cwd: tmp, env: {} })
      const dir = path.join(tmp, 'model')
      const runs = ['run-20261115-001500', 'run-20261115-001501'] as const
      for (const run of runs) fs.mkdirSync(path.join(dir, '.dethereal', 'triage-run', run), { recursive: true })
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ model: { id: 'local', name: 'M' } }))
      fs.writeFileSync(path.join(dir, 'structure.json'), JSON.stringify({ defaultBoundary: { id: 'b0', name: 'Edge', boundaries: [], components: [{ id: 'c1', name: 'api', classData: { id: pick.classId, name: 'Guided' } }] } }))
      fs.writeFileSync(path.join(dir, 'dataflows.json'), '[]')
      fs.writeFileSync(path.join(dir, 'data-items.json'), '[]')
      const text = `Task list derived from the threat model's attributes as of 2026-11-15.\n- ${pick.quote}`
      const guides = [{ class_id: pick.classId, element_kind: 'component', attribute_keys: [pick.key] }]
      const written = await triageReviewTool.run({ action: 'tasks', directory_path: dir, run: runs[0], text, guides }, context)
      expect(written.success, written.error).toBe(true)
      expect(written.data).toMatchObject({ written: true, path: `.dethereal/triage-run/${runs[0]}/remediation-tasks-2026-11-15.md`, quotes_exempted: 1 })
      expect(fs.readFileSync(path.join(dir, (written.data as { path: string }).path), 'utf8')).toBe(text)
      const refused = await triageReviewTool.run({ action: 'tasks', directory_path: dir, run: runs[1], text: `${text}\nApplying this fixes the finding.`, guides }, context)
      expect((refused.data as { codes?: string[] }).codes).toEqual(['claims_found'])
      expect(fs.readdirSync(path.join(dir, '.dethereal', 'triage-run', runs[1]))).toEqual([])
    } finally {
      resetProjectRoot()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }, 60_000)
})
