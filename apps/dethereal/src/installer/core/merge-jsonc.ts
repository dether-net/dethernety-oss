/**
 * Adding and removing owned keys in JSON and JSONC files without touching
 * anything else.
 *
 * The edits are minimal splices located with the parser's offsets: comments,
 * formatting, trailing commas and line endings elsewhere in the file are never
 * rewritten. Insertion and removal are exact inverses, and every merge is
 * guarded: the merged text must parse, hold the owned value, and give back the
 * input byte for byte when the owned key is removed again. Files the parser
 * cannot read cleanly, with duplicate keys, or whose root is not an object are
 * refused, as is any owned key that already exists (a conflict to ask about).
 *
 * The owned key is the leaf; parent objects the merge had to create are recorded
 * as a count and removed with it only while they hold nothing else, so entries
 * the user adds beside it later survive an uninstall. Removal cuts the owned
 * property and one comma only, and every comment outside it must survive.
 */
import { createScanner, findNodeAtLocation, getNodeValue, type Node, type ParseError, parseTree, SyntaxKind, visit } from 'jsonc-parser'
import { isDeepStrictEqual } from 'node:util'
import { InstallerError } from './errors.js'
import type { OwnedKey } from './manifest.js'
import { sha256 } from './safe-write.js'

export type JsonFormat = 'json' | 'jsonc'

const BOM = String.fromCharCode(0xfeff)

/** The parser builds null-prototype objects; compare plain values. */
const valueOf = (node: Node): unknown => JSON.parse(JSON.stringify(getNodeValue(node)))

