/**
 * The neutral token grammar: scanning (with positions, for lint) and rendering (per harness).
 *
 * Inline tokens:   {{tool:x}}  {{cmd:x}}  {{cmd:x args}}  {{skill:x}}  {{agent:x}}  {{args}}
 *                  ({{skill:x}} is "the x skill", started as a handover: each harness says how)
 * Blocks:          {{#harness claude[,codex,opencode]}} … {{/harness}}   (tag lines stand alone)
 *                  {{#delegate x}} prompt {{/delegate}}
 *                  {{#ask id=x}} question {{/ask}}   ·   {{#ask id=x text}} … {{/ask}} (free text)
 * Includes:        {{include shared/x.md}}           inlined (own line)
 *                  {{include shared/x.md as-file}}   emitted next to the skill, read on demand
 *
 * Rendering order: harness blocks → includes → delegate/ask → inline tokens. Inside a code span
 * or a fenced block an inline token renders bare, so it can sit in an example command line.
 */

import type { AskLayout } from './ask-cues.js'
import { HARNESSES, type Finding, type Harness, NAME_PATTERN } from './types.js'

export type InlineKind = 'tool' | 'cmd' | 'skill' | 'agent' | 'args'

export type Token =
  | { readonly kind: 'inline'; readonly inline: InlineKind; readonly name: string; readonly args?: string }
  | { readonly kind: 'harness-open'; readonly harnesses: readonly Harness[] }
  | { readonly kind: 'harness-close' }
  | { readonly kind: 'include'; readonly path: string; readonly asFile: boolean }
  | { readonly kind: 'delegate-open'; readonly agent: string }
  | { readonly kind: 'delegate-close' }
  | { readonly kind: 'ask-open'; readonly id: string; readonly freeText: boolean }
  | { readonly kind: 'ask-close' }

export interface ScannedToken {
  readonly token: Token
  readonly raw: string
  /** 1-based line in the scanned text. */
  readonly line: number
  /** Inside a code span or fenced block. */
  readonly inCode: boolean
  /** A code span whose whole content is this token. */
  readonly aloneInCodeSpan: boolean
  /** The harness block around the token, or null outside any. */
  readonly harnesses: readonly Harness[] | null
}

export interface ScanResult {
  readonly tokens: readonly ScannedToken[]
  readonly findings: readonly Finding[]
}

const TOOL_NAME = /^[a-z][a-z0-9_]*$/
const ASK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const INCLUDE_PATH = /^shared\/(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*\.md$/
const TOKEN = /\{\{([^{}\n]*)\}\}/g
const FENCE = /^ {0,3}(`{3,}|~{3,})/

function parseToken(body: string): Token | string {
  let m: RegExpMatchArray | null
  if ((m = body.match(/^#harness ([a-z,]+)$/))) {
    const names = m[1]!.split(',')
    const unknown = names.filter((n) => !(HARNESSES as readonly string[]).includes(n))
    if (unknown.length) return `unknown harness ${unknown.join(', ')}`
    if (new Set(names).size !== names.length) return 'harness listed twice'
    return { kind: 'harness-open', harnesses: names as Harness[] }
  }
  if (body === '/harness') return { kind: 'harness-close' }
  if ((m = body.match(/^include (\S+)( as-file)?$/))) {
    if (!INCLUDE_PATH.test(m[1]!)) return `include path must be shared/<name>.md: ${m[1]}`
    return { kind: 'include', path: m[1]!, asFile: m[2] !== undefined }
  }
  if ((m = body.match(/^#delegate (\S+)$/))) {
    if (!NAME_PATTERN.test(m[1]!)) return `bad agent name ${m[1]}`
    return { kind: 'delegate-open', agent: m[1]! }
  }
  if (body === '/delegate') return { kind: 'delegate-close' }
  if ((m = body.match(/^#ask id=(\S+)( text)?$/))) {
    if (!ASK_ID.test(m[1]!)) return `bad ask id ${m[1]}`
    return { kind: 'ask-open', id: m[1]!, freeText: m[2] !== undefined }
  }
  if (body === '/ask') return { kind: 'ask-close' }
  if ((m = body.match(/^tool:(\S+)$/))) {
    if (!TOOL_NAME.test(m[1]!)) return `bad tool name ${m[1]}`
    return { kind: 'inline', inline: 'tool', name: m[1]! }
  }
  if ((m = body.match(/^cmd:(\S+) (\S.*)$/))) {
    if (!NAME_PATTERN.test(m[1]!)) return `bad cmd name ${m[1]}`
    if (/[`]/.test(m[2]!)) return `command arguments must not contain a backtick: ${m[2]}`
    return { kind: 'inline', inline: 'cmd', name: m[1]!, args: m[2]!.trim() }
  }
  if ((m = body.match(/^(cmd|skill|agent):(\S+)$/))) {
    if (!NAME_PATTERN.test(m[2]!)) return `bad ${m[1]} name ${m[2]}`
    return { kind: 'inline', inline: m[1] as InlineKind, name: m[2]! }
  }
  if (body === 'args') return { kind: 'inline', inline: 'args', name: '' }
  return `unknown token {{${body}}}`
}

