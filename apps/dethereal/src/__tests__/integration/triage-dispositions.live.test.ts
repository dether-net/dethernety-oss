/**
 * triage_review and manage_dispositions against a running platform, the one named for it (live-platform.ts). It WRITES: it
 * imports a model of its own (the synthetic fixture's key model), writes dispositions on it, and deletes it at the
 * end. It never touches another model.
 *
 * Runs only with DETHEREAL_TRIAGE_LIVE=1, DETHERNETY_URL naming the platform, and DETHEREAL_TRIAGE_LIVE_WRITE set to
 * that same URL (live-platform.ts). Once switched on, a platform it cannot use fails the suite.
 *
 * What it shows on the live platform:
 * - every list_model page stays under the page budget, and the partition's counts agree with the groups and rows walks;
 * - prepare checks each operation against the platform as it is now: an exposure changed since the review was opened
 *   is not applied, the others are;
 * - a cancel writes nothing, and a reply that is neither yes nor cancel is refused, writing nothing;
 * - an exposure changed between prepare and commit makes the commit refuse the whole plan, and the platform keeps
 *   that change and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DtExposure, DtModel } from '@dethernety/dt-core'
import type { ToolContext } from '../../tools/base-tool.js'
import { generateAttributeStubsTool } from '../../tools/generate-attribute-stubs.tool.js'
import { importModelTool } from '../../tools/import-model.tool.js'
import { queryExposuresTool } from '../../tools/query-security.tool.js'
import { resultText } from '../../tools/base-tool.js'
import { LIST_MODEL_PAGE_CHARS } from '../../triage/model-views.js'
import { triageReviewTool } from '../../tools/triage-review.tool.js'
import { manageDispositionsTool } from '../../tools/manage-dispositions.tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { liveContext, livePlatform } from './live-platform.js'

const KEY_MODEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'acceptance', 'fixtures', 'synthetic', 'key', 'model')
const platform = await livePlatform({ write: true })

type Row = { exposure_id: string; name: string; disposition_kind: string | null; disposition_reason: string | null; dispositioned_at: string | null; disposition_stale: boolean | null }
type Result = { success: boolean; error?: string; data?: Record<string, unknown> }

describe.runIf(platform.enabled)('triage dispositions on the named platform (writes a model of its own)', () => {
  let tmp: string
  let dir: string
  let modelId: string | undefined
  let context: ToolContext
  const queryExposures = queryExposuresTool

  /** Every page of a list_model view, each checked against the page budget as the server sends it. */
  const walk = async (input: Record<string, unknown>): Promise<Array<Record<string, unknown>>> => {
    const pages: Array<Record<string, unknown>> = []
    let next: Record<string, unknown> = {}
    for (;;) {
      const r = (await queryExposures.run({ action: 'list_model', directory_path: dir, ...input, ...next }, context)) as Result
      expect(r.success, r.error).toBe(true)
      expect(resultText(r.data).length).toBeLessThanOrEqual(LIST_MODEL_PAGE_CHARS)
      pages.push(r.data!)
      if (!r.data!.truncated) return pages
      next = { offset: r.data!.next_offset, listing: r.data!.listing }
    }
  }
  const rows = async (): Promise<Row[]> => (await walk({ view: 'rows', select: 'all' })).flatMap((p) => p.rows as Row[])
  const stateOf = async (id: string) => {
    const r = (await rows()).find((x) => x.exposure_id === id)!
    return { kind: r.disposition_kind, reason: r.disposition_reason, at: r.dispositioned_at, stale: r.disposition_stale }
  }
  const open = async (groups: unknown[]) => {
    const r = (await triageReviewTool.run({ action: 'open', directory_path: dir, mode: 'review', groups }, context)) as Result
    expect(r.success, r.error).toBe(true)
    return String(r.data!.review_id)
  }
  /** Close a review a failed test left open, so the next test's open is not refused as review_open. */
  const closeQuietly = (review_id: string) => triageReviewTool.run({ action: 'reply', review_id, reply: 'done' }, context).catch(() => undefined)
  const reply = async (review_id: string, text: string) => {
    const r = (await triageReviewTool.run({ action: 'reply', review_id, reply: text }, context)) as Result
    expect(r.success, r.error).toBe(true)
  }
  const prepare = async (review_id: string) => {
    const r = (await manageDispositionsTool.run({ action: 'prepare', directory_path: dir, review_id }, context)) as Result
    expect(r.success, r.error).toBe(true)
    return r.data as { plan_id: string; count: number; lines: string[]; ask?: string; operations: Array<{ exposure_id: string; status: string; code?: string }> }
  }
  const commit = (plan_id: string, lines: string[], text: string) =>
    manageDispositionsTool.run({ action: 'commit', directory_path: dir, plan_id, lines, reply: text }, context) as Promise<Result>
  const direct = (exposureId: string) => new DtExposure(context.apolloClient!).disposeExposure({ exposureId, kind: 'AFFIRMED', reason: 'changed outside the review by the live test' })

  beforeAll(async () => {
    if (platform.problem) return
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'triage-live-')))
    initProjectRoot({ cwd: tmp, env: {} })
    dir = path.join(tmp, 'model')
    fs.cpSync(KEY_MODEL, dir, { recursive: true })
    context = await liveContext()
    // The push gate derives the model's modules from its class cache, which the fixture does not carry: filled from the platform's classes.
    const stubs = (await generateAttributeStubsTool.run({ directory_path: dir }, context)) as Result
    expect(stubs.success, stubs.error).toBe(true)
    const imported = (await importModelTool.run({ directory_path: dir, create_backup: false }, context)) as Result
    // The id first, so the model is deleted whatever fails next.
    modelId = typeof imported.data?.model_id === 'string' ? imported.data.model_id : undefined
    expect(imported.success, imported.error).toBe(true)
    expect(modelId).toBeTruthy()
    // The platform computes the exposures after the import: wait until their count holds for two reads.
    let last = -1
    for (let i = 0; i < 36; i++) {
      const n = (await rows()).length
      if (n > 0 && n === last) return
      last = n
      await new Promise((r) => setTimeout(r, 5000))
    }
    throw new Error(`the imported model's exposures did not settle (last count ${last})`)
  }, 240_000)

  afterAll(async () => {
    try {
      if (modelId) expect(await new DtModel(context.apolloClient!).deleteModel({ modelId }), 'the test model was not deleted').not.toBeNull()
    } finally {
      resetProjectRoot()
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    }
  }, 60_000)

  it('runs on a platform named for it, signed in or with authentication disabled', () => {
    if (platform.problem) throw new Error(platform.problem)
  })

  it.skipIf(!!platform.problem)('pages every view of the model under the budget, the partition agreeing with the walks', async () => {
    const started = Date.now()
    const r = (await queryExposures.run({ action: 'list_model', directory_path: dir }, context)) as Result
    // The time of one full model read, for the record.
    console.log(`list_model partition read: ${Date.now() - started} ms`)
    expect(r.success, r.error).toBe(true)
    expect(resultText(r.data).length).toBeLessThanOrEqual(LIST_MODEL_PAGE_CHARS)
    const partition = r.data as { exposures: number; triage: number; totals: Record<string, number> }
    const groups = await walk({ view: 'groups' })
    for (const page of groups) expect(page.rows_total).toBe(partition.triage)
    expect(groups.flatMap((p) => (p.groups as Array<{ members: unknown[] }>).flatMap((g) => g.members))).toHaveLength(partition.triage)
    const all = (await walk({ view: 'rows', select: 'all' })).flatMap((p) => p.rows as Array<Row & { lifecycle: string; created_by: string | null }>)
    const count = (f: (x: (typeof all)[number]) => boolean) => all.filter(f).length
    expect({
      pending: count((x) => x.lifecycle === 'pending'), confirmed: count((x) => x.lifecycle === 'confirmed'), disposed: count((x) => x.lifecycle === 'disposed'),
      stale: count((x) => x.disposition_stale === true), user: count((x) => x.created_by === 'USER'), system: count((x) => x.created_by !== 'USER'),
    }).toEqual(partition.totals)
  }, 120_000)

  it.skipIf(!!platform.problem)('prepares against the platform as it is now; a cancel and a non-answer write nothing', async () => {
    const undisposed = (await rows()).filter((r) => r.disposition_kind === null)
    expect(undisposed.length).toBeGreaterThanOrEqual(2)
    const [a, b] = undisposed
    const id = await open([
      { group: 1, exposure_ids: [a!.exposure_id], proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'the live test proposes this' } },
      { group: 2, exposure_ids: [b!.exposure_id], proposal: { op: 'dispose', kind: 'NOT_APPLICABLE', reason: 'the live test proposes this' } },
    ])
    try {
      await reply(id, 'accept-all')
    } finally {
      await closeQuietly(id)
    }
    // Changed after the review was opened: prepare must find it changed, and still plan the other.
    expect((await direct(b!.exposure_id)).success).toBe(true)
    const plan = await prepare(id)
    expect(plan.operations).toEqual([
      expect.objectContaining({ exposure_id: a!.exposure_id, status: 'ready' }),
      expect.objectContaining({ exposure_id: b!.exposure_id, status: 'rejected', code: 'target_changed' }),
    ])
    expect(plan.count).toBe(1)
    expect(plan.ask).toBe('[prompt: triage-apply] Apply 1 dispositions? Type yes or cancel.')
    const before = await stateOf(a!.exposure_id)
    const refused = await commit(plan.plan_id, plan.lines, 'maybe')
    expect(refused.success).toBe(false)
    expect((refused.data as { codes: string[] }).codes).toEqual(['reply_not_answer'])
    expect((refused.data as { ask?: string }).ask).toBe(plan.ask)
    expect(await stateOf(a!.exposure_id)).toEqual(before)
    const cancelled = await commit(plan.plan_id, plan.lines, 'cancel')
    expect(cancelled.success, cancelled.error).toBe(true)
    expect(cancelled.data).toMatchObject({ cancelled: true, written: 0 })
    expect(await stateOf(a!.exposure_id)).toEqual(before)
  }, 120_000)

  it.skipIf(!!platform.problem)('refuses a plan whose exposure changed after prepare, and writes nothing of it', async () => {
    const [a] = (await rows()).filter((r) => r.disposition_kind === null)
    const id = await open([{ group: 1, exposure_ids: [a!.exposure_id], proposal: { op: 'dispose', kind: 'FALSE_POSITIVE', reason: 'the live test proposes this' } }])
    try {
      await reply(id, 'accept 1')
      await reply(id, 'done')
    } finally {
      await closeQuietly(id)
    }
    const plan = await prepare(id)
    expect(plan.count).toBe(1)
    expect((await direct(a!.exposure_id)).success).toBe(true)
    const changed = await stateOf(a!.exposure_id)
    expect(changed.kind).toBe('AFFIRMED')
    const r = await commit(plan.plan_id, plan.lines, 'yes')
    expect(r.success).toBe(false)
    expect((r.data as { codes: string[]; changed?: string[] }).codes).toEqual(['plan_stale'])
    expect((r.data as { changed: string[] }).changed).toEqual([a!.exposure_id])
    expect(await stateOf(a!.exposure_id)).toEqual(changed)
  }, 120_000)
})
