/**
 * update_attributes checks the platform before it pushes, within what it writes:
 * the attribute values of the elements it sends. A colleague's change to one of
 * those is never overwritten unnamed; a change it does not overwrite neither
 * refuses it nor goes into the record; and its own writes never read as platform
 * changes on the next push. The platform is simulated: the push merges the sent
 * values into it, and every export returns a fresh copy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SplitModel } from '@dethernety/dt-core'
import type { ToolContext } from '../base-tool.js'
import { richExport } from './fixtures/platform-export.js'

const { platform, exports, updates } = vi.hoisted(() => ({
  platform: { model: null as any, exportFails: [] as boolean[] },
  exports: { count: 0 },
  updates: { calls: [] as any[], during: null as null | (() => Promise<void>) },
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtExportSplit: class {
      constructor(_c: unknown) {}
      exportModelToSplit = async () => {
        const fail = platform.exportFails[exports.count++]
        if (fail) throw new Error('network')
        return JSON.parse(JSON.stringify(platform.model))
      }
    },
    DtUpdateSplit: class {
      constructor(_c: unknown) {}
      updateAttributesOnly = async (_modelId: string, sent: Record<string, Record<string, any>>) => {
        updates.calls.push(JSON.parse(JSON.stringify(sent)))
        if (updates.during) await updates.during()
        for (const [group, bag] of Object.entries(sent)) {
          for (const [id, entry] of Object.entries(bag ?? {})) {
            if (!entry?.classData?.id || !entry.attributes || !Object.keys(entry.attributes).length) continue
            const target = (platform.model.attributes[group] ??= {})
            const old = target[id]?.attributes ?? {}
            target[id] = { ...(target[id] ?? {}), elementId: id, classData: entry.classData, attributes: { ...old, ...entry.attributes } }
          }
        }
        const zero = { updated: 0, failed: 0 }
        return { success: true, errors: [], warnings: [], stats: { boundaries: zero, components: zero, dataFlows: zero, dataItems: zero, total: zero } }
      }
    },
  }
})

// The gates have their own tests; here every model passes them.
vi.mock('../../utils/gates.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../utils/gates.js')
  return { ...actual, directoryPushRefusal: async () => null }
})

const { updateAttributesTool } = await import('../update-attributes.tool.js')
const { writeModelDirectory } = await import('../../utils/directory-utils.js')
const { readSyncJson, writeSyncJson } = await import('../../utils/sync-utils.js')
const { initProjectRoot, resetProjectRoot } = await import('../../utils/project-root.js')
const { checkPlatformChanges, fingerprintSplitModel, signPlatformBaseline, MODEL_PUSH_FIELDS, ATTRIBUTE_PUSH_FIELDS } =
  await import('../../utils/platform-baseline.js')

const context: ToolContext = { debug: false, apolloClient: {} as never }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/** The platform model: the rich fixture, with a class on its flow and first data item so their values can be pushed. */
function platformModel(): any {
  const m = clone(richExport()) as any
  m.attributes.dataFlows['f-1'].classData = { id: 'cls-flow', name: 'Flow' }
  m.dataFlows[0].classData = { id: 'cls-flow', name: 'Flow' }
  m.attributes.dataItems['d-1'].classData = { id: 'cls-data', name: 'Data' }
  m.dataItems[0].classData = { id: 'cls-data', name: 'Data' }
  return m
}

