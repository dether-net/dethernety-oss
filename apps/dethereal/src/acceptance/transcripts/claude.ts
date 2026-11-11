/**
 * Claude Code transcripts: a project directory holding `<session>.jsonl` and,
 * per session, `<session>/subagents/agent-*.jsonl` with a `.meta.json` naming
 * the agent type.
 *
 * File tool results carry the file as it was before the change (`originalFile`)
 * and the change itself (`structuredPatch`), and a complete read carries the
 * file: the replay's ground truth. The session's file-history entries are
 * Claude Code's own checkpoints; they become metadata-only `harness_change`
 * events. They cover a file from the first time a file tool touches it; a later
 * change to it, by any means, shows as a new version at the next user message.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RawEvent } from './types.js'
import { structuredPatchText } from './unified-diff.js'

type Rec = Record<string, any>

function jsonl(file: string): Rec[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Rec]
      } catch {
        return []
      }
    })
}

/** Whether a session file under `transcriptsDir` is a subagent's: judged by its path inside that directory, never above it. */
export function isSubagentFile(transcriptsDir: string, file: string): boolean {
  return path.relative(transcriptsDir, file).split(path.sep).slice(0, -1).includes('subagents')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out.sort()
}

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: Rec) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : ''

/**
 * A question dialog the operator dismissed without answering. Claude Code records it as a rejected
 * tool use (`toolDenialKind: "user-rejected"`). This exact message is the SDK-harness form: a harness
 * driving Claude Code through its SDK that has no answer denies the question with it, under the
 * `permission-rule` kind. A failed dialog (a closed stream, a hook's refusal) has that same kind and
 * another text, and was never before the operator.
 */
const DISMISSED = 'The user dismissed the question without answering.'

/** The dethereal server's tools are named `mcp__<server>__<tool>`; keep `dethereal.<tool>` for them. */
export function claudeToolName(name: string): string {
  const m = /^mcp__(?:plugin_[^_]+_)?(.+?)__(.+)$/.exec(name)
  if (!m) return name
  return m[1] === 'dethereal' ? `dethereal.${m[2]}` : `${m[1]}.${m[2]}`
}

/**
 * What a user-role message really is. Claude Code writes some of its own messages in the operator's
 * place: a background task's result, an interrupt marker, a local command's output. A slash command
 * is the operator's (`command`).
 */
export function classifyUserText(text: string): { kind: 'user' | 'notice'; source?: string } {
  const t = text.trimStart()
  if (t.startsWith('<task-notification>')) return { kind: 'notice', source: 'task-notification' }
  if (/^<local-command-(stdout|stderr)>/.test(t)) return { kind: 'notice', source: 'local-command' }
  if (t.startsWith('[Request interrupted')) return { kind: 'notice', source: 'interrupt' }
  if (/^<command-(name|message)>/.test(t)) return { kind: 'user', source: 'command' }
  return { kind: 'user' }
}

/** The raw text of a slash command whose own command record was written within two seconds of it. */
function isEchoedCommand(e: RawEvent, neighbours: Array<RawEvent | undefined>): boolean {
  const m = /^\/(\S+)$/.exec((e.text ?? '').trim())
  if (!m) return false
  return neighbours.some(
    (n) => !!n && n.source === 'command' && (n.text ?? '').includes(`<command-name>/${m[1]}</command-name>`) && Math.abs(Date.parse(n.ts) - Date.parse(e.ts)) <= 2000,
  )
}

export interface ClaudeParse {
  events: RawEvent[]
  cwd: string | null
  /**
   * Content blocks of a user or assistant message of a type this parser does not know, by type: a call travels only
   * in such blocks, so one of them could be missing from the events. Other record types carry no call.
   */
  unknownTypes: Record<string, number>
}

