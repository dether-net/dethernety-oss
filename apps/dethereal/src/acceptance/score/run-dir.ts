/**
 * The run directory: what a recorded acceptance run hands the scorer. The run
 * kit writes it; the scorer checks it first. A part that is missing or
 * malformed makes the run INVALID with a named reason, never a silent pass.
 *
 *   <run>/
 *     run.json                 the run record (RunRecord below)
 *     start/                   the project as it was at launch (before the harness started)
 *     project/                 the project as it was at the end (a git repository)
 *     transcripts/             the harness's transcripts, in the layout the transcript parsers read
 *     replies.jsonl            every operator input, in order (ReplyLine below)
 *     approvals.jsonl          every tool-approval decision the operator made (ApprovalLine below; may be empty)
 *     operator-waits.jsonl     optional: each wait for the operator the kit saw outside the approvals (OperatorWaitLine below)
 *     export/run-model.json    the platform export of the run's model after its push, or {"absent": "<reason>"}
 *     export/key-model.json    the platform export of the fixture's key model, synced on the same platform
 *     export/model-state.json  the run's own `model_state get`, taken through the server after the push
 *     installed/bundle.json    the harness bundle's bundle.json, as installed for the run
 *     installed/bundle/        the installed bundle's files, at exactly the paths bundle.json lists
 *     installed/dist/          the runtime's dist/, as installed for the run
 *     adjudications.json       optional: needs-review adjudications (Adjudication[] below)
 *     walk/project/            with a skills tail: the project as it was at the end of the main walk (a git repository)
 *
 * A run with a skills tail (the plugin's other skills, run after the main walk in the same session) says so in
 * run.json (`tail_start`, `walk_snapshot`), logs each tail command as a `tail:<skill>` reply in TAIL_IDS order, and
 * takes its exports at the end of the walk. The walk is scored on `walk/project` and the transcript up to the first
 * tail command; the tail is scored on its own.
 */
import fs from 'node:fs'
import path from 'node:path'
import { VERSION_PLACEHOLDER } from '../../generator/bundle-json.js'
import { treeHash as bundleTreeHash } from '../../generator/source.js'
import { sha256Hex } from '../../utils/hash.js'
import type { SettlementMode } from '../../utils/settlement-switch.js'
import type { ReplyMode } from '../answer-sheet.js'
import { isSubagentFile } from '../transcripts/claude.js'

export const RUN_DIR_SCHEMA_VERSION = 1

/** The skills tail, in the order the commands are sent; each is logged as `tail:<id>`. */
export const TAIL_IDS = ['status', 'view', 'surface', 'review', 'sync', 'login', 'threat-modeler'] as const
export type TailId = (typeof TAIL_IDS)[number]

/** Where the walk's snapshot lives in a run with a skills tail. */
export const WALK_SNAPSHOT = 'walk/project'

/** The policy rules under which a run kit's autopilot may answer a tool approval in the operator's place. */
export const AUTOPILOT_RULES = [
  'read-in-project', 'read-plugin-root', 'read-spill-file', 'write-in-root', 'bash-sandboxed', 'bash-read-only', 'mcp-plugin-prompt-tier', 'skill-handover',
  'waiver-decline', 'operator-after-stop',
] as const
export type AutopilotRule = (typeof AUTOPILOT_RULES)[number]

export type RunHarness = 'claude' | 'codex' | 'opencode'

