import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { initProjectRoot, resetProjectRoot } from '../project-root.js'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

// The canary starts the built server: slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

// Paths outside the base fall through to the home-directory model registry; point
// the home directory at an empty temp dir so no test reads the real one.
let mockedHome = ''
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => mockedHome || actual.homedir(), default: { ...actual, homedir: () => mockedHome || actual.homedir() } }
})

const { readState, updateState, updateDetherealJson, deleteDetherealFile, readRepoJson, StateFileError } = await import('../state-store.js')
const { remapLocalSidecars } = await import('../directory-utils.js')
const { acquireFileLock } = await import('../file-lock.js')
const { buildWorker, removeWorker, runWorker, holdLock } = await import('./fixtures/worker-harness.js')

const base = process.cwd()

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => undefined, (e) => e)
  expect(err).toBeInstanceOf(StateFileError)
  expect((err as Error).message).not.toContain(base)
  return (err as InstanceType<typeof StateFileError>).code
}

describe('state-store', () => {
  let worker: string
  let model: string
  let stateFile: string

  beforeAll(async () => {
    worker = await buildWorker()
  }, 120_000)
  afterAll(() => removeWorker(worker))

  beforeEach(async () => {
    mockedHome = await fs.mkdtemp(path.join(base, '.test-state-home-'))
    model = await fs.mkdtemp(path.join(base, '.test-state-'))
    await fs.writeFile(path.join(model, 'manifest.json'), '{"name":"m"}')
    await fs.mkdir(path.join(model, '.dethereal'))
    stateFile = path.join(model, '.dethereal', 'state.json')
    // A model's first state registers it: the registry goes under this test's own project root.
    initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: model } })
  })
  afterEach(async () => {
    resetProjectRoot()
    await fs.rm(model, { recursive: true, force: true })
    await fs.rm(mockedHome, { recursive: true, force: true })
  })

  const write = (content: string) => fs.writeFile(stateFile, content)

  it('round-trips and keeps keys it does not know', async () => {
    await write(JSON.stringify({ currentState: 'DISCOVERED', futureKey: { a: 1 } }))
    const next = await updateState(model, (s) => ({ ...s, currentState: 'STRUCTURE_COMPLETE' }))
    expect(next).toEqual({ currentState: 'STRUCTURE_COMPLETE', futureKey: { a: 1 } })
    expect(await readState(model)).toEqual(next)
    expect(existsSync(path.join(model, '.dethereal', 'state.lock'))).toBe(false)
    expect((await fs.readdir(path.join(model, '.dethereal'))).sort()).toEqual(['state.json'])
  })

  it('loads a legacy file with only some keys', async () => {
    await write('{"currentState":"SCOPE_DEFINED"}')
    expect(await readState(model)).toEqual({ currentState: 'SCOPE_DEFINED' })
  })

  it('returns null for an absent state and creates nothing', async () => {
    await fs.rmdir(path.join(model, '.dethereal'))
    expect(await readState(model)).toBeNull()
    expect(await updateState(model, (s) => ({ ...s, currentState: 'X' }))).toBeNull()
    expect(existsSync(path.join(model, '.dethereal'))).toBe(false)
  })

  it('creates the state when asked to', async () => {
    await fs.rmdir(path.join(model, '.dethereal'))
    const next = await updateState(model, () => ({ currentState: 'INITIALIZED' }), { createIfMissing: true })
    expect(next).toEqual({ currentState: 'INITIALIZED' })
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual({ currentState: 'INITIALIZED' })
  })

  it('refuses to create state outside a model directory', async () => {
    await fs.rm(path.join(model, 'manifest.json'))
    await fs.rmdir(path.join(model, '.dethereal'))
    expect(await codeOf(updateState(model, () => ({}), { createIfMissing: true }))).toBe('not_model_dir')
  })

  it.each([
    ['invalid JSON', '{"refresh":"eyJhbGciOi', 'invalid_json'],
    ['an array', '[]', 'not_object'],
    ['null', 'null', 'not_object'],
  ])('reports %s by code only', async (_label, content, code) => {
    await write(content)
    const err = await readState(model).then(() => undefined, (e) => e)
    expect(err.code).toBe(code)
    expect(err.message).not.toContain('eyJ')
    expect(err.message).not.toContain(base)
  })

  it('does not write when nothing changes', async () => {
    await write('{"currentState":"DISCOVERED"}')
    const before = await fs.stat(stateFile)
    await updateState(model, (s) => ({ ...s }))
    const after = await fs.stat(stateFile)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('serialises writers in different processes', async () => {
    await write('{"staleElements":[]}')
    const results = await Promise.all([
      runWorker(worker, ['state-add', model, base, 'a', '60']),
      runWorker(worker, ['state-add', model, base, 'b', '60']),
    ])
    expect(results.map((r) => r.code)).toEqual([0, 0])
    const state = await readState(model)
    expect(state!.staleElements).toHaveLength(120)
    expect(new Set(state!.staleElements).size).toBe(120)
  }, 120_000)

  it('refuses a model directory outside the base', async () => {
    const outside = await fs.mkdtemp(path.join(mockedHome, 'outside-'))
    await fs.writeFile(path.join(outside, 'manifest.json'), '{}')
    expect(await codeOf(readState(outside, { baseDir: model }))).toBe('outside_root')
  })

  it('refuses a symlinked state file and never materialises its target', async () => {
    const secret = path.join(mockedHome, 'auth.json')
    await fs.writeFile(secret, '{"needle":"canary-secret-value"}')
    await fs.symlink(secret, stateFile)
    expect(await codeOf(readState(model))).toBe('symlink')
    expect(await codeOf(updateState(model, (s) => ({ ...s, x: 1 })))).toBe('symlink')
    expect((await fs.lstat(stateFile)).isSymbolicLink()).toBe(true)
    expect(readFileSync(secret, 'utf8')).toBe('{"needle":"canary-secret-value"}')
  })

  it('refuses a symlinked .dethereal directory', async () => {
    const elsewhere = await fs.mkdtemp(path.join(mockedHome, 'elsewhere-'))
    await fs.rmdir(path.join(model, '.dethereal'))
    await fs.symlink(elsewhere, path.join(model, '.dethereal'))
    expect(await codeOf(updateState(model, () => ({ x: 1 }), { createIfMissing: true }))).toBe('symlink')
    expect(await fs.readdir(elsewhere)).toEqual([])
  })

  it('refuses special and oversized files quickly', async () => {
    await fs.symlink('/dev/zero', stateFile)
    expect(await codeOf(readState(model))).toBe('symlink')
    await fs.unlink(stateFile)
    await fs.writeFile(stateFile, Buffer.alloc(2 * 1024 * 1024, 32))
    expect(await codeOf(readState(model))).toBe('too_large')
  })

  it('refuses a hard-linked state file', async () => {
    const other = path.join(mockedHome, 'other.json')
    await fs.writeFile(other, '{}')
    await fs.link(other, stateFile)
    expect(await codeOf(readState(model))).toBe('hardlinked')
  })

  it('keeps reads inside the model directory', async () => {
    expect(await codeOf(readRepoJson(model, '../outside.json'))).toBe('outside_root')
    expect(await codeOf(readRepoJson(model, '/etc/hosts'))).toBe('outside_root')
  })

  it('keeps the permissions of the file it replaces', async () => {
    await write('{"n":0}')
    await fs.chmod(stateFile, 0o600)
    await updateState(model, (s) => ({ ...s, n: 1 }))
    expect((await fs.stat(stateFile)).mode & 0o777).toBe(0o600)
  })

  it('reports an error code with every underscore spelled as a space', async () => {
    await fs.rm(path.join(model, 'manifest.json'))
    await fs.rmdir(path.join(model, '.dethereal'))
    const err = await updateState(model, () => ({}), { createIfMissing: true }).catch((e) => e)
    expect(err.message).toContain('not model dir')
  })

  it('reports a lock it cannot take by code, without an absolute path', async () => {
    await write('{"n":0}')
    const dir = path.join(model, '.dethereal')
    await fs.chmod(dir, 0o500)
    try {
      expect(await codeOf(updateState(model, (s) => ({ ...s, n: 1 }), { lock: { waitMs: 200 } }))).toBe('io')
    } finally {
      await fs.chmod(dir, 0o700)
    }
  })

  it('leaves no temporary files behind', async () => {
    await write('{}')
    for (let i = 0; i < 5; i++) await updateState(model, (s) => ({ ...s, n: i }))
    expect(await fs.readdir(path.join(model, '.dethereal'))).toEqual(['state.json'])
  })

  describe('id remap after a push', () => {
    it('reports a busy state lock as a warning and leaves the state alone', async () => {
      await write(JSON.stringify({ staleElements: ['c-old'] }))
      const holder = await holdLock(worker, path.join(model, '.dethereal', 'state.lock'), 8000)
      try {
        const warnings = await remapLocalSidecars(model, new Map([['c-old', 'C-NEW']]))
        expect(warnings).toHaveLength(1)
        expect(warnings![0]).toContain('.dethereal/state.json')
        expect(warnings![0]).not.toContain(base)
      } finally {
        holder.kill()
      }
      expect((await readState(model))!.staleElements).toEqual(['c-old'])
    }, 30_000)

    it('does not follow a symlinked state file to a token-like target', async () => {
      const secret = path.join(mockedHome, 'auth.json')
      const content = '{"staleElements":["c-old"],"needle":"canary-secret-value"}'
      await fs.writeFile(secret, content)
      await fs.symlink(secret, stateFile)
      const warnings = await remapLocalSidecars(model, new Map([['c-old', 'C-NEW']]))
      expect(warnings).toHaveLength(1)
      expect(warnings![0]).toContain('(symlink)')
      expect(warnings![0]).not.toContain('canary-secret-value')
      expect(warnings![0]).not.toContain(base)
      expect(readFileSync(secret, 'utf8')).toBe(content)
      expect((await fs.lstat(stateFile)).isSymbolicLink()).toBe(true)
    })

    it('creates nothing when the model has no state', async () => {
      await fs.rmdir(path.join(model, '.dethereal'))
      expect(await remapLocalSidecars(model, new Map([['a', 'B']]))).toBeUndefined()
      expect(existsSync(path.join(model, '.dethereal'))).toBe(false)
    })

    it('waits for a short-lived holder and then remaps', async () => {
      await write(JSON.stringify({ staleElements: ['c-old'], other: true }))
      const lockPath = path.join(model, '.dethereal', 'state.lock')
      const held = await acquireFileLock(lockPath)
      const released = new Promise<void>((r) => setTimeout(() => void held.release().then(r), 300))
      expect(await remapLocalSidecars(model, new Map([['c-old', 'C-NEW']]))).toBeUndefined()
      await released
      expect(await readState(model)).toEqual({ staleElements: ['C-NEW'], other: true })
    })
  })

  describe('crown-jewel map remap after a push', () => {
    const scopeFile = () => path.join(model, '.dethereal', 'scope.json')

    it('re-keys the mapped element ids and keeps everything else', async () => {
      const scope = {
        system_name: 'shop',
        crown_jewels: ['Orders', 'Cards'],
        crown_jewel_elements: { Orders: ['c-old', 'c-kept', 7], Cards: ['d-old'], Odd: 'not-a-list' },
        adversary_classes: ['insider'],
      }
      await fs.writeFile(scopeFile(), JSON.stringify(scope))
      expect(await remapLocalSidecars(model, new Map([['c-old', 'C-NEW'], ['d-old', 'D-NEW']]))).toBeUndefined()
      expect(JSON.parse(readFileSync(scopeFile(), 'utf8'))).toEqual({
        ...scope,
        crown_jewel_elements: { Orders: ['C-NEW', 'c-kept', 7], Cards: ['D-NEW'], Odd: 'not-a-list' },
      })
    })

    it('leaves a scope without a map untouched, and creates no scope', async () => {
      const content = '{ "crown_jewels": ["Orders"] }'
      await fs.writeFile(scopeFile(), content)
      expect(await remapLocalSidecars(model, new Map([['a', 'B']]))).toBeUndefined()
      expect(readFileSync(scopeFile(), 'utf8')).toBe(content)
      await fs.rm(scopeFile())
      expect(await remapLocalSidecars(model, new Map([['a', 'B']]))).toBeUndefined()
      expect(existsSync(scopeFile())).toBe(false)
    })

    it('warns, and writes nothing through a symlinked scope file', async () => {
      const target = path.join(mockedHome, 'scope-target.json')
      const content = '{"crown_jewel_elements":{"Orders":["c-old"]},"needle":"canary-secret-value"}'
      await fs.writeFile(target, content)
      await fs.symlink(target, scopeFile())
      const warnings = await remapLocalSidecars(model, new Map([['c-old', 'C-NEW']]))
      expect(warnings).toHaveLength(1)
      expect(warnings![0]).toContain('crown-jewel map')
      expect(warnings![0]).toContain('(symlink)')
      expect(warnings![0]).not.toContain('canary-secret-value')
      expect(warnings![0]).not.toContain(base)
      expect(readFileSync(target, 'utf8')).toBe(content)
    })
  })

  describe('updateDetherealJson', () => {
    it('rewrites scope.json with the state file\'s guarantees', async () => {
      const scopeFile = path.join(model, '.dethereal', 'scope.json')
      await fs.writeFile(scopeFile, JSON.stringify({ crown_jewels: ['A'], local: { x: 1 } }))
      const next = await updateDetherealJson(model, 'scope.json', (s) => ({ ...s, crown_jewel_elements: { A: ['c-1'] } }))
      expect(next).toEqual({ crown_jewels: ['A'], local: { x: 1 }, crown_jewel_elements: { A: ['c-1'] } })
      expect(JSON.parse(readFileSync(scopeFile, 'utf8'))).toEqual(next)
      expect((await fs.readdir(path.join(model, '.dethereal'))).sort()).toEqual(['scope.json'])

      const before = (await fs.stat(scopeFile)).mtimeMs
      await new Promise((r) => setTimeout(r, 20))
      await updateDetherealJson(model, 'scope.json', (s) => s)
      expect((await fs.stat(scopeFile)).mtimeMs).toBe(before)
    })

    it('refuses a hard-linked scope file', async () => {
      const other = path.join(model, 'other.json')
      await fs.writeFile(other, '{}')
      await fs.link(other, path.join(model, '.dethereal', 'scope.json'))
      expect(await codeOf(updateDetherealJson(model, 'scope.json', (s) => ({ ...s, x: 1 })))).toBe('hardlinked')
    })

    it.each(['manifest.json', 'state.lock', '../manifest.json', 'class-cache/x.json'])('refuses %s', async (file) => {
      expect(await codeOf(updateDetherealJson(model, file, (s) => s))).toBe('outside_root')
    })
  })

  it('realpaths an explicit base before confining to it', async () => {
    const link = path.join(mockedHome, 'base-link')
    await fs.symlink(base, link)
    await write('{"currentState":"DISCOVERED"}')
    expect(await readState(model, { baseDir: link })).toEqual({ currentState: 'DISCOVERED' })
  })

  describe('deleteDetherealFile', () => {
    const quality = () => path.join(model, '.dethereal', 'quality.json')

    it('removes the quality cache, and reports whether there was one', async () => {
      await fs.writeFile(quality(), '{}')
      expect(await deleteDetherealFile(model, 'quality.json')).toBe(true)
      expect(existsSync(quality())).toBe(false)
      expect(await deleteDetherealFile(model, 'quality.json')).toBe(false)
    })

    it('removes a symlink itself, never its target', async () => {
      const target = path.join(mockedHome, 'target.json')
      await fs.writeFile(target, '{"keep":1}')
      await fs.symlink(target, quality())
      expect(await deleteDetherealFile(model, 'quality.json')).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe('{"keep":1}')
    })

    it('does nothing, and takes no lock, without a .dethereal directory', async () => {
      await fs.rmdir(path.join(model, '.dethereal'))
      expect(await deleteDetherealFile(model, 'quality.json')).toBe(false)
      expect(existsSync(path.join(model, '.dethereal'))).toBe(false)
    })

    it('refuses a symlinked .dethereal directory and anything but the quality cache', async () => {
      expect(await codeOf(deleteDetherealFile(model, 'state.json'))).toBe('outside_root')
      await fs.rmdir(path.join(model, '.dethereal'))
      const elsewhere = await fs.mkdtemp(path.join(mockedHome, 'dir-'))
      await fs.writeFile(path.join(elsewhere, 'quality.json'), '{}')
      await fs.symlink(elsewhere, path.join(model, '.dethereal'))
      expect(await codeOf(deleteDetherealFile(model, 'quality.json'))).toBe('symlink')
      expect(existsSync(path.join(elsewhere, 'quality.json'))).toBe(true)
    })
  })

  describe('canary: tools reading the store through a model directory', () => {
    const needle = `canary-store-needle-${Math.random().toString(36).slice(2)}`

    async function seedModel(name: string): Promise<string> {
      const { gateModel, writeGateModel } = await import('./fixtures/gate-model.js')
      const dir = path.join(model, name)
      await writeGateModel(dir, gateModel())
      return dir
    }

    it('never lets a linked, garbage or hostile state reach a tool result', async () => {
      const { allTools } = await import('../../tools/index.js')
      const secret = path.join(mockedHome, 'secret.txt')
      await fs.writeFile(secret, needle)

      // Linked state and scope.
      const linkedState = await seedModel('linked-state')
      await fs.symlink(secret, path.join(linkedState, '.dethereal', 'state.json'))
      await fs.rm(path.join(linkedState, '.dethereal', 'scope.json'))
      await fs.symlink(secret, path.join(linkedState, '.dethereal', 'scope.json'))
      // Linked model files.
      const linkedModel = await seedModel('linked-model')
      for (const f of ['manifest.json', 'structure.json']) {
        await fs.rm(path.join(linkedModel, f))
        await fs.symlink(secret, path.join(linkedModel, f))
      }
      // Garbage in place.
      const garbage = await seedModel('garbage')
      await fs.writeFile(path.join(garbage, 'structure.json'), needle)
      await fs.writeFile(path.join(garbage, '.dethereal', 'state.json'), needle)
      // A state that carries the needle as values.
      const hostile = await seedModel('hostile')
      await fs.writeFile(path.join(hostile, '.dethereal', 'state.json'), JSON.stringify({ currentState: needle, leaky: needle, staleElements: [needle] }))

      const models = { linkedState, linkedModel, garbage, hostile }
      const results: Record<string, unknown> = {}
      const ctx = { debug: false }
      const modelState = allTools.find((t) => t.name === 'model_state')!
      const validate = allTools.find((t) => t.name === 'validate_model_json')!
      for (const [name, dir] of Object.entries(models)) {
        for (const action of ['validate', 'quality', 'coverage', 'zoning', 'gates']) {
          results[`${name} validate ${action}`] = await validate.run({ action, directory_path: dir }, ctx)
        }
        results[`${name} get`] = await modelState.run({ action: 'get', directory_path: dir }, ctx)
        for (const to of ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE', 'ENRICHING', 'REVIEWED']) {
          results[`${name} transition ${to}`] = await modelState.run({ action: 'transition', directory_path: dir, to, add: ['c-web'] }, ctx)
        }
        results[`${name} set_baseline`] = await modelState.run({ action: 'set_baseline', directory_path: dir, commit: 'abcdef1' }, ctx)
        results[`${name} stale`] = await modelState.run({ action: 'stale', directory_path: dir, add: ['c-web'], remove: ['c-db'] }, ctx)
        results[`${name} merge_pulled`] = await modelState.run({ action: 'merge_pulled', directory_path: dir }, ctx)
        // Client-dependent tools stop before the disk without a platform session.
        for (const tool of allTools.filter((t) => t.requiresClient)) {
          const r = await tool.run({ directory_path: dir, model_id: 'm' }, ctx)
          expect(r, tool.name).toMatchObject({ success: false })
          expect(r.error, tool.name).toMatch(/requires authentication|Invalid input|required/i)
          results[`${name} ${tool.name}`] = r
        }
      }
      for (const [label, r] of Object.entries(results)) {
        const text = JSON.stringify(r)
        expect(text, label).not.toContain(needle)
        expect(text, label).not.toContain(base)
        expect(text, label).not.toContain(mockedHome)
      }

      // Positive controls: each case really reached the store or the loader and was refused.
      const get = (name: string) => (results[`${name} get`] as { data: Record<string, any> }).data
      expect(get('linkedState').state_error).toBe('.dethereal/state.json: symlink')
      expect((results['linkedState validate gates'] as any).data.gate3.criteria.C6.value).toContain('symlink')
      expect(get('linkedModel').gates).toEqual({ verdict: 'UNAVAILABLE', reason: 'manifest.json: symlink' })
      expect(get('garbage').state_error).toBe('.dethereal/state.json: invalid json')
      expect(get('garbage').gates.reason).toBe('structure.json: invalid json')
      expect(get('hostile')).toMatchObject({ claimed_state: null, claimed_state_invalid: true, unknown_keys: ['leaky'], stale_elements: [], stale_unresolved: 1 })
      expect((results['linkedState transition SCOPE_DEFINED'] as any).error).toBe('.dethereal/state.json: symlink')
      expect(readFileSync(secret, 'utf8')).toBe(needle)
    })

    // The client-dependent tools read and write scope.json through readScope/writeScope,
    // which now go through the store: a linked scope.json is refused, never followed.
    it('scope.json linked to an unregistered secret: readScope and writeScope refuse, and the secret is untouched', async () => {
      const { readScope, writeScope } = await import('../directory-utils.js')
      const secret = path.join(mockedHome, 'secret-scope.json')
      const needle = `NEEDLE-${Date.now()}`
      await fs.writeFile(secret, JSON.stringify({ depth: needle }))
      await fs.symlink(secret, path.join(model, '.dethereal', 'scope.json'))
      const read = await readScope(model).then(() => undefined, (e: Error) => e)
      expect(read?.message).toBe('.dethereal/scope.json: symlink')
      const write = await writeScope(model, { depth: 'design' } as never).then(() => undefined, (e: Error) => e)
      expect(write?.message).toBe('.dethereal/scope.json: symlink')
      expect(readFileSync(secret, 'utf8')).toContain(needle)
      expect(`${read?.message} ${write?.message}`).not.toContain(needle)
    })
  })
})