interface Doc {
  bom: string
  text: string
  root: Node
  eol: string
  unit: string
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function detectUnit(text: string): string {
  const m = /\n([ \t]+)"/.exec(text)
  if (!m) return '  '
  const ws = m[1]!
  if (ws.startsWith('\t')) return '\t'
  return ws.length % 4 === 0 && ws.length >= 4 ? '    ' : '  '
}

/** Parse strictly enough to edit safely; `label` names the file in errors. */
function load(bytes: Buffer, format: JsonFormat, label: string): Doc {
  let text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new InstallerError('parse_error', `${label} (not UTF-8)`)
  const bom = text.startsWith(BOM) ? BOM : ''
  if (bom) text = text.slice(1)
  if (format === 'json') {
    try {
      JSON.parse(text)
    } catch {
      throw new InstallerError('parse_error', label)
    }
  }
  const errors: ParseError[] = []
  const root = parseTree(text, errors, { allowTrailingComma: format === 'jsonc', disallowComments: format === 'json' })
  if (errors.length || !root) throw new InstallerError('parse_error', label)
  if (root.type !== 'object') throw new InstallerError('parse_error', `${label} (root is not an object)`)
  let duplicate = false
  const stack: Array<Set<string>> = []
  visit(text, {
    onObjectBegin: () => { stack.push(new Set()) },
    onObjectEnd: () => { stack.pop() },
    onObjectProperty: (name) => {
      const keys = stack[stack.length - 1]
      if (!keys) return
      if (keys.has(name)) duplicate = true
      keys.add(name)
    },
  }, { allowTrailingComma: true })
  if (duplicate) throw new InstallerError('parse_error', `${label} (duplicate keys)`)
  return { bom, text, root, eol: detectEol(text), unit: detectUnit(text) }
}

const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1
const indentAt = (text: string, at: number) => /^[ \t]*/.exec(text.slice(lineStart(text, at)))![0]
/** Is the closing brace of `obj` alone on its line (only whitespace before it)? */
const braceOnOwnLine = (text: string, obj: Node) => {
  const close = obj.offset + obj.length - 1
  return text.slice(lineStart(text, close), close).trim() === ''
}

/** Render `value` for a property at `indent`, pretty (multi-line) or compact. */
function render(key: string, value: unknown, indent: string, unit: string, eol: string, pretty: boolean): string {
  if (!pretty) return `${JSON.stringify(key)}: ${JSON.stringify(value)}`
  const body = JSON.stringify(value, null, unit).split('\n').map((l, i) => (i === 0 ? l : indent + l)).join(eol)
  return `${JSON.stringify(key)}: ${body}`
}

/** The deepest existing object on `path`, and the part of the path still to create. */
function deepest(root: Node, path: string[], label: string): { obj: Node; rest: string[] } {
  let obj = root
  for (let i = 0; i < path.length; i++) {
    const child = findNodeAtLocation(obj, [path[i]!])
    if (!child) return { obj, rest: path.slice(i) }
    if (i === path.length - 1) throw new InstallerError('conflict', `${label} (${path.join('.')})`)
    // A parent the user set to a value that is not an object ("permission": "allow"): nothing can be added under it.
    if (child.type !== 'object') throw new InstallerError('conflict_scalar_parent', `${label} (${path.slice(0, i + 1).join('.')})`)
    obj = child
  }
  throw new InstallerError('conflict', label)
}

export interface JsonMergeResult {
  bytes: Buffer
  /** The owned key (the full path), the hash of its value, and how many parents above it were created. */
  owned: OwnedKey
}

/**
 * Insert `value` at `path`, creating missing parent objects. `bytes` null creates
 * the file. Refuses a conflict, a parse problem, or any merge that does not pass
 * the guard.
 */
export function mergeJson(bytes: Buffer | null, path: string[], value: unknown, format: JsonFormat, label: string): JsonMergeResult {
  if (path.length === 0) throw new InstallerError('conflict', label)
  if (bytes === null) {
    const nested = path.slice(1).reduceRight<unknown>((v, k) => ({ [k]: v }), value)
    const text = `{\n  ${render(path[0]!, nested, '  ', '  ', '\n', true)}\n}\n`
    const out = Buffer.from(text)
    return guard(null, out, path, value, path.length - 1, format, label)
  }
  const doc = load(bytes, format, label)
  const { obj, rest } = deepest(doc.root, path, label)
  const insertedKey = rest[0]!
  const insertedValue = rest.slice(1).reduceRight<unknown>((v, k) => ({ [k]: v }), value)
  const props = obj.children ?? []
  const last = props[props.length - 1]
  const { text } = doc
  let out: string
  if (last && braceOnOwnLine(text, obj)) {
    // A multi-line object: the new property gets its own line before the closing brace.
    const indent = indentAt(text, last.offset)
    const close = obj.offset + obj.length - 1
    const at = lineStart(text, close)
    const after = text.slice(last.offset + last.length, close)
    const trailing = /^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*,/.test(after)
    const line = `${indent}${render(insertedKey, insertedValue, indent, doc.unit, doc.eol, true)}${trailing ? ',' : ''}${doc.eol}`
    const commaAt = last.offset + last.length
    out = trailing ? text.slice(0, at) + line + text.slice(at) : text.slice(0, commaAt) + ',' + text.slice(commaAt, at) + line + text.slice(at)
  } else if (last) {
    // A compact object: insert right after the last property.
    const at = last.offset + last.length
    out = text.slice(0, at) + ', ' + render(insertedKey, insertedValue, '', doc.unit, doc.eol, false) + text.slice(at)
  } else {
    // An empty object: insert right after the opening brace.
    const at = obj.offset + 1
    out = text.slice(0, at) + render(insertedKey, insertedValue, '', doc.unit, doc.eol, false) + text.slice(at)
  }
  return guard(bytes, Buffer.from(doc.bom + out), path, value, rest.length - 1, format, label)
}

/** The first token at or after `offset` that is not whitespace or a comment. */
function tokenAt(text: string, offset: number): { kind: SyntaxKind; offset: number } {
  const sc = createScanner(text, true)
  sc.setPosition(offset)
  const kind = sc.scan()
  return { kind, offset: sc.getTokenOffset() }
}

/** The comments in `text`, with their offsets. */
function comments(text: string): Array<{ offset: number; text: string }> {
  const sc = createScanner(text, false)
  const out: Array<{ offset: number; text: string }> = []
  for (let k = sc.scan(); k !== SyntaxKind.EOF; k = sc.scan()) {
    if (k === SyntaxKind.LineCommentTrivia || k === SyntaxKind.BlockCommentTrivia) out.push({ offset: sc.getTokenOffset(), text: text.slice(sc.getTokenOffset(), sc.getTokenOffset() + sc.getTokenLength()) })
  }
  return out
}

const blank = (s: string) => /^[ \t]*$/.test(s)
const blankOrBreaks = (s: string) => /^\s*$/.test(s)

/**
 * Remove the owned key at `path`, and each of the `created` parents above it
 * that holds nothing else. Reverses `mergeJson` exactly when the file around it
 * is as the merge left it. Returns null when the key is not there, or when it
 * cannot be cut out without touching anything else (the file is then edited by
 * hand).
 */
export function unmergeJson(bytes: Buffer, path: string[], format: JsonFormat, label: string, created = 0): Buffer | null {
  const doc = load(bytes, format, label)
  if (!findNodeAtLocation(doc.root, path)?.parent) return null
  // Climb through created parents while the owned chain is all they hold.
  let depth = path.length
  for (let c = created; c > 0; c--) {
    const parent = findNodeAtLocation(doc.root, path.slice(0, depth - 1))
    if (!parent || parent.type !== 'object' || (parent.children ?? []).length !== 1) break
    depth--
  }
  const cutPath = path.slice(0, depth)
  const prop = findNodeAtLocation(doc.root, cutPath)?.parent
  if (!prop || prop.type !== 'property') return null
  const obj = prop.parent!
  const siblings = obj.children ?? []
  const prev = siblings[siblings.indexOf(prop) - 1]
  const { text } = doc
  const start = prop.offset
  const end = prop.offset + prop.length
  const after = tokenAt(text, end)
  const ownComma = after.kind === SyntaxKind.CommaToken ? after.offset : -1
  const prevComma = prev ? tokenAt(text, prev.offset + prev.length) : null
  const lineEnd = (at: number) => {
    const nl = text.indexOf('\n', at)
    return nl < 0 ? -1 : nl + 1
  }

  let out: string | null = null
  const ownLineStart = lineStart(text, start)
  const alone = blank(text.slice(ownLineStart, start))
  if (alone && ownComma >= 0 && blank(text.slice(end, ownComma)) && lineEnd(ownComma) > 0 && blank(text.slice(ownComma + 1, lineEnd(ownComma) - 1).replace(/\r$/, ''))) {
    // Its own line(s), comma included.
    out = text.slice(0, ownLineStart) + text.slice(lineEnd(ownComma))
  } else if (alone && ownComma < 0 && lineEnd(end) > 0 && blank(text.slice(end, lineEnd(end) - 1).replace(/\r$/, ''))) {
    // The last property on its own line(s): the comma before it goes too.
    out = text.slice(0, ownLineStart) + text.slice(lineEnd(end))
    if (prevComma?.kind === SyntaxKind.CommaToken) out = out.slice(0, prevComma.offset) + out.slice(prevComma.offset + 1)
  } else if (prevComma?.kind === SyntaxKind.CommaToken && ownComma < 0 && blankOrBreaks(text.slice(prevComma.offset + 1, start))) {
    // Inline after a previous property: the comma before it and the space between.
    out = text.slice(0, prevComma.offset) + text.slice(end)
  } else if (ownComma >= 0 && blankOrBreaks(text.slice(end, ownComma))) {
    // Inline before a next property: it, its comma and the space after.
    let to = ownComma + 1
    while (text[to] === ' ' || text[to] === '\t') to++
    out = text.slice(0, start) + text.slice(to)
  } else if (!prev && ownComma < 0) {
    out = text.slice(0, start) + text.slice(end)
  }
  if (out === null) return null

  const result = Buffer.from(doc.bom + out)
  // Whatever the layout, removing the key must leave everything else as it was,
  // comments included.
  let reloaded: Doc
  try {
    reloaded = load(result, format, label)
  } catch {
    return null
  }
  const before = valueOf(doc.root) as Record<string, unknown>
  if (!isDeepStrictEqual(valueOf(reloaded.root), without(before, cutPath))) return null
  const kept = comments(text).filter((c) => c.offset < start || c.offset >= end).map((c) => c.text)
  if (!isDeepStrictEqual(comments(out).map((c) => c.text), kept)) return null
  return result
}

function without(obj: Record<string, unknown>, path: string[]): unknown {
  const copy = structuredClone(obj)
  let cur: Record<string, unknown> = copy
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>
  delete cur[path[path.length - 1]!]
  return copy
}

/**
 * The merge guard: the output parses, holds the owned value at the owned path,
 * leaves everything else as it was, and gives back the input byte for byte when
 * the owned key is removed again.
 */
export function guard(before: Buffer | null, out: Buffer, ownedPath: string[], ownedValue: unknown, created: number, format: JsonFormat, label: string): JsonMergeResult {
  const merged = load(out, format, label)
  const node = findNodeAtLocation(merged.root, ownedPath)
  if (!node || !isDeepStrictEqual(valueOf(node), ownedValue)) throw new InstallerError('guard_failed', label)
  const topmost = ownedPath.slice(0, ownedPath.length - created)
  if (before !== null) {
    const original = valueOf(load(before, format, label).root) as Record<string, unknown>
    if (!isDeepStrictEqual(without(valueOf(merged.root) as Record<string, unknown>, topmost), original)) throw new InstallerError('guard_failed', label)
    const reversed = unmergeJson(out, ownedPath, format, label, created)
    if (!reversed || !reversed.equals(before)) throw new InstallerError('guard_failed', label)
  } else if (created !== ownedPath.length - 1) {
    throw new InstallerError('guard_failed', label)
  }
  return { bytes: out, owned: { path: ownedPath, valueSha256: sha256(JSON.stringify(ownedValue)), ...(created ? { created } : {}) } }
}

/**
 * Merge several owned keys into one file, in order (for example an MCP server,
 * permission entries and an agent's permission block). Each step is guarded
 * like a single merge, and so is the whole: taking every owned key out again,
 * in reverse, gives back the input byte for byte. A conflict on any key
 * refuses the whole merge; nothing is written until the caller applies the
 * result as one file change.
 */
export function mergeJsonAll(bytes: Buffer | null, entries: ReadonlyArray<{ path: string[]; value: unknown }>, format: JsonFormat, label: string): { bytes: Buffer; owned: OwnedKey[] } {
  if (entries.length === 0) throw new InstallerError('guard_failed', `${label} (nothing to merge)`)
  let cur: Buffer | null = bytes
  const owned: OwnedKey[] = []
  for (const e of entries) {
    const r = mergeJson(cur, e.path, e.value, format, label)
    cur = r.bytes
    owned.push(r.owned)
  }
  if (bytes !== null) {
    let back: Buffer | null = cur
    for (const o of [...owned].reverse()) back = back && unmergeJson(back, o.path, format, label, o.created ?? 0)
    if (!back || !back.equals(bytes)) throw new InstallerError('guard_failed', label)
  }
  return { bytes: cur!, owned }
}