export interface RunRecord {
  schemaVersion: typeof RUN_DIR_SCHEMA_VERSION
  runId: string
  harness: RunHarness
  /** The fixture the run used: a directory name under src/acceptance/fixtures/ */
  fixture: string
  /** The absolute path the harness worked in (the transcripts name it) */
  projectPath: string
  /** The harness's model id, as the run kit set it (logged, not scored) */
  model: string
  startedAt: string
  endedAt: string
  /** Set by a restore: such a run is never clean */
  resumed_from?: { snapshot: string; label: string; runId: string }
  /** For a confirming run after a marginal pass: the run it confirms */
  confirms?: string
  /** A run with a skills tail: the main session's transcript file the tail ran in */
  tail_start?: { transcript: string }
  /** A run with a skills tail: always WALK_SNAPSHOT */
  walk_snapshot?: typeof WALK_SNAPSHOT
  /** What the run measures: the full workflow (absent: full), a quick run, or a baseline of an earlier release */
  run_mode?: RunMode
  /** A baseline run: the release it ran */
  baseline_version?: string
  /** A full run: where the operator's facts are given; absent, `loopback` (the runs before the relay gave them) */
  sheet_mode?: SheetMode
  /** Whether the run's server had the settlement switched on; absent, on (the releases that always had it) */
  settlement?: SettlementMode
  /** What the run kit recorded of the run's environment, for comparing runs: each field only when the kit knows it */
  environment?: RunEnvironment
}

/** The environment two runs must share to be compared: recorded by the run kit, each field optional. */
export interface RunEnvironment {
  platformRelease?: string
  claudeCodeVersion?: string
  effort?: string
  autocompact?: boolean
  allowlistSha256?: string
  /** The claude binary that ran (Claude runs only) */
  claudeBinarySha256?: string
  /** The Node the MCP server and hooks ran on, as `process.version` gives it */
  nodeVersion?: string
  /** How the MCP server was started: a baseline runs its release's server from a lockfile */
  launcher?: RunLauncher
}

export interface RunLauncher {
  kind: 'node' | 'node-locked'
  /** The lockfile a `node-locked` server was installed from: present exactly then */
  lockfileSha256?: string
}

export type RunMode = 'full' | 'quick' | 'baseline'
export type SheetMode = Extract<ReplyMode, 'bar' | 'loopback'>

/**
 * How the run's sheet replies are chosen: `quick` for a quick run, a full run's `sheet_mode`, and `bar` for a
 * baseline, whose questions are matched to the sheet's by their triggers and given the operator's facts as an
 * acceptance run is.
 */
export function replyModeOf(record: Pick<RunRecord, 'run_mode' | 'sheet_mode'>): ReplyMode | null {
  if (record.run_mode === 'baseline') return 'bar'
  if (record.run_mode === 'quick') return 'quick'
  return record.sheet_mode ?? 'loopback'
}

export interface ReplyLine {
  ts: string
  /** The prompt id the operator answered, or: invocation, off-sheet, after-compact, fixed:<name> */
  prompt: string
  /** The answer-sheet variant used, when the prompt has variants (1-based) */
  variant?: number
  text: string
  /** sha256 of `text` (hex), so the scorer can match it with the transcript */
  sha256: string
}

export interface ApprovalLine {
  ts: string
  /** The tool the harness asked to approve, as the harness named it */
  tool: string
  decision: 'approve' | 'decline'
  /** Set when the run kit's autopilot answered in the operator's place: the rule that decided it */
  autopilotRule?: AutopilotRule
  /**
   * On an approval the operator made by hand (no `autopilotRule`, or `operator-after-stop`): when the run kit saw
   * them decide, never before `ts` (when the approval was asked)
   */
  decidedAt?: string
}

/**
 * A wait for the operator outside a tool approval: a hand step the operator resolved (an autopilot stop), a dialog
 * the autopilot left to the operator, or another. Its window is removed whole from the run's net model-active time.
 */
export interface OperatorWaitLine {
  start: string
  end: string
  kind: 'hand-step' | 'dialog' | 'other'
  /** What the operator did, one line, at most 200 characters */
  what: string
}

export interface Adjudication {
  /** The item: a hard gate or rubric id, plus the element or event it concerns */
  item: string
  adjudicator: string
  verdict: 'pass' | 'fail'
  reason: string
}

export interface RunDirProblem {
  code: string
  detail: string
}

