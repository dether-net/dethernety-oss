/**
 * Links committed into a model directory must never carry a read, a write, a
 * delete or a backup outside it.
 *
 * Every fixture is built in a scratch directory: the "outside" directory is a
 * sibling in the same scratch directory, holding a canary file the tests check is
 * never read, written, removed or copied. Nothing outside the scratch directory is
 * touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validatePathConfinement, assertRealModelTree, writeFileNoFollow, realOrResolved } from '../path-confinement.js'
import {
  ensureModelDirectoryStructure,
  writeManifest,
  writeAttributes,
  writeModelDirectory,
  createDirectoryBackup,
  readDataFlows,
  readManifest,
  readAttributes,
  applyIdMapping,
} from '../directory-utils.js'
import { writeSyncJson, readSyncJson, computeContentHash } from '../sync-utils.js'
import { execFileSync } from 'node:child_process'
import { initProjectRoot, resetProjectRoot } from '../project-root.js'

/** The hash of the content-hash tests' ordinary tree; the implementation before no-follow reads gives the same digest. */
const ORDINARY_TREE_HASH = 'sha256:v2:be88b37fe90701355299dcb837d601ebc79f1a4456ccd553956857323cc3e03b'

describe('links in a model directory', () => {
  let tmp: string
  let project: string
  let outside: string
  let canary: string
  const savedHome = process.env.HOME

  const mk = (...parts: string[]) => {
    const p = path.join(...parts)
    fs.mkdirSync(p, { recursive: true })
    return fs.realpathSync.native(p)
  }
  const outsideFiles = () => fs.readdirSync(outside).sort()

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-tree-')))
    project = mk(tmp, 'project')
    outside = mk(tmp, 'outside')
    canary = path.join(outside, 'keep.json')
    fs.writeFileSync(canary, '{"secret":"CANARY-SECRET"}')
    process.env.HOME = mk(tmp, 'home')
    // The writers confine to the project root, as the server does.
    initProjectRoot({ cwd: project, env: {} })
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  describe('confinement resolves every existing component', () => {
    it('refuses a path that runs through a committed link out of the base', async () => {
      // The review's case: a relative link climbing out of the project.
      fs.symlinkSync('../outside', path.join(project, 'l'))
      for (const target of ['l', 'l/a', 'l/a/b']) {
        await expect(validatePathConfinement(path.join(project, target), project)).rejects.toThrow(/outside the allowed directory/)
      }
    })

    it('refuses a path through a dangling link or a link loop, without hanging', async () => {
      fs.symlinkSync(path.join(tmp, 'nowhere'), path.join(project, 'dl'))
      fs.symlinkSync('loop2', path.join(project, 'loop1'))
      fs.symlinkSync('loop1', path.join(project, 'loop2'))
      await expect(validatePathConfinement(path.join(project, 'dl', 'a', 'b'), project)).rejects.toThrow()
      await expect(validatePathConfinement(path.join(project, 'loop1', 'a'), project)).rejects.toThrow()
      await expect(realOrResolved(path.join(project, 'dl', 'x'))).rejects.toThrow()
    })

    it('accepts a deep new path under a real directory, and a link that stays inside', async () => {
      const deep = path.join(project, 'models', 'a', 'b', 'c')
      await expect(validatePathConfinement(deep, project)).resolves.toBe(deep)
      mk(project, 'real')
      fs.symlinkSync('real', path.join(project, 'inner'))
      await expect(validatePathConfinement(path.join(project, 'inner', 'x'), project)).resolves.toBe(path.join(project, 'real', 'x'))
    })

    it('resolves ".." before judging, so the returned path is where writes go', async () => {
      mk(project, 'x')
      fs.symlinkSync('../outside', path.join(project, 'l'))
      // Lexically this is project/x: that is where it resolves, and it is returned as such.
      await expect(validatePathConfinement(path.join(project, 'l', '..', 'x'), project)).resolves.toBe(path.join(project, 'x'))
    })
  })

  describe('writers refuse a linked directory below the model directory', () => {
    let model: string
    beforeEach(() => {
      model = mk(project, 'model')
      fs.writeFileSync(path.join(model, 'manifest.json'), '{}')
    })

    it.each([
      ['attributes', 'attributes'],
      ['an attribute group', 'attributes/components'],
      ['.dethereal', '.dethereal'],
      ['a .dethereal cache directory', '.dethereal/template-fields'],
    ])('refuses %s that is a link', async (_label, rel) => {
      fs.mkdirSync(path.dirname(path.join(model, rel)), { recursive: true })
      fs.symlinkSync(outside, path.join(model, rel))
      await expect(assertRealModelTree(model)).rejects.toThrow(`${rel}: symlink`)
    })

    it('writes no attribute file and unlinks nothing through a linked group', async () => {
      mk(model, 'attributes')
      fs.symlinkSync(outside, path.join(model, 'attributes', 'components'))
      await expect(
        writeAttributes(model, { boundaries: {}, components: { 'c-1': { elementId: 'c-1' } as never }, dataFlows: {}, dataItems: {} })
      ).rejects.toThrow(/attributes\/components: symlink/)
      await expect(ensureModelDirectoryStructure(model)).rejects.toThrow(/symlink/)
      // The id remap refuses too (whichever check it meets first); what matters is that nothing outside changes.
      await expect(applyIdMapping(model, new Map([['c-1', 'c-2']]), 'model-1')).rejects.toThrow()
      expect(outsideFiles()).toEqual(['keep.json'])
      expect(fs.readFileSync(canary, 'utf8')).toContain('CANARY-SECRET')
    })

    it('never writes through a link planted where a model file goes', async () => {
      fs.symlinkSync(canary, path.join(model, 'manifest.json.link'))
      fs.rmSync(path.join(model, 'manifest.json'))
      fs.symlinkSync(canary, path.join(model, 'manifest.json'))
      await expect(writeManifest(model, { name: 'x' } as never)).rejects.toThrow(/symlink/)
      await expect(writeFileNoFollow(path.join(model, 'manifest.json'), 'x')).rejects.toThrow(/symlink/)
      expect(fs.readFileSync(canary, 'utf8')).toContain('CANARY-SECRET')
    })

    it('writes a whole model normally when the tree is real', async () => {
      await ensureModelDirectoryStructure(model)
      await writeModelDirectory(model, {
        manifest: { name: 'm' },
        structure: { boundaries: [], components: [] },
        dataFlows: [],
        dataItems: [],
        attributes: { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} },
      } as never)
      expect(fs.existsSync(path.join(model, 'structure.json'))).toBe(true)
    })

    it('never reads or writes sync.json through a link', async () => {
      mk(model, '.dethereal')
      fs.symlinkSync(canary, path.join(model, '.dethereal', 'sync.json'))
      expect(await readSyncJson(model)).toBeNull()
      await expect(writeSyncJson(model, { platform_model_id: 'p' })).rejects.toThrow(/symlink/)
      expect(fs.readFileSync(canary, 'utf8')).toContain('CANARY-SECRET')
    })
  })

  describe('readers', () => {
    let model: string
    beforeEach(() => {
      model = mk(project, 'model')
    })

    it('refuses a malformed flows file instead of reading it as "no flows"', async () => {
      // Read as empty, a push would delete every flow the platform has for the model.
      fs.writeFileSync(path.join(model, 'dataflows.json'), '{ not json')
      await expect(readDataFlows(model)).rejects.toThrow(/^dataflows\.json: invalid json$/)
    })

    it('refuses a linked model file, naming the file and a code only', async () => {
      fs.symlinkSync(canary, path.join(model, 'manifest.json'))
      const err = await readManifest(model).then(() => undefined, (e: Error) => e)
      expect(err?.message).toBe('manifest.json: symlink')
      expect(err?.message).not.toContain(tmp)
    })

    it('reads no attribute through a linked group, and reports it', async () => {
      mk(model, 'attributes')
      fs.symlinkSync(outside, path.join(model, 'attributes', 'components'))
      const issues: { file: string }[] = []
      const attrs = await readAttributes(model, undefined, issues as never)
      expect(attrs.components).toEqual({})
      expect(issues.map((i) => i.file)).toContain('attributes/components')
    })
  })

  describe('backup', () => {
    it('leaves links and special files out of a backup, never copying their targets', async () => {
      const model = mk(project, 'model')
      fs.writeFileSync(path.join(model, 'manifest.json'), '{}')
      mk(model, 'attributes', 'components')
      fs.writeFileSync(path.join(model, 'attributes', 'components', 'c-1.json'), '{}')
      fs.symlinkSync(canary, path.join(model, 'notes'))
      fs.symlinkSync(outside, path.join(model, 'attributes', 'linked-dir'))
      const backup = await createDirectoryBackup(model)
      expect(fs.existsSync(path.join(backup, 'manifest.json'))).toBe(true)
      expect(fs.existsSync(path.join(backup, 'attributes', 'components', 'c-1.json'))).toBe(true)
      expect(fs.existsSync(path.join(backup, 'notes'))).toBe(false)
      expect(fs.existsSync(path.join(backup, 'attributes', 'linked-dir'))).toBe(false)
      const copied = fs.readdirSync(backup, { recursive: true }).map(String)
      for (const f of copied) {
        const p = path.join(backup, f)
        if (fs.statSync(p).isFile()) expect(fs.readFileSync(p, 'utf8')).not.toContain('CANARY-SECRET')
      }
    })
  })

  describe('writing a model file', () => {
    let model: string
    const withinTwoSeconds = <T>(p: Promise<T>) =>
      Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hung')), 2000))])
    beforeEach(() => {
      model = mk(project, 'model')
    })

    it('never opens a FIFO planted where the file goes', async () => {
      execFileSync('mkfifo', [path.join(model, 'manifest.json')])
      await expect(withinTwoSeconds(writeFileNoFollow(path.join(model, 'manifest.json'), 'x', model))).rejects.toThrow(/not regular/)
    })

    it('replaces a hard-linked file without writing through the other name', async () => {
      fs.linkSync(canary, path.join(model, 'manifest.json'))
      await writeFileNoFollow(path.join(model, 'manifest.json'), '{"new":true}', model)
      expect(fs.readFileSync(canary, 'utf8')).toContain('CANARY-SECRET')
      expect(fs.readFileSync(path.join(model, 'manifest.json'), 'utf8')).toBe('{"new":true}')
    })

    it('keeps the file\'s mode, and leaves no tmp behind', async () => {
      fs.writeFileSync(path.join(model, 'manifest.json'), '{}', { mode: 0o600 })
      fs.chmodSync(path.join(model, 'manifest.json'), 0o600)
      await writeFileNoFollow(path.join(model, 'manifest.json'), '{"a":1}', model)
      expect(fs.statSync(path.join(model, 'manifest.json')).mode & 0o777).toBe(0o600)
      expect(fs.readdirSync(model)).toEqual(['manifest.json'])
    })

    it('refuses to write below a directory that is not real on the way from the model', async () => {
      fs.symlinkSync(outside, path.join(model, 'attributes'))
      await expect(writeFileNoFollow(path.join(model, 'attributes', 'x.json'), '{}', model)).rejects.toThrow(/attributes: symlink/)
      expect(outsideFiles()).toEqual(['keep.json'])
    })
  })

  describe('content hash', () => {
    let model: string
    beforeEach(() => {
      model = mk(project, 'model')
      fs.writeFileSync(path.join(model, 'manifest.json'), JSON.stringify({ name: 'm' }))
      fs.writeFileSync(path.join(model, 'structure.json'), JSON.stringify({ components: [{ id: 'c-1' }] }))
      mk(model, 'attributes', 'components')
      fs.writeFileSync(path.join(model, 'attributes', 'components', 'c-1.json'), JSON.stringify({ elementId: 'c-1', attributes: { a: 1 } }))
    })

    it('hashes an ordinary tree as before', async () => {
      expect(await computeContentHash(model)).toBe(ORDINARY_TREE_HASH)
    })

    it('leaves out a link or FIFO without reading it, and without hanging', async () => {
      const plain = await computeContentHash(model)
      execFileSync('mkfifo', [path.join(model, 'dataflows.json')])
      fs.symlinkSync(canary, path.join(model, 'attributes', 'components', 'c-2.json'))
      const withSpecial = await Promise.race([
        computeContentHash(model),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hung')), 2000)),
      ])
      expect(withSpecial).toBe(plain)
    })

    it('fails on a file too large to hash rather than silently changing the hash', async () => {
      fs.writeFileSync(path.join(model, 'attributes', 'components', 'c-3.json'), JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }))
      await expect(computeContentHash(model)).rejects.toThrow(/too_large|too large/)
    })

    it('refuses a linked attribute group instead of listing through it', async () => {
      fs.rmSync(path.join(model, 'attributes', 'components'), { recursive: true })
      fs.symlinkSync(outside, path.join(model, 'attributes', 'components'))
      await expect(computeContentHash(model)).rejects.toThrow(/attributes\/components: symlink/)
    })
  })

  describe('backups skip hard links', () => {
    it('leaves a hard-linked file out of a backup', async () => {
      const model = mk(project, 'model')
      fs.writeFileSync(path.join(model, 'manifest.json'), '{}')
      fs.linkSync(canary, path.join(model, 'notes.json'))
      const backup = await createDirectoryBackup(model)
      expect(fs.existsSync(path.join(backup, 'manifest.json'))).toBe(true)
      expect(fs.existsSync(path.join(backup, 'notes.json'))).toBe(false)
    })
  })
})
