/**
 * Generator lint. Source rules read the neutral workflow; output rules read what one harness's
 * rendering produced. Every rule reports all its hits; the generator fails when any exist.
 */

import { ASKING_RULE, askCue, type AskLayout, DISMISSAL_RULE } from './ask-cues.js'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { harnessRegions, type ScanResult, walkMarkdown } from './tokens.js'
import type { Finding, Harness, WorkflowSource } from './types.js'

/** The token store, in any spelling a prompt could use. */
export const TOKEN_STORE = /tokens\.json|\.dethernety[\\/]tokens/i

const BUILTINS = 'Read|Write|Edit|MultiEdit|Glob|Grep|Bash|NotebookEdit|WebFetch|WebSearch|TodoWrite|Task|Agent|Skill'
const CLAUDE_LITERALS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`\`(${BUILTINS}|AskUserQuestion)\``), 'backticked Claude tool name'],
  [new RegExp(`\\b(${BUILTINS})\\(`), 'Claude tool call form'],
  [/mcp__/, 'literal MCP tool name'],
  [/AskUserQuestion/, 'Claude question tool'],
  [/subagent_type/, 'Claude Agent tool parameter'],
  [/\$\{CLAUDE_/, 'Claude plugin variable'],
  [/\/dethereal:/, 'Claude slash command'],
  [/\$ARGUMENTS/, 'Claude argument variable'],
  [/(^|\s)@\.{1,2}\//, '@-import (never expanded in plugin files)'],
]

const VERSION_LITERAL = /@dether\.net\/dethereal@|\bdethereal@\d|\bv\d+\.\d+\.\d+\b/
const WRITE_VERB =
  /\b(write|writes|writing|written|update|updates|updating|edit|edits|editing|set|sets|modify|modifies|save|saves|record|records|recording|append|appends|create|creates|overwrite|overwrites|patch|patches)\b/i
const NEGATION = /\b(never|not|don't|must not|no)\b/i
const OPTION_LIST = /\?\s*\(\s*[\w'-]+(?:\s[\w'-]+){0,3}\s*\/\s*[\w'-]+/
const PROTOCOL_REF = /\bper the ((?:[A-Z][\w-]*\s)+)Protocol\b/g

const isMarkdown = (file: string) => file.endsWith('.md')

function finding(rule: string, file: string, line: number, message: string): Finding {
  return { rule, file, line, message }
}

/** Claude literals outside a block whose harness set is exactly claude. */
export function claudeLiterals(file: string, text: string): Finding[] {
  const regions = harnessRegions(text)
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    const set = regions[i]
    if (set && set.length === 1 && set[0] === 'claude') return
    for (const [re, what] of CLAUDE_LITERALS) {
      if (re.test(line)) {
        out.push(finding('claude-literal', file, i + 1, `${what} outside a {{#harness claude}} block: ${line.trim()}`))
        break
      }
    }
  })
  return out
}

/**
 * A tool named in backticks instead of `{{tool:x}}`: each harness spells tool names differently,
 * so a bare name is the wrong name everywhere but one. A Claude-only block may name them.
 */
export function bareToolNames(file: string, text: string, toolNames: ReadonlySet<string>): Finding[] {
  const regions = harnessRegions(text)
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    const set = regions[i]
    if (set && set.length === 1 && set[0] === 'claude') return
    for (const m of line.matchAll(/`([a-z_]+)(\([^`]*\))?`/g)) {
      if (toolNames.has(m[1]!)) {
        out.push(finding('bare-tool-name', file, i + 1, `tool ${m[1]} named in backticks; write {{tool:${m[1]}}}`))
        break
      }
    }
  })
  return out
}

/** Files that may say how the enrichment agent and the main conversation change the pending file. */
const PENDING_FILE_OWNERS = new Set(['shared/enrichment-protocol.md', 'shared/enrichment-invariants.md'])
const PENDING_OBJECT = String.raw`(?:\.dethereal\/)?(?:enrichment-pending\.json|(?:the\s+)?pending(?:[- ]enrichment)?\s+(?:file|entr(?:y|ies)|rows?|values?))`
const PENDING_VERB = String.raw`write|writes|writing|append\w*|delet\w*|remov\w*|clear\w*|empties|emptied|empty(?=\s+the\b)|truncat\w*|overwrit\w*|edit\w*|reset\w*|rewrit\w*|drop\w*|purg\w*|eras\w*|wip(?:e|es|ed|ing)|discard\w*|unlink\w*|replac\w*|updat\w*|modif\w*|mark\w*|set|chang\w*`
const PENDING_PARTICIPLE = String.raw`written|appended|deleted|removed|cleared|emptied|truncated|overwritten|edited|reset|rewritten|dropped|purged|erased|wiped|discarded|unlinked|replaced|updated|modified|marked|set|changed`
const PENDING_WRITES = [
  // verb first: "clear the pending file", "append a row to .dethereal/enrichment-pending.json"
  new RegExp(String.raw`\b(?:${PENDING_VERB})\b(?:\s+\S+){0,4}?\s+\W*${PENDING_OBJECT}`, 'i'),
  // object first or passive: "the pending file is cleared", "pending entries get removed"
  new RegExp(String.raw`${PENDING_OBJECT}\W*(?:\s+\S+){0,3}?\s+(?:(?:is|are|gets?|was|were|be|been)\s+)?(?:${PENDING_PARTICIPLE})\b`, 'i'),
  // shell forms: rm, mv, tee, sed -i, truncate, a redirect into the file
  /\b(?:rm|mv|cp|tee|truncate|sed\s+-i|perl\s+-[a-z]*i|git\s+(?:checkout|restore|stash)|unlinkSync|writeFileSync|rmSync)\b[^\n]*enrichment-pending\.json|>{1,2}\s*\S*enrichment-pending\.json/i,
]
/** A negation that governs the match: within three words before it, in the same clause. */
const NEGATED = /\b(never|not|no)\b/i
const negated = (sentence: string, m: RegExpExecArray): boolean => {
  const clause = sentence.slice(0, m.index).split(/[,;:—]/).pop() ?? ''
  return NEGATED.test(clause.split(/\s+/).filter(Boolean).slice(-3).join(' '))
}

/**
 * The pending-enrichment file is written only by the enrichment agent and settled only by the
 * operator's replies, both described in the enrichment protocol. Prose anywhere else that writes,
 * clears or deletes it would unblock a review or push without the operator.
 */
export function pendingFileWrites(file: string, text: string): Finding[] {
  if (PENDING_FILE_OWNERS.has(file)) return []
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    for (const sentence of line.split(/(?<=[.;!?])\s+/)) {
      const m = PENDING_WRITES.map((re) => re.exec(sentence)).find((x) => x !== null)
      if (m && !negated(sentence, m)) {
        out.push(finding('pending-file-write', file, i + 1, `changes the pending-enrichment file outside the enrichment protocol: ${sentence.trim()}`))
        return
      }
    }
  })
  return out
}

const TO_REVIEWED = /\bto['"`]?\s*:\s*['"`]?REVIEWED\b/
const REVIEW_RECORD_ASK = /\{\{#ask id=review-record[\s}]/

/**
 * REVIEWED is recorded only on the operator's answer to the review-record question: prose that
 * transitions a model to REVIEWED must ask that question in the same file.
 */
export function reviewRecords(file: string, text: string): Finding[] {
  if (REVIEW_RECORD_ASK.test(text)) return []
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    if (TO_REVIEWED.test(line)) out.push(finding('review-record', file, i + 1, 'a transition to REVIEWED without the review-record question in the same file'))
  })
  return out
}

/** Claude spellings that must never reach another harness's output. */
const CLAUDE_OUTPUT_LITERALS = /mcp__plugin_|\bAgent\(|AskUserQuestion|\$\{CLAUDE_|\/dethereal:/
/**
 * Claude spellings some harnesses share: OpenCode's task tool also takes `subagent_type`, and
 * its command templates also use `$ARGUMENTS`.
 */
const SHARED_SPELLINGS = { subagentType: /subagent_type/, arguments: /\$ARGUMENTS/ }

/** Output rule for every harness but Claude: no Claude spelling survived the rendering. */
export function claudeLiteralsInOutput(file: string, text: string, harness: Harness): Finding[] {
  const out = perLine('claude-literal-output', CLAUDE_OUTPUT_LITERALS, 'Claude-specific text in another harness\'s output', file, text)
  const own = harness === 'opencode' ? [] : [SHARED_SPELLINGS.subagentType]
  if (!(harness === 'opencode' && /(^|\/)commands\/[^/]+\.md$/.test(file))) own.push(SHARED_SPELLINGS.arguments)
  for (const re of own) out.push(...perLine('claude-literal-output', re, 'Claude-specific text in another harness\'s output', file, text))
  return out
}

/**
 * OpenCode serves every skill as a command template, where `$1`…, `$ARGUMENTS` are substituted
 * and `` !`cmd` `` runs a shell command unasked: none may appear in a skill, and a command may
 * use only `$ARGUMENTS`.
 */
export function openCodeTemplateSafety(file: string, text: string): Finding[] {
  const out = perLine('template-safety', /!`/, 'text that OpenCode runs as a shell command in a template', file, text)
  out.push(...perLine('template-safety', /\$\d/, 'a positional template variable', file, text))
  if (!/(^|\/)commands\/[^/]+\.md$/.test(file)) out.push(...perLine('template-safety', /\$ARGUMENTS/, 'a template variable outside a command', file, text))
  return out
}

function perLine(rule: string, re: RegExp, message: string, file: string, text: string): Finding[] {
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    if (re.test(line)) out.push(finding(rule, file, i + 1, message))
  })
  return out
}

export function tokenStore(file: string, text: string): Finding[] {
  return perLine('token-store', TOKEN_STORE, 'names the session token store', file, text)
}

export function versionLiterals(file: string, text: string): Finding[] {
  return perLine('version-literal', VERSION_LITERAL, 'literal package version; the workflow must be version-free', file, text)
}

/** A sentence that names state.json with a write verb and no negation. */
export function stateJsonWrites(file: string, text: string): Finding[] {
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    for (const sentence of line.split(/(?<=[.;!?])\s+/)) {
      if (/state\.json/.test(sentence) && WRITE_VERB.test(sentence) && !NEGATION.test(sentence)) {
        out.push(finding('state-json-write', file, i + 1, 'workflow state changes go through the state tool, not writes to state.json'))
        break
      }
    }
  })
  return out
}

/** Lines inside {{#ask}} … {{/ask}} blocks. */
function askLines(scan: ScanResult): Set<number> {
  const lines = new Set<number>()
  let open: number | null = null
  for (const t of scan.tokens) {
    if (t.token.kind === 'ask-open') open = t.line
    if (t.token.kind === 'ask-close' && open !== null) {
      for (let l = open; l <= t.line; l++) lines.add(l)
      open = null
    }
  }
  return lines
}

/** A choice question's options, as its closing "(a / b / …)" lists them: at most four (the question tools' limit). */
export function optionCounts(file: string, text: string): Finding[] {
  const out: Finding[] = []
  for (const m of text.matchAll(/\{\{#ask id=([a-z0-9-]+)\}\}([\s\S]*?)\{\{\/ask\}\}/g)) {
    const lists = [...m[2]!.matchAll(/\(([^()]*\/[^()]*)\)/g)]
    const last = lists[lists.length - 1]
    const count = last ? last[1]!.split(' / ').length : 0
    if (count > 4) out.push(finding('option-count', file, lineAt(text, m.index!), `question ${m[1]} offers ${count} options; a choice question takes at most 4`))
  }
  return out
}

export function optionLists(file: string, text: string, scan: ScanResult): Finding[] {
  const inAsk = askLines(scan)
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    if (!inAsk.has(i + 1) && OPTION_LIST.test(line)) {
      out.push(finding('option-list', file, i + 1, `choice question outside an {{#ask}} block: ${line.trim()}`))
    }
  })
  return out
}

export function backtickedTokens(file: string, scan: ScanResult): Finding[] {
  return scan.tokens
    .filter((t) => t.aloneInCodeSpan && t.token.kind === 'inline')
    .map((t) => finding('backticked-token', file, t.line, `${t.raw} is wrapped in backticks; the renderer formats it`))
}

/** Ask ids label the question in every harness; OpenCode caps a question header at 30 characters. */
export const ASK_ID_MAX = 30

export function askIds(file: string, scan: ScanResult): Finding[] {
  const seen = new Map<string, number>()
  const out: Finding[] = []
  for (const t of scan.tokens) {
    if (t.token.kind !== 'ask-open') continue
    if (t.token.id.length > ASK_ID_MAX) out.push(finding('ask-id', file, t.line, `ask id ${t.token.id} is longer than ${ASK_ID_MAX} characters`))
    const first = seen.get(t.token.id)
    if (first !== undefined) out.push(finding('ask-id', file, t.line, `ask id ${t.token.id} already used on line ${first}`))
    else seen.set(t.token.id, t.line)
  }
  return out
}

export interface Targets {
  readonly tools: ReadonlySet<string>
  readonly skills: ReadonlySet<string>
  readonly agents: ReadonlySet<string>
  readonly shared: ReadonlySet<string>
}

export function unknownTargets(file: string, scan: ScanResult, targets: Targets): Finding[] {
  const out: Finding[] = []
  for (const t of scan.tokens) {
    const tok = t.token
    let problem: string | null = null
    if (tok.kind === 'inline' && tok.inline === 'tool' && !targets.tools.has(tok.name)) problem = `tool ${tok.name} is not in the tool manifest`
    if (tok.kind === 'inline' && (tok.inline === 'cmd' || tok.inline === 'skill') && !targets.skills.has(tok.name)) problem = `no skill named ${tok.name}`
    if (tok.kind === 'inline' && tok.inline === 'agent' && !targets.agents.has(tok.name)) problem = `no agent named ${tok.name}`
    if (tok.kind === 'delegate-open' && !targets.agents.has(tok.agent)) problem = `no agent named ${tok.agent}`
    if (tok.kind === 'include' && !targets.shared.has(tok.path)) problem = `no shared file ${tok.path}`
    if (problem) out.push(finding('unknown-target', file, t.line, problem))
  }
  return out
}

/**
 * Where a file's text ends up: a skill body, a forked skill, an agent prompt, a leaf agent's
 * prompt (one that skills delegate to or fork onto), an as-file sibling of a skill, an as-file
 * sibling of a forked skill.
 */
export type Context = 'skill' | 'fork' | 'agent' | 'leaf' | 'as-file' | 'fork-file'

/**
 * `{{#ask}}` needs a way to the operator: a skill asks directly (a sibling it reads too) and an
 * agent hands the question back, but a leaf (started to do one job and return), a forked skill
 * and its siblings have none. `{{args}}` is substituted only in a skill's own body: not in agents
 * or siblings.
 */
export function tokenContexts(file: string, scan: ScanResult, contexts: ReadonlySet<Context>): Finding[] {
  const out: Finding[] = []
  const where = [...contexts].sort().join(', ')
  for (const t of scan.tokens) {
    if (t.token.kind === 'ask-open' && (contexts.has('leaf') || contexts.has('fork') || contexts.has('fork-file'))) {
      out.push(finding('token-context', file, t.line, `a question cannot be asked from here (reaches: ${where})`))
    }
    if (t.token.kind === 'delegate-open' && contexts.has('fork')) {
      out.push(finding('token-context', file, t.line, `a forked skill runs as a leaf and cannot delegate (reaches: ${where})`))
    }
    if (t.token.kind === 'inline' && t.token.inline === 'args' && (contexts.has('agent') || contexts.has('leaf') || contexts.has('as-file') || contexts.has('fork-file'))) {
      out.push(finding('token-context', file, t.line, `{{args}} is only substituted in a skill body (reaches: ${where})`))
    }
  }
  return out
}

interface Paragraph {
  readonly key: string
  readonly line: number
}

function paragraphs(text: string): Paragraph[] {
  const out: Paragraph[] = []
  let words: string[] = []
  let start = 0
  const flush = () => {
    if (words.length >= 40) out.push({ key: words.join(' ').toLowerCase(), line: start })
    words = []
  }
  walkMarkdown(text, (line, lineNo, inFence) => {
    const tagOnly = /^\{\{[#/]?(harness|include)\b[^}]*\}\}$/.test(line)
    if (inFence || tagOnly || !line.trim()) {
      flush()
      return
    }
    if (words.length === 0) start = lineNo
    words.push(...line.trim().split(/\s+/))
  })
  flush()
  return out
}

/** A paragraph of 40 or more words in two workflow files: shared text belongs in an include. */
export function duplicateParagraphs(source: WorkflowSource): Finding[] {
  const byKey = new Map<string, Array<{ file: string; line: number }>>()
  for (const [file, text] of source) {
    if (!isMarkdown(file)) continue
    for (const p of paragraphs(text)) {
      const list = byKey.get(p.key) ?? []
      if (!list.some((e) => e.file === file)) list.push({ file, line: p.line })
      byKey.set(p.key, list)
    }
  }
  const out: Finding[] = []
  for (const list of byKey.values()) {
    if (list.length < 2) continue
    for (const e of list) {
      const others = list.filter((o) => o !== e).map((o) => `${o.file}:${o.line}`)
      out.push(finding('duplicate-paragraph', e.file, e.line, `same paragraph as ${others.join(', ')}; move it to a shared include`))
    }
  }
  return out
}

/** Rendered-output rule: "per the X Protocol" needs a heading defining X Protocol in the same skill or agent. */
export function protocolIncludes(file: string, texts: readonly string[]): Finding[] {
  const all = texts.join('\n')
  const out: Finding[] = []
  const seen = new Set<string>()
  for (const m of all.matchAll(PROTOCOL_REF)) {
    const name = m[1]!.trim()
    if (seen.has(name)) continue
    seen.add(name)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`^#{1,6}\\s.*\\b${escaped} Protocol\\b`, 'm').test(all)) {
      out.push(finding('protocol-include', file, 0, `refers to the ${name} Protocol but does not include it`))
    }
  }
  return out
}

/**
 * A skill must carry what it needs within the part a harness keeps after a compaction.
 *
 * After a compaction Claude Code re-attaches the most recent invocation of each skill, newest
 * first. In Claude Code 2.1.283 each skill is sliced at 5000 × 4 = 20,000 characters (`cko=5000`,
 * the slice at ×4) within a combined 25,000 estimated tokens (`TPe=25000`). These are that
 * version's constants, not a documented contract. A skill's injected text stays within 19,000
 * characters, a margin under the slice. When the pinned Claude Code version changes, re-verify
 * the constants; until they are verified for the new version, lower this budget to 13,500.
 */
export const SKILL_BUDGET = 19_000
/** The per-skill slice Claude Code 2.1.283 keeps after a compaction, in characters. */
export const REATTACH_SLICE_CHARS = 20_000
/** What the harness adds when it injects a skill: a base-directory line, expanded paths, the arguments. */
const INJECTED = { baseDirectory: 120, skillDir: { token: '${CLAUDE_SKILL_DIR}', length: 90 }, args: { token: '$ARGUMENTS', length: 200 } } as const

/** A skill's size as the harness injects it: the body without its frontmatter, with expansions. */
export function injectedLength(text: string): number {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
  const count = (token: string) => body.split(token).length - 1
  return (
    body.length +
    INJECTED.baseDirectory +
    count(INJECTED.skillDir.token) * (INJECTED.skillDir.length - INJECTED.skillDir.token.length) +
    count(INJECTED.args.token) * (INJECTED.args.length - INJECTED.args.token.length)
  )
}

export function sizeBudget(file: string, text: string): Finding[] {
  const size = injectedLength(text)
  return size > SKILL_BUDGET
    ? [finding('size-budget', file, 0, `${size} characters as injected; the budget is ${SKILL_BUDGET} (move reference material to an as-file include)`)]
    : []
}

/**
 * A skill's questions: every one carries its tag and the cue that names how to ask it, and the
 * skill carries the asking rule those cues point to (in the core rules). A sibling file's
 * questions rely on the rule in its skill's body, `ruleText`.
 */
export function askCues(file: string, text: string, harness: Harness, ruleText = text, askLayouts: ReadonlyMap<string, AskLayout> = new Map()): Finding[] {
  const out: Finding[] = []
  const tags = [...text.matchAll(/`\[prompt: ([a-z0-9-]+)\]` /g)]
  if (tags.length === 0) return out
  if (!ruleText.includes(ASKING_RULE)) out.push(finding('ask-line', file, 0, `questions without the asking rule ("${ASKING_RULE}")`))
  if (!ruleText.includes(DISMISSAL_RULE)) out.push(finding('ask-line', file, 0, `questions without the dismissal rule ("${DISMISSAL_RULE}")`))
  for (const m of tags) {
    const id = m[1]!
    // A question may run over several paragraphs; its cue closes the last one, before the next
    // question or heading.
    const next = text.indexOf('`[prompt: ', m.index! + 1)
    let question = text.slice(m.index, next < 0 ? undefined : next)
    const heading = question.search(/\n#{1,6} /)
    if (heading >= 0) question = question.slice(0, heading)
    const layout = askLayouts.get(id)
    const cues = layout ? [askCue(harness, id, false, layout)] : [askCue(harness, id, false), askCue(harness, id, true)]
    if (!cues.some((c) => question.includes(c))) {
      out.push(finding('ask-line', file, lineAt(text, m.index!), `question ${id} does not carry its cue`))
    }
  }
  return out
}

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length

/**
 * The package-level part of the token-store ban: tool sources are model-visible through their
 * descriptions. Tests are excluded; they name the store to prove it never leaks.
 */
export function lintPackage(pkgRoot: string): Finding[] {
  const toolsDir = path.join(pkgRoot, 'src', 'tools')
  const out: Finding[] = []
  let scanned = 0
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry)
      if (statSync(abs).isDirectory()) {
        if (entry !== '__tests__') walk(abs)
        continue
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
      scanned++
      out.push(...tokenStore(path.relative(pkgRoot, abs).split(path.sep).join('/'), readFileSync(abs, 'utf8')))
    }
  }
  walk(toolsDir)
  if (scanned === 0) out.push(finding('token-store', 'src/tools', 0, 'no tool sources found to scan'))
  return out
}

/**
 * The skill hops the workflow makes on purpose: from a skill (or an agent, `agent:<name>`) to the
 * skills it may start itself. Every other skill is started by the operator; a `[next]` line only
 * suggests one.
 */
export const NAMED_HANDOVERS: Readonly<Record<string, readonly string[]>> = {
  'threat-model': ['threat-model', 'enrich-controls', 'sync-controls', 'sync-pull', 'remove'],
  enrich: ['enrich-controls'],
  create: ['discover', 'sync'],
  sync: ['sync-pull', 'sync-controls'],
}

const INCLUDE = /\{\{include (shared\/[^\s}]+)/g
const START_LINE = /`Skill` tool|`skill` tool|\{\{skill:|\b(?:load|open|invoke|start) the\b|\bhands?\b[^\n]{0,160}?\bover to\b/i
const STARTED = /\{\{cmd:([a-z-]+)\}\} skill|dethereal[:-]([a-z][a-z-]*)|\{\{skill:([a-z-]+)\}\}|\bover to (?:the )?\{\{cmd:([a-z-]+)(?: [^}]*)?\}\}/g
/** The command form in a handover: only `{{skill:x}}` says, per harness, how to start a skill. */
const COMMAND_HANDOVER = /\{\{cmd:[a-z-]+\}\} skill\b/

/**
 * A skill or agent starts another Dethereal skill only as a named handover: an instruction to load,
 * open or invoke one, in its own text or any fragment it includes, must name a skill in its entry
 * of `NAMED_HANDOVERS`, and name it with `{{skill:x}}`, never the command form.
 */
export function skillHandovers(source: ReadonlyMap<string, string>, handovers: Readonly<Record<string, readonly string[]>> = NAMED_HANDOVERS): Finding[] {
  const out: Finding[] = []
  const reach = (file: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(file)) return seen
    seen.add(file)
    for (const m of (source.get(file) ?? '').matchAll(INCLUDE)) reach(m[1]!, seen)
    return seen
  }
  const origins: [string, string][] = []
  for (const file of source.keys()) {
    const skill = file.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1]
    const agent = file.match(/^agents\/([^/]+)\.md$/)?.[1]
    if (skill) origins.push([skill, file])
    else if (agent) origins.push([`agent:${agent}`, file])
  }
  const reported = new Set<string>()
  for (const [from, file] of origins) {
    const allowed = new Set(handovers[from] ?? [])
    for (const f of reach(file)) {
      const lines = (source.get(f) ?? '').split('\n')
      lines.forEach((line, i) => {
        if (!START_LINE.test(line)) return
        const formKey = `form|${f}|${i}`
        if (COMMAND_HANDOVER.test(line) && !reported.has(formKey)) {
          reported.add(formKey)
          out.push(finding('skill-handover', f, i + 1, 'names the skill it starts in the command form; use {{skill:x}}, which each harness renders as its own way to start a skill'))
        }
        for (const m of line.matchAll(STARTED)) {
          const to = m[1] ?? m[2] ?? m[3] ?? m[4]!
          if (allowed.has(to)) continue
          const key = `${from}|${f}|${i}|${to}`
          if (reported.has(key)) continue
          reported.add(key)
          out.push(finding('skill-handover', f, i + 1, `${from} starts ${to}, which is not one of its named handovers; the operator starts every other skill`))
        }
      })
    }
  }
  return out
}

const MODEL_FILE = /structure\.json|dataflows\.json|data-items\.json|attributes\/|\.dethereal\//
/** Shell syntax that writes a file: a heredoc, a redirection into a model file, tee, sed -i, an inline script. */
const SHELL_WRITE = [
  /<<-?\s*['"]?[A-Z_]{2,}['"]?/,
  /(?:^|[^<>=\w-])>>?\s*`?[\w./<>{}-]*(?:structure|dataflows|data-items)\.json/,
  /\btee\s+(?:-a\s+)?\S*(?:\.json|attributes\/|\.dethereal\/)/,
  /\bsed\s+-i\b/,
  /\bpython3?\s+(?:-c\b|-\s)/,
  /\bjq\b[^\n]*>\s*\S*\.json/,
]
/** An instruction to run git: the server runs git for the workflow. */
const RUN_GIT = /\brun\s+`git\b|`git\s+-C\b|`git\s+rev-parse\b/i

/**
 * Lines that may keep a shell step until the tool that replaces it lands, as `file` → a text the
 * line contains.
 */
export const SHELL_STEP_ALLOWLIST: ReadonlyMap<string, string> = new Map()

/**
 * Model files are written through the harness's edit tool, never a shell, and git runs in the
 * server: prose that tells the model to write a model file through the shell, or to run git, is
 * refused.
 */
export function shellWrites(file: string, text: string, allowlist: ReadonlyMap<string, string> = SHELL_STEP_ALLOWLIST): Finding[] {
  const out: Finding[] = []
  const allowed = allowlist.get(file)
  text.split('\n').forEach((line, i) => {
    if (allowed && line.includes(allowed)) return
    if (RUN_GIT.test(line)) out.push(finding('shell-write', file, i + 1, 'tells the model to run git; the server runs git for the workflow'))
    else if (SHELL_WRITE.some((re) => re.test(line)) && (MODEL_FILE.test(line) || /<<-?\s*['"]?[A-Z_]{2,}/.test(line))) {
      out.push(finding('shell-write', file, i + 1, 'writes a model file through the shell; use the harness\'s edit tool'))
    }
  })
  return out
}

/**
 * What the class tool refuses, from the text of one instruction: attributes and guide — asked for,
 * or by leaving out `fields` — need a `class_id`, a `name` or a `category`; and a listing is never
 * unfiltered (a class type, one of those, or the modules view). Undefined when the call is sound.
 */
export function classListingProblem(line: string): string | undefined {
  if (/view:\s*['"]modules['"]/.test(line)) return undefined
  const specific = /class_id|\bname:|`name`|category/.test(line)
  if (specific) return undefined
  if (!/class_type/.test(line)) return 'lists classes without a class_type, a class_id or the modules view'
  const fields = /fields[^\]]*\]/.exec(line)?.[0]
  if (!fields) return 'lists classes without fields: that asks for attributes and guide, which need a class_id'
  if (/attributes|guide/.test(fields)) return 'asks a listing for attributes or guide, which need a class_id'
  return undefined
}

/** Every instruction to call the class tool must pass the tool's own refusal rule (classListingProblem). */
export function unfilteredClassListings(file: string, text: string): Finding[] {
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    if (!line.includes('{{tool:get_classes}}')) return
    const problem = classListingProblem(line)
    if (problem) out.push(finding('get-classes-filter', file, i + 1, problem))
  })
  return out
}

/** The server records HEAD for the drift baseline: prose never has the model pass `commit` to `set_baseline`. */
export function baselineCommits(file: string, text: string): Finding[] {
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    if (line.includes('set_baseline') && [...line.matchAll(/`commit`/g)].some((m) => !/\b(?:no|never|without)(?: pass)? $/.test(line.slice(0, m.index)))) {
      out.push(finding('baseline-commit', file, i + 1, 'names `commit` for set_baseline; the server records HEAD, so say "no `commit`"'))
    }
  })
  return out
}

/** `{{skill:x}}` renders as a bare name inside code, which drops how the harness starts the skill. */
export function skillTokensInCode(file: string, text: string): Finding[] {
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    // Odd segments between single backticks are code spans.
    if (line.split('`').some((part, k) => k % 2 === 1 && part.includes('{{skill:'))) out.push(finding('skill-in-code', file, i + 1, '{{skill:x}} inside a code span loses how the harness starts the skill; put it in prose'))
  })
  return out
}