export interface RunDir {
  dir: string
  record: RunRecord
  replies: ReplyLine[]
  approvals: ApprovalLine[]
  /** Waits for the operator the run kit recorded beside the approvals; empty without the file */
  operatorWaits: OperatorWaitLine[]
  runExport: unknown | { absent: string }
  keyExport: unknown
  /** The run's own `model_state get` after the push (the scorer cannot verify the settlement baseline itself) */
  stateExport: StateExport
  /** The installed bundle's bundle.json; null for a baseline of a release that ships none */
  bundleJson: { contentHash: string; [k: string]: unknown } | null
  adjudications: Adjudication[]
}

/**
 * The fields of the run's own `model_state get` the scorer reads. The run kit
 * takes it through the run's server, which holds the signing key, after the
 * push and before the sandbox home is removed; the model never writes it.
 */
export type StateExport = SettlementOnExport | SettlementOffExport

/** From a server with the settlement on, as every release before the switch */
export interface SettlementOnExport extends StateExportCommon {
  settlement?: undefined
  baseline: 'verified' | 'missing' | 'unverified' | 'unavailable'
  unregistered_changes: { rows_total: number; [k: string]: unknown }
  pending_enrichment?: { blocks: boolean; [k: string]: unknown }
}

/** From a server with the settlement switched off: the mark, and no settlement or pending field */
export interface SettlementOffExport extends StateExportCommon {
  settlement: 'off'
  baseline?: never
  unregistered_changes?: never
  pending_enrichment?: never
}

interface StateExportCommon {
  state: string | null
  claimed_state: string | null
  /** The review content hash of the model the run's server read (the scorer must reach the same), or null with why */
  content_hash: string | null
  content_hash_unavailable?: { code: string; files?: unknown; files_total?: unknown }
  [k: string]: unknown
}

const BASELINE_STATES = new Set(['verified', 'missing', 'unverified', 'unavailable'])

/** Why a state export breaks the contract, or null. */
function checkStateExport(v: unknown): string | null {
  if (!isObj(v)) return 'not an object'
  if (!(v.state === null || typeof v.state === 'string') || !(v.claimed_state === null || typeof v.claimed_state === 'string')) return 'state and claimed_state must be strings or null'
  if (v.settlement !== undefined) {
    if (v.settlement !== 'off') return 'settlement, when present, must be off'
    const kept = ['baseline', 'unregistered_changes', 'pending_enrichment'].filter((k) => k in v)
    if (kept.length) return `an export with settlement off carries no ${kept.join(', ')}`
  } else {
    if (typeof v.baseline !== 'string' || !BASELINE_STATES.has(v.baseline)) return 'baseline must be verified, missing, unverified or unavailable'
    const u = v.unregistered_changes
    if (!isObj(u) || !Number.isInteger(u.rows_total) || (u.rows_total as number) < 0) return 'unregistered_changes.rows_total must be a non-negative integer'
  }
  if (v.pending_enrichment !== undefined && (!isObj(v.pending_enrichment) || typeof v.pending_enrichment.blocks !== 'boolean')) return 'pending_enrichment.blocks must be a boolean'
  if (v.mode !== undefined && v.mode !== null && typeof v.mode !== 'string') return 'mode must be a string or null'
  if (v.quick_through !== undefined && v.quick_through !== null && !Number.isInteger(v.quick_through)) return 'quick_through must be an integer or null'
  if (v.content_hash === null) {
    const u = v.content_hash_unavailable as { code?: unknown } | undefined
    if (!u || typeof u !== 'object' || typeof u.code !== 'string' || !/^[a-z_]{1,64}$/.test(u.code)) return 'a null content_hash must say why (content_hash_unavailable.code)'
  } else if (typeof v.content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(v.content_hash)) return 'content_hash must be a sha256 hex digest or null'
  return null
}

export type RunDirCheck = { valid: true; run: RunDir } | { valid: false; problems: RunDirProblem[] }

const HARNESSES = new Set(['claude', 'codex', 'opencode'])
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const sha256 = sha256Hex

function readJson(file: string, problems: RunDirProblem[], code: string): unknown {
  if (!fs.existsSync(file)) {
    problems.push({ code: `missing_${code}`, detail: `${path.basename(file)} is missing` })
    return undefined
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    problems.push({ code: `bad_${code}`, detail: `${path.basename(file)} is not JSON` })
    return undefined
  }
}

