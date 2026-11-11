/**
 * The review hash is never taken over less than the model: a refused read of
 * anything it reads makes it unavailable, with the files named; what it does
 * not read, and content a reader judged, leave it as it was.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gateInputFromModel, loadGateInput, refusedReads, reviewHash, type GateInput } from '../gates.js'
import { gateModel, writeGateModel } from './fixtures/gate-model.js'

let dir: string
/** Directories a test made outside the model, removed after it. */
let made: string[]
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(process.cwd(), '.test-review-hash-'))
  made = []
  await writeGateModel(dir, gateModel())
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
  for (const d of made) await fs.rm(d, { recursive: true, force: true })
})
const outsideDir = async () => {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-review-hash-')))
  made.push(d)
  return d
}

const cache = () => path.join(dir, '.dethereal', 'class-cache')
const unavailable = async () => {
  const h = reviewHash(await loadGateInput(dir))
  return 'unavailable' in h ? h.unavailable : null
}
/** Replace a file by a link to a copy of it outside the model. */
async function linked(file: string): Promise<void> {
  const outside = path.join(await outsideDir(), path.basename(file))
  await fs.copyFile(file, outside)
  await fs.rm(file)
  await fs.symlink(outside, file)
}
const usedClassFile = async () => (await fs.readdir(cache())).sort()[0]!

