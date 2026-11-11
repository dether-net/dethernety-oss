/**
 * Strict control resolution for import and update.
 *
 * Lenient resolution (the default, ControlResolver) links a control reference by id, then by the one
 * control whose name matches exactly or ignoring case, and reports a reference it cannot resolve with a
 * warning while the rest is written. Strict resolution links an entry only to the control it names
 * beyond doubt:
 * - an entry with an id links that id, or nothing;
 * - an entry without an id links the one catalog control whose name equals the entry's name (both
 *   NFC-normalised, zero-width characters removed, trimmed; case matters);
 * - anything else refuses the whole push before the first write.
 *
 * The catalog is read once (the no-folder set and the all-folders set; either failing refuses) and
 * every list is resolved against that snapshot, so each write links exactly what the preflight
 * checked. Resolution depends on the entry and the snapshot only, never on where the element sits.
 *
 * An entry whose id is a greenfield Control's temporary id is deferred: the Control does not exist on
 * the platform yet, and the control library links it once it has created it. Such an entry is neither
 * linked nor refused, and it is left out of the lists reported as written.
 */
import type { Control } from '../interfaces/core-types-interface.js'
import { GREENFIELD_TEMP_ID } from '../dt-control-library/wal-helper.js'

export type ControlResolution = 'lenient' | 'strict'

export const CONTROL_RESOLUTION_CODES = [
  'control_id_not_found',
  'control_name_not_found',
  'control_name_ambiguous',
  'control_entry_invalid',
  'control_catalog_unavailable',
] as const

export type ControlResolutionCode = typeof CONTROL_RESOLUTION_CODES[number]

/** A control as linked: its catalog id and its catalog name. */
export interface ResolvedControl {
  id: string
  name: string
}

/** Fields a strict refusal adds to an import or update error. */
export interface ControlErrorFields {
  code?: string
  /** '@model', the element id as the files hold it, or `<group>[<n>]` for an element without one */
  ref?: string
  /** Position of the entry in that element's controls list */
  index?: number
  /** The entry as given */
  control?: { id: string | null; name: string | null }
  candidates?: ResolvedControl[]
  candidates_total?: number
}

export interface ControlResolutionError extends ControlErrorFields {
  step: 'resolve_controls' | 'validate'
  error: string
}

/** The ref of the model's own controls list. */
export const MODEL_CONTROLS_REF = '@model'

const MAX_CANDIDATES = 20
const MAX_ECHO = 256
const IGNORABLE = new RegExp('[' + [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map((c) => String.fromCharCode(c)).join('') + ']', 'g')

/** A control name as strict resolution compares it; null when nothing is left. */
export function normaliseControlName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const n = name.normalize('NFC').replace(IGNORABLE, '').trim()
  return n.length > 0 ? n : null
}

/** True for an entry whose id is a greenfield Control's temporary id (the control library links it later). */
export function isDeferredControlEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  const id = (entry as { id?: unknown }).id
  return typeof id === 'string' && GREENFIELD_TEMP_ID.test(id)
}

const echo = (v: unknown): string | null =>
  typeof v === 'string' ? (v.length > MAX_ECHO ? `${v.slice(0, MAX_ECHO)}…` : v) : null

interface Owner {
  ref: string
  data: any
}

/**
 * Every element of a monolithic model in document order (a boundary, its components, then its child
 * boundaries), then the data flows and the data items, with the ref reports use.
 */
function walk(model: any): { owners: Owner[]; all: Owner[] } {
  const counters: Record<string, number> = {}
  const all: Owner[] = []
  const owners: Owner[] = [{ ref: MODEL_CONTROLS_REF, data: model }]
  const add = (group: string, el: any, carriesControls: boolean) => {
    const n = counters[group] ?? 0
    counters[group] = n + 1
    if (!el || typeof el !== 'object') return
    const ref = typeof el.id === 'string' && el.id.length > 0 ? el.id : `${group}[${n}]`
    all.push({ ref, data: el })
    if (carriesControls) owners.push({ ref, data: el })
  }
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const boundary = (b: any) => {
    add('boundaries', b, true)
    if (!b || typeof b !== 'object') return
    for (const c of list(b.components)) add('components', c, true)
    for (const child of list(b.boundaries)) boundary(child)
  }
  boundary(model?.defaultBoundary)
  for (const f of list(model?.dataFlows)) add('dataFlows', f, true)
  for (const d of list(model?.dataItems)) add('dataItems', d, true)
  return { owners, all }
}