interface Span {
  readonly start: number
  readonly end: number
}

/** Code spans on one line: a backtick run closed by the next run of the same length. */
function codeSpans(line: string): Span[] {
  const spans: Span[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') {
      i++
      continue
    }
    let n = 0
    while (line[i + n] === '`') n++
    const run = '`'.repeat(n)
    let j = i + n
    let close = -1
    while ((j = line.indexOf(run, j)) !== -1) {
      if (line[j + n] !== '`' && line[j - 1] !== '`') {
        close = j
        break
      }
      while (line[j] === '`') j++
    }
    if (close === -1) {
      i += n
      continue
    }
    spans.push({ start: i + n, end: close })
    i = close + n
  }
  return spans
}

/**
 * Walks the lines of a markdown text, tracking fenced blocks. For each line, `visit` gets the
 * line, its 1-based number, whether it is inside a fence (fence lines included), and its spans.
 */
export function walkMarkdown(
  text: string,
  visit: (line: string, lineNo: number, inFence: boolean, spans: readonly Span[]) => void,
): void {
  let fence: { char: string; len: number } | null = null
  text.split('\n').forEach((line, idx) => {
    const m = line.match(FENCE)
    if (m) {
      const char = m[1]![0]!
      const len = m[1]!.length
      if (!fence) {
        fence = { char, len }
        visit(line, idx + 1, true, [])
        return
      }
      if (fence.char === char && len >= fence.len && line.trim() === m[1]!.trim()) {
        visit(line, idx + 1, true, [])
        fence = null
        return
      }
    }
    visit(line, idx + 1, fence !== null, fence ? [] : codeSpans(line))
  })
}

/** Scans a workflow file for tokens and checks the block structure. */
export function scanTokens(file: string, text: string): ScanResult {
  const tokens: ScannedToken[] = []
  const findings: Finding[] = []
  const add = (line: number, message: string) => findings.push({ rule: 'unknown-token', file, line, message })

  // Assigned inside the walk callback, so declared through `as` to keep the full type after it.
  let harness = null as { harnesses: readonly Harness[]; line: number } | null
  let block = null as { kind: 'delegate' | 'ask'; line: number; harnesses: readonly Harness[] | null } | null

  walkMarkdown(text, (line, lineNo, inFence, spans) => {
    const stray = line.replace(TOKEN, '')
    if (stray.includes('{{') || stray.includes('}}')) add(lineNo, 'unbalanced token braces')

    for (const m of line.matchAll(TOKEN)) {
      const raw = m[0]
      const start = m.index!
      const end = start + raw.length
      const parsed = parseToken(m[1]!)
      if (typeof parsed === 'string') {
        add(lineNo, parsed)
        continue
      }
      const span = spans.find((s) => start >= s.start && end <= s.end)
      const inCode = inFence || span !== undefined
      const aloneInCodeSpan = span !== undefined && span.start === start && span.end === end

      const lineLevel = parsed.kind === 'harness-open' || parsed.kind === 'harness-close' || parsed.kind === 'include'
      if (lineLevel && line !== raw) add(lineNo, `${raw} must stand alone on its line`)

      switch (parsed.kind) {
        case 'harness-open':
          if (harness) add(lineNo, `harness block opened inside the block opened on line ${harness.line}`)
          else if (block) add(lineNo, `harness block opened inside the ${block.kind} block opened on line ${block.line}`)
          harness = { harnesses: parsed.harnesses, line: lineNo }
          break
        case 'harness-close':
          if (!harness) add(lineNo, '{{/harness}} without an open harness block')
          else if (block && block.harnesses !== null) add(lineNo, `the ${block.kind} block opened on line ${block.line} is still open`)
          harness = null
          break
        case 'delegate-open':
        case 'ask-open': {
          const kind = parsed.kind === 'delegate-open' ? 'delegate' : 'ask'
          if (block) add(lineNo, `${kind} block opened inside the ${block.kind} block opened on line ${block.line}`)
          block = { kind, line: lineNo, harnesses: harness?.harnesses ?? null }
          break
        }
        case 'delegate-close':
        case 'ask-close': {
          const kind = parsed.kind === 'delegate-close' ? 'delegate' : 'ask'
          if (!block || block.kind !== kind) add(lineNo, `{{/${kind}}} without an open ${kind} block`)
          else if ((harness?.harnesses ?? null) !== block.harnesses) {
            add(lineNo, `the ${kind} block opened on line ${block.line} crosses a harness block boundary`)
          }
          block = null
          break
        }
        case 'include':
          if (block) add(lineNo, `include inside the ${block.kind} block opened on line ${block.line}`)
          break
        default:
          break
      }
      tokens.push({ token: parsed, raw, line: lineNo, inCode, aloneInCodeSpan, harnesses: harness?.harnesses ?? null })
    }
  })

  if (harness) add(harness.line, 'harness block is never closed')
  if (block) add(block.line, `${block.kind} block is never closed`)
  return { tokens, findings }
}