function readJsonl<T>(file: string, problems: RunDirProblem[], code: string, check: (v: unknown) => string | null): T[] {
  if (!fs.existsSync(file)) {
    problems.push({ code: `missing_${code}`, detail: `${path.basename(file)} is missing` })
    return []
  }
  const out: T[] = []
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return
    let v: unknown
    try {
      v = JSON.parse(line)
    } catch {
      problems.push({ code: `bad_${code}`, detail: `${path.basename(file)} line ${i + 1} is not JSON` })
      return
    }
    const why = check(v)
    if (why) problems.push({ code: `bad_${code}`, detail: `${path.basename(file)} line ${i + 1}: ${why}` })
    else out.push(v as T)
  })
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SHA256 = /^[0-9a-f]{64}$/
const ENVIRONMENT_KEYS = ['platformRelease', 'claudeCodeVersion', 'effort', 'autocompact', 'allowlistSha256', 'claudeBinarySha256', 'nodeVersion', 'launcher']

function checkRecord(v: unknown): string | null {
  if (!isObj(v)) return 'not an object'
  if (v.schemaVersion !== RUN_DIR_SCHEMA_VERSION) return `schemaVersion must be ${RUN_DIR_SCHEMA_VERSION}`
  for (const k of ['runId', 'fixture', 'projectPath', 'model', 'startedAt', 'endedAt']) if (typeof v[k] !== 'string' || !v[k]) return `${k} must be a non-empty string`
  if (!HARNESSES.has(v.harness as string)) return 'harness must be claude, codex or opencode'
  if (!path.posix.isAbsolute(v.projectPath as string)) return 'projectPath must be absolute'
  if (!ISO.test(v.startedAt as string) || !ISO.test(v.endedAt as string)) return 'startedAt and endedAt must be ISO timestamps (UTC)'
  if (v.resumed_from !== undefined) {
    const r = v.resumed_from
    if (!isObj(r) || typeof r.snapshot !== 'string' || typeof r.label !== 'string' || typeof r.runId !== 'string') return 'resumed_from must hold snapshot, label and runId'
  }
  if (v.confirms !== undefined && typeof v.confirms !== 'string') return 'confirms must be a run id'
  if ((v.tail_start === undefined) !== (v.walk_snapshot === undefined)) return 'tail_start and walk_snapshot come together'
  if (v.tail_start !== undefined) {
    const t = v.tail_start
    if (!isObj(t) || typeof t.transcript !== 'string' || !t.transcript || /[\\/]/.test(t.transcript) || t.transcript.startsWith('.')) return 'tail_start.transcript must be a transcript file name'
    if (v.walk_snapshot !== WALK_SNAPSHOT) return `walk_snapshot must be ${WALK_SNAPSHOT}`
  }
  const modes = modesProblem(v)
  if (modes) return modes
  if (v.run_mode === 'quick' && v.tail_start !== undefined) return 'a quick run has no skills tail'
  if (v.environment !== undefined) {
    const e = v.environment
    if (!isObj(e)) return 'environment must be an object'
    for (const k of ['platformRelease', 'claudeCodeVersion', 'effort', 'allowlistSha256']) if (e[k] !== undefined && (typeof e[k] !== 'string' || !e[k])) return `environment.${k} must be a non-empty string`
    if (e.autocompact !== undefined && typeof e.autocompact !== 'boolean') return 'environment.autocompact must be a boolean'
    if (typeof e.allowlistSha256 === 'string' && !SHA256.test(e.allowlistSha256)) return 'environment.allowlistSha256 must be a sha256 hex digest'
    if (e.claudeBinarySha256 !== undefined) {
      if (typeof e.claudeBinarySha256 !== 'string' || !SHA256.test(e.claudeBinarySha256)) return 'environment.claudeBinarySha256 must be a sha256 hex digest'
      if (v.harness !== 'claude') return 'environment.claudeBinarySha256 is recorded on Claude runs only'
    }
    if (e.nodeVersion !== undefined && (typeof e.nodeVersion !== 'string' || !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(e.nodeVersion))) return 'environment.nodeVersion must be a Node version, such as v22.14.0'
    if (e.launcher !== undefined) {
      const l = e.launcher
      if (!isObj(l) || (l.kind !== 'node' && l.kind !== 'node-locked')) return "environment.launcher must be an object whose kind is 'node' or 'node-locked'"
      if (l.kind === 'node-locked' && (typeof l.lockfileSha256 !== 'string' || !SHA256.test(l.lockfileSha256))) return 'environment.launcher.lockfileSha256 must be a sha256 hex digest for a node-locked launcher'
      if (l.kind === 'node' && l.lockfileSha256 !== undefined) return 'environment.launcher.lockfileSha256 is recorded for a node-locked launcher only'
      const extraLauncher = Object.keys(l).filter((k) => k !== 'kind' && k !== 'lockfileSha256')
      if (extraLauncher.length) return `environment.launcher has unknown fields: ${extraLauncher.join(', ')}`
    }
    const extra = Object.keys(e).filter((k) => !ENVIRONMENT_KEYS.includes(k))
    if (extra.length) return `environment has unknown fields: ${extra.join(', ')}`
  }
  return null
}

