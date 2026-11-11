/**
 * manifest.json's module list is derived: the modules it lists, the scope's activeModules, and the
 * module of every class the model uses. Anything that cannot be derived is a named gap, never a guess.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { deriveManifestModules, moduleRef, persistDerivedModules, sameModules, shownModules, type DerivationInput, type ModuleRef } from '../manifest-modules.js'

const GENERAL: ModuleRef = { id: 'mod-general', name: 'dethernety-general' }
const AWS: ModuleRef = { id: 'mod-aws', name: 'aws-identity' }
const K8S: ModuleRef = { id: 'mod-k8s', name: 'kubernetes' }

const structure = (components: Array<{ id: string; classData?: unknown }>, boundaryClass?: unknown) => ({
  defaultBoundary: { id: 'root', name: 'System', components: [], boundaries: [
    { id: 'b-1', name: 'Zone', ...(boundaryClass ? { classData: boundaryClass } : {}), components, boundaries: [] },
  ] },
}) as never

const cls = (id: string, name = `Class ${id}`, module?: unknown) => ({ id, name, ...(module !== undefined ? { module } : {}) })

function input(over: Partial<DerivationInput> = {}): DerivationInput {
  return {
    manifestModules: [],
    scope: { scope: {} },
    structure: structure([]),
    dataFlows: [],
    dataItems: [],
    classModules: new Map(),
    ...over,
  }
}

describe('deriveManifestModules', () => {
  it('activeModules only', () => {
    expect(deriveManifestModules(input({ scope: { scope: { activeModules: [GENERAL, AWS] } } }))).toEqual({ modules: [GENERAL, AWS], gaps: [] })
  })

  it('classes only: each class module, from the cache', () => {
    const r = deriveManifestModules(input({
      structure: structure([{ id: 'c1', classData: cls('k1') }, { id: 'c2', classData: cls('k2') }]),
      classModules: new Map([['k1', GENERAL], ['k2', K8S]]),
    }))
    expect(r).toEqual({ modules: [GENERAL, K8S], gaps: [] })
  })

  it('both, with overlap: no duplicate, manifest entries first, then activeModules, then class modules by name', () => {
    const r = deriveManifestModules(input({
      manifestModules: [AWS],
      scope: { scope: { activeModules: [GENERAL, AWS] } },
      structure: structure([{ id: 'c1', classData: cls('k1') }, { id: 'c2', classData: cls('k2') }], cls('kb')),
      dataFlows: [{ id: 'f1', classData: cls('kf') }],
      dataItems: [{ id: 'd1', classData: cls('kd') }],
      classModules: new Map([['k1', K8S], ['k2', GENERAL], ['kb', GENERAL], ['kf', { id: 'mod-a', name: 'a-module' }], ['kd', AWS]]),
    }))
    expect(r.gaps).toEqual([])
    expect(r.modules).toEqual([AWS, GENERAL, { id: 'mod-a', name: 'a-module' }, K8S])
  })

  it('lists the module of a class from a module that is not active', () => {
    const r = deriveManifestModules(input({
      scope: { scope: { activeModules: [GENERAL] } },
      structure: structure([{ id: 'c1', classData: cls('k1') }]),
      classModules: new Map([['k1', K8S]]),
    }))
    expect(r.modules).toEqual([GENERAL, K8S])
  })

  it('keeps the entries manifest.json already lists: derivation only adds', () => {
    expect(deriveManifestModules(input({ manifestModules: [K8S] })).modules).toEqual([K8S])
  })

  it("uses an element's classData.module when the cache has none (a pulled model)", () => {
    const r = deriveManifestModules(input({ structure: structure([{ id: 'c1', classData: cls('k1', 'Web', K8S) }]) }))
    expect(r).toEqual({ modules: [K8S], gaps: [] })
  })

  it('names a class with no known module, with its elements, and never guesses one', () => {
    const r = deriveManifestModules(input({
      scope: { scope: { activeModules: [GENERAL] } },
      structure: structure([{ id: 'c2', classData: cls('k1', 'Web server') }, { id: 'c1', classData: cls('k1', 'Web server') }]),
    }))
    expect(r.modules).toEqual([GENERAL])
    expect(r.gaps).toEqual([{ id: 'k1', reason: 'module_unknown', className: 'Web server', elements: ['c1', 'c2'] }])
  })

  it('names a conflict between the cache and an element, and between two elements', () => {
    const cacheVsElement = deriveManifestModules(input({
      structure: structure([{ id: 'c1', classData: cls('k1', 'Web', K8S) }]),
      classModules: new Map([['k1', GENERAL]]),
    }))
    expect(cacheVsElement.gaps.map((g) => [g.id, g.reason])).toEqual([['k1', 'module_conflict']])
    expect(cacheVsElement.modules).toEqual([])
    const twoElements = deriveManifestModules(input({
      structure: structure([{ id: 'c1', classData: cls('k1', 'Web', K8S) }, { id: 'c2', classData: cls('k1', 'Web', GENERAL) }]),
    }))
    expect(twoElements.gaps.map((g) => [g.id, g.reason])).toEqual([['k1', 'module_conflict']])
    // The same module named by the cache and an element is no conflict.
    expect(deriveManifestModules(input({
      structure: structure([{ id: 'c1', classData: cls('k1', 'Web', K8S) }]), classModules: new Map([['k1', K8S]]),
    }))).toEqual({ modules: [K8S], gaps: [] })
  })

  it('an unreadable scope is a gap, not an empty activeModules', () => {
    expect(deriveManifestModules(input({ scope: { scope: null, error: 'outside_root' } })).gaps).toEqual([{ id: 'scope', reason: 'scope_unreadable', elements: [] }])
    expect(deriveManifestModules(input({ scope: { scope: null } })).gaps).toEqual([])
  })

  it('names malformed entries of the scope and of manifest.json, and keeps the well-formed ones', () => {
    const r = deriveManifestModules(input({
      manifestModules: [GENERAL, { id: 'x' }, 'kubernetes'],
      scope: { scope: { activeModules: [AWS, { name: 'no id' }] } },
    }))
    expect(r.modules).toEqual([GENERAL, AWS])
    expect(r.gaps.map((g) => g.reason)).toEqual(['manifest_module_invalid', 'manifest_module_invalid', 'scope_module_invalid'])
    expect(deriveManifestModules(input({ manifestModules: 'dethernety-general' })).gaps.map((g) => g.reason)).toEqual(['manifest_module_invalid'])
  })

  it('deduplicates by id: the first name stays, and two modules sharing a name are both listed', () => {
    const r = deriveManifestModules(input({
      manifestModules: [{ id: 'mod-general', name: 'General' }],
      scope: { scope: { activeModules: [GENERAL, { id: 'mod-other', name: 'General' }] } },
    }))
    expect(r.modules).toEqual([{ id: 'mod-general', name: 'General' }, { id: 'mod-other', name: 'General' }])
  })

  it('gives the same list whatever order the elements come in', () => {
    const els = [{ id: 'c1', classData: cls('k1') }, { id: 'c2', classData: cls('k2') }, { id: 'c3', classData: cls('k3') }]
    const classModules = new Map([['k1', K8S], ['k2', AWS], ['k3', GENERAL]])
    const a = deriveManifestModules(input({ structure: structure(els), classModules }))
    const b = deriveManifestModules(input({ structure: structure([...els].reverse()), classModules: new Map([...classModules].reverse()) }))
    expect(b).toEqual(a)
    expect(a.modules.map((m) => m.name)).toEqual(['aws-identity', 'dethernety-general', 'kubernetes'])
  })
})

describe('moduleRef: the caps on what a module reference may hold', () => {
  it('takes {id, name}, dropping anything else', () => {
    expect(moduleRef({ id: '034be16c-3dda-42b6-81bc-89b33cc47fb1', name: 'dethernety-general', description: 'x' }))
      .toEqual({ id: '034be16c-3dda-42b6-81bc-89b33cc47fb1', name: 'dethernety-general' })
  })
  it.each([
    ['an id with a space', { id: 'a b', name: 'n' }],
    ['an id starting with a dot', { id: '.x', name: 'n' }],
    ['an id of 129 characters', { id: 'a'.repeat(129), name: 'n' }],
    ['an empty name', { id: 'a', name: ' ' }],
    ['a name of 201 characters', { id: 'a', name: 'n'.repeat(201) }],
    ['a name with a control character', { id: 'a', name: 'bad\u0007name' }],
    ['a name with a newline', { id: 'a', name: 'two\nlines' }],
    ['no name', { id: 'a' }],
    ['an array', [{ id: 'a', name: 'n' }]],
  ])('refuses %s', (_what, value) => {
    expect(moduleRef(value)).toBeNull()
  })
})

describe('shownModules: a list from a file as a result shows it', () => {
  it('shows well-formed entries, names the rest, and stops at 50', () => {
    expect(shownModules(undefined)).toEqual([])
    expect(shownModules('text')).toBe('(not a list)')
    expect(shownModules([GENERAL, { id: 'x' }, 'y'])).toEqual([GENERAL, '(not {id, name})', '(not {id, name})'])
    expect((shownModules(Array.from({ length: 60 }, () => GENERAL)) as unknown[]).length).toBe(50)
  })
})

describe('sameModules', () => {
  it('is the same list only with the same ids, names and order, and no other keys', () => {
    expect(sameModules([GENERAL, AWS], [GENERAL, AWS])).toBe(true)
    expect(sameModules([AWS, GENERAL], [GENERAL, AWS])).toBe(false)
    expect(sameModules([{ ...GENERAL, name: 'General' }], [GENERAL])).toBe(false)
    expect(sameModules([{ ...GENERAL, description: 'd' }], [GENERAL])).toBe(false)
    expect(sameModules(undefined, [])).toBe(false)
    expect(sameModules([], [])).toBe(true)
  })
})

describe('persistDerivedModules', () => {
  let root: string
  let seq = 0
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(process.cwd(), '.test-manifest-modules-'))
  })
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  async function modelDir(manifest: Record<string, unknown>): Promise<{ dir: string; bytes: Buffer }> {
    const dir = path.join(root, `m${seq++}`)
    await fs.mkdir(dir)
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    return { dir, bytes: await fs.readFile(path.join(dir, 'manifest.json')) }
  }
  const manifest = { schemaVersion: '2.0.0', format: 'split', model: { name: 'Shop', description: 'd' }, files: { structure: 'structure.json' }, modules: [] }

  it('writes the list and changes nothing else', async () => {
    const { dir, bytes } = await modelDir(manifest)
    expect(await persistDerivedModules(dir, bytes, [GENERAL, AWS])).toEqual({ written: true })
    expect(JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'))).toEqual({ ...manifest, modules: [GENERAL, AWS] })
  })

  it('writes nothing when the list is already there', async () => {
    const { dir, bytes } = await modelDir({ ...manifest, modules: [GENERAL] })
    const before = await fs.stat(path.join(dir, 'manifest.json'))
    expect(await persistDerivedModules(dir, bytes, [GENERAL])).toEqual({ written: false, reason: 'unchanged' })
    const after = await fs.stat(path.join(dir, 'manifest.json'))
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.ino).toBe(before.ino)
  })

  it('writes nothing when the file changed since it was read', async () => {
    const { dir, bytes } = await modelDir(manifest)
    const edited = JSON.stringify({ ...manifest, model: { name: 'Edited', description: 'd' } })
    await fs.writeFile(path.join(dir, 'manifest.json'), edited)
    expect(await persistDerivedModules(dir, bytes, [GENERAL])).toEqual({ written: false, reason: 'changed' })
    expect(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).toBe(edited)
  })

  it('refuses a manifest.json that is a symbolic link, and writes nothing through it', async () => {
    const { dir, bytes } = await modelDir(manifest)
    const target = path.join(root, `outside-${seq++}.json`)
    await fs.writeFile(target, bytes)
    await fs.rm(path.join(dir, 'manifest.json'))
    await fs.symlink(target, path.join(dir, 'manifest.json'))
    expect((await persistDerivedModules(dir, bytes, [GENERAL])).written).toBe(false)
    expect((await fs.readFile(target)).equals(bytes)).toBe(true)
  })

  it('refuses a hard-linked manifest.json', async () => {
    const { dir, bytes } = await modelDir(manifest)
    const twin = path.join(root, `twin-${seq++}.json`)
    await fs.link(path.join(dir, 'manifest.json'), twin)
    expect(await persistDerivedModules(dir, bytes, [GENERAL])).toEqual({ written: false, reason: 'changed' })
    expect((await fs.readFile(twin)).equals(bytes)).toBe(true)
  })

  it('refuses a model directory whose link leads outside the project, and writes nothing there', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-modules-outside-'))
    try {
      await fs.writeFile(path.join(outside, 'manifest.json'), JSON.stringify(manifest, null, 2))
      const bytes = await fs.readFile(path.join(outside, 'manifest.json'))
      const link = path.join(root, `link-${seq++}`)
      await fs.symlink(outside, link)
      await expect(persistDerivedModules(link, bytes, [GENERAL])).rejects.toThrow()
      expect((await fs.readFile(path.join(outside, 'manifest.json'))).equals(bytes)).toBe(true)
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})
