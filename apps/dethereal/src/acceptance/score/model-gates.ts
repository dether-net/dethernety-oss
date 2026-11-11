/**
 * H1 and H2: the gates of the run's final model, recomputed.
 *
 * The run's model directory is copied to a scratch project, and its class
 * cache is rewritten from the pinned module: the run could edit
 * `.dethereal/class-cache/` and so move its own gates. A run whose cache
 * holds an entry of a module class that differs from the module (beyond the
 * fields the platform reserves and serves on component and security-boundary
 * templates), or a module
 * class (its name, kind and template) under another id, is INVALID, not
 * failed: the platform did not serve the pinned module. A class of another
 * module is the run's own choice (H5), whatever its name. Each pinned entry
 * keeps the module the run's entry named, as the run's server derived it. The server's gate tools then run on the
 * copy, offline, with HOME and the project root pointed at the scratch
 * directory, so nothing is read from any real home. The review hash is taken on
 * a second copy that keeps the run's own class cache, as the run's server read it.
 *
 * H1: Gate 2 passes.
 * H2: Gate 3 passes; the state file claims REVIEWED, and the model supports it
 * (Gates 2 and 3, no queued stale element, no pending enrichment); the review
 * hash is current, recomputed here; the state file holds no waiver the key does
 * not expect (a waiver counts whether or not it verifies). The settlement part
 * cannot be recomputed: its baseline is signed with a key in the run's own home,
 * which the scorer never reads. It rests on the run's own `model_state get`,
 * taken through the run's server after the push (`export/model-state.json`):
 * its content hash equal to the one recomputed here, then the baseline
 * verified, no unregistered value, nothing pending, REVIEWED.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { modelStateTool } from '../../tools/model-state.tool.js'
import { validateModelTool } from '../../tools/validate-model.tool.js'
import type { ToolContext } from '../../tools/base-tool.js'
import { loadGateInput, readClassTemplates, reviewHash, type ReviewHashUnavailable } from '../../utils/gates.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { canonicalJson } from '../../utils/canonical-json.js'
import { isObject } from '../json.js'
import { pinnedClassCache, writeClassCache, type ExpectedKey } from '../key.js'
import type { Matching } from './match.js'
import { outcome, type Finding, type GateOutcome } from './outcome.js'
import type { RunDirProblem, StateExport } from './run-dir.js'
import type { SettlementMode } from '../../utils/settlement-switch.js'
import { isModelFile } from '../transcripts/index.js'
import { moduleRef, type ModuleRef } from '../../utils/manifest-modules.js'
import { quickStateFindings } from './quick.js'
import type { TranscriptEvent } from '../transcripts/types.js'

const SKIP_DIRS = new Set(['.git', 'node_modules'])
/** The copy a push keeps of a model directory before it writes (`<dir>.backup-<time>`). */
const BACKUP = /\.backup-[^/]*$/

/** Model directories under a project: a `manifest.json` next to a `structure.json`. Push backups are not models. */
export function findModelDirs(project: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name))
    if (names.has('manifest.json') && names.has('structure.json')) out.push(dir)
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !BACKUP.test(e.name)) walk(path.join(dir, e.name))
  }
  walk(project)
  return out.sort()
}

export interface ModuleClass { id: string; name: string; classType: string; type?: string; template: unknown }

/** The classes a module ships, by id. */
export function readModuleClasses(moduleDataDirs: string | readonly string[]): Map<string, ModuleClass> {
  const out = new Map<string, ModuleClass>()
  for (const moduleDataDir of [moduleDataDirs].flat()) for (const t of fs.readdirSync(moduleDataDir, { withFileTypes: true })) {
    if (!t.isDirectory()) continue
    for (const c of fs.readdirSync(path.join(moduleDataDir, t.name), { withFileTypes: true })) {
      if (!c.isDirectory()) continue
      const dir = path.join(moduleDataDir, t.name, c.name)
      try {
        const cls = JSON.parse(fs.readFileSync(path.join(dir, 'class.json'), 'utf8'))
        const template = JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8'))
        out.set(cls.id, { id: cls.id, name: cls.name, classType: cls.classType, ...(typeof cls.type === 'string' ? { type: cls.type } : {}), template })
      } catch {
        // not a class directory
      }
    }
  }
  return out
}

/**
 * A template as the module names it. The platform serves a class's UI schema
 * as `uischema`, while most module files name it `uiSchema`: the content is the
 * same, so both sides are read under one name. A template holding both is left
 * as it is, and so differs.
 */
function moduleNamed(template: unknown): unknown {
  if (!isObject(template) || !('uischema' in template) || 'uiSchema' in template) return template
  const { uischema, ...rest } = template
  return { ...rest, uiSchema: uischema }
}

/**
 * Attribute keys starting with this prefix (exact case) are the platform's own: it serves them on every component and
 * security-boundary template, whatever the module ships. The same value as dt-core's and dt-module's
 * `RESERVED_ATTRIBUTE_PREFIX`; a test fails when they differ.
 */