/** Why a record's mode fields (`run_mode`, `baseline_version`, `sheet_mode`, `settlement`) break their rules, or null. */
export function modesProblem(v: Record<string, unknown>): string | null {
  if (v.run_mode !== undefined && !['full', 'quick', 'baseline'].includes(v.run_mode as string)) return 'run_mode must be full, quick or baseline'
  const runMode = (v.run_mode as RunMode | undefined) ?? 'full'
  if ((runMode === 'baseline') !== (v.baseline_version !== undefined)) return 'baseline_version comes with run_mode baseline, and only with it'
  if (v.baseline_version !== undefined && (typeof v.baseline_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(v.baseline_version))) return 'baseline_version must be a release version (x.y.z)'
  if (v.sheet_mode !== undefined && runMode !== 'full') return 'sheet_mode is for a full run only'
  if (v.sheet_mode !== undefined && v.sheet_mode !== 'bar' && v.sheet_mode !== 'loopback') return 'sheet_mode must be bar or loopback'
  if (v.settlement !== undefined && v.settlement !== 'on' && v.settlement !== 'off') return 'settlement must be on or off'
  if (v.settlement !== undefined && runMode === 'baseline') return 'settlement is for a run of this release, not a baseline'
  return null
}

/** Whether a run's server had the settlement on: as its record says, on when the record says nothing. */
export function settlementModeOf(record: Pick<RunRecord, 'settlement'>): SettlementMode {
  return record.settlement === 'off' ? 'off' : 'on'
}

function checkReply(v: unknown): string | null {
  if (!isObj(v)) return 'not an object'
  if (typeof v.ts !== 'string' || !ISO.test(v.ts)) return 'ts must be an ISO timestamp (UTC)'
  if (typeof v.prompt !== 'string' || !/^([a-z0-9-]+|fixed:[a-z0-9-]+|tail:[a-z0-9-]+)$/.test(v.prompt)) return 'prompt must be a prompt id, invocation, off-sheet, after-compact, fixed:<name> or tail:<skill>'
  if (v.variant !== undefined && (!Number.isInteger(v.variant) || (v.variant as number) < 1)) return 'variant must be a positive integer'
  if (typeof v.text !== 'string' || !v.text) return 'text must be a non-empty string'
  if (v.sha256 !== sha256(v.text)) return 'sha256 does not match text'
  return null
}

function checkOperatorWait(v: unknown): string | null {
  if (!isObj(v)) return 'not an object'
  if (typeof v.start !== 'string' || !ISO.test(v.start) || typeof v.end !== 'string' || !ISO.test(v.end)) return 'start and end must be ISO timestamps (UTC)'
  if (Date.parse(v.start) >= Date.parse(v.end)) return 'start must be before end'
  if (!['hand-step', 'dialog', 'other'].includes(v.kind as string)) return 'kind must be hand-step, dialog or other'
  if (typeof v.what !== 'string' || !v.what.trim() || v.what.length > 200 || /[\r\n]/.test(v.what)) return 'what must be one line of 1-200 characters'
  return null
}