/**
 * For each line (index 0 = line 1), the harness set of the block around it, or null. Tag lines
 * themselves belong to their block. Assumes a structurally valid text.
 */
export function harnessRegions(text: string): (readonly Harness[] | null)[] {
  let current: readonly Harness[] | null = null
  return text.split('\n').map((line) => {
    const open = line.match(/^\{\{#harness ([a-z,]+)\}\}$/)
    if (open) {
      current = open[1]!.split(',') as Harness[]
      return current
    }
    if (line === '{{/harness}}') {
      const set = current
      current = null
      return set
    }
    return current
  })
}

/** The text as `harness` sees it: blocks for other harnesses removed, tag lines removed. */
export function filterHarness(text: string, harness: Harness): string {
  const regions = harnessRegions(text)
  return text
    .split('\n')
    .filter((line, i) => {
      if (/^\{\{#harness [a-z,]+\}\}$/.test(line) || line === '{{/harness}}') return false
      const set = regions[i]
      return set === null || set === undefined || set.includes(harness)
    })
    .join('\n')
}

/** How one harness spells each token. */
export interface TokenRenderer {
  inline(kind: InlineKind, name: string, inCode: boolean): string
  delegate(agent: string, prompt: string): string
  /** A question in a skill: the gate rules live once, in the core rules' asking rule (see `ask-cues.ts`). */
  ask(id: string, question: string, freeText: boolean, layout: AskLayout): string
  /** The instruction that replaces an `as-file` include: read `fileName` from the directory of skill `skill`. */
  asFile(fileName: string, skill: string): string
}

export interface RenderContext {
  readonly harness: Harness
  readonly renderer: TokenRenderer
  /** Raw workflow text of `shared/…` files. */
  readonly shared: (path: string) => string | undefined
  /** Whether `as-file` includes are allowed here (top level of a skill body). */
  readonly allowAsFile: boolean
  /** The skill being rendered, for `as-file` instructions. */
  readonly skill?: string
  /** Rendering an agent: its questions go back to whoever started it (see `agentAsk`). */
  readonly inAgent?: boolean
  /** How registered choices are asked (`table: true` or `message: true` in the prompt registry); the rest are dialogs. */
  readonly askLayouts?: ReadonlyMap<string, AskLayout>
}

export interface RenderResult {
  readonly text: string
  /** `as-file` includes: file name next to the skill → rendered content. */
  readonly siblings: ReadonlyMap<string, string>
}

/** Replaces include lines, recursively, in harness-filtered text. */
function expandIncludes(text: string, ctx: RenderContext, stack: readonly string[], siblings: Map<string, string>): string {
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(/^\{\{include (\S+)( as-file)?\}\}$/)
      if (!m) return line
      const target = m[1]!
      if (stack.includes(target)) throw new Error(`include cycle: ${[...stack, target].join(' → ')}`)
      const raw = ctx.shared(target)
      if (raw === undefined) throw new Error(`include of a missing file: ${target}`)
      const body = expandIncludes(filterHarness(raw, ctx.harness), ctx, [...stack, target], siblings).replace(/\n+$/, '')
      if (m[2] === undefined) return body
      if (!ctx.allowAsFile || stack.length > 0) throw new Error(`as-file include outside a skill body: ${target}`)
      const name = target.slice(target.lastIndexOf('/') + 1)
      if (siblings.has(name)) throw new Error(`two as-file includes named ${name}`)
      siblings.set(name, body)
      return ctx.renderer.asFile(name, ctx.skill ?? '')
    })
    .join('\n')
}

const DELEGATE = /\{\{#delegate ([a-z0-9-]+)\}\}([\s\S]*?)\{\{\/delegate\}\}/g
const ASK = /\{\{#ask id=([a-z0-9-]+)( text)?\}\}([\s\S]*?)\{\{\/ask\}\}/g

/**
 * A question inside an agent. An agent may be the main conversation (then the operator reads its
 * final message) or started by another conversation (then that one must relay the question and
 * bring the operator's own words back). Either way the agent shows the question and stops.
 */
export function agentAsk(id: string, question: string): string {
  const tag = `\`[prompt: ${id}]\``
  return (
    `${tag} ${question}\n\n` +
    `Show any table, tree or list this question refers to, then this question starting with ${tag}, as your final message, and stop; write nothing this question decides. ` +
    `End that message with: "Put this question to the operator exactly as written. Do not answer it yourself. Re-invoke me with their reply quoted verbatim, tagged \`[answer: ${id}]\`." ` +
    `Only the operator's own words answer it: their reply in this conversation, or an \`[answer: ${id}]\` quoting it when you are invoked again — a paraphrase such as "the user agreed" does not.`
  )
}

/**
 * A block that opens indented (inside a list item) keeps its later lines at the same indent, so a
 * multi-paragraph rendering stays inside the item instead of ending the list.
 */
function indented(rendered: string, source: string, offset: number): string {
  const indent = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset)
  if (!indent || /\S/.test(indent)) return rendered
  return rendered.replace(/\n(?=[^\n])/g, `\n${indent}`)
}

function renderBlocks(text: string, renderer: TokenRenderer, inAgent = false, askLayouts: ReadonlyMap<string, AskLayout> = new Map()): string {
  const delegated = text.replace(DELEGATE, (_, agent: string, prompt: string, offset: number, source: string) =>
    indented(renderer.delegate(agent, prompt.trim()), source, offset),
  )
  return delegated.replace(ASK, (_, id: string, free: string | undefined, question: string, offset: number, source: string) => {
    if (inAgent) return indented(agentAsk(id, question.trim()), source, offset)
    return indented(renderer.ask(id, question.trim(), free !== undefined, askLayouts.get(id) ?? 'dialog'), source, offset)
  })
}

function renderInline(text: string, renderer: TokenRenderer): string {
  const out: string[] = []
  walkMarkdown(text, (line, _lineNo, inFence, spans) => {
    out.push(
      line.replace(TOKEN, (raw, body: string, offset: number) => {
        const parsed = parseToken(body)
        if (typeof parsed === 'string' || parsed.kind !== 'inline') return raw
        const inCode = inFence || spans.some((s) => offset >= s.start && offset + raw.length <= s.end)
        if (parsed.args === undefined) return renderer.inline(parsed.inline, parsed.name, inCode)
        // A command with its arguments is one code span: `/x push`, never `/x` push.
        const command = `${renderer.inline(parsed.inline, parsed.name, true)} ${parsed.args}`
        return inCode ? command : `\`${command}\``
      }),
    )
  })
  return out.join('\n')
}

/**
 * Renders one workflow text for one harness. The text must already have passed `scanTokens`;
 * a structural problem that slips through throws.
 */
export function renderText(text: string, ctx: RenderContext): RenderResult {
  const siblings = new Map<string, string>()
  const expanded = expandIncludes(filterHarness(text, ctx.harness), ctx, [], siblings)
  const rendered = renderInline(renderBlocks(expanded, ctx.renderer, ctx.inAgent, ctx.askLayouts), ctx.renderer)
  const renderedSiblings = new Map<string, string>()
  for (const [name, body] of siblings) {
    // A sibling is a file of its own; the include expansion dropped its final newline.
    renderedSiblings.set(name, `${renderInline(renderBlocks(body, ctx.renderer, false, ctx.askLayouts), ctx.renderer)}\n`)
  }
  return { text: rendered, siblings: renderedSiblings }
}

/** Whether rendered text still holds token syntax. */
export function unrenderedTokenLines(text: string): number[] {
  const lines: number[] = []
  text.split('\n').forEach((line, i) => {
    if (line.includes('{{') || line.includes('}}')) lines.push(i + 1)
  })
  return lines
}
