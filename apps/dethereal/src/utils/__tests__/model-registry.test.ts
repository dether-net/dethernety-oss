/**
 * The model registry's writer: a model directory inside the project root is added
 * once and updated in place, the registry keeps everything it does not own, and
 * nothing outside the root is ever written or registered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// What happens between the registry's first check of .dethernety and the locked write.
const { lockHook } = vi.hoisted(() => ({ lockHook: { before: null as null | (() => void) } }))
vi.mock('../file-lock.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../file-lock.js')
  return {
    ...actual,
    withFileLock: ((lockPath, fn, options) => {
      lockHook.before?.()
      return actual.withFileLock(lockPath, fn, options)
    }) as typeof actual.withFileLock,
  }
})

const { initProjectRoot, resetProjectRoot } = await import('../project-root.js')
const { registerModel, readRegistry, REGISTRY_REL } = await import('../model-registry.js')

describe('registerModel', () => {
  let tmp: string
  let project: string
  const registry = () => path.join(project, REGISTRY_REL)
  const read = () => JSON.parse(fs.readFileSync(registry(), 'utf8'))
  const model = (rel: string) => {
    const dir = path.join(project, rel)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{}')
    return dir
  }

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-registry-')))
    project = path.join(tmp, 'project')
    fs.mkdirSync(project)
    initProjectRoot({ cwd: project, env: {} })
  })
  afterEach(() => {
    lockHook.before = null
    resetProjectRoot()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('writes nothing when .dethernety is swapped for a link after it was checked', async () => {
    const dir = model('m')
    fs.mkdirSync(path.join(project, '.dethernety'))
    const elsewhere = path.join(tmp, 'elsewhere')
    fs.mkdirSync(elsewhere)
    lockHook.before = () => {
      fs.renameSync(path.join(project, '.dethernety'), path.join(project, '.dethernety-moved'))
      fs.symlinkSync(elsewhere, path.join(project, '.dethernety'))
    }
    expect(await registerModel(dir, { name: 'M', source: 'local' })).toEqual({ registered: false, code: 'outside_root' })
    expect(fs.readdirSync(elsewhere).filter((f) => f !== '.models.lock')).toEqual([])
  })

  it('writes nothing when .dethernety is swapped for another real directory after it was checked', async () => {
    const dir = model('m')
    fs.mkdirSync(path.join(project, '.dethernety'))
    lockHook.before = () => {
      fs.renameSync(path.join(project, '.dethernety'), path.join(project, '.dethernety-moved'))
      fs.mkdirSync(path.join(project, '.dethernety'))
    }
    expect(await registerModel(dir, { name: 'M', source: 'local' })).toEqual({ registered: false, code: 'outside_root' })
    expect(fs.existsSync(registry())).toBe(false)
    expect(fs.readdirSync(path.join(project, '.dethernety-moved'))).toEqual([])
  })

  it('creates the registry with the model, then updates the entry in place', async () => {
    const dir = model('threat-models/shop')
    expect(await registerModel(dir, { name: 'Shop', source: 'pull' })).toEqual({ registered: true })
    const first = read()
    expect(first).toMatchObject({ version: 1, models: [{ name: 'Shop', path: './threat-models/shop', source: 'pull' }] })
    expect(first.models[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    expect(await registerModel(dir, { name: 'Shop v2', source: 'create' })).toEqual({ registered: true })
    const second = read()
    expect(second.models).toHaveLength(1)
    // The name follows; the source and creation time are kept.
    expect(second.models[0]).toEqual({ ...first.models[0], name: 'Shop v2' })
  })

  it('does not rewrite the file when nothing changed', async () => {
    const dir = model('m')
    await registerModel(dir, { name: 'M', source: 'local' })
    const before = fs.statSync(registry()).mtimeMs
    const bytes = fs.readFileSync(registry(), 'utf8')
    await new Promise((r) => setTimeout(r, 20))
    expect(await registerModel(dir, { name: 'M', source: 'pull' })).toEqual({ registered: true })
    expect(fs.readFileSync(registry(), 'utf8')).toBe(bytes)
    expect(fs.statSync(registry()).mtimeMs).toBe(before)
  })

  it('treats "./x" and "x" as the same entry, and keeps every key it does not own', async () => {
    const dir = model('models/a')
    fs.mkdirSync(path.join(project, '.dethernety'))
    fs.writeFileSync(registry(), JSON.stringify({ version: 1, team: 'blue', models: [{ name: 'A', path: 'models/a', createdAt: '2026-01-01T00:00:00Z', pinned: true }] }))
    expect(await registerModel(dir, { name: 'A', source: 'pull' })).toEqual({ registered: true })
    expect(read()).toEqual({ version: 1, team: 'blue', models: [{ name: 'A', path: 'models/a', createdAt: '2026-01-01T00:00:00Z', pinned: true, source: 'pull' }] })
  })

  it('never rewrites an entry whose stored path points outside the project root', async () => {
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(outside)
    fs.mkdirSync(path.join(project, '.dethernety'))
    const entry = { name: 'Elsewhere', path: outside, createdAt: '2026-01-01T00:00:00Z' }
    fs.writeFileSync(registry(), JSON.stringify({ version: 1, models: [entry] }))
    const dir = model('models/b')
    expect(await registerModel(dir, { name: 'B', source: 'local' })).toEqual({ registered: true })
    const doc = read()
    expect(doc.models[0]).toEqual(entry)
    expect(doc.models[1]).toMatchObject({ name: 'B', path: './models/b' })
  })

  it('refuses a directory outside the project root and leaves the registry untouched', async () => {
    const dir = model('inside')
    await registerModel(dir, { name: 'Inside', source: 'local' })
    const bytes = fs.readFileSync(registry(), 'utf8')
    const outside = path.join(tmp, 'outside-model')
    fs.mkdirSync(outside)
    expect(await registerModel(outside, { name: 'Out', source: 'pull' })).toEqual({ registered: false, code: 'outside_root' })
    expect(await registerModel(project, { name: 'Root', source: 'pull' })).toEqual({ registered: false, code: 'outside_root' })
    expect(fs.readFileSync(registry(), 'utf8')).toBe(bytes)
  })

  it('refuses a registry whose models is not a list, without overwriting it', async () => {
    fs.mkdirSync(path.join(project, '.dethernety'))
    fs.writeFileSync(registry(), JSON.stringify({ models: { a: 1 } }))
    expect(await registerModel(model('m'), { name: 'M', source: 'local' })).toEqual({ registered: false, code: 'models_not_array' })
    expect(read()).toEqual({ models: { a: 1 } })
  })

  it('refuses a .dethernety that is a link, and a registry that is one', async () => {
    const elsewhere = path.join(tmp, 'elsewhere')
    fs.mkdirSync(elsewhere)
    fs.symlinkSync(elsewhere, path.join(project, '.dethernety'))
    expect(await registerModel(model('m'), { name: 'M', source: 'local' })).toEqual({ registered: false, code: 'outside_root' })
    expect(fs.readdirSync(elsewhere)).toEqual([])

    fs.rmSync(path.join(project, '.dethernety'))
    fs.mkdirSync(path.join(project, '.dethernety'))
    fs.writeFileSync(path.join(elsewhere, 'target.json'), '{"models":[]}')
    fs.symlinkSync(path.join(elsewhere, 'target.json'), registry())
    expect((await registerModel(model('m2'), { name: 'M2', source: 'local' })).registered).toBe(false)
    expect(fs.readFileSync(path.join(elsewhere, 'target.json'), 'utf8')).toBe('{"models":[]}')
  })

  it('reports no project root', async () => {
    resetProjectRoot()
    initProjectRoot({ cwd: os.homedir(), env: {} })
    expect(await registerModel(model('m'), { name: 'M', source: 'local' })).toEqual({ registered: false, code: 'no_project_root' })
  })

  it('keeps both entries when two registrations run at once', async () => {
    const a = model('a')
    const b = model('b')
    const results = await Promise.all([registerModel(a, { name: 'A', source: 'local' }), registerModel(b, { name: 'B', source: 'local' })])
    expect(results).toEqual([{ registered: true }, { registered: true }])
    const r = await readRegistry(project)
    expect(r.registry === 'present' && r.entries.map((e) => (e as { name: string }).name).sort()).toEqual(['A', 'B'])
  })
})