function checkApproval(v: unknown): string | null {
  if (!isObj(v)) return 'not an object'
  if (typeof v.ts !== 'string' || !ISO.test(v.ts)) return 'ts must be an ISO timestamp (UTC)'
  if (typeof v.tool !== 'string' || !v.tool) return 'tool must be a non-empty string'
  if (v.decision !== 'approve' && v.decision !== 'decline') return 'decision must be approve or decline'
  if (v.autopilotRule !== undefined) {
    if (!(AUTOPILOT_RULES as readonly unknown[]).includes(v.autopilotRule)) return `autopilotRule must be one of ${AUTOPILOT_RULES.join(', ')}`
    if ((v.autopilotRule === 'waiver-decline') !== (v.decision === 'decline')) return 'autopilotRule waiver-decline goes with decline, every other rule with approve'
  }
  if (v.decidedAt !== undefined) {
    if (typeof v.decidedAt !== 'string' || !ISO.test(v.decidedAt)) return 'decidedAt must be an ISO timestamp (UTC)'
    if (v.autopilotRule !== undefined && v.autopilotRule !== 'operator-after-stop') return 'decidedAt is for an approval the operator made, not the autopilot'
    if (Date.parse(v.decidedAt) < Date.parse(v.ts)) return 'decidedAt must not be before ts'
  }
  return null
}

/**
 * The tail's reply lines: none, or every TAIL_IDS command once, in order. Lines between them answer what the
 * tail asked; the walk's invocation comes before them all.
 */
function tailProblems(record: RunRecord, replies: ReplyLine[]): string | null {
  const tail = replies.map((r, i) => ({ r, i })).filter(({ r }) => r.prompt.startsWith('tail:'))
  if (!record.tail_start) return tail.length ? 'tail: lines without tail_start in run.json' : null
  if (!tail.length) return 'tail_start without tail: lines in replies.jsonl'
  if (replies.slice(tail[0]!.i).some((r) => r.prompt === 'invocation')) return 'an invocation line after the first tail: line'
  const ids = tail.map(({ r }) => r.prompt.slice('tail:'.length))
  if (ids.join(',') !== TAIL_IDS.join(',')) return `tail: lines must be ${TAIL_IDS.map((t) => `tail:${t}`).join(', ')}, once each and in that order`
  return null
}

