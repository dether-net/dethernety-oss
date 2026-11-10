/**
 * The pull and push tools hand the settlement writers exactly what they wrote or pushed: export_model
 * registers the model as written (its scope moved out), and import_model writes the control ids the push
 * linked into the files, then registers them, only where the files hold what was pushed.
 *
 * Every test runs with its own HOME, so this machine's key and pointer never carry over.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const hooks = vi.hoisted(() => ({
  importImpl: null as null | ((split: any) => Promise<unknown>),
  pulled: [] as unknown[][],
  pinned: [] as unknown[][],
  pulledResult: null as null | Record<string, unknown>,
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const { richExport } = await import('./fixtures/platform-export.js')
  return {
    ...actual,
    DtImportSplit: class { constructor(_c: unknown) {} importSplitModel = (split: any) => hooks.importImpl!(split) },
    DtExportSplit: class { constructor(_c: unknown) {} exportModelToSplit = async () => richExport() },
  }
})

vi.mock('../../utils/settlement-writers.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../../utils/settlement-writers.js')
  return {
    ...actual,
    registerPulled: async (...args: Parameters<typeof actual.registerPulled>) => {
      hooks.pulled.push(args)
      return hooks.pulledResult ?? actual.registerPulled(...args)
    },
    registerPushPin: async (...args: Parameters<typeof actual.registerPushPin>) => {
      hooks.pinned.push(args)
      return actual.registerPushPin(...args)
    },
  }
})

const { importModelTool } = await import('../import-model.tool.js')
const { exportModelTool } = await import('../export-model.tool.js')
const { modelStateTool } = await import('../model-state.tool.js')
const { gateModel, writeGateModel } = await import('../../utils/__tests__/fixtures/gate-model.js')
const { registerAll } = await import('./helpers/settle.js')
const { initProjectRoot, resetProjectRoot } = await import('../../utils/project-root.js')
const { parseLog } = await import('../../utils/settlement.js')

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false, apolloClient: {} as never }
const realHome = process.env.HOME
let root: string
let homes: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-settlement-wiring-'))
  homes = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-wiring-homes-')))
})
afterAll(async () => {
  process.env.HOME = realHome
  resetProjectRoot()
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(homes, { recursive: true, force: true })
})
beforeEach(async () => {
  const h = path.join(homes, `h${seq++}`)
  await fs.mkdir(h)
  process.env.HOME = h
  initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: root } })
  hooks.importImpl = null
  hooks.pulled = []
  hooks.pinned = []
  hooks.pulledResult = null
})

const ENRICHING = { currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const get = async (dir: string) => ((await modelStateTool.run({ action: 'get', directory_path: dir }, { debug: false })) as any).data
const firstComponent = (s: any): any => {
  let found: any
  const walk = (b: any) => {
    for (const c of b?.components ?? []) found ??= c
    for (const n of b?.boundaries ?? []) walk(n)
  }
  walk(s.defaultBoundary)
  return found
}
const structureOf = (dir: string) => readJson(path.join(dir, 'structure.json'))
async function editStructure(dir: string, fn: (s: any) => void): Promise<void> {
  const s = structureOf(dir)
  fn(s)
  await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(s, null, 2))
}

/** A registered model whose first component names a control without an id. */
async function modelWithNamedControl(): Promise<{ dir: string; component: string }> {
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, gateModel())
  await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify(ENRICHING))
  await editStructure(dir, (s) => { firstComponent(s).controls = [{ id: null, name: 'WAF' }] })
  await registerAll(dir)
  return { dir, component: firstComponent(structureOf(dir)).id }
}

/** The platform's side of an import: the model it created, the ids it gave, the controls it linked. */
function platformImport(component: string, during?: () => Promise<void>) {
  const seen: { split?: any; snapshot?: any } = {}
  hooks.importImpl = async (split) => {
    seen.split = split
    seen.snapshot = structuredClone(split)
    if (during) await during()
    return {
      success: true,
      model: { id: 'M-imported', name: 'Shop' },
      idMapping: new Map([[component, `srv-${component}`]]),
      resolvedControls: { [component]: [{ id: 'ctl-waf', name: 'WAF' }] },
      warnings: [],
      errors: [],
    }
  }
  return seen
}

