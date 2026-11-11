/**
 * YAML in and out: frontmatter blocks and `harness/*.yaml`. The only module that touches the
 * YAML library, so parsing is strict in one place and emitting is deterministic in one place.
 */

import { parse, stringify } from 'yaml'

export interface Split {
  /** The raw YAML between the `---` lines, or null when the text has no frontmatter. */
  readonly yaml: string | null
  readonly body: string
  /** 1-based line of the first body line in the original text. */
  readonly bodyLine: number
}

export function splitFrontmatter(text: string): Split {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) return { yaml: null, body: text, bodyLine: 1 }
  return { yaml: m[1]!, body: text.slice(m[0].length), bodyLine: m[0].split('\n').length }
}

/** Parses YAML with unique keys and the core schema; returns the value or an error message. */
export function parseYaml(text: string): { value: unknown } | { error: string } {
  try {
    return { value: parse(text, { uniqueKeys: true, schema: 'core', prettyErrors: false }) }
  } catch (err) {
    return { error: (err as Error).message.split('\n')[0]! }
  }
}

/** A frontmatter block from ordered entries; undefined values are left out. No line folding. */
export function emitFrontmatter(entries: ReadonlyArray<readonly [string, unknown]>): string {
  const doc: Record<string, unknown> = {}
  for (const [k, v] of entries) if (v !== undefined) doc[k] = v
  return `---\n${stringify(doc, { lineWidth: 0 })}---\n`
}