/** The transcript files a harness must have. */
function transcriptsPresent(dir: string, harness: RunHarness): string | null {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 'transcripts/ is missing'
  if (harness === 'claude') {
    // The main session's own file; a subagent's alone is not a session.
    const walk = (d: string): boolean =>
      fs.readdirSync(d, { withFileTypes: true }).some((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.jsonl') && !isSubagentFile(dir, path.join(d, e.name))))
    return walk(dir) ? null : 'no Claude Code main session (.jsonl outside subagents/) under transcripts/'
  }
  const need = harness === 'codex' ? ['codex-threads.json', 'codex-thread-items.json'] : ['opencode-sessions.json', 'opencode-messages.json', 'opencode-parts.json']
  const missing = need.filter((f) => !fs.existsSync(path.join(dir, f)))
  return missing.length ? `transcripts/ lacks ${missing.join(', ')}` : null
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The installed bundle against its bundle.json: every listed file present
 * under `installed/bundle/` with its listed sha256, nothing else there, and
 * `contentHash` recomputed from the files (the package version replaced by a
 * placeholder, as the generator hashes it).
 */
export function checkBundleFiles(installed: string, bundle: Record<string, unknown>): RunDirProblem[] {
  const problems: RunDirProblem[] = []
  const files = bundle.files
  if (typeof bundle.version !== 'string' || !bundle.version || !Array.isArray(files) ||
    !files.every((f) => isObj(f) && typeof f.path === 'string' && typeof f.sha256 === 'string' && HEX64.test(f.sha256) &&
      !path.posix.isAbsolute(f.path) && !f.path.split('/').includes('..') && f.path === path.posix.normalize(f.path))) {
    return [{ code: 'bad_bundle_json', detail: 'bundle.json needs a version and files with safe relative paths and sha256 hashes' }]
  }
  const root = path.join(installed, 'bundle')
  const listed = new Map((files as Array<{ path: string; sha256: string }>).map((f) => [f.path, f.sha256]))
  const texts = new Map<string, string>()
  for (const [rel, want] of listed) {
    const p = path.join(root, ...rel.split('/'))
    let bytes: Buffer
    try {
      if (!fs.lstatSync(p).isFile()) throw new Error('not a file')
      bytes = fs.readFileSync(p)
    } catch {
      problems.push({ code: 'bundle_file_missing', detail: `installed/bundle/${rel} is missing` })
      continue
    }
    if (sha256(bytes) !== want) problems.push({ code: 'bundle_file_changed', detail: `installed/bundle/${rel} differs from bundle.json` })
    texts.set(rel, bytes.toString('utf8').split(bundle.version as string).join(VERSION_PLACEHOLDER))
  }
  const walk = (d: string): string[] => {
    if (!fs.existsSync(d)) return []
    return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name)
      return e.isDirectory() ? walk(p) : [path.relative(root, p).split(path.sep).join('/')]
    })
  }
  for (const rel of walk(root)) if (!listed.has(rel)) problems.push({ code: 'bundle_file_extra', detail: `installed/bundle/${rel} is not in bundle.json` })
  if (!problems.length && bundleTreeHash(texts) !== bundle.contentHash) problems.push({ code: 'bundle_hash_mismatch', detail: 'the files do not hash to bundle.json\'s contentHash' })
  return problems
}