/** Message blocks read below, and those skipped on purpose (the model's thinking, an image the operator pasted). */
const KNOWN_BLOCKS = new Set(['text', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking', 'image'])

export function parseClaude(dir: string): ClaudeParse {
  const unknownTypes: Record<string, number> = {}
  const events: RawEvent[] = []
  /** Background agents, by the id of the tool call that started them: their subagent transcript's id */
  const background = new Map<string, string>()
  let cwd: string | null = null
  const files = walk(dir)
  for (const file of files) {
    const sub = isSubagentFile(dir, file)
    let actor = 'main'
    const actorId = path.basename(file, '.jsonl')
    if (sub) {
      try {
        const meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
        actor = meta.agentType ?? actorId
        if (meta.requestShape === 'background' && typeof meta.toolUseId === 'string') background.set(meta.toolUseId, actorId)
      } catch {
        actor = actorId
      }
    }
    const calls = new Map<string, { name: string; input: Rec; ts: string }>()
    let turn: string | undefined
    /** When the current turn began: the window start of a file's first tracked write */
    let turnTs = ''
    /**
     * Per tracked path, its version and when the state that version holds began: a backup taken at a
     * user message holds the file as of then; a first-write record holds the file as it was before that
     * write, so its state began with the turn.
     */
    const versions = new Map<string, { version: number; since: string }>()
    for (const d of jsonl(file)) {
      if (!sub && !cwd && typeof d.cwd === 'string') cwd = d.cwd
      const ts: string = d.timestamp ?? d.snapshot?.backupTime ?? ''
      if (d.type === 'system' && d.subtype === 'compact_boundary') {
        events.push({ ts, actor, actorId, turn, kind: 'compaction', trigger: d.compactMetadata?.trigger })
        continue
      }
      if (d.type === 'file-history-snapshot') {
        for (const [p, b] of Object.entries((d.snapshot?.trackedFileBackups ?? {}) as Record<string, Rec>)) {
          const prev = versions.get(p)
          if (!prev || b.version > prev.version) {
            // A new version: the file changed after the previous version's state began, and before this backup.
            if (prev) events.push({ ts: b.backupTime, actor, actorId, turn: d.messageId, kind: 'harness_change', path: p, source: `file-history:${prev.since}` })
            versions.set(p, { version: b.version, since: b.backupTime })
          }
        }
        continue
      }
      if (d.type === 'file-history-delta') {
        const b = d.backup ?? {}
        const prev = versions.get(d.trackingPath)
        if (!prev || b.version > prev.version) {
          events.push({ ts: d.timestamp, actor, actorId, turn: d.snapshotMessageId, kind: 'harness_change', path: d.trackingPath, source: `file-history:${prev?.since ?? (turnTs || d.timestamp)}` })
          versions.set(d.trackingPath, { version: b.version, since: turnTs || d.timestamp })
        }
        continue
      }
      const m = d.message
      if (d.type === 'user' && !d.isMeta && !d.isCompactSummary && !d.isVisibleInTranscriptOnly) {
        if (typeof m?.content === 'string') {
          const c = classifyUserText(m.content)
          if (c.kind === 'user') {
            turn = d.uuid
            turnTs = ts
          }
          events.push({ ts, actor, actorId, turn, kind: c.kind, text: m.content, ...(c.source ? { source: c.source } : {}) })
          continue
        }
      }
      if (!m || !Array.isArray(m.content)) continue
      for (const b of m.content as Rec[]) {
        if ((d.type === 'user' || d.type === 'assistant') && !KNOWN_BLOCKS.has(String(b?.type))) unknownTypes[String(b?.type)] = (unknownTypes[String(b?.type)] ?? 0) + 1
        if (d.type === 'user' && b.type === 'text' && !d.isMeta && !d.isCompactSummary && !d.isVisibleInTranscriptOnly) {
          const c = classifyUserText(b.text)
          if (c.kind === 'user') {
            turn = d.uuid
            turnTs = ts
          }
          events.push({ ts, actor, actorId, turn, kind: c.kind, text: b.text, ...(c.source ? { source: c.source } : {}) })
        } else if (d.type === 'assistant' && b.type === 'text') {
          events.push({ ts, actor, actorId, turn, kind: 'assistant', text: b.text })
        } else if (d.type === 'assistant' && b.type === 'tool_use') {
          const name = claudeToolName(b.name)
          calls.set(b.id, { name, input: b.input ?? {}, ts })
          if (name === 'AskUserQuestion') events.push({ ts, actor, actorId, turn, kind: 'ask', tool: name, callId: b.id, input: b.input })
          else if (name === 'Agent' || name === 'Task') events.push({ ts, actor, actorId, turn, kind: 'subagent_start', tool: name, callId: b.id, input: b.input, text: b.input?.subagent_type })
          // The call's own record carries the working directory it runs in; its result's may already be another.
          else if (name === 'Bash') events.push({ ts, actor, actorId, turn, kind: 'shell', tool: name, callId: b.id, input: b.input, text: b.input?.command, ...(typeof d.cwd === 'string' ? { cwd: d.cwd } : {}) })
          else events.push({ ts, actor, actorId, turn, kind: 'tool_call', tool: name, callId: b.id, input: b.input })
        } else if (d.type === 'user' && b.type === 'tool_result') {
          const call = calls.get(b.tool_use_id)
          const name = call?.name ?? 'unknown'
          const text = textOf(b.content)
          const isError = !!b.is_error
          const r: Rec = typeof d.toolUseResult === 'object' && d.toolUseResult !== null ? d.toolUseResult : {}
          const base = { ts, actor, actorId, turn, tool: name, callId: b.tool_use_id }
          if (name === 'AskUserQuestion') {
            const answers = r.answers && typeof r.answers === 'object' ? Object.values(r.answers as Record<string, unknown>).map(String) : undefined
            const dismissed = isError && !answers && (d.toolDenialKind === 'user-rejected' || text.trim() === DISMISSED)
            // Claude Code checks a call's input before it shows anything: a call it rejects there was never before the operator.
            const inputRejected = isError && !answers && typeof d.toolDenialKind !== 'string' && /^(?:<tool_use_error>)?InputValidationError\b/.test(text.trim())
            events.push({ ...base, kind: 'answer', text: r.answers ? JSON.stringify(r.answers) : text, isError, ...(answers ? { answers } : {}), ...(dismissed ? { dismissed } : {}), ...(inputRejected ? { inputRejected } : {}) })
            continue
          }
          if (name === 'Agent' || name === 'Task') {
            events.push({ ...base, kind: 'subagent_end', text, isError })
            continue
          }
          events.push({ ...base, kind: 'tool_result', text, isError })
          // A call the harness refused never ran; the attempt stays on record.
          if (isError && typeof d.toolDenialKind === 'string') {
            const called = events.find((e) => (e.kind === 'shell' || e.kind === 'tool_call') && e.callId === b.tool_use_id)
            if (called) called.denied = d.toolDenialKind
          }
          if (isError) continue
          // A file tool changes the file while it runs: the change is dated by the call, not the result.
          if (name === 'Write' && call) {
            events.push({
              ...base,
              ts: call.ts,
              kind: 'file_write',
              path: call.input.file_path,
              fileOp: { op: 'write', content: String(call.input.content ?? '') },
              ...(typeof r.originalFile === 'string' ? { before: r.originalFile } : r.originalFile === null ? { beforeAbsent: true } : {}),
            })
          } else if (name === 'Edit' && call) {
            events.push({
              ...base,
              ts: call.ts,
              kind: 'file_write',
              path: call.input.file_path,
              fileOp: { op: 'replace', oldString: String(call.input.old_string ?? ''), newString: String(call.input.new_string ?? ''), replaceAll: !!call.input.replace_all },
              ...(typeof r.originalFile === 'string' ? { before: r.originalFile } : {}),
              ...(Array.isArray(r.structuredPatch) ? { expectedPatch: structuredPatchText(r.structuredPatch) } : {}),
            })
          } else if (name === 'Read' && call) {
            const f = r.file
            const complete = f && typeof f.content === 'string' && (f.startLine ?? 1) === 1 && f.numLines === f.totalLines
            events.push({ ...base, kind: 'file_read', path: call.input.file_path, ...(complete ? { content: f.content } : {}) })
          }
        }
      }
    }
  }
  // A background agent's tool call returns when it is launched; it finishes with the last event of its own transcript.
  for (const e of events) {
    const agent = e.kind === 'subagent_end' && e.callId ? background.get(e.callId) : undefined
    if (!agent) continue
    const last = events.filter((x) => x.actorId === agent).reduce((m, x) => (x.ts > m ? x.ts : m), '')
    if (last > e.ts) {
      e.ts = new Date(Date.parse(last) + 1).toISOString()
      e.source = 'background'
    }
  }
  // A typed slash command is written twice: its raw text, then its command record. Keep the record.
  const users = events.filter((e) => e.kind === 'user')
  const echoes = new Set(users.filter((e) => isEchoedCommand(e, users)))
  return { events: events.filter((e) => !echoes.has(e)), cwd, unknownTypes }
}