describe('update_attributes checks the platform before it pushes', () => {
  let tmp: string
  let dir: string
  const savedHome = process.env.HOME

  /** Record the platform as it is now as this directory's baseline (optionally leaving elements out). */
  const recordBaseline = async (leaveOut: string[] = []) => {
    const prints = fingerprintSplitModel(platform.model as SplitModel)
    for (const id of leaveOut) delete prints[id]
    const signed = await signPlatformBaseline(dir, 'm-1', prints)
    expect(signed.record).not.toBeNull()
    await writeSyncJson(dir, { platform_model_id: 'm-1', platform_url: 'x', platform_baseline: signed.record })
  }
  /** Change one local attribute file. */
  const local = (group: string, id: string, attributes: Record<string, unknown>, classData?: unknown) => {
    const file = path.join(dir, 'attributes', group, `${id}.json`)
    const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { elementId: id }
    doc.attributes = attributes
    if (classData !== undefined) doc.classData = classData
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(doc, null, 2))
  }
  const push = (extra: Record<string, unknown> = {}) => updateAttributesTool.run({ model_id: 'm-1', directory_path: dir, ...extra }, context)
  /** What a later update_model would refuse, against the platform as it is now. */
  const modelCheck = () =>
    checkPlatformChanges(dir, 'm-1', fingerprintSplitModel(platform.model as SplitModel), { includeAdded: true, scope: { fields: MODEL_PUSH_FIELDS } })
  const syncBytes = () => fs.readFileSync(path.join(dir, '.dethereal', 'sync.json'), 'utf8')

  beforeEach(async () => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-attr-check-')))
    const project = path.join(tmp, 'project')
    dir = path.join(project, 'model')
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    initProjectRoot({ cwd: project, env: {} })
    platform.model = platformModel()
    platform.exportFails = []
    exports.count = 0
    updates.calls = []
    updates.during = null
    await writeModelDirectory(dir, clone(platform.model))
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("never reads the operator's own attribute push as a platform change afterwards", async () => {
    await recordBaseline()
    local('components', 'c-web', { tls: false })
    local('dataItems', 'd-1', { retention: '2y' })
    const res = await push()
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data).toMatchObject({ platform_baseline: 'recorded' })
    expect(res.data).not.toHaveProperty('acknowledgement')
    expect(platform.model.attributes.components['c-web'].attributes).toEqual({ tls: false })

    expect((await modelCheck()).refusal).toBeUndefined()
    const again = await push()
    expect(again.success, JSON.stringify(again)).toBe(true)
    expect(again.data).not.toHaveProperty('acknowledgement')
  })

  it("refuses a colleague's change to a value it would overwrite, names only that element, and writes nothing", async () => {
    await recordBaseline()
    platform.model.attributes.components['c-web'].attributes = { tls: 'set by a colleague' }
    local('components', 'c-web', { tls: false })
    local('boundaries', 'b-dmz', { ingress: 'lb' })
    const before = syncBytes()

    const res = await push()
    expect(res.success).toBe(false)
    expect(res.data).toMatchObject({
      code: 'PLATFORM_CHANGED_SINCE_SYNC',
      baseline: 'verified',
      changes: [{ id: 'c-web', change: 'modified', fields: ['attributes'] }],
      changed_ids: ['c-web'],
    })
    expect(updates.calls).toHaveLength(0)
    expect(syncBytes()).toBe(before)

    // Named, it is overwritten; the platform then holds exactly what was sent, so it is recorded as the push left it.
    const { changed_ids, revision } = res.data as any
    const named = await push({ overwrite_changed: changed_ids, overwrite_revision: revision })
    expect(named.success, JSON.stringify(named)).toBe(true)
    expect(named.data).toMatchObject({ acknowledgement: 'accepted', platform_baseline: 'recorded' })
    // Neither it nor the other element it wrote reads as a platform change afterwards.
    expect((await modelCheck()).refusal).toBeUndefined()
  })

  /** A colleague changes c-web's attributes; the operator's push is refused, then overwrites them by name. */
  const overwriteColleague = async (colleague: Record<string, unknown>, mine: Record<string, unknown>, alsoOnPlatform?: () => void) => {
    await recordBaseline()
    alsoOnPlatform?.()
    platform.model.attributes.components['c-web'].attributes = colleague
    local('components', 'c-web', mine)
    const refused = await push()
    expect(refused.success).toBe(false)
    const { changed_ids, revision } = refused.data as any
    const named = await push({ overwrite_changed: changed_ids, overwrite_revision: revision })
    expect(named.success, JSON.stringify(named)).toBe(true)
  }

  it('after an overwrite, its own write never reads as a platform change: the next pushes go through', async () => {
    await overwriteColleague({ tls: 'set by a colleague' }, { tls: false })
    local('components', 'c-web', { tls: true })
    const next = await push()
    expect(next.success, JSON.stringify(next)).toBe(true)
    expect(next.data).not.toHaveProperty('acknowledgement')
    const idle = await push()
    expect(idle.success, JSON.stringify(idle)).toBe(true)
  })

  it('refreshes an overwritten element whose local values hold a null, which the push withholds', async () => {
    await overwriteColleague({ tls: 'set by a colleague' }, { tls: false, waf: null })
    expect(platform.model.attributes.components['c-web'].attributes).toEqual({ tls: false })
    const next = await push()
    expect(next.success, JSON.stringify(next)).toBe(true)
  })

  it('keeps an overwritten element changed while a value of the colleague it did not overwrite survives', async () => {
    await overwriteColleague({ tls: 'set by a colleague', waf: 'added by a colleague' }, { tls: false })
    expect(platform.model.attributes.components['c-web'].attributes).toEqual({ tls: false, waf: 'added by a colleague' })
    // The surviving value still reads as changed, to update_model and to the next attribute push alike.
    expect((await modelCheck()).refusal?.data.changed_ids).toEqual(['c-web'])
    const next = await push()
    expect(next.success).toBe(false)
    expect(next.data).toMatchObject({ changed_ids: ['c-web'], changes: [{ id: 'c-web', change: 'modified', fields: ['attributes'] }] })
  })

  it('refreshes only the attributes: a property the colleague changed still refuses the next update_model', async () => {
    await overwriteColleague({ tls: 'set by a colleague' }, { tls: false }, () => {
      platform.model.structure.defaultBoundary.boundaries[0].components[0].name = 'Renamed by a colleague'
    })
    const later = await modelCheck()
    expect(later.refusal?.data.changes).toEqual([expect.objectContaining({ id: 'c-web', change: 'modified', fields: ['properties'] })])
  })

  it('neither refuses nor records a platform change it does not overwrite', async () => {
    await recordBaseline()
    // A colleague moved the web component and edited the DMZ boundary's attributes; this push sends only c-web.
    platform.model.structure.defaultBoundary.boundaries[0].components[0].positionX = 999
    platform.model.attributes.boundaries['b-dmz'].attributes = { ingress: 'colleague' }
    local('components', 'c-web', { tls: false })
    fs.rmSync(path.join(dir, 'attributes', 'boundaries'), { recursive: true, force: true })

    const res = await push()
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data).toMatchObject({ platform_baseline: 'recorded' })

    // Both changes are still reported by the next update_model: neither went into the record.
    const later = await modelCheck()
    expect(later.refusal?.data.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'c-web', fields: ['layout'] }),
      expect.objectContaining({ id: 'b-dmz', fields: ['attributes'] }),
    ]))
  })

  it("checks a data item's attributes, which update_model does not write", async () => {
    await recordBaseline()
    platform.model.attributes.dataItems['d-1'].attributes = { retention: 'colleague' }
    local('dataItems', 'd-1', { retention: '2y' })
    const res = await push()
    expect(res.data).toMatchObject({ changes: [{ id: 'd-1', kind: 'data_item', fields: ['item_attributes'] }], changed_ids: ['d-1'] })
    expect(updates.calls).toHaveLength(0)
    // update_model never overwrites them, so it is not refused by them.
    expect((await modelCheck()).refusal).toBeUndefined()
  })

  it('without a record, counts every element it writes, and keeps no record after', async () => {
    local('components', 'c-web', { tls: false })
    const res = await push()
    // Every element with a class and a value is written (the directory holds all four), so all four count.
    expect(res.data).toMatchObject({ baseline: 'missing' })
    expect([...(res.data as any).changed_ids].sort()).toEqual(['b-dmz', 'c-web', 'd-1', 'f-1'])
    expect((res.data as any).changes.every((c: any) => c.change === 'no_baseline')).toBe(true)
    const { changed_ids, revision } = res.data as any
    const named = await push({ overwrite_changed: changed_ids, overwrite_revision: revision })
    expect(named.success, JSON.stringify(named)).toBe(true)
    expect(named.data).toMatchObject({ acknowledgement: 'accepted', platform_baseline: 'not_recorded' })
    expect(await readSyncJson(dir)).toBeNull()
  })

  it('lists an element it writes that the platform has but the record lacks', async () => {
    await recordBaseline(['c-web'])
    local('components', 'c-web', { tls: false })
    const res = await push()
    expect(res.data).toMatchObject({ changes: [{ id: 'c-web', change: 'added_on_platform' }] })
  })

  it('does not check an element it does not write: no class, or only unresolved values', async () => {
    await recordBaseline()
    platform.model.attributes.components['c-web'].attributes = { tls: 'colleague' }
    platform.model.attributes.boundaries['b-dmz'].attributes = { ingress: 'colleague' }
    local('components', 'c-web', { tls: null })
    local('boundaries', 'b-dmz', { ingress: 'lb' }, null)
    const res = await push()
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data).not.toHaveProperty('acknowledgement')
  })

  it('keeps an acknowledgement valid when only an unchecked field class changes meanwhile', async () => {
    await recordBaseline()
    platform.model.attributes.components['c-web'].attributes = { tls: 'colleague' }
    local('components', 'c-web', { tls: false })
    const { changed_ids, revision } = (await push()).data as any
    platform.model.structure.defaultBoundary.boundaries[0].components[0].positionY = 123
    const named = await push({ overwrite_changed: changed_ids, overwrite_revision: revision })
    expect(named.data).toMatchObject({ acknowledgement: 'accepted' })

    // A further change to the checked values does make it stale.
    platform.model.attributes.components['c-web'].attributes = { tls: 'colleague again' }
    const stale = await push({ overwrite_changed: changed_ids, overwrite_revision: revision })
    expect(stale.data).toMatchObject({ acknowledgement: 'stale' })
  })

  it('refuses when the platform cannot be read for the check, and pushes nothing', async () => {
    await recordBaseline()
    platform.exportFails = [true]
    local('components', 'c-web', { tls: false })
    const res = await push()
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/could not be read to check it for changes/)
    expect(updates.calls).toHaveLength(0)
  })

  it('drops what it wrote from the record when the post-push export fails, so it reads as changed', async () => {
    await recordBaseline()
    platform.exportFails = [false, true]
    local('components', 'c-web', { tls: false })
    const res = await push()
    expect(res.success, JSON.stringify(res)).toBe(true)
    // Every element it wrote now reads as changed in its attributes (the data item's are not update_model's to check).
    const listed = (await modelCheck()).refusal?.data.changes ?? []
    expect(listed.map((c) => [c.id, c.fields])).toEqual(expect.arrayContaining([['c-web', ['attributes']], ['b-dmz', ['attributes']], ['f-1', ['attributes']]]))
    expect(listed.map((c) => c.id)).not.toContain('d-1')
  })

  it('removes the record when sync.json was rewritten during the push', async () => {
    await recordBaseline()
    local('components', 'c-web', { tls: false })
    updates.during = async () => {
      const prints = fingerprintSplitModel(platform.model as SplitModel)
      delete prints['c-db']
      const signed = await signPlatformBaseline(dir, 'm-1', prints)
      await writeSyncJson(dir, { platform_baseline: signed.record })
    }
    const res = await push()
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(res.data).toMatchObject({ platform_baseline: 'not_recorded' })
    expect((res.data as any).warnings.join('\n')).toMatch(/changed_during_push/)
    expect((await readSyncJson(dir))?.platform_baseline).toBeUndefined()
  })

  it('withholds nested unresolved values, which would erase the platform key like a top-level null', async () => {
    await recordBaseline()
    local('components', 'c-web', { tls: true, cfg: { cipher: null, min: '1.2', deep: { a: null } } })
    const res = await push()
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(updates.calls[0].components['c-web'].attributes).toEqual({ tls: true, cfg: { min: '1.2', deep: {} } })
    expect(res.data?.attributes.withheld_unresolved).toBe(2)
  })

  it('stays a prompted tool that needs the operator; the acknowledgement is an input, not an approval', async () => {
    const { manifestTool } = await import('../manifest.js')
    expect(manifestTool('update_attributes')).toMatchObject({
      approval: 'prompt',
      requiresUser: true,
      inputs: expect.objectContaining({ overwrite_changed: 'element_id_set', overwrite_revision: 'text' }),
    })
  })

  it('checks the same field classes it writes', () => {
    expect(ATTRIBUTE_PUSH_FIELDS).toEqual(['attributes', 'item_attributes'])
    expect(MODEL_PUSH_FIELDS).not.toContain('item_attributes')
  })
})