export const RESERVED_ATTRIBUTE_PREFIX = 'dethernety_'

const isReserved = (key: unknown): boolean => typeof key === 'string' && key.startsWith(RESERVED_ATTRIBUTE_PREFIX)

/**
 * The scope a served element may carry, as the platform judges it: a plain chain of `#/properties/<key>` with no
 * reserved key. The same pattern as dt-module's; a test fails when the strip removes anything other than the platform does.
 */
const PLAIN_SCOPE = /^#\/properties\/[^/~.[\]"'\\]+(?:\/properties\/[^/~.[\]"'\\]+)*$/
const scopeMayBind = (scope: unknown): boolean => typeof scope === 'string' && PLAIN_SCOPE.test(scope) && !scope.split('/').some(isReserved)

/** What the strip leaves of an element it removes whole; a `null` the template holds itself is kept, and so compared. */
const REMOVED = Symbol('removed')

/** A uischema element without what its object options hold that may not bind, and without an option left empty by it. */
function withoutUnboundOptions(element: Record<string, unknown>): Record<string, unknown> {
  if (!isObject(element.options)) return element
  const walked = Object.entries(element.options).map(([key, value]) => [key, value, isObject(value) ? withoutUnboundElements(value) : value] as const)
  if (!walked.some(([, value, kept]) => kept !== value)) return element
  return { ...element, options: Object.fromEntries(walked.filter(([, , kept]) => kept !== REMOVED).map(([key, , kept]) => [key, kept])) }
}

/** A uischema element without the elements whose scope may not bind, at any depth, and without a layout that held only those. */
function withoutUnboundElements(element: unknown): unknown {
  if (!isObject(element)) return element
  if ('scope' in element && !scopeMayBind(element.scope)) return REMOVED
  let next = element
  if ('elements' in element) {
    const children = element.elements
    if (!Array.isArray(children)) return REMOVED
    const kept = children.map(withoutUnboundElements).filter((e) => e !== REMOVED)
    const changed = kept.length !== children.length || kept.some((e, i) => e !== children[i])
    if (changed && kept.length === 0) return REMOVED
    if (changed) next = { ...next, elements: kept }
  }
  return withoutUnboundOptions(next)
}

/** The class types the platform serves its fields on, as the module names them. */
const OPERATED = new Set(['component', 'securityBoundary'])

/**
 * A module-named template without what the platform reserves or drops before it adds its fields, on the templates it
 * serves them on: a component or security-boundary class (`classType`, the module's). It removes the properties under
 * the reserved prefix and their `required` entries, and every uischema element whose scope is not a plain chain of
 * `#/properties/<key>` free of reserved keys, with any layout or category left empty by that; a template without
 * `schema.properties` or a `Categorization` UI schema loses only those elements. The platform's own category holds only
 * reserved Controls, so it goes whole wherever it stands. One difference from the platform: a `null` element the
 * template holds itself is kept, and so compared. Any other template is returned as it came.
 */
export function withoutReserved(template: unknown, classType: unknown): unknown {
  if (!OPERATED.has(classType as string) || !isObject(template)) return template
  const schema = template.schema
  const ui = template.uiSchema
  if (!isObject(ui)) return template
  if (!isObject(schema) || !isObject(schema.properties) || ui.type !== 'Categorization' || !Array.isArray(ui.elements)) {
    const kept = withoutUnboundElements(ui)
    if (kept === ui) return template
    return { ...template, uiSchema: kept === REMOVED ? { type: 'VerticalLayout', elements: [] } : kept }
  }
  let out: Record<string, unknown> = template
  let next: Record<string, unknown> = schema
  if (Object.keys(schema.properties).some(isReserved)) {
    next = { ...next, properties: Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !isReserved(key))) }
  }
  if (Array.isArray(schema.required) && schema.required.some(isReserved)) next = { ...next, required: schema.required.filter((key) => !isReserved(key)) }
  if (next !== schema) out = { ...out, schema: next }
  const elements = ui.elements as unknown[]
  const kept = elements.map(withoutUnboundElements).filter((e) => e !== REMOVED)
  const held = withoutUnboundOptions(ui)
  const { scope, ...unscoped } = held
  const root = 'scope' in held && !scopeMayBind(scope) ? unscoped : held
  if (root !== ui || kept.length !== elements.length || kept.some((e, i) => e !== elements[i])) out = { ...out, uiSchema: { ...root, elements: kept } }
  return out
}

/** A template as compared with a module class's: module-named, without the platform's reserved fields if it serves them on that class. */
const compared = (template: unknown, classType: unknown): string => canonicalJson(withoutReserved(moduleNamed(template), classType))

/** The platform's component types for the classes that are not components; component types read the same on both sides. */
const PLATFORM_TYPES: Record<string, string> = { DATA_FLOW: 'dataFlow', DATA: 'data', SECURITY_BOUNDARY: 'securityBoundary' }

