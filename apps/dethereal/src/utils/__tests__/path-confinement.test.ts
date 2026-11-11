/**
 * Path confinement against the project root, and what happens when there is no
 * usable root: no confinement base may be the filesystem root, the home directory
 * or the session store — whether it came from startup, a caller, or the working
 * directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validatePathConfinement } from '../directory-utils.js'
import { initProjectRoot, resetProjectRoot } from '../project-root.js'
import { readState, updateState, StateFileError } from '../state-store.js'

describe('validatePathConfinement', () => {
  let tmp: string
  let home: string
  let proj: string
  const savedHome = process.env.HOME

  const mkdir = (...parts: string[]): string => {
    const p = path.join(...parts)
    fs.mkdirSync(p, { recursive: true })
    return fs.realpathSync.native(p)
  }
  const modelDir = (...parts: string[]): string => {
    const p = mkdir(...parts)
    fs.writeFileSync(path.join(p, 'manifest.json'), '{"name":"m"}')
    return p
  }
  const register = (paths: unknown[]) =>
    fs.writeFileSync(path.join(mkdir(home, '.dethernety'), 'models.json'), JSON.stringify({ paths }))

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-confine-')))
    home = mkdir(tmp, 'home')
    proj = mkdir(tmp, 'work', 'proj')
    fs.mkdirSync(path.join(proj, '.git'))
    // The model registry and the protected home both follow HOME.
    process.env.HOME = home
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = savedHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  describe('with a resolved project root', () => {
    beforeEach(() => {
      const root = initProjectRoot({ cwd: mkdir(proj, 'src'), env: {} })
      expect(root).toEqual({ root: proj, source: 'marker' })
    })

    it('uses the root, not the working directory, as the default base', async () => {
      const target = path.join(proj, 'threat-models', 'm')
      await expect(validatePathConfinement(target)).resolves.toBe(target)
    })

    it('still refuses a path outside the root', async () => {
      await expect(validatePathConfinement(mkdir(tmp, 'work', 'other'))).rejects.toThrow(/outside the allowed directory/)
    })
  })

  describe('with a refused project root', () => {
    beforeEach(() => {
      expect(initProjectRoot({ cwd: home, env: {} }).root).toBeNull()
    })

    it('refuses an arbitrary path and says how to fix it, without naming a path', async () => {
      const err = await validatePathConfinement(mkdir(home, 'notes')).then(() => undefined, (e: Error) => e)
      expect(err?.message).toMatch(/No project root .*DETHEREAL_PROJECT_ROOT/)
      expect(err?.message.replace(path.join(home, 'notes'), '')).not.toContain(home)
    })

    it('still admits a registered model directory', async () => {
      const model = modelDir(tmp, 'models', 'm')
      register([model])
      await expect(validatePathConfinement(path.join(model, 'structure.json'))).resolves.toBe(
        path.join(model, 'structure.json')
      )
    })
  })

  describe('model registry entries', () => {
    beforeEach(() => {
      initProjectRoot({ cwd: proj, env: {} })
    })

    it('ignores a relative entry', async () => {
      const model = modelDir(tmp, 'models', 'm')
      register([path.relative(process.cwd(), model)])
      await expect(validatePathConfinement(model)).rejects.toThrow(/outside/)
    })

    it('ignores an entry for the home directory itself', async () => {
      fs.writeFileSync(path.join(home, 'manifest.json'), '{"name":"home"}')
      register([home])
      await expect(validatePathConfinement(mkdir(home, 'Documents'))).rejects.toThrow(/outside/)
    })

    it('ignores entries that are not strings', async () => {
      register([42, null, { path: '/' }])
      await expect(validatePathConfinement(mkdir(tmp, 'elsewhere'))).rejects.toThrow(/outside/)
    })
  })

  describe('a base supplied by the caller', () => {
    it.each([
      ['the filesystem root', () => path.parse(tmp).root],
      ['the home directory', () => home],
    ])('is refused when it is %s', async (_label, base) => {
      await expect(validatePathConfinement(mkdir(home, 'x'), base())).rejects.toThrow(/No project root/)
    })

    it('is compared by its real path when reached through a symlink', async () => {
      const link = path.join(tmp, 'proj-link')
      fs.symlinkSync(proj, link)
      const target = path.join(proj, 'm')
      await expect(validatePathConfinement(target, link)).resolves.toBe(target)
      await expect(validatePathConfinement(path.join(link, 'm'), link)).resolves.toBe(target)
    })
  })

  describe('state store', () => {
    it('refuses model state under the home directory when the base is the home directory', async () => {
      const model = modelDir(home, 'stray')
      fs.mkdirSync(path.join(model, '.dethereal'))
      fs.writeFileSync(path.join(model, '.dethereal', 'state.json'), '{}')
      for (const call of [
        () => readState(model, { baseDir: home }),
        () => updateState(model, (s) => s, { baseDir: home }),
      ]) {
        const err = await call().then(() => undefined, (e: unknown) => e)
        expect(err).toBeInstanceOf(StateFileError)
        expect((err as InstanceType<typeof StateFileError>).code).toBe('outside_root')
      }
    })
  })
})
