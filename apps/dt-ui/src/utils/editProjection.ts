/**
 * Narrowing an element down to the edit that was actually made.
 *
 * An interactive save carries two things: the element as this client last loaded it, and an `updates`
 * object naming what the user just changed. Sending the whole element means every save rewrites every
 * field — including fields somebody else changed in the meantime, which are silently reverted with no
 * error to either party. `updates` is the only part that states intent, so it is what decides which
 * fields travel.
 *
 * The writers treat a field the element does not define as "leave it alone", so narrowing the element
 * is all that is needed; nothing has to be marked absent explicitly.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The leaf paths an edit names, as segment lists.
 *
 * Three properties, each of which is a real case rather than a precaution:
 *
 * ARRAYS ARE LEAVES. The merge that produced the element treats an array as opaque — it replaces
 * rather than merging element-wise — so the projection must too. Descending would turn a conduit list
 * into `data.conduits.0.justification` and rebuild a partial array from it.
 *
 * PRESENCE IS THE TEST, NOT TRUTH. `zone: null` clears a zone, `crownJewel: false` un-marks a crown
 * jewel, and `parentNode: ''` relocates a node to the root boundary. All three are real edits and a
 * truthiness test drops all three.
 *
 * AN OBJECT WITH NO KEYS NAMES NOTHING. It contributes no path rather than standing for its whole
 * subtree, so an empty edit narrows to nothing instead of quietly widening back to everything.
 */
export function editPaths(updates: unknown): string[][] {
  const paths: string[][] = []
  const walk = (value: Record<string, unknown>, trail: string[]) => {
    for (const key of Object.keys(value)) {
      const child = value[key]
      if (isPlainObject(child)) walk(child, [...trail, key])
      else paths.push([...trail, key])
    }
  }
  if (isPlainObject(updates)) walk(updates, [])
  return paths
}

/**
 * The element rebuilt from `source`, carrying only the paths `updates` names.
 *
 * The id always travels: it is not part of the edit, it is how the write addresses the element at all.
 * A named path missing from `source` is skipped rather than written as undefined — absent and
 * explicitly-undefined mean the same thing to the writers, and skipping keeps the result honest about
 * what it actually holds.
 */
export function projectEdit<T extends object>(source: T, updates: unknown): T {
  const projected: Record<string, unknown> = {}
  if (isPlainObject(source) && 'id' in source) projected.id = source.id

  for (const path of editPaths(updates)) {
    let read: unknown = source
    let found = true
    for (const segment of path) {
      if (!isPlainObject(read) || !(segment in read)) { found = false; break }
      read = read[segment]
    }
    if (!found) continue

    let branch = projected
    for (const segment of path.slice(0, -1)) {
      if (!isPlainObject(branch[segment])) branch[segment] = {}
      branch = branch[segment] as Record<string, unknown>
    }
    branch[path[path.length - 1]] = read
  }

  return projected as T
}
