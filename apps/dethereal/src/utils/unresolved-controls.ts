import type { SplitModel, StructureBoundary, UnresolvedControl } from '@dethernety/dt-core'

// A model file's control entry; it may carry more fields (such as `source`), which are kept as they are.
type ControlEntry = { id?: string | null; name?: string | null }
type ControlHolder = { controls?: ControlEntry[] }

function holderIn(boundary: StructureBoundary | undefined, id: string): ControlHolder | undefined {
  if (!boundary) return undefined
  if (boundary.id === id) return boundary
  const component = boundary.components?.find((c) => c.id === id)
  if (component) return component
  for (const child of boundary.boundaries ?? []) {
    const found = holderIn(child, id)
    if (found) return found
  }
  return undefined
}

/** The model, or the element with this id, in a split model. The default boundary is found by its id there. */
function holderOf(model: SplitModel, owner: NonNullable<UnresolvedControl['owner']>, id: string | undefined): ControlHolder | undefined {
  if (owner.kind === 'MODEL') return model.manifest.model
  if (!id) return undefined
  return owner.kind === 'DATA_FLOW' ? model.dataFlows.find((f) => f.id === id) : holderIn(model.structure.defaultBoundary, id)
}

/** Whether a model file's control entry is the reference the resolver reported (it keeps a non-blank id and name). */
const isReference = (entry: ControlEntry, u: UnresolvedControl): boolean =>
  (typeof entry.id === 'string' && entry.id ? entry.id : undefined) === u.id &&
  (typeof entry.name === 'string' && entry.name.trim() ? entry.name : undefined) === u.name

/**
 * After a push, the model files are rewritten from the platform, where an element has only the controls that
 * attached. A control reference the push could not attach (no control or several had that name) would drop out of the
 * files with it. Instead the entry is written back to the model or element it came from, as the local file has it, so
 * it can still be pinned to a control id and the next push reports it again.
 *
 * `local` is the model the push sent, whose ids the owners use; `exported` is changed in place. Returns the references
 * that could not be written back, because their model or element is not in the exported model.
 */
export function keepUnresolvedControls(
  exported: SplitModel,
  local: SplitModel,
  unresolved: UnresolvedControl[] | undefined,
  idMapping: Map<string, string>,
): UnresolvedControl[] {
  const lost: UnresolvedControl[] = []
  for (const u of unresolved ?? []) {
    if (!u.id && !u.name) continue
    const owner = u.owner
    if (!owner) {
      lost.push(u)
      continue
    }
    // The default boundary is always the exported one, whatever id the local file gave it.
    const isDefaultBoundary = owner.kind === 'BOUNDARY' && owner.id !== undefined && owner.id === local.structure.defaultBoundary?.id
    const target: ControlHolder | undefined = isDefaultBoundary
      ? exported.structure.defaultBoundary
      : holderOf(exported, owner, owner.id === undefined ? undefined : (idMapping.get(owner.id) ?? owner.id))
    if (!target) {
      lost.push(u)
      continue
    }
    // The file schema types an entry's id as a string; a name-only entry in a model file has `id: null`.
    const controls: ControlEntry[] = (target.controls ??= [])
    if (controls.some((c) => isReference(c, u))) continue
    const entry = holderOf(local, owner, owner.id)?.controls?.find((c) => isReference(c, u))
    controls.push(entry ? { ...entry } : { ...(u.id ? { id: u.id } : {}), ...(u.name ? { name: u.name } : {}) })
  }
  return lost
}
