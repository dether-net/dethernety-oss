/**
 * Parse one run's transcripts into the common event stream, replay its model
 * writes, and cross-check them against the harness's own change records.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseClaude } from './claude.js'
import { innerCommand, parseCodex } from './codex.js'
import { parseOpenCode } from './opencode.js'
import { afterLeadingCd, isModelFile, replay, serverWriteScope, type ReplayOptions } from './replay.js'
import { reconcile } from './reconcile.js'
import { SCHEMA_VERSION, type Harness, type ParsedRun, type RawEvent, type TranscriptEvent } from './types.js'

export * from './types.js'
export { isModelFile, modelDirOf, serverWriteScope, shellModelWrites, type TextChange } from './replay.js'

export interface ParseOptions {
  /** The project root the run worked in; defaults to the one the transcript names */
  projectRoot?: string
  /** A directory holding the project as it was at the start of the run */
  start?: string
  /** Diagnostics: see ReplayOptions.observe */
  observe?: ReplayOptions['observe']
  /** See ReplayOptions.onChange */
  onChange?: ReplayOptions['onChange']
  /** A directory holding the project as it was at the end of the run (see ReplayOptions.end) */
  end?: string
  /**
   * Keep only part of the run, chosen once the events are in order and before the replay: `[from, to)` by event
   * seq (`to` omitted for the end). The kept events are numbered from 0 again; `start` and `end` then describe the
   * project at that part's own start and end.
   */
  window?: (events: TranscriptEvent[]) => { from: number; to?: number }
}

const PARSERS = { claude: parseClaude, codex: parseCodex, opencode: parseOpenCode }

/** Model files under `dir`, by project path. */
function readStart(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        const rel = path.relative(dir, p).split(path.sep).join('/')
        if (isModelFile(rel)) out.set(rel, fs.readFileSync(p, 'utf8'))
      }
    }
  }
  walk(dir)
  return out
}

export function parseRun(harness: Harness, input: string, options: ParseOptions = {}): ParsedRun {
  const parsed = PARSERS[harness](input)
  const root = options.projectRoot ?? parsed.cwd
  const rel = (p: string): { path: string; outside: boolean } => {
    const posix = p.split(path.sep).join('/')
    if (!path.posix.isAbsolute(posix)) return { path: path.posix.normalize(posix).replace(/^\.\//, ''), outside: false }
    if (root && (posix === root || posix.startsWith(`${root.replace(/\/$/, '')}/`))) return { path: path.posix.relative(root, posix), outside: false }
    return { path: posix, outside: true }
  }
  const relPath = (p: string) => rel(p).path

  // Stable order by time; ties keep the parser's order.
  const ordered = parsed.events.map((e, i) => ({ e, i })).sort((a, b) => (a.e.ts < b.e.ts ? -1 : a.e.ts > b.e.ts ? 1 : a.i - b.i))
  const calls = new Map<string, RawEvent>()
  const events: TranscriptEvent[] = []
  const push = (e: RawEvent & Partial<TranscriptEvent>) => {
    const out: TranscriptEvent = { ...e, seq: events.length, harness } as TranscriptEvent
    if (e.path !== undefined) {
      const r = rel(e.path)
      out.path = r.path
      if (r.outside) out.outside = true
      out.modelFile = !r.outside && isModelFile(r.path)
    }
    if (e.fileOp?.op === 'move') out.fileOp = { op: 'move', to: relPath(e.fileOp.to) }
    events.push(out)
  }
  for (const { e } of ordered) {
    if (e.kind === 'tool_call' && e.callId) calls.set(e.callId, e)
    if (e.kind === 'shell') {
      const cwd = e.cwd ?? (e.input as { cwd?: unknown } | undefined)?.cwd
      // A command wrapped in a login shell (`/bin/zsh -lc '…'`) begins where the quotes do.
      push({ ...e, cwdRel: afterLeadingCd(innerCommand(String(e.text ?? '')), typeof cwd === 'string' ? relPath(cwd) : '', relPath) })
      continue
    }
    // A subagent's "user" message is the task its parent gave it, not the operator.
    push(e.kind === 'user' && e.actor !== 'main' ? { ...e, kind: 'subagent_prompt' } : e)
    // A server tool that writes into a model directory: the files it may have changed become unknown.
    if (e.kind === 'tool_result' && e.tool && e.callId) {
      const call = calls.get(e.callId)
      const scope = serverWriteScope(e.tool, call?.input, relPath)
      if (scope) push({ ts: e.ts, actor: e.actor, actorId: e.actorId, turn: e.turn, kind: 'server_write', tool: e.tool, callId: e.callId, isError: e.isError, touches: scope })
    }
  }

  if (options.window) {
    const { from, to } = options.window(events)
    const kept = events.slice(from, to).map((e, i) => ({ ...e, seq: i }))
    events.length = 0
    events.push(...kept)
  }

  const result = replay(events, { projectRoot: root, observe: options.observe, onChange: options.onChange, ...(options.end ? { end: readStart(options.end) } : {}), ...(options.start ? { start: readStart(options.start) } : {}) })
  return {
    schemaVersion: SCHEMA_VERSION,
    harness,
    projectRoot: root,
    events,
    attributions: result.attributions,
    opaque: result.opaque,
    checkpoints: result.checkpoints,
    reconciliation: reconcile(harness, events),
    replayNotes: result.notes,
    ...(Object.keys(parsed.unknownTypes).length ? { unknownTypes: parsed.unknownTypes } : {}),
  }
}
