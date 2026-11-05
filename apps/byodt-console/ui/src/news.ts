import type { NewsCategory, NewsItem, NewsView } from '@/api'

// What this operator has read, kept in THIS BROWSER. It is per person, and in local posture the console has
// no notion of who the person is, so the daemon cannot keep it. The cost is that it does not follow an
// operator to another browser.
//
// Item ids, not dates: the feed's dates have no time of day, so two items published on one day could not
// be told apart by date. The stored set is pruned to the ids the feed still carries, so it stays small.
const SEEN_KEY = 'console_news_seen'

export function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    // A damaged entry, or storage the browser refuses: start again rather than fail the tab.
    return new Set()
  }
}

// saveSeen persists the set, keeping only the ids in current. An id the feed no longer carries can never
// be shown again, and one in a category that was switched off is back catalogue when it is switched on
// again, so neither needs remembering.
export function saveSeen(seen: Set<string>, current: Iterable<string>): void {
  const keep = [...current].filter((id) => seen.has(id))
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keep))
  } catch {
    // Storage full or refused: the markers come back on the next load, which is the honest failure.
  }
}

// isNew: not read in this browser, and not part of the back catalogue the category started from when it
// was switched on. The second half is what keeps switching on Platform releases from lighting up every
// release ever made.
export function isNew(item: NewsItem, categories: NewsCategory[], seen: Set<string>): boolean {
  if (seen.has(item.id)) return false
  const since = categories.find((c) => c.key === item.category)?.since
  return !since || item.date >= since
}

export function newIds(view: NewsView | null, seen: Set<string>): string[] {
  if (!view || view.status !== 'ok') return []
  return view.items.filter((i) => isNew(i, view.categories, seen)).map((i) => i.id)
}
