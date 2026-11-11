/**
 * The pending-row table pages this server process rendered for each model: what the operator can have been shown.
 * One range of rows may be accepted as shown only inside them, under the pending file's digest they were rendered
 * from. Held in memory only, a bounded number per model, and dropped when the pending file changes.
 */

const MAX_PAGES = 50

interface Rendered { digest: string; pages: Array<[number, number]> }

const byModel = new Map<string, Rendered>()

/** A table page rendered for `dir`: rows `from`–`to` of the pending file with this digest. */
export function noteRendered(dir: string, digest: string, from: number, to: number): void {
  if (to < from) return
  const held = byModel.get(dir)
  const current = held && held.digest === digest ? held : { digest, pages: [] }
  current.pages.push([from, to])
  if (current.pages.length > MAX_PAGES) current.pages.shift()
  byModel.set(dir, current)
}

/** Whether every row from `from` to `to` was on a page rendered for `dir` from this digest; with the pages that were. */
export function renderedCovers(dir: string, digest: string, from: number, to: number): { covered: boolean; rendered: Array<[number, number]> } {
  const held = byModel.get(dir)
  const pages = held && held.digest === digest ? held.pages : []
  const merged = [...pages].sort((a, b) => a[0] - b[0]).reduce<Array<[number, number]>>((out, [a, b]) => {
    const last = out.at(-1)
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
    return out
  }, [])
  return { covered: merged.some(([a, b]) => a <= from && b >= to), rendered: merged }
}

/** Tests only. */
export function clearRendered(): void {
  byModel.clear()
}
