/**
 * The module list a model's manifest.json holds, derived rather than written by hand: the modules
 * already listed there, the scope's activeModules, and the module of every class the model uses.
 * Derivation only adds, so a module leaves the list only by a deliberate edit (an update push sets the
 * platform model's modules to exactly this list).
 *
 * A class's module comes from its class-cache entry (the platform's own answer, cached by
 * generate_attribute_stubs), else from the elements' classData.module (a pulled model carries it).
 * Anything that cannot be derived is a gap, named for Gate 2, never guessed and never left out silently.
 */
import path from 'node:path'
import { flattenStructure, type ModelStructure } from '@dethernety/dt-core'
import { validatePathConfinement, assertRealModelTree, writeFileNoFollow } from './path-confinement.js'
import { readChecked } from './state-store.js'

export interface ModuleRef {
  id: string
  name: string
}

export type ModuleGapReason = 'module_unknown' | 'module_conflict' | 'scope_unreadable' | 'scope_module_invalid' | 'manifest_module_invalid'

export interface ModuleGap {
  /** The class id, or `scope` / `manifest` for an entry of those files. */
  id: string
  reason: ModuleGapReason
  /** The class's name as the elements give it (bounded), when the gap is a class's. */
  className?: string
  /** The elements using the class (ids, sorted). */
  elements: string[]
}

export interface DerivedModules {
  modules: ModuleRef[]
  gaps: ModuleGap[]
}

const MODULE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_NAME = 200
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** A module reference as `{id, name}`, or null when it is not one: an id of the module-id shape and a short plain name. */
export function moduleRef(value: unknown): ModuleRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { id, name } = value as { id?: unknown; name?: unknown }
  if (typeof id !== 'string' || !MODULE_ID.test(id)) return null
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME || CONTROL.test(name)) return null
  return { id, name }
}

const boundedName = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.replace(new RegExp(CONTROL.source, 'g'), ' ').slice(0, 80) : undefined

interface ClassUse {
  elements: string[]
  name?: string
  fromElements: Map<string, ModuleRef>
}

export interface DerivationInput {
  /** manifest.json's `modules` as it is on disk. */
  manifestModules: unknown
  /** The scope file as read: its content, or why it could not be used. */
  scope: { scope: Record<string, unknown> | null; error?: string }
  structure: ModelStructure
  dataFlows: ReadonlyArray<{ id?: unknown; classData?: unknown }>
  dataItems: ReadonlyArray<{ id?: unknown; classData?: unknown }>
  /** Each cached class's module, by class id (only well-formed ones). */
  classModules: ReadonlyMap<string, ModuleRef>
}

/** The derived list, in a fixed order: manifest entries, then activeModules, then class modules by name and id. */
export function deriveManifestModules(input: DerivationInput): DerivedModules {
  const listed = new Map<string, ModuleRef>()
  const add = (m: ModuleRef) => {
    if (!listed.has(m.id)) listed.set(m.id, m)
  }
  const gaps: ModuleGap[] = []

  if (input.manifestModules !== undefined && input.manifestModules !== null) {
    const entries = Array.isArray(input.manifestModules) ? input.manifestModules : [input.manifestModules]
    for (const entry of entries) {
      const m = moduleRef(entry)
      if (m) add(m)
      else gaps.push({ id: 'manifest', reason: 'manifest_module_invalid', elements: [] })
    }
  }

  if (input.scope.error) {
    gaps.push({ id: 'scope', reason: 'scope_unreadable', elements: [] })
  } else {
    const active = input.scope.scope?.activeModules
    if (active !== undefined && active !== null) {
      for (const entry of Array.isArray(active) ? active : [active]) {
        const m = moduleRef(entry)
        if (m) add(m)
        else gaps.push({ id: 'scope', reason: 'scope_module_invalid', elements: [] })
      }
    }
  }

  const uses = new Map<string, ClassUse>()
  const use = (el: { id?: unknown; classData?: unknown }) => {
    const cd = el.classData as { id?: unknown; name?: unknown; module?: unknown } | null | undefined
    if (!cd || typeof cd !== 'object' || typeof cd.id !== 'string' || !cd.id) return
    let u = uses.get(cd.id)
    if (!u) uses.set(cd.id, (u = { elements: [], fromElements: new Map() }))
    if (typeof el.id === 'string') u.elements.push(el.id)
    u.name ??= boundedName(cd.name)
    const m = moduleRef(cd.module)
    if (m) u.fromElements.set(m.id, m)
  }
  const { boundaries, components } = flattenStructure(input.structure)
  for (const e of [...boundaries, ...components, ...input.dataFlows, ...input.dataItems]) use(e as { id?: unknown; classData?: unknown })

  const fromClasses: ModuleRef[] = []
  for (const [classId, u] of [...uses].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const cached = input.classModules.get(classId)
    const seen = [...u.fromElements.values()]
    const gap = (reason: ModuleGapReason) => gaps.push({ id: classId, reason, ...(u.name ? { className: u.name } : {}), elements: [...u.elements].sort() })
    if (seen.length > 1 || (cached && seen.length === 1 && seen[0]!.id !== cached.id)) {
      gap('module_conflict')
    } else if (cached) fromClasses.push(cached)
    else if (seen.length === 1) fromClasses.push(seen[0]!)
    else gap('module_unknown')
  }
  fromClasses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const m of fromClasses) add(m)
  return { modules: [...listed.values()], gaps }
}

