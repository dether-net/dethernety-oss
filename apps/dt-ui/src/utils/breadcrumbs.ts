import type { Folder } from '@dethernety/dt-core'

/**
 * The folders from the top down to `folderId`, that folder last; empty for the root (Home). A folder missing from
 * `folders` ends the walk there, and a parent cycle stops at the first folder seen twice.
 */
export function folderAncestors(folderId: string | undefined, folders: Folder[]): Folder[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]))
  const trail: Folder[] = []
  const seen = new Set<string>()
  for (let id = folderId; id && !seen.has(id); id = byId.get(id)?.parentFolder?.id) {
    seen.add(id)
    const folder = byId.get(id)
    if (!folder) break
    trail.unshift(folder)
  }
  return trail
}

/**
 * A breadcrumb trail shortened to fit: up to `max` crumbs show as they are; a longer trail shows its first crumb
 * (Home), an ellipsis (null) and its last two, and the crumbs in between are `hidden`, for a menu behind the ellipsis.
 */
export function collapseTrail<T>(trail: T[], max = 4): { shown: (T | null)[], hidden: T[] } {
  if (trail.length <= max) return { shown: [...trail], hidden: [] }
  return { shown: [trail[0], null, ...trail.slice(-2)], hidden: trail.slice(1, -2) }
}