/** Catalog lookups by id and by normalised name. */
export class ControlCatalog {
  private byId = new Map<string, ResolvedControl>()
  private byName = new Map<string, ResolvedControl[]>()

  constructor(controls: Array<Partial<Pick<Control, 'id' | 'name'>> | null | undefined>) {
    for (const c of controls) {
      if (!c || typeof c.id !== 'string' || !c.id || this.byId.has(c.id)) continue
      const control = { id: c.id, name: typeof c.name === 'string' ? c.name : '' }
      this.byId.set(c.id, control)
      const key = normaliseControlName(c.name)
      if (key !== null) this.byName.set(key, [...(this.byName.get(key) ?? []), control])
    }
  }

  /** Both control sets, or null when either cannot be read. */
  static async load(dtControl: { getControls(args: { folderId?: string }): Promise<Control[]> }): Promise<ControlCatalog | null> {
    try {
      const noFolder = await dtControl.getControls({ folderId: undefined })
      const all = await dtControl.getControls({ folderId: 'all' })
      if (!Array.isArray(noFolder) || !Array.isArray(all)) return null
      return new ControlCatalog([...noFolder, ...all])
    } catch {
      return null
    }
  }

  /** The control an entry links, or why it links none. */
  resolve(entry: unknown): { control: ResolvedControl } | { code: Exclude<ControlResolutionCode, 'control_catalog_unavailable'>; candidates?: ResolvedControl[] } {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { code: 'control_entry_invalid' }
    const { id, name } = entry as { id?: unknown; name?: unknown }
    const named = normaliseControlName(name)
    if (id !== undefined && id !== null) {
      if (typeof id !== 'string' || id.length === 0) return { code: 'control_entry_invalid' }
      const control = this.byId.get(id)
      if (control) return { control }
      const candidates = named !== null ? this.byName.get(named) : undefined
      return { code: 'control_id_not_found', ...(candidates?.length ? { candidates } : {}) }
    }
    if (named === null) return { code: 'control_entry_invalid' }
    const matches = this.byName.get(named) ?? []
    if (matches.length === 1) return { control: matches[0] }
    if (matches.length === 0) return { code: 'control_name_not_found' }
    return { code: 'control_name_ambiguous', candidates: matches }
  }
}

const MESSAGES: Record<Exclude<ControlResolutionCode, 'control_catalog_unavailable'>, (ref: string, index: number, id: string | null, name: string | null) => string> = {
  control_id_not_found: (ref, i, id) => `controls[${i}] of ${ref}: no control in the catalog has the id "${id}"`,
  control_name_not_found: (ref, i, _id, name) => `controls[${i}] of ${ref}: no control in the catalog is named "${name}"`,
  control_name_ambiguous: (ref, i, _id, name) => `controls[${i}] of ${ref}: more than one control in the catalog is named "${name}"; the entry needs an id`,
  control_entry_invalid: (ref, i) => `controls[${i}] of ${ref}: the entry has no usable id or name`,
}

