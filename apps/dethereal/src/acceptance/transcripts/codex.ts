/**
 * Codex transcripts, as exported from its state database: `codex-threads.json`
 * (one row per thread; a spawned agent's thread carries its role and path) and
 * `codex-thread-items.json` (one row per item, the item itself in `item_json`).
 *
 * File changes are `fileChange` items: an added file carries its whole content,
 * an updated one unified-diff hunks. A shell command that prints one whole file
 * (`cat <file>`) is a read the replay can resync from. Codex keeps no record of
 * the worktree independent of these items, so there is no cross-check here.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RawEvent } from './types.js'

type Rec = Record<string, any>

const readJson = (file: string): Rec[] => {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** The command a login shell wrapper runs: `/bin/zsh -lc 'cmd'` → `cmd`. */
export function innerCommand(command: string): string {
  const m = /^\S*\/(?:ba|z|da)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(command.trim())
  if (!m) return command.trim()
  return m[1] === "'" ? m[2]!.replace(/'\\''/g, "'") : m[2]!.replace(/\\(["\\$`])/g, '$1')
}

/** The file a command prints whole, when the command is exactly `cat <one path>`. */
export function wholeFileRead(command: string): string | null {
  const m = /^cat\s+(?:--\s+)?('[^']+'|"[^"]+"|[^\s'"|;&<>$`]+)$/.exec(innerCommand(command))
  return m ? m[1]!.replace(/^['"]|['"]$/g, '') : null
}

export interface CodexParse {
  events: RawEvent[]
  cwd: string | null
  /** Items of a type this parser does not know, by type: a call one of them made would be missing from the events */
  unknownTypes: Record<string, number>
}

/** Item types read above, and the one skipped on purpose (the model's reasoning, which acts on nothing). */
const KNOWN_ITEMS = new Set(['userMessage', 'agentMessage', 'commandExecution', 'fileChange', 'mcpToolCall', 'subAgentActivity', 'collabAgentToolCall', 'contextCompaction', 'reasoning'])

export function parseCodex(dir: string): CodexParse {
  const unknownTypes: Record<string, number> = {}
  const events: RawEvent[] = []
  const threads = new Map(readJson(path.join(dir, 'codex-threads.json')).map((t) => [t.id as string, t]))
  const rows = readJson(path.join(dir, 'codex-thread-items.json'))
    .map((r) => ({ r, d: JSON.parse(r.item_json) as Rec }))
    .sort((a, b) => (a.r.completed_at_ms ?? a.r.created_at_ms) - (b.r.completed_at_ms ?? b.r.created_at_ms) || a.r.rollout_ordinal - b.r.rollout_ordinal)
  let cwd: string | null = null
  for (const { r, d } of rows) {
    const t = threads.get(r.thread_id)
    const actor: string = t?.agent_role ?? t?.agent_path ?? 'main'
    const actorId: string = r.thread_id
    const turn: string | undefined = r.turn_id ?? undefined
    const ts = new Date(r.completed_at_ms ?? r.created_at_ms).toISOString()
    const base = { ts, actor, actorId, turn }
    switch (r.item_type) {
      case 'userMessage':
        events.push({ ...base, kind: 'user', text: (d.content ?? []).map((c: Rec) => c.text ?? '').join('\n') })
        break
      case 'agentMessage':
        events.push({ ...base, kind: 'assistant', text: d.text ?? '', ...(d.phase ? { source: d.phase } : {}) })
        break
      case 'commandExecution': {
        if (!cwd && actor === 'main' && typeof d.cwd === 'string') cwd = d.cwd
        events.push({ ...base, kind: 'shell', tool: 'shell', callId: d.id, text: d.command, input: { command: d.command, cwd: d.cwd }, ...(d.status === 'declined' ? { denied: 'declined' } : {}) })
        const ok = d.status === 'completed' && d.exitCode === 0
        events.push({ ...base, kind: 'tool_result', tool: 'shell', callId: d.id, text: String(d.aggregatedOutput ?? ''), isError: !ok })
        const read = ok ? wholeFileRead(String(d.command ?? '')) : null
        if (read && typeof d.aggregatedOutput === 'string') {
          events.push({ ...base, kind: 'file_read', tool: 'shell', callId: d.id, path: path.resolve(d.cwd ?? '/', read), content: d.aggregatedOutput })
        }
        break
      }
      case 'fileChange':
        for (const c of (d.changes ?? []) as Rec[]) {
          const kind = c.kind?.type
          const fileOp =
            kind === 'add' ? { op: 'write' as const, content: String(c.diff ?? '') } :
            kind === 'delete' ? { op: 'delete' as const } :
            { op: 'patch' as const, hunks: String(c.diff ?? '') }
          events.push({ ...base, kind: 'file_write', tool: 'apply_patch', callId: d.id, path: c.path, fileOp, isError: d.status !== 'completed' })
          if (kind === 'update' && c.kind?.move_path) {
            events.push({ ...base, kind: 'file_write', tool: 'apply_patch', callId: d.id, path: c.path, fileOp: { op: 'move', to: c.kind.move_path }, isError: d.status !== 'completed' })
          }
        }
        break
      case 'mcpToolCall': {
        const tool = d.server === 'dethereal' ? `dethereal.${d.tool}` : `${d.server}.${d.tool}`
        events.push({ ...base, kind: 'tool_call', tool, callId: d.id, input: d.arguments })
        const text = d.error ? JSON.stringify(d.error) : (d.result?.content ?? []).map((c: Rec) => c.text ?? '').join('\n')
        events.push({ ...base, kind: 'tool_result', tool, callId: d.id, text, isError: !!d.error || d.status === 'failed' })
        break
      }
      case 'subAgentActivity':
        {
          // The agent a thread runs is its role; the path is only where it sits in the spawn tree.
          const agent = threads.get(d.agentThreadId)?.agent_role ?? d.agentPath
          if (d.kind === 'started') events.push({ ...base, kind: 'subagent_start', tool: 'spawn', callId: d.agentThreadId, text: agent })
          else if (d.kind === 'completed') events.push({ ...base, kind: 'subagent_end', tool: 'spawn', callId: d.agentThreadId, text: agent })
        }
        break
      case 'collabAgentToolCall':
        events.push({ ...base, kind: 'tool_call', tool: `collab.${d.tool}`, callId: d.id, input: { receiverThreadIds: d.receiverThreadIds } })
        break
      case 'contextCompaction':
        events.push({ ...base, kind: 'compaction' })
        break
      default:
        if (!KNOWN_ITEMS.has(String(d.type))) unknownTypes[String(d.type)] = (unknownTypes[String(d.type)] ?? 0) + 1
        break
    }
  }
  return { events, cwd, unknownTypes }
}