/** A class kind as both sides spell it: the module's `securityBoundary` and `dataFlow` are the cache's `boundary` and `dataflow`. */
const kindOf = (classType: unknown): string => {
  const k = typeof classType === 'string' ? classType.toLowerCase() : ''
  return k === 'securityboundary' ? 'boundary' : k
}
const nameKey = (name: unknown, kind: string) => `${kind}\u0000${typeof name === 'string' ? name.trim().toLowerCase() : ''}`

/** A module's name as compared: case and everything but letters and digits ignored, so `dethernety-general` is `Dethernety General`. */
const looseName = (name: unknown) => (typeof name === 'string' ? name.toLowerCase().replace(/[^a-z0-9]/g, '') : '')

/** The names the pinned module goes by (its `module.json` name and display name), as `looseName` reads them. */
export function moduleNames(moduleDataDirs: string | readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const moduleDataDir of [moduleDataDirs].flat()) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(moduleDataDir, 'module.json'), 'utf8'))
      for (const n of [m?.name, m?.displayName].map(looseName).filter(Boolean)) out.add(n)
    } catch {
      // no module.json: no names from it
    }
  }
  return out
}

/**
 * A module class under an id the module does not give it: the platform served another version of the module. An entry
 * that names its module says which module it is from; one that names none is judged by its template, since another
 * module's class of the same name has its own.
 */
function movedClass(classId: string, entry: Record<string, unknown>, classes: Map<string, ModuleClass>, pinnedNames: Set<string>): string | null {
  const name = entry.className
  if (classes.has(classId) || typeof name !== 'string' || !name.trim()) return null
  const named = moduleRef(entry.module)
  if (named && !pinnedNames.has(looseName(named.name))) return null
  const same = [...classes.values()].find((c) => nameKey(c.name, kindOf(c.classType)) === nameKey(name, kindOf(entry.classType)) &&
    (named !== null || compared(c.template, c.classType) === compared(entry.template, c.classType)))
  return same ? `the platform served ${same.name} under another id` : null
}

/**
 * Cache entries that show the platform did not serve the pinned module: a module class whose template or component
 * type differs, or a module class under another id. An entry of another module's class is not drift, nor is the module
 * an entry names.
 */
export function classCacheDrift(modelDir: string, classes: Map<string, ModuleClass>, pinnedNames: Set<string> = new Set()): Array<{ classId: string; reason: string }> {
  const dir = path.join(modelDir, '.dethereal', 'class-cache')
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return []
  }
  const out: Array<{ classId: string; reason: string }> = []
  for (const f of files) {
    const classId = f.slice(0, -'.json'.length)
    const cls = classes.get(classId)
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    } catch {
      if (cls) out.push({ classId, reason: 'unreadable' })
      continue
    }
    if (!cls) {
      const moved = movedClass(classId, entry, classes, pinnedNames)
      if (moved) out.push({ classId, reason: moved })
      continue
    }
    const type = typeof entry.componentType === 'string' ? (PLATFORM_TYPES[entry.componentType] ?? entry.componentType) : entry.componentType
    if (compared(entry.template, cls.classType) !== compared(cls.template, cls.classType)) out.push({ classId, reason: 'template differs' })
    else if (type !== undefined && type !== cls.type) out.push({ classId, reason: 'component type differs' })
  }
  return out
}

const listOf = (v: unknown, key: string): any[] => (Array.isArray(v) ? v : isObject(v) && Array.isArray(v[key]) ? v[key] : [])

/** Class ids the model's elements carry, boundaries included. */
function usedClassIds(modelDir: string): string[] {
  const ids = new Set<string>()
  const take = (classData: any) => { if (typeof classData?.id === 'string') ids.add(classData.id) }
  const read = (f: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(modelDir, f), 'utf8'))
    } catch {
      return undefined
    }
  }
  const walk = (b: any) => {
    if (!b || typeof b !== 'object') return
    take(b.classData)
    for (const c of Array.isArray(b.components) ? b.components : []) take(c?.classData)
    for (const n of Array.isArray(b.boundaries) ? b.boundaries : []) walk(n)
  }
  walk(read('structure.json')?.defaultBoundary)
  // A pushed or pulled model wraps each list in an object; a model written locally may not.
  for (const [f, key] of [['dataflows.json', 'dataFlows'], ['data-items.json', 'dataItems']] as const) {
    for (const e of listOf(read(f), key)) take(e?.classData)
  }
  return [...ids].sort()
}

/**
 * Replace a model copy's class cache with the module's classes. Each class keeps the module the run's entry named, as
 * the run's server read it (`modules`, from `readClassTemplates`), else `fallback`; a class of another module keeps an
 * entry naming its module and nothing else, so the module list derives as the run's did. Returns the class ids the
 * module lacks.
 */
