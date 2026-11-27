// Name matching shared by the searches (the canvas search, utils/flowSearch.ts, and the Browser's search,
// utils/browserSearch.ts): what counts as a match and how good it is.

/**
 * Text as the searches compare it: accents dropped (é → e), case folded, runs of whitespace as one space, trimmed. NFD
 * splits an accented letter into the letter and its combining mark, and the marks are removed.
 */
export const normalise = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * How well a name matches a query, both already normalised: 0 the whole name, 1 the name's start, 2 a word's start
 * inside it, 3 anywhere; null for no match.
 */
export const rankName = (name: string, query: string): number | null => {
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  let at = name.indexOf(query)
  if (at === -1) return null
  for (; at !== -1; at = name.indexOf(query, at + 1)) {
    if (!/[\p{L}\p{N}]/u.test(name[at - 1])) return 2
  }
  return 3
}
