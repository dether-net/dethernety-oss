/**
 * A proposal's citations: locators only, never quoted text. The review module takes a citation only in its grammar
 * (`platform:<field>`, `kg:<id>`, `attributes:<path>`, `source:<path>:<line>[-<line>]`); Dethereal adds what the
 * module cannot know: no path to a secret file, none outside the project (absolute, or climbing with `..`), and a
 * source only among the files discovery read, when discovery lists them.
 */
import { isSecretPath } from '../utils/secret-paths.js'

/** A citation's length, as the review module takes it. */
export const CITATION_MAX = 300

const PATH = '[A-Za-z0-9._\\-/]+'
const GRAMMAR = [
  /^platform:(name|description|type|category|score|attackVector)$/,
  /^kg:[A-Za-z0-9._:-]{1,200}$/,
  new RegExp(`^attributes:${PATH}$`),
  new RegExp(`^source:${PATH}:\\d{1,6}(-\\d{1,6})?$`),
]

/** The file a citation points at, for `attributes:` and `source:`; null for the others. */
export function citedPath(tag: string): string | null {
  if (tag.startsWith('attributes:')) return tag.slice('attributes:'.length)
  if (tag.startsWith('source:')) return tag.slice('source:'.length, tag.lastIndexOf(':'))
  return null
}

/** Why a citation is refused, or null. */
export function citationProblem(tag: string): string | null {
  if (typeof tag !== 'string' || tag.length > CITATION_MAX) return `a citation is at most ${CITATION_MAX} characters`
  if (!GRAMMAR.some((g) => g.test(tag))) return `'${tag.slice(0, 80)}' is not a locator (platform:<field>, kg:<id>, attributes:<path>, source:<path>:<line>)`
  const path = citedPath(tag)
  // isSecretPath also refuses an absolute path, a `..` and a control character
  if (path !== null && isSecretPath(path)) return `'${tag.slice(0, 80)}' points at a secret file or outside the project`
  return null
}

/** The files discovery read, from `.dethereal/discovery.json`'s elements; empty when it lists none. */
export function discoveredSources(discovery: unknown): Set<string> {
  const out = new Set<string>()
  const elements = discovery && typeof discovery === 'object' ? (discovery as { elements?: unknown }).elements : undefined
  for (const el of Array.isArray(elements) ? elements : []) {
    const sources = el && typeof el === 'object' ? (el as { sources?: unknown }).sources : undefined
    for (const s of Array.isArray(sources) ? sources : []) {
      const file = s && typeof s === 'object' ? (s as { file?: unknown }).file : undefined
      if (typeof file === 'string' && file.length > 0) out.add(file.replace(/^(\.\/)+/, ''))
    }
  }
  return out
}