export function pinClassCache(modelDir: string, classes: Map<string, ModuleClass>, from: { modules?: Map<string, ModuleRef>; fallback?: ModuleRef } = {}): string[] {
  const dir = path.join(modelDir, '.dethereal', 'class-cache')
  const used = usedClassIds(modelDir)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const unknown: string[] = []
  for (const id of used) {
    const cls = classes.get(id)
    const module = from.modules?.get(id) ?? (cls ? from.fallback : undefined)
    if (!cls) {
      unknown.push(id)
      // Named by the run's own cache listing, never by the model: the file keeps its name.
      if (module && from.modules?.has(id)) fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ classId: id, module }, null, 2) + '\n')
      continue
    }
    const entry = { classId: cls.id, className: cls.name, classType: cls.classType, ...(cls.type ? { componentType: cls.type } : {}), template: cls.template, ...(module ? { module } : {}) }
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(entry, null, 2) + '\n')
  }
  return unknown
}

/**
 * Run `fn` on a scratch project, with HOME and the project root pointed into
 * it and the environment restored afterwards. The scratch directory is removed.
 */
async function isolated<T>(fn: (project: string) => Promise<T>): Promise<T> {
  const work = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'dethereal-score-')))
  const home = path.join(work, 'home')
  const project = path.join(work, 'project')
  fs.mkdirSync(home)
  fs.mkdirSync(project)
  const saved = { HOME: process.env.HOME, DETHEREAL_PROJECT_ROOT: process.env.DETHEREAL_PROJECT_ROOT, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR }
  process.env.HOME = home
  process.env.DETHEREAL_PROJECT_ROOT = project
  delete process.env.CLAUDE_PROJECT_DIR
  try {
    const root = initProjectRoot()
    if (root.root === null) throw new Error(`the scratch project root was refused: ${root.reason}`)
    return await fn(project)
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetProjectRoot()
    fs.rmSync(work, { recursive: true, force: true })
  }
}

/**
 * The pinned module must be the one the key was frozen against: the key
 * model's classes, written from it, hash to the key's pinned value.
 */
const pinned = new Map<string, Promise<void>>()
/** Once per key model, module and pinned hash in a process: a scorer run never changes either directory. */
export function checkPinnedModule(keyModelDir: string, moduleDataDir: string | readonly string[], key: ExpectedKey): Promise<void> {
  const k = `${path.resolve(keyModelDir)}\0${[moduleDataDir].flat().map((d) => path.resolve(d)).join('\0')}\0${pinnedClassCache(key)}`
  let p = pinned.get(k)
  if (!p) {
    p = checkPinned(keyModelDir, moduleDataDir, key)
    // A check that could not run is tried again; only a settled answer is kept.
    p.catch(() => pinned.delete(k))
    pinned.set(k, p)
  }
  return p
}

async function checkPinned(keyModelDir: string, moduleDataDir: string | readonly string[], key: ExpectedKey): Promise<void> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dethereal-score-key-'))
  try {
    fs.cpSync(keyModelDir, tmp, { recursive: true, verbatimSymlinks: true })
    const hash = await writeClassCache(tmp, moduleDataDir)
    if (hash !== pinnedClassCache(key)) throw new Error('the module is not the one the key pins (class cache hash differs)')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export interface ModelGatesResult {
  /** Protocol problems: the run is INVALID and H1/H2 are not computed */
  problems: RunDirProblem[]
  /** The model directory, relative to project/ */
  modelDir?: string
  /** Class ids the model uses that the pinned module does not ship */
  unknownClasses: string[]
  h1?: GateOutcome
  h2?: GateOutcome
  /** Recomputed verdicts, for the report */
  gates?: { gate1: string; gate2: string; gate3: string; gate3_failing: string[] }
  state?: { claimed_state: unknown; review_current: boolean }
  /** Zoning findings of the final model (run boundary ids), at the full phase */
  zoning?: Array<{ kind: string; boundaryId: string; peerId?: string }>
  /** The quality score: reported, never gated */
  quality?: number
  /**
   * Whether the final model, its channels removed, has an external-ingress finding: a crossing Step 5 asks the
   * operator to ratify. Unset when that zoning could not be computed.
   */
  externalIngress?: boolean
}

/** Whether a model copy, with every boundary's declared channels removed, has an external-ingress finding. */
async function unratifiedIngress(copy: string, into: string): Promise<boolean | undefined> {
  fs.cpSync(copy, into, { recursive: true, verbatimSymlinks: true })
  const file = path.join(into, 'structure.json')
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    const strip = (b: unknown) => {
      if (!b || typeof b !== 'object') return
      delete (b as { conduits?: unknown }).conduits
      for (const n of Array.isArray((b as { boundaries?: unknown }).boundaries) ? (b as { boundaries: unknown[] }).boundaries : []) strip(n)
    }
    strip(doc?.defaultBoundary)
    fs.writeFileSync(file, JSON.stringify(doc, null, 2))
  } catch {
    return undefined
  }
  const z = await validateModelTool.run({ action: 'zoning', directory_path: into, assets: 'full' } as never, {} as never)
  if (!z.success) return undefined
  return ((z.data as { findings?: Array<{ kind: string }> }).findings ?? []).some((f) => f.kind === 'external-ingress')
}

interface GatesData {
  gate1: { verdict: string }
  gate2: { verdict: string; checks: Record<string, { verdict: string; failing: Array<{ id: string }>; failing_total: number }> }
  gate3: { verdict: string; criteria: Record<string, { verdict: string; failing: Array<{ id: string }>; failing_total: number }>; waived_total?: number }
}

