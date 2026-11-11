/**
 * One event stream for the transcripts of every supported harness, so the
 * acceptance scorer reads Claude Code, Codex and OpenCode runs the same way.
 *
 * A parser turns a harness's own records into `RawEvent`s in order. The replay
 * then follows every write to a model file, attributes each changed value to the
 * event that set it, and emits checkpoints carrying the model state at each
 * question, reply, compaction and turn end. The harness's own change records,
 * where it keeps any, are a metadata-only cross-check of that replay.
 */

export const SCHEMA_VERSION = 1

export type Harness = 'claude' | 'codex' | 'opencode'

export type EventKind =
  /** A message from the operator (only ever in the main session) */
  | 'user'
  /** The task a subagent was given: never operator input */
  | 'subagent_prompt'
  /** A message the harness put in the operator's place (a background task's result, an interrupt marker, a local command's output) */
  | 'notice'
  | 'assistant'
  | 'ask'
  | 'answer'
  | 'tool_call'
  | 'tool_result'
  | 'compaction'
  | 'subagent_start'
  | 'subagent_end'
  | 'file_write'
  | 'file_read'
  | 'server_write'
  | 'shell'
  | 'harness_change'

/** What a file tool did, as far as the transcript shows it. */
export type FileOp =
  /** The whole new content is known */
  | { op: 'write'; content: string }
  /** Replace `oldString` by `newString` (once, or every occurrence) */
  | { op: 'replace'; oldString: string; newString: string; replaceAll: boolean }
  /** Unified-diff hunks (the `@@` lines and their bodies) */
  | { op: 'patch'; hunks: string }
  | { op: 'delete' }
  /** Rename to `to` (a project path as the harness gave it), content unchanged */
  | { op: 'move'; to: string }

export interface RawEvent {
  ts: string
  /** `main`, or the agent that acted (its type or path) */
  actor: string
  /** The session, thread or agent id the event came from */
  actorId: string
  /** The harness's turn or step id, when it has one */
  turn?: string
  kind: EventKind
  /** The tool name, for tool calls, results, file and server events */
  tool?: string
  /** Pairs a tool call with its result */
  callId?: string
  text?: string
  input?: unknown
  isError?: boolean
  /** file_write / file_read / harness_change: the path as the harness gave it */
  path?: string
  /** file_write: what changed */
  fileOp?: FileOp
  /** file_write: the content before the change, when the harness recorded it */
  before?: string
  /** file_write: the harness recorded that the file did not exist before the change */
  beforeAbsent?: boolean
  /** file_write: the harness's own record of the change, to check the replay against */
  expectedPatch?: string
  /** file_read: the file's content as read, when complete */
  content?: string
  /** compaction: manual or automatic */
  trigger?: string
  /** answer: the operator's answers, one per question, as the harness recorded them (picked label or typed text) */
  answers?: string[]
  /** shell: the working directory the harness recorded for the call, as it was when the call was made */
  cwd?: string
  /** shell, tool_call: the harness refused the call before it ran, as it recorded the refusal (an operator's decline, a rule, a hook) */
  denied?: string
  /** answer: the harness rejected the question call on its input before showing it (no showing) */
  inputRejected?: boolean
  /** answer: the harness recorded that the operator dismissed the dialog without answering it */
  dismissed?: boolean
  /** harness_change: which record it came from */
  source?: string
}

export interface TranscriptEvent extends Omit<RawEvent, 'path'> {
  seq: number
  harness: Harness
  /** Project-relative, `/`-separated; absolute when outside the project */
  path?: string
  outside?: boolean
  /** A model file of a model directory (or the project registry) */
  modelFile?: boolean
  /** shell: the working directory, project-relative */
  cwdRel?: string
  /** shell: the command writes, moves or deletes a model path */
  writesModel?: boolean
  /** shell / server_write: the model paths it may have changed */
  touches?: string[]
  /** file_write: the replay could not apply the change to the known content */
  replayMismatch?: string
  /** file_write: the replayed result differs from the harness's own record of the change */
  expectedMismatch?: boolean
}

export type FileState = { state: 'known'; text: string } | { state: 'unknown'; since: number } | { state: 'absent' }

export interface Attribution {
  path: string
  /** JSON pointer inside the file; '' for a non-JSON file or a whole-file change */
  pointer: string
  before: unknown
  after: unknown
  /** The event that set the value */
  event: number
  actor: string
  tool?: string
  /** The file's content before this write was unknown, so every value it wrote is attributed to it */
  beforeUnknown?: boolean
}

export interface OpaqueChange {
  path: string
  /**
   * The event after which the file's content was unknown: a server write, a shell command, a write the
   * replay could not apply, or a move of an unknown file. -1: the file was known, and differed when
   * seen again, with nothing in between that explains it (an unobserved change).
   */
  since: number
  /** The event where the replay knew the file again */
  resyncedAt: number
  pointer: string
  before: unknown
  after: unknown
  /** Writes to the file while its content was unknown: the change may be theirs too */
  alsoWritten?: number[]
  /** Later server writes or shell commands that also covered the file before it was seen again */
  alsoCovered?: number[]
}

export interface Checkpoint {
  seq: number
  /** The event after which the checkpoint was taken */
  after: number
  reason: 'ask' | 'answer' | 'user' | 'compaction' | 'turn_end'
  actor: string
  /** Every model file seen so far: its state, by the last event that changed it */
  files: Record<string, { state: 'known'; lastWrite: number; sha256: string } | { state: 'unknown'; since: number } | { state: 'absent' }>
}

export type CrossCheck = 'available' | 'partial' | 'unavailable'

export interface Reconciliation {
  crossCheck: CrossCheck
  /** Why the cross-check is partial or unavailable */
  note: string
  /** A change the harness tracked to a model file with no replayed or server write in its window */
  unobserved: Array<{ path: string; harnessEvent: number; window: [number, number]; shellInWindow: boolean }>
  /** A replayed write with no tracked change in its window (reported, not failed) */
  untracked: Array<{ path: string; event: number }>
}

export interface ParsedRun {
  schemaVersion: typeof SCHEMA_VERSION
  harness: Harness
  projectRoot: string | null
  events: TranscriptEvent[]
  attributions: Attribution[]
  opaque: OpaqueChange[]
  checkpoints: Checkpoint[]
  reconciliation: Reconciliation
  /** Model files whose content the replay could not follow, with the reason */
  replayNotes: Array<{ event: number; path: string; note: string }>
  /** Transcript items of a type the parser does not know, by type, with their count; absent when there are none */
  unknownTypes?: Record<string, number>
}