/** Check a run directory against the contract. Every problem is named; none is skipped. */
export function validateRunDir(dir: string): RunDirCheck {
  const problems: RunDirProblem[] = []
  const recordRaw = readJson(path.join(dir, 'run.json'), problems, 'run_json')
  let record: RunRecord | undefined
  if (recordRaw !== undefined) {
    const why = checkRecord(recordRaw)
    if (why) problems.push({ code: 'bad_run_json', detail: why })
    else record = recordRaw as RunRecord
  }
  for (const [sub, code] of [['start', 'start'], ['project', 'project']] as const) {
    const p = path.join(dir, sub)
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) problems.push({ code: `missing_${code}`, detail: `${sub}/ is missing` })
  }
  if (fs.existsSync(path.join(dir, 'project')) && !fs.existsSync(path.join(dir, 'project', '.git'))) problems.push({ code: 'project_not_git', detail: 'project/ is not a git repository' })
  if (record) {
    const why = transcriptsPresent(path.join(dir, 'transcripts'), record.harness)
    if (why) problems.push({ code: 'missing_transcripts', detail: why })
  }
  const replies = readJsonl<ReplyLine>(path.join(dir, 'replies.jsonl'), problems, 'replies', checkReply)
  if (fs.existsSync(path.join(dir, 'replies.jsonl')) && !replies.some((r) => r.prompt === 'invocation')) problems.push({ code: 'bad_replies', detail: 'replies.jsonl has no invocation line' })
  const approvals = readJsonl<ApprovalLine>(path.join(dir, 'approvals.jsonl'), problems, 'approvals', checkApproval)
  const waitsFile = path.join(dir, 'operator-waits.jsonl')
  const operatorWaits = fs.existsSync(waitsFile) ? readJsonl<OperatorWaitLine>(waitsFile, problems, 'operator_waits', checkOperatorWait) : []
  if (isObj(record)) {
    const from = Date.parse(String(record.startedAt))
    const to = Date.parse(String(record.endedAt))
    operatorWaits.forEach((w, i) => {
      if (Date.parse(w.start) < from || Date.parse(w.end) > to) problems.push({ code: 'bad_operator_waits', detail: `operator-waits.jsonl wait ${i + 1}: the window is outside the run` })
      if (i > 0 && Date.parse(w.start) < Date.parse(operatorWaits[i - 1]!.start)) problems.push({ code: 'bad_operator_waits', detail: `operator-waits.jsonl wait ${i + 1}: waits must be in start order` })
    })
  }
  if (record) {
    const why = tailProblems(record, replies)
    if (why) problems.push({ code: 'bad_tail', detail: why })
    if (record.tail_start) {
      const walk = path.join(dir, WALK_SNAPSHOT)
      if (!fs.existsSync(path.join(walk, '.git'))) problems.push({ code: 'missing_walk_snapshot', detail: `${WALK_SNAPSHOT}/ is missing or not a git repository` })
      const t = path.join(dir, 'transcripts', record.tail_start.transcript)
      // A bare file name: never a subagent's file, which sits under subagents/.
      if (!fs.existsSync(t) || !fs.statSync(t).isFile()) problems.push({ code: 'bad_tail', detail: 'tail_start.transcript is not a transcript file' })
    }
  }
  const runExport = readJson(path.join(dir, 'export', 'run-model.json'), problems, 'run_export')
  if (runExport !== undefined && isObj(runExport) && 'absent' in runExport && (typeof runExport.absent !== 'string' || !runExport.absent)) {
    problems.push({ code: 'bad_run_export', detail: 'an absent export must say why' })
  }
  const keyExport = readJson(path.join(dir, 'export', 'key-model.json'), problems, 'key_export')
  // A baseline ran an earlier release: it has no model state of this release's shape (an absent export says why) and
  // may ship no bundle.json.
  const baseline = record?.run_mode === 'baseline'
  const stateExport = readJson(path.join(dir, 'export', 'model-state.json'), problems, 'state_export')
  if (stateExport !== undefined) {
    const absent = baseline && isObj(stateExport) && 'absent' in stateExport
    const why = absent ? (typeof stateExport.absent === 'string' && stateExport.absent ? null : 'an absent export must say why') : checkStateExport(stateExport)
    if (why) problems.push({ code: 'bad_state_export', detail: `model-state.json: ${why}` })
  }
  const bundlePath = path.join(dir, 'installed', 'bundle.json')
  const bundleJson = (baseline && !fs.existsSync(bundlePath) ? null : readJson(bundlePath, problems, 'bundle_json')) as RunDir['bundleJson'] | null | undefined
  if (bundleJson !== undefined && bundleJson !== null && (!isObj(bundleJson) || typeof bundleJson.contentHash !== 'string')) problems.push({ code: 'bad_bundle_json', detail: 'bundle.json has no contentHash' })
  if (bundleJson !== undefined && bundleJson !== null && isObj(bundleJson) && typeof bundleJson.contentHash === 'string') problems.push(...checkBundleFiles(path.join(dir, 'installed'), bundleJson))
  const dist = path.join(dir, 'installed', 'dist')
  if (!fs.existsSync(path.join(dist, 'index.js'))) problems.push({ code: 'missing_dist', detail: 'installed/dist/index.js is missing' })
  let adjudications: Adjudication[] = []
  if (fs.existsSync(path.join(dir, 'adjudications.json'))) {
    const a = readJson(path.join(dir, 'adjudications.json'), problems, 'adjudications')
    const ok = Array.isArray(a) && a.every((x) => isObj(x) && typeof x.item === 'string' && !!x.item && typeof x.adjudicator === 'string' && !!x.adjudicator && (x.verdict === 'pass' || x.verdict === 'fail') && typeof x.reason === 'string' && !!x.reason)
    if (a !== undefined && !ok) problems.push({ code: 'bad_adjudications', detail: 'each adjudication needs item, adjudicator, verdict pass|fail and a reason' })
    else if (ok) adjudications = a as Adjudication[]
  }
  if (problems.length || !record || bundleJson === undefined) return { valid: false, problems }
  return { valid: true, run: { dir, record, replies, approvals, operatorWaits, runExport, keyExport, stateExport: stateExport as StateExport, bundleJson, adjudications } }
}