describe('import_model pins the linked control ids, then registers them', () => {
  it('writes the linked id into the list as pushed, and registers it: no row, a push-pin entry', async () => {
    const { dir, component } = await modelWithNamedControl()
    const seen = platformImport(component)
    const res = await importModelTool.run({ directory_path: dir, create_backup: false }, context) as any
    expect(res.success, res.error).toBe(true)

    const pinned = firstComponent(structureOf(dir))
    expect(pinned.id).toBe(`srv-${component}`)
    expect(pinned.controls).toEqual([{ id: 'ctl-waf', name: 'WAF' }])
    expect(res.data.settlement_registration).toMatchObject({ status: 'registered', registered: 1 })
    expect((await get(dir)).unregistered_changes.rows_total).toBe(0)
    expect(parseLog(readFileSync(path.join(dir, '.dethereal', 'settlements.json'))).entries.at(-1)).toMatchObject({ action: 'push-pin' })

    // The writer got the object pushed, unchanged, and the push's links and ids.
    expect(hooks.pinned).toHaveLength(1)
    const [pinDir, pushed, resolved, idMapping, modelId] = hooks.pinned[0]!
    expect(pinDir).toBe(dir)
    expect(pushed).toBe(seen.split)
    expect(pushed).toEqual(seen.snapshot)
    expect(resolved).toEqual({ [component]: [{ id: 'ctl-waf', name: 'WAF' }] })
    expect((idMapping as Map<string, string>).get(component)).toBe(`srv-${component}`)
    expect(modelId).toBe('M-imported')
  })

  it('leaves a list edited since the push as it is, and registers nothing', async () => {
    const { dir, component } = await modelWithNamedControl()
    const edited = [{ id: null, name: 'WAF' }, { id: null, name: 'MFA' }]
    platformImport(component, () => editStructure(dir, (s) => { firstComponent(s).controls = edited }))
    const res = await importModelTool.run({ directory_path: dir, create_backup: false }, context) as any
    expect(res.success, res.error).toBe(true)
    expect(firstComponent(structureOf(dir)).controls).toEqual(edited)
    expect(res.data).not.toHaveProperty('settlement_registration')
  })

  it('pins and registers nothing while the files keep the reference ids', async () => {
    const { dir, component } = await modelWithNamedControl()
    platformImport(component)
    const res = await importModelTool.run({ directory_path: dir, create_backup: false, disable_source_file_update: true }, context) as any
    expect(res.success, res.error).toBe(true)
    expect(firstComponent(structureOf(dir)).controls).toEqual([{ id: null, name: 'WAF' }])
    expect(res.data).not.toHaveProperty('settlement_registration')
    expect(hooks.pinned).toEqual([])
  })

  it('pins and registers nothing when writing the platform ids back failed', async () => {
    const { dir, component } = await modelWithNamedControl()
    platformImport(component, () => fs.writeFile(path.join(dir, 'structure.json'), '{ not json'))
    const res = await importModelTool.run({ directory_path: dir, create_backup: false }, context) as any
    expect(res.success, res.error).toBe(true)
    expect(res.data.warnings.some((w: string) => /Could not update source files/.test(w))).toBe(true)
    expect(res.data).not.toHaveProperty('settlement_registration')
    expect(hooks.pinned).toEqual([])
  })
})

describe('export_model registers the model as written', () => {
  it('hands the writer the split model written (its scope moved out), with the model id and the prints', async () => {
    const dir = path.join(root, `x${seq++}`)
    const res = await exportModelTool.run({ model_id: 'm-1', directory_path: dir }, context) as any
    expect(res.success, res.error).toBe(true)
    expect(hooks.pulled).toHaveLength(1)
    const [pullDir, split, platform] = hooks.pulled[0] as [string, any, any]
    expect(pullDir).toBe(dir)
    expect(split.manifest.model).not.toHaveProperty('scope')
    // Exactly what is on disk: no local value merged in.
    expect(split.structure).toEqual(structureOf(dir))
    expect(platform.modelId).toBe('m-1')
    expect(platform.prints).toBeTruthy()
  })

  it('says so when the writer failed: the result carries it and a warning', async () => {
    hooks.pulledResult = { status: 'failed', code: 'busy' }
    const dir = path.join(root, `x${seq++}`)
    const res = await exportModelTool.run({ model_id: 'm-1', directory_path: dir }, context) as any
    expect(res.success, res.error).toBe(true)
    expect(res.data.settlement_registration).toEqual({ status: 'failed', code: 'busy' })
    expect(res.data.warnings.some((w: string) => /pulled values were not registered \(busy\)/.test(w))).toBe(true)
  })
})
