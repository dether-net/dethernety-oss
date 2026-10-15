import { Control } from '../interfaces/core-types-interface.js'

/** A model file's reference to a control: by id, by name, or both. */
export interface ControlReference {
  id?: string | null
  name?: string | null
}

/** What a control reference belongs to: the model itself, or one of its elements. */
export type ControlOwnerKind = 'MODEL' | 'BOUNDARY' | 'COMPONENT' | 'DATA_FLOW'

/** The model or element a control reference came from. */
export interface ControlOwner {
  kind: ControlOwnerKind
  /** The element's id in the model file (a reference id for an element the run created); absent for the model. */
  id?: string
  name?: string
}

/**
 * A control reference that was not attached, and why: no control matched it, several did, or the control catalog
 * could not be fetched in full, so a name match or a missing match says nothing certain about the platform.
 */
export interface UnresolvedControl {
  id?: string
  name?: string
  reason: 'not_found' | 'ambiguous' | 'catalog_unavailable'
  /** For an ambiguous reference, the controls it matched. */
  candidates?: Array<{ id: string; name: string }>
  /** The model or element the reference came from, when the caller said. */
  owner?: ControlOwner
}

export interface ControlResolution {
  ids: string[]
  unresolved: UnresolvedControl[]
}

/** Whether the control catalogue was fetched: completely, only the controls with no folder, or not at all. */
export type ControlCatalogStatus = 'complete' | 'incomplete' | 'unavailable'

/**
 * How a message names an unresolved control reference and why it was not attached. An ambiguous one lists the ids of
 * the controls it matched, so the reference can be pinned to one of them.
 */
export const describeUnresolvedControl = (u: UnresolvedControl): string => {
  const label = u.name || u.id || 'unnamed'
  if (u.reason === 'ambiguous') {
    const ids = (u.candidates ?? []).map((c) => c.id)
    return `${label} (${ids.length} controls match that name: ${ids.join(', ')})`
  }
  return u.reason === 'catalog_unavailable' ? `${label} (the control catalog could not be fetched in full)` : label
}

const OWNER_KIND_LABEL: Record<ControlOwnerKind, string> = {
  MODEL: 'model',
  BOUNDARY: 'boundary',
  COMPONENT: 'component',
  DATA_FLOW: 'data flow',
}

/** How a message names the model or element a control reference came from, e.g. `component "API"`. */
export const describeControlOwner = (owner: ControlOwner): string => {
  const label = owner.name || owner.id
  return label ? `${OWNER_KIND_LABEL[owner.kind]} "${label}"` : `the ${OWNER_KIND_LABEL[owner.kind]}`
}

const normalised = (name: string): string => name.trim().toLowerCase()

/**
 * Finds the platform controls a model file's control references name, the same way for import and update: by id, then
 * by exact name, then by name ignoring case and surrounding spaces. A name step attaches a control only when exactly
 * one matches; a name several controls share is ambiguous and attaches none. There is no partial-name match, so
 * "Firewall" never attaches "Perimeter Firewall". The catalogue (the controls with no folder plus every folder's) is
 * fetched once per resolver. When it could not be fetched in full, only an id attaches: a name unique among the
 * controls that were fetched may be shared by one that was not.
 */
export class ControlResolver {
  private controls: Control[] | null = null
  private status: ControlCatalogStatus = 'unavailable'

  constructor(private readonly loadControls: (folderId: string | undefined) => Promise<Control[]>) {}

  /** The control catalogue, fetched once. What could be fetched when it is not complete (see catalogStatus). */
  catalog = async (): Promise<Control[]> => {
    if (this.controls === null) {
      const merged: Control[] = []
      let noFolderOk = false
      let allOk = false
      try {
        merged.push(...(await this.loadControls(undefined)))
        noFolderOk = true
      } catch {
        // Reported through catalogStatus.
      }
      try {
        for (const control of await this.loadControls('all')) {
          if (!merged.some((c) => c.id === control.id)) merged.push(control)
        }
        allOk = true
      } catch {
        // Reported through catalogStatus.
      }
      // The 'all' fetch is the superset (no folder filter), so the catalogue is complete exactly when it succeeded.
      this.status = allOk ? 'complete' : noFolderOk ? 'incomplete' : 'unavailable'
      this.controls = merged
    }
    return this.controls
  }

  catalogStatus = async (): Promise<ControlCatalogStatus> => {
    await this.catalog()
    return this.status
  }

  resolve = async (references: ControlReference[]): Promise<ControlResolution> => {
    // A catalogue entry without an id cannot be attached, so it cannot match either.
    const complete = (await this.catalogStatus()) === 'complete'
    const controls = (await this.catalog()).filter((c): c is Control & { id: string } => typeof c.id === 'string' && c.id !== '')
    const ids: string[] = []
    const unresolved: UnresolvedControl[] = []
    for (const ref of references) {
      const id = typeof ref.id === 'string' && ref.id ? ref.id : undefined
      const name = typeof ref.name === 'string' && ref.name.trim() ? ref.name : undefined
      if (id && controls.some((c) => c.id === id)) {
        ids.push(id)
        continue
      }
      const report = (reason: UnresolvedControl['reason'], matches: Array<Control & { id: string }> = []) =>
        unresolved.push({
          ...(id ? { id } : {}),
          ...(name ? { name } : {}),
          reason,
          ...(reason === 'ambiguous' ? { candidates: matches.map((c) => ({ id: c.id, name: c.name ?? '' })) } : {}),
        })
      if (!name || !complete) {
        report(complete ? 'not_found' : 'catalog_unavailable')
        continue
      }
      const exact = controls.filter((c) => c.name === name)
      const matches = exact.length > 0 ? exact : controls.filter((c) => typeof c.name === 'string' && c.name.trim() && normalised(c.name) === normalised(name))
      if (matches.length === 1) ids.push(matches[0].id)
      else report(matches.length === 0 ? 'not_found' : 'ambiguous', matches)
    }
    return { ids, unresolved }
  }
}