describe('the review hash', () => {
  it('reads as before when every read succeeds', async () => {
    // The gate-model fixture's hash, pinned: the refusal checks change nothing for a model read in full.
    expect(reviewHash(await loadGateInput(dir))).toEqual({ hash: '23ac52bb1b046a9fd9819f59269e4bade7af013f412925aceb0c845009172429' })
  })

  it("changes with a data item's origin or credential flag, false included, and not while they are absent", async () => {
    const before = reviewHash(await loadGateInput(dir))
    const file = path.join(dir, 'data-items.json')
    const doc = JSON.parse(await fs.readFile(file, 'utf8'))
    const items = Array.isArray(doc) ? doc : doc.dataItems
    const hashWith = async (patch: Record<string, unknown>) => {
      Object.assign(items.find((d: { id: string }) => d.id === 'd-audit'), patch)
      await fs.writeFile(file, JSON.stringify(doc, null, 2))
      return reviewHash(await loadGateInput(dir))
    }
    const withFlag = await hashWith({ is_credential: false })
    expect(withFlag).not.toEqual(before)
    const withOrigin = await hashWith({ origin: 'third_party' })
    expect(withOrigin).not.toEqual(withFlag)
    expect(await hashWith({ origin: undefined, is_credential: undefined })).toEqual(before)
  })

  it('is unavailable when the model is read with no project root around it', async () => {
    const outside = await outsideDir()
    await fs.cp(dir, path.join(outside, 'm'), { recursive: true })
    const h = reviewHash(await loadGateInput(path.join(outside, 'm')))
    expect(h).toMatchObject({ unavailable: { code: 'state_files_refused' } })
    const input = await loadGateInput(path.join(outside, 'm'))
    expect(refusedReads(input).map((r) => r.code)).toContain('outside_root')
  })

  it('is unavailable when the scope, the cache listing or a used class entry is refused', async () => {
    await linked(path.join(dir, '.dethereal', 'scope.json'))
    expect(await unavailable()).toEqual({ code: 'state_files_refused', files: ['.dethereal/scope.json'], files_total: 1 })
    await fs.rm(path.join(dir, '.dethereal', 'scope.json'))
    await writeGateModel(dir, gateModel())
    const entry = await usedClassFile()
    await linked(path.join(cache(), entry))
    expect(await unavailable()).toEqual({ code: 'state_files_refused', files: [`.dethereal/class-cache/${entry}`], files_total: 1 })
  })

  it('reads a cache directory that is a file or a link as refused, and a missing one as empty', async () => {
    await fs.rm(cache(), { recursive: true })
    const missing = reviewHash(await loadGateInput(dir))
    expect('hash' in missing).toBe(true)
    await fs.writeFile(cache(), '{}')
    expect(await unavailable()).toEqual({ code: 'state_files_refused', files: ['.dethereal/class-cache'], files_total: 1 })
    await fs.rm(cache())
    await fs.symlink(await outsideDir(), cache())
    expect(await unavailable()).toMatchObject({ code: 'state_files_refused', files: ['.dethereal/class-cache'] })
  })

  it('is taken when only what it does not read is refused, or a reader judged the content', async () => {
    const before = reviewHash(await loadGateInput(dir))
    // A cache entry of a class the model does not use.
    await fs.writeFile(path.join(cache(), 'unused-class.json'), '{')
    expect(reviewHash(await loadGateInput(dir))).toEqual(before)
    await fs.rm(path.join(cache(), 'unused-class.json'))
    // A pending file that cannot be read, and a template-field manifest behind a link: named, not hashed.
    await fs.writeFile(path.join(dir, '.dethereal', 'enrichment-pending.json'), '{')
    await fs.mkdir(path.join(dir, '.dethereal', 'template-fields'), { recursive: true })
    const manifest = path.join(dir, '.dethereal', 'template-fields', 'c-web.json')
    await fs.writeFile(manifest, JSON.stringify({ classId: 'x', templateFields: [] }))
    await linked(manifest)
    const input = await loadGateInput(dir)
    expect(reviewHash(input)).toEqual(before)
    expect(refusedReads(input).map((r) => r.file).sort()).toEqual(['.dethereal/enrichment-pending.json', '.dethereal/template-fields/c-web.json'])
    // Content a reader judged is not a refused read: a pending file of an unsupported version, a cache entry with no fields.
    await fs.rm(path.join(dir, '.dethereal', 'template-fields'), { recursive: true })
    await fs.writeFile(path.join(dir, '.dethereal', 'enrichment-pending.json'), JSON.stringify({ version: 9, entries: [] }))
    expect(refusedReads(await loadGateInput(dir))).toEqual([])
  })

  it('reads a scope file that is not JSON as refused, and a used class entry for another class as content', async () => {
    await fs.writeFile(path.join(dir, '.dethereal', 'scope.json'), '{')
    expect(await unavailable()).toEqual({ code: 'state_files_refused', files: ['.dethereal/scope.json'], files_total: 1 })
    await writeGateModel(dir, gateModel())
    const entry = await usedClassFile()
    const file = path.join(cache(), entry)
    await fs.writeFile(file, JSON.stringify({ ...JSON.parse(await fs.readFile(file, 'utf8')), classId: 'another-class' }))
    // The gates judged it (class_id_mismatch) and use no template from it: the hash is taken, as for an absent entry.
    expect(await unavailable()).toBeNull()
  })

  it('takes no hash of a model that was not read from its directory', async () => {
    const m = gateModel()
    const input = gateInputFromModel({ manifest: m.manifest, structure: m.structure, dataFlows: m.dataFlows, dataItems: m.dataItems, attributes: m.attributes } as never)
    expect(reviewHash(input)).toEqual({ unavailable: { code: 'not_read_from_directory', files: [], files_total: 0 } })
  })

  it('counts a read no reader foresaw as refused', () => {
    const input = { classTemplates: { templates: new Map(), refused: [{ file: '.dethereal/class-cache/x.json', reason: 'unreadable' }] }, scope: { scope: null }, pending: { state: 'none', entries: [], invalid: [], unknownKeys: 0 } } as unknown as GateInput
    expect(refusedReads(input)).toEqual([{ file: '.dethereal/class-cache/x.json', code: 'unreadable' }])
  })

  it('is unavailable when an attribute file cannot be read', async () => {
    const file = path.join(dir, 'attributes', 'components', 'c-web.json')
    await linked(file)
    expect(await unavailable()).toMatchObject({ code: 'attribute_files_unreadable' })
  })
})
