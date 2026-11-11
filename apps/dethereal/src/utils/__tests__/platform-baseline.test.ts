/**
 * The platform baseline: fingerprints of a platform export, the signed record in
 * sync.json, and the push check built on them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SplitModel } from '@dethernety/dt-core'
import { richExport } from '../../tools/__tests__/fixtures/platform-export.js'
import { initProjectRoot, resetProjectRoot } from '../project-root.js'
import { readSyncJson, writeSyncJson } from '../sync-utils.js'
import {
  fingerprintSplitModel,
  platformChanges,
  changeRevision,
  signPlatformBaseline,
  loadPlatformBaseline,
  checkPlatformChanges,
  baselineForSync,
  MODEL_ELEMENT_ID,
  MAX_LISTED_CHANGES,
  MODEL_PUSH_FIELDS,
} from '../platform-baseline.js'

const MODEL_SCOPE = { fields: MODEL_PUSH_FIELDS }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const changedFields = (before: SplitModel, after: SplitModel) =>
  platformChanges('verified', fingerprintSplitModel(before), fingerprintSplitModel(after), { includeAdded: true, scope: MODEL_SCOPE })

describe('platform fingerprints', () => {
  it('covers every element, the default boundary and the model itself', () => {
    const prints = fingerprintSplitModel(richExport())
    expect(Object.keys(prints).sort()).toEqual([MODEL_ELEMENT_ID, 'b-dmz', 'b-root', 'c-db', 'c-web', 'd-1', 'd-2', 'f-1'].sort())
    expect(prints['c-web']).toMatchObject({ k: 'component', n: 'Web' })
    expect(prints[MODEL_ELEMENT_ID]?.k).toBe('model')
  })

  it('does not depend on the order of lists, keys, or on what a push never writes', () => {
    const a = richExport()
    const b = clone(a) as any
    b.manifest.modules.reverse()
    b.manifest.exportedAt = '2030-01-01T00:00:00.000Z'
    const dmz = b.structure.defaultBoundary.boundaries[0]
    dmz.conduits.reverse()
    dmz.conduits[1].peerName = 'Renamed'
    dmz.conduits[1].controlRefs = ['other']
    dmz.conduits[0] = { peerId: 'b-ext', direction: 'INBOUND', justification: 'changed' }
    dmz.domains.reverse()
    dmz.planes.reverse()
    dmz.dimensionsMinWidth = 999
    const web = dmz.components[0]
    web.controls.reverse()
    web.dataItemIds.reverse()
    web.representedModel = { id: 'm-else' }
    b.dataItems[0].regulatory_flags.reverse()
    b.attributes.components['c-web'].modifiedAt = 't2'
    b.attributes.components['c-web'].elementName = 'Renamed in the bag'
    b.attributes.dataItems['d-1'].attributes = { retention: '5y' }
    b.dataFlows[0] = { ...b.dataFlows[0] }
    expect(changedFields(a, b)).toEqual([])
  })

  it('names the class of each change separately', () => {
    const cases: Array<[string, (m: any) => void, string, string[]]> = [
      ['layout', (m) => { m.structure.defaultBoundary.boundaries[0].components[0].positionX = 99 }, 'c-web', ['layout']],
      ['controls', (m) => { m.structure.defaultBoundary.boundaries[0].components[0].controls.push({ id: 'ctl-3' }) }, 'c-web', ['controls']],
      ['data items', (m) => { m.dataFlows[0].dataItemIds = [] }, 'f-1', ['data_items']],
      ['attributes', (m) => { m.attributes.components['c-web'].attributes.tls = false }, 'c-web', ['attributes']],
      ['class', (m) => { m.structure.defaultBoundary.components[0].classData = { id: 'cls-db' } }, 'c-db', ['properties']],
      ['parent', (m) => {
        const [web] = m.structure.defaultBoundary.boundaries[0].components.splice(0, 1)
        m.structure.defaultBoundary.components.push(web)
      }, 'c-web', ['structure']],
      ['flow endpoint', (m) => { m.dataFlows[0].targetHandle = 'top' }, 'f-1', ['structure']],
      ['crown jewel', (m) => { m.structure.defaultBoundary.boundaries[0].components[0].crownJewel = false }, 'c-web', ['asset_context']],
      ['outbound conduit', (m) => { m.structure.defaultBoundary.boundaries[0].conduits[0].justification = 'other' }, 'b-dmz', ['asset_context']],
      ['sensitivity', (m) => { m.dataItems[0].sensitivity = 'internal' }, 'd-1', ['asset_context']],
      ['origin set', (m) => { m.dataItems[1].origin = 'arbitrary_public' }, 'd-2', ['asset_context']],
      ['credential answered', (m) => { m.dataItems[1].is_credential = false }, 'd-2', ['asset_context']],
      ['data item controls', (m) => { m.dataItems[0].controls = [{ id: 'ctl-9', name: 'Field encryption' }] }, 'd-1', ['controls']],
      ['model scope', (m) => { m.manifest.model.scope = { compliance_drivers: ['GDPR'] } }, MODEL_ELEMENT_ID, ['asset_context']],
      ['model controls', (m) => { m.manifest.model.controls = [] }, MODEL_ELEMENT_ID, ['controls']],
      ['model name', (m) => { m.manifest.model.name = 'Store' }, MODEL_ELEMENT_ID, ['properties']],
    ]
    for (const [label, change, id, fields] of cases) {
      const after = clone(richExport())
      change(after)
      expect(changedFields(richExport(), after), label).toEqual([
        expect.objectContaining({ id, change: 'modified', fields }),
      ])
    }
  })

  it('keeps the asset-context print of an item with no origin and no credential answer as recorded before', () => {
    // Prints taken from the fixture before origin and is_credential existed: a stored baseline must still match.
    const prints = fingerprintSplitModel(richExport())
    expect(prints['d-1']?.f.asset_context).toBe('d7eb8221cb9722b5')
    expect(prints['d-2']?.f.asset_context).toBe('09903a3f266c6c12')
  })

  it('prints a data item\'s controls only when it has some, and sees them change, go and come', () => {
    // An item without controls keeps the print a baseline recorded before data items carried them: no new field.
    expect(Object.keys(fingerprintSplitModel(richExport())['d-1']?.f ?? {})).not.toContain('controls')
    const withControls = (ids: string[]) => {
      const m = clone(richExport()) as any
      m.dataItems[0].controls = ids.map((id) => ({ id, name: id }))
      return m
    }
    expect(changedFields(withControls(['ctl-1', 'ctl-2']), withControls(['ctl-2', 'ctl-1']))).toEqual([])
    for (const after of [withControls(['ctl-1']), richExport()]) {
      expect(changedFields(withControls(['ctl-1', 'ctl-2']), after)).toEqual([expect.objectContaining({ id: 'd-1', change: 'modified', fields: ['controls'] })])
    }
  })

  it('tells a changed origin and a changed credential answer apart from the same ones', () => {
    const withAnswers = (origin: string, isCredential: boolean) => {
      const m = clone(richExport()) as any
      Object.assign(m.dataItems[0], { origin, is_credential: isCredential })
      return m
    }
    const before = withAnswers('third_party', true)
    expect(changedFields(before, withAnswers('third_party', true))).toEqual([])
    for (const after of [withAnswers('curated_internal', true), withAnswers('third_party', false)]) {
      expect(changedFields(before, after)).toEqual([expect.objectContaining({ id: 'd-1', change: 'modified', fields: ['asset_context'] })])
    }
    const answeredFalse = withAnswers('third_party', false)
    for (const field of ['origin', 'is_credential']) {
      const cleared = clone(answeredFalse) as any
      delete cleared.dataItems[0][field]
      expect(changedFields(answeredFalse, cleared), field).toEqual([expect.objectContaining({ id: 'd-1', change: 'modified', fields: ['asset_context'] })])
    }
  })

  it('lists deletions by their recorded name, and additions only when the push would delete them', () => {
    const after = clone(richExport()) as any
    after.dataItems = after.dataItems.filter((d: any) => d.id !== 'd-2')
    after.dataItems.push({ id: 'd-3', name: 'Added there' })
    const before = fingerprintSplitModel(richExport())
    const now = fingerprintSplitModel(after)
    expect(platformChanges('verified', before, now, { includeAdded: true, scope: MODEL_SCOPE })).toEqual([
      { id: 'd-3', kind: 'data_item', name: 'Added there', change: 'added_on_platform' },
      { id: 'd-2', kind: 'data_item', name: 'Name', change: 'deleted_on_platform' },
    ])
    expect(platformChanges('verified', before, now, { includeAdded: false, scope: MODEL_SCOPE })).toEqual([
      { id: 'd-2', kind: 'data_item', name: 'Name', change: 'deleted_on_platform' },
    ])
  })

  it('without a trusted baseline, lists every element as changed', () => {
    const live = fingerprintSplitModel(richExport())
    const changes = platformChanges('legacy', null, live, { includeAdded: true, scope: MODEL_SCOPE })
    expect(changes).toHaveLength(Object.keys(live).length)
    expect(new Set(changes.map((c) => c.change))).toEqual(new Set(['no_baseline']))
    expect(changes[0]?.id).toBe(MODEL_ELEMENT_ID)
  })

  it('gives a new revision when a changed element changes again, and the same one otherwise', () => {
    const before = fingerprintSplitModel(richExport())
    const once = clone(richExport()) as any
    once.structure.defaultBoundary.boundaries[0].components[0].controls.push({ id: 'ctl-3' })
    const twice = clone(once)
    twice.structure.defaultBoundary.boundaries[0].components[0].controls.push({ id: 'ctl-4' })
    const rev = (m: SplitModel) => {
      const live = fingerprintSplitModel(m)
      return changeRevision('m-1', 'verified', platformChanges('verified', before, live, { includeAdded: true, scope: MODEL_SCOPE }), live, MODEL_SCOPE)
    }
    expect(rev(once)).toBe(rev(clone(once)))
    expect(rev(twice)).not.toBe(rev(once))
  })
})

describe('the signed record', () => {
  let tmp: string
  let project: string
  let model: string
  const saved = { home: process.env.HOME, url: process.env.DETHERNETY_URL }

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-baseline-')))
    project = path.join(tmp, 'project')
    model = path.join(project, 'model')
    fs.mkdirSync(path.join(model, '.dethereal'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    initProjectRoot({ cwd: project, env: {} })
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = saved.home
    process.env.DETHERNETY_URL = saved.url
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const record = async (dir = model, prints = fingerprintSplitModel(richExport())) => {
    const signed = await signPlatformBaseline(dir, 'm-1', prints)
    expect(signed.record).not.toBeNull()
    await writeSyncJson(dir, { platform_model_id: 'm-1', platform_url: 'x', platform_baseline: signed.record })
    return signed.record!
  }

  it('verifies a record written on this machine for this directory, model and platform', async () => {
    await record()
    expect(await loadPlatformBaseline(model, 'm-1')).toMatchObject({ state: 'verified' })
  })

  it('reports missing and legacy records', async () => {
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('missing')
    await writeSyncJson(model, { platform_model_id: 'm-1', platform_url: 'x' })
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('legacy')
  })

  it('treats an edited, moved, other-model or other-platform record as unverifiable', async () => {
    const rec = await record()
    // One fingerprint edited by hand.
    const forged = clone(rec)
    forged.elements['c-web']!.f.controls = '0000000000000000'
    await writeSyncJson(model, { platform_baseline: forged })
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('unverifiable')

    // The genuine record copied into another model directory.
    await writeSyncJson(model, { platform_baseline: rec })
    const other = path.join(project, 'copy')
    fs.mkdirSync(path.join(other, '.dethereal'), { recursive: true })
    fs.copyFileSync(path.join(model, '.dethereal', 'sync.json'), path.join(other, '.dethereal', 'sync.json'))
    expect((await loadPlatformBaseline(other, 'm-1')).state).toBe('unverifiable')

    expect((await loadPlatformBaseline(model, 'm-2')).state).toBe('unverifiable')

    process.env.DETHERNETY_URL = 'http://127.0.0.1:10'
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('unverifiable')
  })

  it('keeps no record on a machine whose key it may not use, and says why', async () => {
    process.env.HOME = path.join(project, 'home-inside')
    fs.mkdirSync(process.env.HOME)
    const result = await baselineForSync(model, 'm-1', fingerprintSplitModel(richExport()))
    expect(result).toMatchObject({ record: null, status: 'not_recorded' })
    expect(result.warning).toMatch(/key_in_project/)
  })

  it('removes a stale record when a new one cannot be made', async () => {
    await record()
    const result = await baselineForSync(model, 'm-1', null)
    expect(result).toMatchObject({ record: null, status: 'not_recorded' })
    await writeSyncJson(model, { platform_baseline: result.record })
    expect((await readSyncJson(model))?.platform_baseline).toBeUndefined()
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('legacy')
  })

  it('keeps the record through other sync.json writes', async () => {
    await record()
    await writeSyncJson(model, { last_pull_at: 'now' })
    expect((await loadPlatformBaseline(model, 'm-1')).state).toBe('verified')
  })

  describe('the push check', () => {
    const live = (change?: (m: any) => void) => {
      const m = clone(richExport()) as any
      change?.(m)
      return fingerprintSplitModel(m)
    }
    const assign = (m: any) => { m.structure.defaultBoundary.components[0].controls = [{ id: 'ctl-new' }] }

    it('passes with nothing changed, and reports an unneeded overwrite as unused', async () => {
      await record()
      expect(await checkPlatformChanges(model, 'm-1', live(), { includeAdded: true, scope: MODEL_SCOPE })).not.toHaveProperty('refusal')
      expect(await checkPlatformChanges(model, 'm-1', live(), { includeAdded: true, scope: MODEL_SCOPE, overwriteChanged: [], overwriteRevision: 'a'.repeat(64) }))
        .toMatchObject({ acknowledgement: 'unused' })
    })

    it('refuses a platform change, and accepts exactly its ids and revision', async () => {
      await record()
      const check = await checkPlatformChanges(model, 'm-1', live(assign), { includeAdded: true, scope: MODEL_SCOPE })
      expect(check.refusal?.data).toMatchObject({
        code: 'PLATFORM_CHANGED_SINCE_SYNC',
        baseline: 'verified',
        changes_total: 1,
        changes: [{ id: 'c-db', kind: 'component', name: 'DB', change: 'modified', fields: ['controls'] }],
        changed_ids: ['c-db'],
      })
      expect(check.refusal?.message).toMatch(/changed since your last pull or push: 1 element/)
      const { revision, changed_ids } = check.refusal!.data
      expect(await checkPlatformChanges(model, 'm-1', live(assign), { includeAdded: true, scope: MODEL_SCOPE, overwriteChanged: changed_ids, overwriteRevision: revision }))
        .toMatchObject({ acknowledgement: 'accepted' })

      // A wrong id set, a duplicate, or the platform changing again: refused again, marked stale.
      for (const [ids, rev, now] of [
        [['c-db', 'c-web'], revision, live(assign)],
        [['c-db', 'c-db'], revision, live(assign)],
        [changed_ids, revision, live((m) => { assign(m); m.structure.defaultBoundary.components[0].positionX = 7 })],
      ] as const) {
        const again = await checkPlatformChanges(model, 'm-1', now, { includeAdded: true, scope: MODEL_SCOPE, overwriteChanged: [...ids], overwriteRevision: rev })
        expect(again.refusal?.data.acknowledgement).toBe('stale')
        expect(again.refusal?.message).toMatch(/^The overwrite no longer matches the platform\./)
      }
    })

    it('without a trusted record, lists every element and can still be answered', async () => {
      await writeSyncJson(model, { platform_model_id: 'm-1', platform_url: 'x' })
      const now = live()
      const check = await checkPlatformChanges(model, 'm-1', now, { includeAdded: true, scope: MODEL_SCOPE })
      expect(check.refusal?.data).toMatchObject({ baseline: 'legacy', changes_total: Object.keys(now).length })
      const { revision, changed_ids } = check.refusal!.data
      expect(await checkPlatformChanges(model, 'm-1', now, { includeAdded: true, scope: MODEL_SCOPE, overwriteChanged: changed_ids, overwriteRevision: revision }))
        .toMatchObject({ acknowledgement: 'accepted' })
    })

    it('details at most 500 changes but gives every id, and cannot be answered past 5000', async () => {
      await writeSyncJson(model, { platform_model_id: 'm-1', platform_url: 'x' })
      const many = (n: number) => {
        const m = clone(richExport()) as any
        m.dataItems = Array.from({ length: n }, (_, i) => ({ id: `d-${String(i).padStart(5, '0')}`, name: `Item ${i}` }))
        return fingerprintSplitModel(m)
      }
      const some = await checkPlatformChanges(model, 'm-1', many(600), { includeAdded: true, scope: MODEL_SCOPE })
      expect(some.refusal?.data.changes).toHaveLength(MAX_LISTED_CHANGES)
      expect(some.refusal?.data.changed_ids.length).toBe(some.refusal?.data.changes_total)

      const tooMany = many(5001)
      const refused = await checkPlatformChanges(model, 'm-1', tooMany, { includeAdded: true, scope: MODEL_SCOPE })
      expect(refused.refusal?.data.changed_ids).toEqual([])
      expect(refused.refusal?.message).toMatch(/cannot be named: pull first/)
    })

    it('says when this machine can keep no record, instead of advising a pull alone', async () => {
      await record()
      process.env.HOME = path.join(project, 'home-inside')
      fs.mkdirSync(process.env.HOME)
      const check = await checkPlatformChanges(model, 'm-1', live(), { includeAdded: true, scope: MODEL_SCOPE })
      expect(check.refusal?.data.baseline).toBe('unverifiable')
      expect(check.refusal?.message).toMatch(/No record of the platform model can be kept on this machine \(key_in_project\)/)
    })
  })
})
