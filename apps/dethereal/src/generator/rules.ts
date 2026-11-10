/**
 * Rule extraction: the unit the rule ledger counts.
 *
 * Every instruction in the prose a workflow was migrated from is a rule, so nothing can be lost
 * silently in a rewrite. The units are deterministic: each list item (with its continuation
 * lines), each table body row, each fenced code block, and each sentence of other text.
 * Headings, thematic breaks and HTML comments are structure, not rules. Frontmatter is left out;
 * the frontmatter map has its own tests.
 *
 * A rule's id comes from its text alone, so it survives moves and reordering; any edit to the
 * text makes a new id. A text repeated within one source gets -2, -3, … in order of appearance.
 */

import { createHash } from 'node:crypto'
import { normaliseNewlines } from './source.js'

export type RuleKind = 'item' | 'row' | 'code' | 'sentence'

export interface Rule {
  readonly id: string
  /** 1-based line where the unit starts in the source. */
  readonly line: number
  readonly kind: RuleKind
  /** The unit's text, whitespace-collapsed. */
  readonly text: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const HEADING = /^\s{0,3}#{1,6}(\s|$)/
const BREAK = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9"'([*`])/

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

export function ruleHash(text: string): string {
  return createHash('sha256').update(collapse(text), 'utf8').digest('hex').slice(0, 10)
}

interface Unit {
  line: number
  kind: RuleKind
  text: string
}

/** The body of a markdown file: frontmatter removed, with the line offset of what remains. */
function body(text: string): { lines: string[]; offset: number } {
  const all = normaliseNewlines(text).split('\n')
  if (all[0] === '---') {
    const end = all.indexOf('---', 1)
    if (end > 0) return { lines: all.slice(end + 1), offset: end + 1 }
  }
  return { lines: all, offset: 0 }
}

function units(text: string): Unit[] {
  const { lines, offset } = body(text)
  const out: Unit[] = []
  // Assigned inside the line callback, so declared through `as` to keep the full types after it.
  let paragraph = null as { line: number; parts: string[] } | null
  let item = null as { line: number; parts: string[] } | null
  let fence = null as { line: number; char: string; len: number; parts: string[] } | null
  let inComment = false

  const flushParagraph = () => {
    if (!paragraph) return
    // Spaces inside code spans are masked, so `a. B` in a span never ends a sentence.
    const joined = collapse(paragraph.parts.join(' ')).replace(/`[^`]*`/g, (span) => span.replace(/ /g, '\uE000'))
    for (const sentence of joined.split(SENTENCE_END)) {
      out.push({ line: paragraph.line, kind: 'sentence', text: sentence.replace(/\uE000/g, ' ') })
    }
    paragraph = null
  }
  const flushItem = () => {
    if (item) out.push({ line: item.line, kind: 'item', text: collapse(item.parts.join(' ')) })
    item = null
  }

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1 + offset

    if (fence) {
      const m = raw.match(FENCE)
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len && raw.trim() === m[1]) {
        out.push({ line: fence.line, kind: 'code', text: fence.parts.join('\n') })
        fence = null
      } else fence.parts.push(raw)
      return
    }
    if (inComment) {
      if (raw.includes('-->')) inComment = false
      return
    }

    const open = raw.match(FENCE)
    if (open) {
      flushParagraph()
      flushItem()
      fence = { line: lineNo, char: open[1]![0]!, len: open[1]!.length, parts: [] }
      return
    }
    if (/^\s*<!--/.test(raw)) {
      flushParagraph()
      flushItem()
      if (!raw.includes('-->')) inComment = true
      return
    }
    if (!raw.trim() || HEADING.test(raw) || BREAK.test(raw)) {
      flushParagraph()
      flushItem()
      return
    }
    if (TABLE_ROW.test(raw)) {
      flushParagraph()
      flushItem()
      const next = lines[idx + 1] ?? ''
      // A header row is the one above the separator; the separator itself is not a rule.
      if (TABLE_SEPARATOR.test(raw) || TABLE_SEPARATOR.test(next)) return
      out.push({ line: lineNo, kind: 'row', text: collapse(raw) })
      return
    }
    const listItem = raw.match(LIST_ITEM)
    if (listItem) {
      flushParagraph()
      flushItem()
      item = { line: lineNo, parts: [raw.slice(listItem[0].length)] }
      return
    }
    // Any text line directly under an item (no blank line between) continues it.
    if (item) {
      item.parts.push(raw)
      return
    }
    const text = raw.replace(/^\s*>\s?/, '')
    if (!paragraph) paragraph = { line: lineNo, parts: [] }
    paragraph.parts.push(text)
  })
  flushParagraph()
  flushItem()
  if (fence) out.push({ line: fence.line, kind: 'code', text: fence.parts.join('\n') })
  return out.filter((u) => /\p{L}/u.test(u.text))
}

export function extractRules(text: string): Rule[] {
  const seen = new Map<string, number>()
  return units(text).map((u) => {
    const base = ruleHash(u.text)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { id: n === 1 ? base : `${base}-${n}`, line: u.line, kind: u.kind, text: u.kind === 'code' ? u.text : collapse(u.text) }
  })
}