/**
 * H1 and H2 on the run's final model. A quick run's H2 is its own: the quick model's state and settlement, and Gate 3's
 * C2 and C8 on the priority subset alone (see `quick.ts`), never a review.
 */
export async function modelGates(project: string, moduleDataDir: string | readonly string[], key: ExpectedKey, matching?: Matching, stateExport?: StateExport, options: { quick?: boolean; settlement?: SettlementMode } = {}): Promise<ModelGatesResult> {
  // Whether the run's server had the settlement on; absent, on (the runs from before the switch).
  const settlement = options.settlement ?? 'on'
  const dirs = findModelDirs(project)
  if (dirs.length !== 1) {
    return { problems: [{ code: 'model_count', detail: `project/ holds ${dirs.length} model directories; one is required` }], unknownClasses: [] }
  }
  const modelDir = dirs[0]!
  const rel = path.relative(project, modelDir) || '.'
  const classes = readModuleClasses(moduleDataDir)
  const drift = classCacheDrift(modelDir, classes, moduleNames(moduleDataDir))
  if (drift.length) {
    return {
      problems: drift.map((d) => ({ code: 'class_cache_drift', detail: `class ${d.classId}: ${d.reason}` })),
      modelDir: rel, unknownClasses: [],
    }
  }
  return isolated(async (scratch) => {
    const copy = path.join(scratch, 'model')
    fs.cpSync(modelDir, copy, { recursive: true, verbatimSymlinks: true })
    // The final model's own gates: a loop-back the run left armed holds back Gate 3 for the run, not for scoring.
    fs.rmSync(path.join(copy, '.dethereal', 'loop-back.json'), { force: true })
    // The modules the run's cache named, read as the run's server reads them.
    const unknownClasses = pinClassCache(copy, classes, { modules: (await readClassTemplates(copy)).modules ?? new Map() })

    // The run's own settlement mode, whatever this process's environment says.
    const context: ToolContext = { debug: false, settlement }
    const g = await validateModelTool.run({ action: 'gates', directory_path: copy } as never, context)
    const s = await modelStateTool.run({ action: 'get', directory_path: copy } as never, context)
    if (!g.success || !g.data) throw new Error(`the gates could not be computed: ${g.error ?? 'no data'}`)
    if (!s.success || !s.data) throw new Error(`model_state get failed: ${s.error ?? 'no data'}`)
    // Fails closed should a tool ever read its mode from the environment instead of the context: a run is never scored
    // with the settlement its server did not have.
    const replayed = (s.data as { settlement?: unknown }).settlement === 'off' ? 'off' : 'on'
    if (replayed !== settlement) throw new Error(`the model was read with the settlement ${replayed}, but the run had it ${settlement}`)
    const gates = g.data as unknown as GatesData
    const z = await validateModelTool.run({ action: 'zoning', directory_path: copy, assets: 'full' } as never, context)
    const q = await validateModelTool.run({ action: 'quality', directory_path: copy } as never, context)
    const zoning = z.success ? ((z.data as { findings?: Array<{ kind: string; boundaryId: string; peerId?: string }> }).findings ?? [])
      .map((f) => ({ kind: f.kind, boundaryId: f.boundaryId, ...(f.peerId ? { peerId: f.peerId } : {}) })) : undefined
    const quality = q.success ? (q.data as { quality_score?: number }).quality_score : undefined
    // The crossings Step 5 asks about, read on a copy of their own: a ratified channel removes its finding.
    const externalIngress = await unratifiedIngress(copy, path.join(scratch, 'unratified'))
    const st = s.data as Record<string, unknown>
    // The review hash, recomputed here: the copy's effective state cannot be used, since
    // without the run's key its settlement baseline never verifies.
    let stored: unknown
    try {
      stored = JSON.parse(fs.readFileSync(path.join(copy, '.dethereal', 'state.json'), 'utf8'))?.reviewHash
    } catch {
      stored = undefined
    }
    // The review hash compares with the run's own (the export, the stored review hash): it reads the model as the run
    // left it, class cache included, not the copy the gates read.
    const asRun = path.join(scratch, 'as-run')
    fs.cpSync(modelDir, asRun, { recursive: true, verbatimSymlinks: true })
    const taken = reviewHash(await loadGateInput(asRun))
    const contentHash = 'hash' in taken ? taken.hash : null
    const reviewCurrent = typeof stored === 'string' && contentHash !== null && stored === contentHash

    const h1: Finding[] = []
    if (gates.gate2.verdict !== 'PASS') {
      for (const [name, c] of Object.entries(gates.gate2.checks)) {
        if (c.verdict !== 'PASS') h1.push({ verdict: 'FAIL', code: 'gate2', detail: `Gate 2 check ${name} fails (${c.failing_total})`, refs: c.failing.map((f) => f.id) })
      }
      if (!h1.length) h1.push({ verdict: 'FAIL', code: 'gate2', detail: 'Gate 2 fails' })
    }

    const h2: Finding[] = []
    const gate3Failing = Object.entries(gates.gate3.criteria).filter(([, c]) => c.verdict !== 'PASS')
    for (const [criterion, c] of gate3Failing) {
      const alternate = criterion === 'C2' && c.failing.length === c.failing_total && c.failing.length > 0 &&
        c.failing.every((f) => isAlternateClass(f.id, modelDir, key, matching))
      h2.push({
        verdict: alternate ? 'needs-review' : 'FAIL',
        code: alternate ? 'gate3_alternate_class' : 'gate3',
        detail: alternate
          ? `Gate 3 ${criterion} fails only on components with an alternate class`
          : `Gate 3 ${criterion} fails (${c.failing_total})`,
        refs: c.failing.map((f) => f.id),
      })
    }
    if (gates.gate3.verdict !== 'PASS' && !gate3Failing.length) h2.push({ verdict: 'FAIL', code: 'gate3', detail: 'Gate 3 fails' })
    const unsupported = [
      ...(gates.gate2.verdict !== 'PASS' ? ['Gate 2 fails'] : []),
      ...(gates.gate3.verdict !== 'PASS' ? ['Gate 3 fails'] : []),
      ...(Number(st.stale_resolvable ?? 0) > 0 ? ['stale elements are queued'] : []),
      // Pending enrichment holds a review back only where the settlement is on.
      ...(settlement === 'on' && (st.pending_enrichment as { blocks?: boolean } | undefined)?.blocks ? ['enrichment values are pending'] : []),
    ]
    if (st.claimed_state !== 'REVIEWED') h2.push({ verdict: 'FAIL', code: 'not_reviewed', detail: `the state file claims ${String(st.claimed_state)}, not REVIEWED` })
    else if (unsupported.length) h2.push({ verdict: 'FAIL', code: 'false_review_claim', detail: `the state file claims REVIEWED, but ${unsupported.join('; ')}` })
    else if (contentHash !== null && !reviewCurrent) h2.push({ verdict: 'FAIL', code: 'review_stale', detail: 'the review is stale: the model changed after it' })
    if (contentHash === null) {
      const u = (taken as { unavailable: ReviewHashUnavailable }).unavailable
      h2.push({ verdict: 'FAIL', code: 'review_hash_unavailable', detail: `the model's review hash cannot be taken (${u.code})`, refs: u.files })
    }
    h2.push(...settlementFindings(stateExport, contentHash, 'REVIEWED', settlement))
    for (const w of undeclaredWaivers(modelDir, key, matching)) {
      h2.push({ verdict: 'FAIL', code: 'undeclared_waiver', detail: `a ${w.criterion} waiver the key does not expect`, refs: [w.element] })
    }

    const h2quick = options.quick
      ? [
          ...quickStateFindings(key, st, gates.gate3, matching, storedWaivers(copy)),
          // The model the export speaks for must be the one scored here, as for a full run.
          ...h2.filter((f) => f.code === 'review_hash_unavailable'),
          ...settlementFindings(stateExport, contentHash, 'ENRICHING', settlement),
        ]
      : []
    return {
      problems: [],
      modelDir: rel,
      unknownClasses,
      h1: outcome('H1', h1),
      h2: outcome('H2', options.quick ? h2quick : h2),
      gates: { gate1: gates.gate1.verdict, gate2: gates.gate2.verdict, gate3: gates.gate3.verdict, gate3_failing: gate3Failing.map(([k]) => k) },
      state: { claimed_state: st.claimed_state, review_current: reviewCurrent },
      ...(zoning ? { zoning } : {}),
      ...(typeof quality === 'number' ? { quality } : {}),
      ...(externalIngress !== undefined ? { externalIngress } : {}),
    }
  })
}