/** A module list from a file, as a result shows it: well-formed entries as they are, anything else named, at most 50. */
export function shownModules(raw: unknown): unknown {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return '(not a list)'
  return raw.slice(0, 50).map((e) => moduleRef(e) ?? '(not {id, name})')
}

/** Whether two module lists are the same list: the same ids and names, in the same order. */
export function sameModules(a: unknown, b: readonly ModuleRef[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false
  return a.every((x, i) => {
    const m = moduleRef(x)
    return m !== null && m.id === b[i]!.id && m.name === b[i]!.name && Object.keys(x as object).length === 2
  })
}

const MANIFEST = 'manifest.json'
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024

/** manifest.json's bytes as a push read them, through the checked reader; null when it cannot be read. */
export async function readManifestBytes(dirPath: string): Promise<Buffer | null> {
  try {
    return await readChecked(path.join(dirPath, MANIFEST), MANIFEST, MAX_MANIFEST_BYTES)
  } catch {
    return null
  }
}

export type PersistResult = { written: true } | { written: false; reason: 'unchanged' | 'changed' | 'unreadable' }

/**
 * Write the derived list into manifest.json, changing nothing else, only when the file still holds
 * the bytes the push read (`readBytes`) and its list differs. Written without following a link,
 * inside the confined model directory.
 */
export async function persistDerivedModules(dirPath: string, readBytes: Buffer, modules: readonly ModuleRef[]): Promise<PersistResult> {
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readBytes.toString('utf8')) as Record<string, unknown>
  } catch {
    return { written: false, reason: 'unreadable' }
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { written: false, reason: 'unreadable' }
  if (sameModules(manifest.modules, modules)) return { written: false, reason: 'unchanged' }
  const dir = await validatePathConfinement(dirPath)
  await assertRealModelTree(dir)
  const now = await readManifestBytes(dir)
  if (!now || !now.equals(readBytes)) return { written: false, reason: 'changed' }
  manifest.modules = modules.map((m) => ({ id: m.id, name: m.name }))
  await writeFileNoFollow(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2), dir)
  return { written: true }
}

/** Why a push that derived its modules must stop before the platform, or null once the list is in manifest.json. */
export async function recordModulesForPush(dirPath: string, readBytes: Buffer | null, modules: readonly ModuleRef[]): Promise<{ written: boolean; refusal?: undefined } | { refusal: string }> {
  const r = readBytes ? await persistDerivedModules(dirPath, readBytes, modules) : ({ written: false, reason: 'unreadable' } as const)
  if (r.written) return { written: true }
  if (r.reason === 'unchanged') return { written: false }
  return {
    refusal: r.reason === 'changed'
      ? 'manifest.json changed while the push was being prepared, so nothing was pushed. Push again.'
      : 'manifest.json could not be read back to record the derived module list, so nothing was pushed.',
  }
}
