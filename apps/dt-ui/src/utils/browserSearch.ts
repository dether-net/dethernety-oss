import type { ContentIndex, ContentIndexEntry, Folder } from '@dethernety/dt-core'
import { normalise, rankName } from './nameMatch'
import { collapseTrail, folderAncestors } from './breadcrumbs'

/** One model or control the Browser's search found. `folderId` is undefined at the root (Home). */
export interface BrowserSearchResult {
  id: string
  kind: 'model' | 'control'
  name: string
  folderId?: string
  /** Where it is, the folder names from Home down: ['Home', 'Payments', 'PCI scope']. */
  path: string[]
}

const HOME_LABEL = 'Home'

const KIND_ORDER = { model: 0, control: 1 } as const

/** The folder names from Home down to `folderId`: ['Home', 'A', 'B']. */
const pathOf = (folderId: string | undefined, folders: Folder[]): string[] =>
  [HOME_LABEL, ...folderAncestors(folderId, folders).map(folder => folder.name || '')]

/** A path as one line; shortened as the header's trail is (utils/breadcrumbs.ts) unless `full`. */
export const pathText = (path: string[], full = false): string =>
  (full ? path : collapseTrail(path).shown.map(name => name ?? '…')).join(' / ')

/**
 * The models and controls, in every folder, whose name contains `query`, best first: the whole name, then the name's
 * start, then a word's start, then anywhere (utils/nameMatch.ts); within a rank by name, then models before controls,
 * then by folder path. Matching ignores case, accents and repeated whitespace. An empty query, and an item with no
 * name, find nothing.
 */
export function searchContent(query: string, index: ContentIndex, folders: Folder[]): BrowserSearchResult[] {
  const q = normalise(query)
  if (!q) return []

  const found: { entry: ContentIndexEntry, kind: BrowserSearchResult['kind'], rank: number, key: string }[] = []
  const consider = (entry: ContentIndexEntry, kind: BrowserSearchResult['kind']) => {
    const key = normalise(entry.name)
    const rank = key ? rankName(key, q) : null
    if (rank !== null) found.push({ entry, kind, rank, key })
  }
  index.models.forEach(entry => consider(entry, 'model'))
  index.controls.forEach(entry => consider(entry, 'control'))

  return found
    .map(f => {
      const path = pathOf(f.entry.folderId, folders)
      return { ...f, path, pathKey: pathText(path, true) }
    })
    .sort((a, b) =>
      a.rank - b.rank
      || a.key.localeCompare(b.key)
      || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || a.pathKey.localeCompare(b.pathKey)
      || a.entry.id.localeCompare(b.entry.id))
    .map(({ entry, kind, path }) => ({ id: entry.id, kind, name: entry.name, folderId: entry.folderId, path }))
}