/**
 * H2's settlement part, from the run's own `model_state get`. `settlement` is the run record's: with it off the
 * run's server reports none, and only the export's own checks and the run's state apply. A server that reports
 * otherwise than the record says ran another release than the one scored.
 */
export function settlementFindings(e: StateExport | undefined, contentHash: string | null, state: 'REVIEWED' | 'ENRICHING', settlement: SettlementMode): Finding[] {
  if (!e) return [{ verdict: 'FAIL', code: 'no_state_export', detail: 'the run directory holds no model_state export' }]
  // The export speaks for the model it was taken from: that model must be the one scored here. With no hash on either
  // side nothing ties the export to this model.
  if (e.content_hash === null) return [{ verdict: 'FAIL', code: 'state_export_hash_unavailable', detail: `the run's server could not take the review hash (${String(e.content_hash_unavailable?.code)})` }]
  if (contentHash === null) return []
  if (e.content_hash !== contentHash) return [{ verdict: 'FAIL', code: 'state_export_stale', detail: 'the model_state export was taken from another version of the model' }]
  const out: Finding[] = []
  if ((e.settlement === 'off') !== (settlement === 'off')) {
    out.push({
      verdict: 'FAIL', code: 'settlement_mode_mismatch',
      detail: settlement === 'off' ? "the run record says the settlement was off, and the run's server reported it on" : "the run's server reported the settlement off, and the run record does not say so",
    })
  } else if (e.settlement === undefined) {
    if (e.baseline !== 'verified') out.push({ verdict: 'FAIL', code: 'settlement_unverified', detail: `the run's settlement baseline is ${e.baseline}` })
    if (e.unregistered_changes.rows_total > 0) out.push({ verdict: 'FAIL', code: 'unregistered_values', detail: `${e.unregistered_changes.rows_total} attribute value(s) were never registered by the operator` })
    if (e.pending_enrichment?.blocks) out.push({ verdict: 'FAIL', code: 'pending_in_run', detail: 'enrichment values were still pending in the run' })
  }
  if (e.state !== state) out.push({ verdict: 'FAIL', code: state === 'REVIEWED' ? 'run_state_not_reviewed' : 'run_state_not_enriching', detail: `the run's server read the model as ${String(e.state)}` })
  return out
}

