/**
 * OpenCode transcripts, as exported from its database: sessions (a child
 * session is a subagent), messages and parts. Tool parts carry their input,
 * output and metadata: `write` its whole content, `edit` its strings and the
 * resulting unified diff, `read` a line-numbered copy of the file.
 *
 * Each step of a message is bracketed by `step-start` and `step-finish` parts
 * holding worktree snapshot hashes, and a `patch` part lists the files the step
 * changed, by any means (file tools, shell, the MCP server). Those become
 * metadata-only `harness_change` events whose window is the step.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RawEvent } from './types.js'

type Rec = Record<string, any>

/**
 * A question the operator dismissed without answering: OpenCode ends the `question` tool call as an
 * error with this text and records no answer. Any other error is a failed dialog.
 */
const DISMISSED = 'The user dismissed this question'

const readJson = (file: string): Rec[] => {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/**
 * The file text of a complete `read` output, or null: a read with an offset, a directory listing, a
 * result the tool marked truncated, or line numbers that do not run 1..N with the stated total.
 */
export function readOutputText(output: string, input: Rec, metadata: Rec | undefined): string | null {
  if (input.offset !== undefined && input.offset !== 0 && input.offset !== 1) return null
  if (metadata?.truncated) return null
  const m = /<type>file<\/type>\n<content>\n([\s\S]*)\n\n\(End of file - total (\d+) lines\)\n<\/content>\s*$/.exec(output)
  if (!m) return null
  const lines = m[1] === '' ? [] : m[1]!.split('\n')
  if (lines.length !== Number(m[2])) return null
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const n = /^(\d+): ?(.*)$/.exec(lines[i]!)
    if (!n || Number(n[1]) !== i + 1) return null
    out.push(n[2]!)
  }
  return out.join('\n')
}

export interface OpenCodeParse {
  events: RawEvent[]
  cwd: string | null
  /** Parts of a type this parser does not know, by type: a call one of them made would be missing from the events */
  unknownTypes: Record<string, number>
}

/** Part types read above, and those skipped on purpose (a step's end snapshot, the model's reasoning). */
const KNOWN_PARTS = new Set(['step-start', 'text', 'compaction', 'patch', 'tool', 'step-finish', 'reasoning'])

export function parseOpenCode(dir: string): OpenCodeParse {
  const unknownTypes: Record<string, number> = {}
  const events: RawEvent[] = []
  const sessions = readJson(path.join(dir, 'opencode-sessions.json'))
  const messages = readJson(path.join(dir, 'opencode-messages.json')).map((m): Rec => ({ ...m, d: JSON.parse(m.data) as Rec }))
  const parts = readJson(path.join(dir, 'opencode-parts.json'))
    .map((p): Rec => ({ ...p, d: JSON.parse(p.data) as Rec }))
    .sort((a, b) => a.time_created - b.time_created || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
  const main = sessions.find((s) => !s.parent_id)
  const cwd: string | null = main?.directory ?? null
  const roleOf = new Map(messages.map((m) => [m.id as string, m.d.role as string]))
  // A compaction writes its summary as an assistant message: harness text, not the model speaking to the operator.
  const summaries = new Set(messages.filter((m) => m.d.role === 'assistant' && (m.d.summary === true || m.d.mode === 'compaction')).map((m) => m.id as string))
  const actorOf = new Map<string, string>()
  for (const s of sessions) {
    if (!s.parent_id) actorOf.set(s.id, 'main')
    else actorOf.set(s.id, messages.find((m) => m.session_id === s.id && m.d.agent)?.d.agent ?? `session:${s.id}`)
  }
  // The start of the step each part belongs to, per message.
  const stepStart = new Map<string, string>()
  for (const p of parts) {
    const ts = new Date(p.time_created).toISOString()
    const actor = actorOf.get(p.session_id) ?? `session:${p.session_id}`
    const base = { ts, actor, actorId: p.session_id as string, turn: p.message_id as string }
    const d = p.d
    switch (d.type) {
      case 'step-start':
        stepStart.set(p.message_id, ts)
        break
      case 'text':
        if (d.synthetic || summaries.has(p.message_id)) break
        events.push({ ...base, kind: roleOf.get(p.message_id) === 'user' ? 'user' : 'assistant', text: d.text ?? '' })
        break
      case 'compaction':
        events.push({ ...base, kind: 'compaction', trigger: d.auto ? 'auto' : 'manual' })
        break
      case 'patch':
        for (const f of (d.files ?? []) as string[]) {
          events.push({ ...base, kind: 'harness_change', path: f, source: `patch:${stepStart.get(p.message_id) ?? ts}` })
        }
        break
      case 'tool': {
        const st: Rec = d.state ?? {}
        const input: Rec = st.input ?? {}
        const end = st.time?.end ? new Date(st.time.end).toISOString() : ts
        const start = st.time?.start ? new Date(st.time.start).toISOString() : ts
        const isError = st.status === 'error'
        const tool = typeof d.tool === 'string' && d.tool.startsWith('dethereal_') ? `dethereal.${d.tool.slice('dethereal_'.length)}` : d.tool
        const output = String(st.output ?? st.error ?? '')
        const call = { actor: base.actor, actorId: base.actorId, turn: base.turn, tool, callId: d.callID as string }
        if (tool === 'question') {
          events.push({ ...call, ts: start, kind: 'ask', input })
          const picked = st.metadata?.answers
          const answers = Array.isArray(picked) ? picked.flatMap((a: unknown) => (Array.isArray(a) ? a : [a])).map(String) : undefined
          const dismissed = isError && !answers?.length && output.trim() === DISMISSED
          events.push({ ...call, ts: end, kind: 'answer', text: output, isError, ...(answers ? { answers } : {}), ...(dismissed ? { dismissed } : {}) })
          break
        }
        if (tool === 'task') {
          events.push({ ...call, ts: start, kind: 'subagent_start', input, text: input.subagent_type })
          events.push({ ...call, ts: end, kind: 'subagent_end', text: output, isError })
          break
        }
        if (tool === 'bash') {
          events.push({ ...call, ts: start, kind: 'shell', input, text: input.command })
          events.push({ ...call, ts: end, kind: 'tool_result', text: output, isError })
          break
        }
        events.push({ ...call, ts: start, kind: 'tool_call', input })
        events.push({ ...call, ts: end, kind: 'tool_result', text: output, isError })
        if (isError) break
        if (tool === 'write') {
          events.push({ ...call, ts: end, kind: 'file_write', path: input.filePath, fileOp: { op: 'write', content: String(input.content ?? '') } })
        } else if (tool === 'edit') {
          events.push({
            ...call,
            ts: end,
            kind: 'file_write',
            path: input.filePath,
            fileOp: { op: 'replace', oldString: String(input.oldString ?? ''), newString: String(input.newString ?? ''), replaceAll: !!input.replaceAll },
            ...(typeof st.metadata?.filediff?.patch === 'string' ? { expectedPatch: st.metadata.filediff.patch } : {}),
          })
        } else if (tool === 'read') {
          const text = readOutputText(output, input, st.metadata)
          events.push({ ...call, ts: end, kind: 'file_read', path: input.filePath, ...(text !== null ? { content: text, source: 'numbered' } : {}) })
        }
        break
      }
      default:
        if (!KNOWN_PARTS.has(String(d.type))) unknownTypes[String(d.type)] = (unknownTypes[String(d.type)] ?? 0) + 1
        break
    }
  }
  return { events, cwd, unknownTypes }
}