const sortCandidates = (list: ResolvedControl[]) =>
  [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/**
 * One strict run: the refs of the elements it resolves for, the catalog snapshot, and the lists
 * actually written.
 */
export class StrictControlResolver {
  private written = new Map<string, ResolvedControl[]>()

  private constructor(private refs: WeakMap<object, string>, private catalog: ControlCatalog) {}

  /** Element ids that appear twice (or collide with a ref), refused before anything is resolved. */
  static validate(model: any): ControlResolutionError[] {
    const seen = new Set<string>([MODEL_CONTROLS_REF])
    const errors: ControlResolutionError[] = []
    for (const { ref } of walk(model).all) {
      if (seen.has(ref)) errors.push({ step: 'validate', code: 'duplicate_element_id', ref, error: `The element id "${echo(ref)}" is used more than once` })
      seen.add(ref)
    }
    return errors
  }

  /**
   * Resolves every controls list of the model against one catalog snapshot. Any error refuses the
   * push: nothing may be written. A catalog is read only when some entry needs it.
   */
  static async prepare(
    model: any,
    dtControl: { getControls(args: { folderId?: string }): Promise<Control[]> },
  ): Promise<{ errors: ControlResolutionError[] } | { resolver: StrictControlResolver; warnings: string[] }> {
    const { owners } = walk(model)
    const refs = new WeakMap<object, string>()
    const errors: ControlResolutionError[] = []
    const lists: Array<{ ref: string; entries: unknown[] }> = []
    for (const { ref, data } of owners) {
      refs.set(data, ref)
      const controls = data.controls
      if (controls === undefined) continue
      if (!Array.isArray(controls)) {
        errors.push({ step: 'resolve_controls', code: 'control_entry_invalid', ref, error: `The controls of ${ref} are not a list` })
        continue
      }
      if (controls.some((entry) => !isDeferredControlEntry(entry))) lists.push({ ref, entries: controls })
    }
    let catalog = new ControlCatalog([])
    if (lists.length > 0) {
      const loaded = await ControlCatalog.load(dtControl)
      if (!loaded) {
        return { errors: [...errors, { step: 'resolve_controls', code: 'control_catalog_unavailable', error: 'The control catalog could not be read; nothing was written' }] }
      }
      catalog = loaded
    }
    const warnings: string[] = []
    for (const { ref, entries } of lists) {
      entries.forEach((entry, index) => {
        if (isDeferredControlEntry(entry)) return
        const r = catalog.resolve(entry)
        const given = entry && typeof entry === 'object' ? (entry as { id?: unknown; name?: unknown }) : {}
        if ('control' in r) {
          const named = normaliseControlName(given.name)
          if (typeof given.id === 'string' && named !== null && named !== normaliseControlName(r.control.name)) {
            warnings.push(`controls[${index}] of ${ref}: the id "${r.control.id}" links the catalog control named "${echo(r.control.name)}", not "${echo(given.name)}"`)
          }
          return
        }
        const control = { id: echo(given.id), name: echo(given.name) }
        const candidates = r.candidates ? sortCandidates(r.candidates) : undefined
        errors.push({
          step: 'resolve_controls',
          code: r.code,
          ref,
          index,
          control,
          ...(candidates ? { candidates: candidates.slice(0, MAX_CANDIDATES), candidates_total: candidates.length } : {}),
          error: MESSAGES[r.code](ref, index, control.id, control.name),
        })
      })
    }
    if (errors.length > 0) return { errors }
    return { resolver: new StrictControlResolver(refs, catalog), warnings }
  }

  /** The ref of an element (or the model) this run prepared for. */
  refOf(owner: object): string {
    const ref = this.refs.get(owner)
    if (ref === undefined) throw new Error('Strict control resolution: an element the preflight did not see')
    return ref
  }

  /**
   * The controls an element's list links, in list order, deferred entries left out; throws on an entry
   * the snapshot cannot link.
   */
  resolve(owner: object, controls: unknown): ResolvedControl[] {
    if (controls === undefined) return []
    const ref = this.refOf(owner)
    if (!Array.isArray(controls)) throw new Error(`Strict control resolution: the controls of ${ref} are not a list`)
    const linked: ResolvedControl[] = []
    controls.forEach((entry, index) => {
      if (isDeferredControlEntry(entry)) return
      const r = this.catalog.resolve(entry)
      if (!('control' in r)) throw new Error(`Strict control resolution: controls[${index}] of ${ref} does not resolve (${r.code})`)
      linked.push(r.control)
    })
    return linked
  }

  /** Records an element's list as written (call only once the write succeeded). */
  record(owner: object, controls: ResolvedControl[]): void {
    this.written.set(this.refOf(owner), controls.map((c) => ({ ...c })))
  }

  /** The lists written, by ref, each in list order. */
  resolved(): Record<string, ResolvedControl[]> {
    const out: Record<string, ResolvedControl[]> = {}
    for (const [ref, list] of this.written) out[ref] = list.map((c) => ({ ...c }))
    return out
  }
}