/**
 * A run recorded with the settlement off whose transcript shows the settle tool answering: a server with the
 * settlement off does not offer it, so the run's server was on, whatever its record says.
 */
export function settleCallFindings(events: readonly TranscriptEvent[], settlement: SettlementMode): Finding[] {
  if (settlement !== 'off') return []
  const ok = new Set(events.flatMap((r) => (r.kind === 'tool_result' && r.callId !== undefined && !r.isError ? [r.callId] : [])))
  const answered = events.filter((e) => e.kind === 'tool_call' && SETTLE_TOOL.test(e.tool ?? '') && e.callId !== undefined && ok.has(e.callId))
  if (!answered.length) return []
  return [{ verdict: 'FAIL', code: 'settlement_mode_mismatch', detail: 'the run record says the settlement was off, and the settle tool answered in the run', events: answered.map((e) => e.seq) }]
}

/**
 * The settlement prompt: a run starts from no model and registers every value
 * as it writes it, so a correct run shows it only after an orphaned-drop, when
 * the dropped values are asked again. Any other showing may mean a write
 * skipped registration, and the operator's reply to it must not clear what
 * that earned: H2 needs review.
 */
export const SETTLEMENT_PROMPTS: readonly string[] = ['unregistered-confirm']

type Shown = { id: string; event: number; answeredBy?: number }
const DROP_PROMPT = 'orphaned-drop'
const SETTLE_TOOL = /(^|[._])model_state_settle$/
const GET_TOOL = /(^|[._])model_state$/
const squash = (s: string) => s.replace(/\s+/g, '')

function resultOf(events: readonly TranscriptEvent[], call: TranscriptEvent): { data: Record<string, unknown>; event: number } | null {
  const r = events.find((e) => e.kind === 'tool_result' && e.callId !== undefined && e.callId === call.callId)
  if (!r || r.isError || typeof r.text !== 'string') return null
  try {
    const data = JSON.parse(r.text)
    return isObject(data) ? { data, event: r.seq } : null
  } catch {
    return null
  }
}

/**
 * Whether a showing asks again for exactly the values an orphaned-drop dropped, and nothing else. The latest drop
 * before it was answered as a drop; a settle after that answer dropped N registrations (the server's count, with every
 * element named); the `get` that reported the orphans and the last `get` before the showing, after that settle, read
 * the same model (their content hash); nothing wrote the model since that last `get`; and its rows, at most N, are
 * all on dropped elements.
 */
function asksForDropped(s: Shown, shown: readonly Shown[], events: readonly TranscriptEvent[]): boolean {
  const drop = [...shown].reverse().find((d) => d.id === DROP_PROMPT && d.event < s.event && d.answeredBy !== undefined && d.answeredBy < s.event)
  if (!drop) return false
  const answer = events.find((e) => e.seq === drop.answeredBy)
  const said = (answer?.kind === 'answer' ? (answer.answers ?? []).join(' ') : answer?.text ?? '').trim().toLowerCase()
  if (!said || /^stop\b/.test(said)) return false
  const mainCalls = (tool: RegExp, from: number, to: number) =>
    events.filter((e) => e.actor === 'main' && e.kind === 'tool_call' && tool.test(e.tool ?? '') && e.seq > from && e.seq < to)
  const settle = mainCalls(SETTLE_TOOL, drop.answeredBy!, s.event).map((c) => resultOf(events, c))
    .filter((r): r is NonNullable<typeof r> => !!r && typeof r.data.orphaned_dropped === 'number' && r.event < s.event).pop()
  if (!settle) return false
  const dropped = settle.data.orphaned_dropped as number
  const elements = Array.isArray(settle.data.orphaned_dropped_elements) ? (settle.data.orphaned_dropped_elements as unknown[]).map(String) : []
  if (settle.data.orphaned_dropped_elements_total !== elements.length) return false
  const gets = (from: number, to: number) => mainCalls(GET_TOOL, from, to)
    .filter((c) => isObject(c.input) && (c.input as { action?: unknown }).action === 'get').map((c) => resultOf(events, c))
    .filter((r): r is NonNullable<typeof r> => !!r && r.event < to)
  const before = gets(-1, drop.event).filter((r) => Number((r.data.orphaned_registrations as { total?: unknown } | undefined)?.total ?? 0) > 0).pop()
  const last = gets(settle.event, s.event).pop()
  if (!before || !last || typeof last.data.content_hash !== 'string' || last.data.content_hash !== before.data.content_hash) return false
  const writes = events.some((e) => e.seq > last.event && e.seq < s.event &&
    (e.kind === 'server_write' || (e.kind === 'shell' && e.writesModel && !e.denied) || (e.kind === 'file_write' && isModelFile(e.path ?? ''))))
  if (writes) return false
  const u = last.data.unregistered_changes as { rows?: unknown; rows_total?: unknown } | undefined
  type Row = { group?: unknown; element_id?: unknown; field?: unknown; shown?: unknown; removed?: unknown }
  const rows = Array.isArray(u?.rows) ? (u!.rows as Row[]) : []
  if (typeof u?.rows_total !== 'number' || u.rows_total > dropped || rows.length !== u.rows_total) return false
  // Each row's element is known by its placement row: its path, as the drop names the element (less the " (type)").
  const elementOf = (r: Row) => `${String(r.group)}\u0000${String(r.element_id)}`
  const paths = new Map(rows.filter((r) => r.field === 'placement' && typeof r.shown === 'string')
    .map((r) => [elementOf(r), squash((r.shown as string).replace(/ \([^()]*\)$/, ''))]))
  const dropped_ = new Set(elements.map(squash))
  return rows.every((r) => r.removed !== true && paths.has(elementOf(r)) && dropped_.has(paths.get(elementOf(r))!))
}

export function settlementPromptFindings(shown: readonly Shown[], events: readonly TranscriptEvent[] = []): Finding[] {
  const hits = shown.filter((p) => SETTLEMENT_PROMPTS.includes(p.id) && !asksForDropped(p, shown, events))
  if (!hits.length) return []
  const ids = [...new Set(hits.map((p) => p.id))]
  return [{
    verdict: 'needs-review', code: 'settlement_prompt_shown',
    detail: `${ids.join(' and ')} shown: a value was written without being registered`, events: hits.map((p) => p.event),
  }]
}

/** A component whose class is one of its key component's alternates (not the first, primary class). */
function isAlternateClass(runId: string, modelDir: string, key: ExpectedKey, matching?: Matching): boolean {
  const keyId = matching?.components.get(runId)
  const k = keyId ? key.components.find((c) => c.id === keyId) : undefined
  if (!k || k.class_ids.length < 2) return false
  const classId = componentClass(modelDir, runId)
  return classId !== undefined && classId !== k.class_ids[0] && k.class_ids.includes(classId)
}

function componentClass(modelDir: string, id: string): string | undefined {
  let found: string | undefined
  const walk = (b: any) => {
    if (!b || typeof b !== 'object' || found) return
    for (const c of Array.isArray(b.components) ? b.components : []) if (c?.id === id && typeof c.classData?.id === 'string') found = c.classData.id
    for (const n of Array.isArray(b.boundaries) ? b.boundaries : []) walk(n)
  }
  try {
    walk(JSON.parse(fs.readFileSync(path.join(modelDir, 'structure.json'), 'utf8')).defaultBoundary)
  } catch {
    return undefined
  }
  return found
}

/** How many waivers a model's state file holds, in use or not. */
function storedWaivers(modelDir: string): number {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(modelDir, '.dethereal', 'state.json'), 'utf8'))
    return Array.isArray(state?.waivers) ? state.waivers.length : 0
  } catch {
    return 0
  }
}

/** Waiver records in the state file whose element the key does not expect a waiver for. */
export function undeclaredWaivers(modelDir: string, key: ExpectedKey, matching?: Matching): Array<{ criterion: string; element: string }> {
  let state: any
  try {
    state = JSON.parse(fs.readFileSync(path.join(modelDir, '.dethereal', 'state.json'), 'utf8'))
  } catch {
    return []
  }
  const expected = (key.expected_waivers as Array<{ element?: string; criterion?: string }>).filter((w) => w && typeof w === 'object')
  const keyIdOf = (id: string) => matching?.components.get(id) ?? matching?.flows.get(id)?.keyId ?? matching?.dataItems.get(id) ?? matching?.boundaries.get(id) ?? id
  const out: Array<{ criterion: string; element: string }> = []
  for (const w of Array.isArray(state?.waivers) ? state.waivers : []) {
    const criterion = typeof w?.criterion === 'string' ? w.criterion : '?'
    const ids = Array.isArray(w?.element_ids) && w.element_ids.length ? w.element_ids.map(String) : ['?']
    for (const id of ids) {
      const keyId = keyIdOf(id)
      if (!expected.some((e) => e.element === keyId && (e.criterion === undefined || e.criterion === criterion))) out.push({ criterion, element: id })
    }
  }
  return out
}

