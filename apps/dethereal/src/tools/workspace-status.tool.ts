/**
 * Workspace Status Tool
 *
 * Reports the local workspace: the project root, the model registry
 * (`.dethernety/models.json`) and each registered model's workflow state, quality
 * score and stale-element count, with the commands that fit next. The same data
 * feeds the `hook session-start` CLI and `workspace-status --json`.
 *
 * Everything here is read from the repository, so everything is untrusted:
 * - the registry and every model file are read through the state store (no links,
 *   no special files, size caps) and every registered path must pass confinement;
 * - read failures become fixed codes, never file content or absolute paths;
 * - counts are counted, not copied, and states must be known values.
 * No network, no session store.
 */

import { z } from 'zod'
import { ClientFreeTool, ToolContext, ToolResult } from './base-tool.js'
import { configProblem, getConfig, originOf, type UrlSource } from '../config.js'
import { getProjectRoot, resolveProjectRoot } from '../utils/project-root.js'
import { readRepoJson, StateFileError, type ModelState, type StateFileErrorCode } from '../utils/state-store.js'
import { entryPath, readRegistry, resolveModelDir } from '../utils/model-registry.js'
import { boundedText, safeName } from '../cli/text.js'
import { localChangeStatus, type SyncRecord } from '../utils/sync-utils.js'
import { lstat } from 'node:fs/promises'
import path from 'node:path'

import { displayState, isQuick, MODEL_STATES, modelStateTool } from './model-state.tool.js'
import { settlementBlocks, type SettlementState } from '../utils/settlement-state.js'
import { settlementEnvProblem, settlementOn, type SettlementMode } from '../utils/settlement-switch.js'
import { BASELINE_FILE, SETTLEMENTS_FILE } from '../utils/settlement.js'
import { runtimeProblem } from '../utils/runtime-trust.js'

export { MODEL_STATES }

export type WorkflowState = (typeof MODEL_STATES)[number] | 'unknown'

export type ModelProblem = StateFileErrorCode | 'invalid_entry' | 'invalid_path' | 'unreadable'

export interface WorkspaceModel {
  /** Registered name, bounded and stripped of invisible characters */
  name: string
  /** Registered path, bounded and stripped likewise; absent when the entry had none */
  path?: string
  /** Workflow state as the server reads it (a claimed REVIEWED reads ENRICHING when the gates do not support it, or the model is quick); absent when unreadable */
  state?: WorkflowState
  /** The state with its qualifiers, e.g. "REVIEWED (2 waivers: C3×2)", when the server assessed the model or it is a quick model that claims REVIEWED */
  displayState?: string
  /** Quality score 0-100, when the model has one */
  qualityScore?: number
  /** Number of elements marked stale */
  staleElements?: number
  /** Number of waivers in use */
  waivers?: number
  /** Whether the model is ready for platform analysis, as the server judges it; absent when not assessed */
  readiness?: { ready: boolean; blockers: ReadinessBlocker[] }
  /** Only for a model whose state file claims REVIEWED: whether that still holds, and what stops it */
  review?: { holds: boolean; stale: boolean | null; blockers: ReviewBlocker[] }
  /** Why the model's files were not (fully) read */
  problem?: ModelProblem
  /**
   * With the settlement off: the model's `.dethereal/` holds settlement records (by name: nothing in them is read), so
   * it was worked on with the settlement on. Off is otherwise silent; this says it changed.
   */
  settledWithSettlementOn?: true
}

/**
 * What stops platform analysis: the model could not be assessed, a gate fails, an
 * enrichment value awaits the operator (or the pending file is unreadable), or the
 * settlement blocks (values nobody registered, a tampered baseline, no usable key).
 * The last two only with the settlement on: with it off, get carries neither.
 */
export type ReadinessBlocker = 'unavailable' | 'gate2' | 'gate3' | 'pending' | 'pending_unreadable' | 'settlement'
/** What stops a claimed REVIEWED: the same, plus queued stale elements the model still has, and a quick model (never reviewed). */
export type ReviewBlocker = ReadinessBlocker | 'stale_queue' | 'quick_mode'

export interface Suggestion {
  command: string
  reason: string
}

export interface WorkspaceStatus {
  /** Directory model paths are confined to; null when none could be used */
  projectRoot: string | null
  /** Why there is no project root, when there is none */
  projectRootDetail?: string
  platform: {
    url: string
    urlSource: UrlSource
    /** A usable platform URL was set explicitly */
    configured: boolean
    problem?: 'invalid_url' | 'untrusted_runtime'
  }
  /** State of `.dethernety/models.json` under the project root */
  registry: 'unavailable' | 'absent' | 'invalid' | 'present'
  registryProblem?: StateFileErrorCode | 'models_not_array'
  /** Number of registered models */
  modelCount: number
  /** The first registered models, in registry order */
  models: WorkspaceModel[]
  /** One-line summary of the first model, names sanitised */
  contextLine: string | null
  /** Up to three commands that fit next */
  suggestions: Suggestion[]
  /** Whether the server holds values to the operator's registrations, as the models were read */
  settlement: SettlementMode
  /**
   * The settlement's switch is set in the environment, but not to exactly `on`, so the settlement is off. Only that
   * it is set: its value is never carried (the environment can come from a repository's own settings).
   */
  settlementSwitchNotOn?: true
}

export interface CollectOptions {
  /** How many models to read (default 50) */
  maxModels?: number
  /** Size cap for a model's state file (default 1 MB) */
  stateMaxBytes?: number
  /** Size cap for a model's quality file (default 1 MB) */
  qualityMaxBytes?: number
  /** The settlement mode the models are read with: the caller's (a hook's flag), else the environment's */
  settlement?: SettlementMode
}

const STATE_REL = '.dethereal/state.json'
const QUALITY_REL = '.dethereal/quality.json'

export { boundedText, safeName } from '../cli/text.js'

/** Whether a model directory holds settlement records (by name only: nothing in them is read). */
async function hasSettlementRecords(dir: string): Promise<boolean> {
  for (const file of [BASELINE_FILE, SETTLEMENTS_FILE]) {
    if (await lstat(path.join(dir, ...file.split('/'))).then(() => true, () => false)) return true
  }
  return false
}

/** The length of a repository array, or undefined for anything that is not one. */
function count(value: unknown): number | undefined {
  const n = Array.isArray(value) ? value.length : undefined
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined
}

function stateOf(value: unknown): WorkflowState | undefined {
  if (value === undefined) return undefined
  return (MODEL_STATES as readonly unknown[]).includes(value) ? (value as WorkflowState) : 'unknown'
}

function scoreOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : undefined
}

function problemOf(error: unknown): ModelProblem {
  return error instanceof StateFileError ? error.code : 'unreadable'
}

async function readModel(entry: unknown, root: string, options: CollectOptions): Promise<WorkspaceModel> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { name: 'Unnamed', problem: 'invalid_entry' }
  }
  const record = entry as Record<string, unknown>
  const name = typeof record.name === 'string' && boundedText(record.name) ? boundedText(record.name) : 'Unnamed'
  const rawPath = entryPath(entry)
  if (rawPath === null) return { name, problem: 'invalid_path' }
  const model: WorkspaceModel = { name, path: boundedText(rawPath, 512) }

  // Registered paths are relative to the project root, wherever the process started.
  let dir: string
  try {
    dir = await resolveModelDir(root, rawPath)
  } catch {
    return { ...model, problem: 'outside_root' }
  }

  try {
    const state = await readRepoJson(dir, STATE_REL, { baseDir: dir, maxBytes: options.stateMaxBytes })
    model.state = state ? stateOf(state.currentState) ?? 'INITIALIZED' : 'INITIALIZED'
    // A quick model is never REVIEWED, even when the server's own reading below is not to be had.
    if (model.state === 'REVIEWED' && isQuick(state as ModelState)) {
      model.state = 'ENRICHING'
      model.displayState = displayState('ENRICHING', { waivers: [] }, false, true)
    }
    if (state) {
      model.staleElements = count(state.staleElements)
      // The state as the server reads it, with its qualifiers and what stops analysis.
      Object.assign(model, await assessed(dir, options.settlement))
    }
    if (!settlementOn(options.settlement) && (await hasSettlementRecords(dir))) model.settledWithSettlementOn = true
  } catch (error) {
    return { ...model, problem: problemOf(error) }
  }

  try {
    const quality = await readRepoJson(dir, QUALITY_REL, { baseDir: dir, maxBytes: options.qualityMaxBytes })
    model.qualityScore = scoreOf(quality?.quality_score)
  } catch (error) {
    model.problem = problemOf(error)
  }
  return model
}

/**
 * The server's own reading of a model's state (model_state get), projected to
 * fields that are enums, counts and fixed words. Names the repository supplies
 * (waived elements, pending rows, error text) are not taken.
 */
async function assessed(dir: string, settlement?: SettlementMode): Promise<Partial<WorkspaceModel>> {
  const result = await modelStateTool.run({ action: 'get', directory_path: dir }, { debug: false, settlement }).catch(() => null)
  const data = result?.success ? (result.data as Record<string, unknown>) : undefined
  if (!data || data.exists !== true) return { problem: 'unreadable' }
  const state = stateOf(data.state)
  const inUse = data.waivers_in_use
  const stale = data.stale_resolvable
  const blockers = readinessBlockers(data)
  return {
    ...(state ? { state } : {}),
    ...(typeof data.display_state === 'string' ? { displayState: boundedText(data.display_state) } : {}),
    waivers: Number.isInteger(inUse) && (inUse as number) >= 0 ? (inUse as number) : undefined,
    staleElements: Number.isInteger(stale) && (stale as number) >= 0 ? (stale as number) : undefined,
    readiness: { ready: blockers.length === 0, blockers },
    ...(data.claimed_state === 'REVIEWED'
      ? {
          review: {
            holds: data.state === 'REVIEWED',
            stale: data.state === 'REVIEWED' ? data.reviewed_stale === true : null,
            blockers: data.state === 'REVIEWED' ? [] : [
              ...(data.mode === 'quick' ? ['quick_mode' as const] : []),
              ...blockers,
              ...(Number.isInteger(stale) && (stale as number) > 0 ? ['stale_queue' as const] : []),
            ],
          },
        }
      : {}),
  }
}

/** What stops analysis, from `model_state get`: the same conditions its effective state applies. */
function readinessBlockers(data: Record<string, unknown>): ReadinessBlocker[] {
  const out: ReadinessBlocker[] = []
  const gates = data.gates as { gate2?: unknown; gate3?: unknown; verdict?: unknown } | undefined
  if (!gates || gates.verdict === 'UNAVAILABLE') out.push('unavailable')
  else {
    if (gates.gate2 !== 'PASS') out.push('gate2')
    if (gates.gate3 !== 'PASS') out.push('gate3')
  }
  const pending = data.pending_enrichment as { state?: unknown; blocking?: unknown } | undefined
  if (pending?.state === 'unreadable') out.push('pending_unreadable')
  else if (typeof pending?.blocking === 'number' && pending.blocking > 0) out.push('pending')
  const unregistered = (data.unregistered_changes as { rows_total?: unknown } | undefined)?.rows_total
  const settlement = settlementBlocks({
    baseline: { status: data.baseline, ...(typeof data.baseline_code === 'string' ? { code: data.baseline_code } : {}) } as SettlementState['baseline'],
    drift: { total: typeof unregistered === 'number' ? unregistered : 0 } as SettlementState['drift'],
  })
  if (settlement.length > 0) out.push('settlement')
  return out
}

function suggestionsFor(state: WorkflowState): Suggestion[] {
  switch (state) {
    case 'INITIALIZED':
      return [
        { command: 'create', reason: 'Describe your system to build the model' },
        { command: 'discover', reason: 'Auto-discover infrastructure from codebase' }
      ]
    case 'SCOPE_DEFINED':
      return [
        { command: 'discover', reason: 'Scan codebase for infrastructure components' },
        { command: 'add', reason: 'Manually add components and boundaries' }
      ]
    case 'DISCOVERED':
      return [
        { command: 'add', reason: 'Refine discovered components and boundaries' },
        { command: 'classify', reason: 'Assign classes to components' },
        { command: 'view', reason: 'Review the current model structure' }
      ]
    case 'STRUCTURE_COMPLETE':
      return [
        { command: 'classify', reason: 'Assign classes to unclassified elements' },
        { command: 'enrich', reason: 'Add security attributes' },
        { command: 'review', reason: 'Check model quality before enrichment' }
      ]
    case 'ENRICHING':
      // No push suggestion from a score: whether a model is ready is the gates' call (review).
      return [
        { command: 'enrich', reason: 'Continue adding security attributes' },
        { command: 'review', reason: 'See full quality breakdown' }
      ]
    case 'REVIEWED':
      return [
        { command: 'sync push', reason: 'Push model to platform for analysis' },
        { command: 'surface', reason: 'View attack surface summary' },
        { command: 'view', reason: 'Review final model' }
      ]
    default:
      return [
        { command: 'status', reason: 'Check current state' },
        { command: 'help', reason: 'See all available commands' }
      ]
  }
}

const LOGIN: Suggestion = { command: 'login', reason: 'Connect to the Dethernety platform' }

/** Commands that need a platform are dropped, and sign-in offered, when none is configured. */
function forPlatform(suggestions: Suggestion[], configured: boolean): Suggestion[] {
  if (configured) return suggestions.slice(0, 3)
  const local = suggestions.filter((s) => s.command !== 'sync' && !s.command.startsWith('sync '))
  if (!local.some((s) => s.command === 'login')) local.push(LOGIN)
  return local.slice(0, 3)
}

/** Collect the workspace status. Never throws; reads local files only. */
export async function collectWorkspaceStatus(options: CollectOptions = {}): Promise<WorkspaceStatus> {
  // The mode is resolved once: every model is read with it, and every answer says which it was.
  const settlement: SettlementMode = settlementOn(options.settlement) ? 'on' : 'off'
  const notOn = options.settlement === undefined && settlementEnvProblem() !== null
  return { ...(await readWorkspace({ ...options, settlement })), settlement, ...(notOn ? { settlementSwitchNotOn: true as const } : {}) }
}

async function readWorkspace(options: CollectOptions): Promise<Omit<WorkspaceStatus, 'settlement'>> {
  const config = getConfig()
  const untrustedRuntime = runtimeProblem() !== undefined
  const invalidUrl = !untrustedRuntime && configProblem() !== undefined
  const platform: WorkspaceStatus['platform'] = {
    url: originOf(config.baseUrl),
    urlSource: config.urlSource,
    configured: config.urlSource !== 'default' && !invalidUrl && !untrustedRuntime,
    ...(untrustedRuntime ? { problem: 'untrusted_runtime' as const } : invalidUrl ? { problem: 'invalid_url' as const } : {})
  }
  const empty = { modelCount: 0, models: [] as WorkspaceModel[] }

  const resolved = getProjectRoot() ?? resolveProjectRoot()
  if (resolved.root === null) {
    return {
      projectRoot: null,
      projectRootDetail: resolved.reason,
      platform,
      registry: 'unavailable',
      ...empty,
      contextLine: null,
      suggestions: forPlatform([{ command: 'status', reason: 'Check current state' }], platform.configured)
    }
  }
  const root = resolved.root
  const base = { projectRoot: root, platform }

  const registry = await readRegistry(root)
  if (registry.registry === 'invalid' && registry.code !== 'models_not_array') {
    return {
      ...base,
      registry: 'invalid',
      registryProblem: registry.code,
      ...empty,
      contextLine: null,
      suggestions: forPlatform([{ command: 'create', reason: 'Create your first threat model' }], true)
    }
  }
  if (registry.registry === 'absent') {
    return {
      ...base,
      registry: 'absent',
      ...empty,
      contextLine: null,
      suggestions: [{ command: 'create', reason: 'Create your first threat model' }, LOGIN]
    }
  }
  if (registry.registry === 'invalid') {
    return {
      ...base,
      registry: 'invalid',
      registryProblem: 'models_not_array',
      ...empty,
      contextLine: null,
      suggestions: [{ command: 'create', reason: 'Create your first threat model' }]
    }
  }
  const entries = registry.entries
  if (entries.length === 0) {
    return {
      ...base,
      registry: 'present',
      ...empty,
      contextLine: null,
      suggestions: [
        { command: 'create', reason: 'Create your first threat model' },
        { command: 'discover', reason: 'Auto-discover infrastructure from your codebase' }
      ]
    }
  }

  const models: WorkspaceModel[] = []
  for (const entry of entries.slice(0, Math.max(1, options.maxModels ?? 50))) {
    try {
      models.push(await readModel(entry, root, options))
    } catch {
      models.push({ name: 'Unnamed', problem: 'unreadable' })
    }
  }

  const first = models[0]!
  const name = safeName(first.name)
  const shown = first.displayState ?? (first.state && first.state !== 'unknown' ? first.state : undefined)
  const contextLine =
    `model "${name}"` + (shown ? ` — ${shown}` : '') + (first.qualityScore !== undefined ? ` at ${first.qualityScore}/100 quality` : '')
  return {
    ...base,
    registry: 'present',
    modelCount: entries.length,
    models,
    contextLine,
    suggestions: forPlatform(suggestionsFor(first.state ?? 'INITIALIZED'), platform.configured)
  }
}

/** The local control library of a model, counted: what a push still has to publish. */
export interface ControlLibraryCounts {
  /** Control files under controls/ (at most MAX_CONTROL_FILES are read) */
  controls: number
  /** Controls with a pending edit to push */
  pendingEdits: number
  /** Controls not yet created or not fully pushed (greenfield, partially pushed) */
  unpushed: number
  /** Controls whose local attributes differ from the platform's with no pending edit */
  drift: number
  /**
   * The first of them by control-file id (at most MAX_DRIFTED_LISTED): the id from the
   * file listing, only when id-shaped, and the name cut to a safe length. Repository
   * data: shown quoted, never followed as an instruction.
   */
  driftedControls: Array<{ id: string; name: string }>
  /** Controls marked tombstoned */
  tombstoned: number
  /** Control files that could not be read (a link, a special file, invalid JSON) */
  unreadable: number
  /** A pending id-rewrite journal is present */
  journal: boolean
}

/** One model's status with its sync record: what `directory_path` asks for. */
export interface ModelSyncStatus {
  projectRoot: string | null
  /** The model, without its path; absent when the directory is not a readable model */
  model?: Omit<WorkspaceModel, 'path'>
  sync?: SyncRecord
  controlLibrary?: ControlLibraryCounts
  /** Why the directory was not read; `absent` when it does not exist */
  problem?: 'no_project_root' | 'outside_root' | 'absent' | 'not_a_model' | ModelProblem
  /** The settlement mode the model was read with */
  settlement: SettlementMode
}

const MAX_CONTROL_FILES = 500
const MAX_DRIFTED_LISTED = 20
const MAX_REFERENCED_MODELS = 20
const REFERENCE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Platform ids of the models this one references: every `representedModel` in
 * structure.json (components or boundaries that stand for whole sub-models). Ids
 * only, deduplicated, at most MAX_REFERENCED_MODELS; unreadable structure → none.
 */
async function referencedModelIds(dir: string): Promise<string[]> {
  let structure: Record<string, unknown> | null
  try {
    structure = await readRepoJson(dir, 'structure.json', { baseDir: dir, maxBytes: 32 * 1024 * 1024 })
  } catch {
    return []
  }
  const ids = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 64 || ids.size >= MAX_REFERENCED_MODELS) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    const record = node as Record<string, unknown>
    const refs = Array.isArray(record.representedModel) ? record.representedModel : [record.representedModel]
    for (const ref of refs) {
      const id = (ref as { id?: unknown } | undefined)?.id
      if (typeof id === 'string' && REFERENCE_ID.test(id)) ids.add(id)
    }
    for (const [key, value] of Object.entries(record)) if (key !== 'representedModel') walk(value, depth + 1)
  }
  walk(structure, 0)
  return [...ids].slice(0, MAX_REFERENCED_MODELS)
}

/** Count the local control library. Never throws; counts, and the ids and names of drifted controls. */
async function controlLibraryCounts(dir: string): Promise<ControlLibraryCounts> {
  const counts: ControlLibraryCounts = { controls: 0, pendingEdits: 0, unpushed: 0, drift: 0, driftedControls: [], tombstoned: 0, unreadable: 0, journal: false }
  // Loaded here, not at the top: the session-start hook imports this module and must stay fast.
  const { listControlFiles, readControlFile, detectControlDrift } = await import('@dethernety/dt-core')
  counts.journal = await lstat(path.join(dir, '.dethereal', 'pending-id-rewrite.json')).then(() => true, () => false)
  let ids: string[]
  try {
    ids = await listControlFiles(dir)
  } catch {
    counts.unreadable = 1
    return counts
  }
  for (const id of ids.slice(0, MAX_CONTROL_FILES)) {
    counts.controls++
    let file
    try {
      file = await readControlFile(dir, id)
    } catch {
      counts.unreadable++
      continue
    }
    if (!file || typeof file !== 'object' || !Array.isArray(file.classes)) {
      counts.unreadable++
      continue
    }
    if (file.lifecycle === 'greenfield' || file.lifecycle === 'partially-pushed') counts.unpushed++
    if (file.lifecycle === 'tombstoned') counts.tombstoned++
    if (file.classes.some((c) => c && typeof c === 'object' && c.pendingEdit)) counts.pendingEdits++
    try {
      if (detectControlDrift(file).hasDrift) {
        counts.drift++
        // The listing's id, never the id the file content claims.
        if (REFERENCE_ID.test(id) && counts.driftedControls.length < MAX_DRIFTED_LISTED) {
          counts.driftedControls.push({ id, name: safeName(typeof file.name === 'string' ? file.name : '') })
        }
      }
    } catch {
      counts.unreadable++
    }
  }
  return counts
}

/**
 * The status of one model directory, with its sync record and whether it
 * changed since the last push or pull. Only this path hashes the model: the
 * workspace listing (and the session-start hook built on it) never does.
 */
export async function collectModelSyncStatus(directoryPath: string, mode?: SettlementMode): Promise<ModelSyncStatus> {
  // As the listing: the mode resolved once, the model read with it, the answer saying which it was.
  const settlement: SettlementMode = settlementOn(mode) ? 'on' : 'off'
  return { ...(await readModelSync(directoryPath, settlement)), settlement }
}

async function readModelSync(directoryPath: string, settlement: SettlementMode): Promise<Omit<ModelSyncStatus, 'settlement'>> {
  const resolved = getProjectRoot() ?? resolveProjectRoot()
  if (resolved.root === null) return { projectRoot: null, problem: 'no_project_root' }
  const root = resolved.root
  let dir: string
  try {
    dir = await resolveModelDir(root, directoryPath)
  } catch {
    return { projectRoot: root, problem: 'outside_root' }
  }
  if (!(await lstat(dir).then(() => true, () => false))) return { projectRoot: root, problem: 'absent' }
  let manifest: Record<string, unknown> | null
  try {
    manifest = await readRepoJson(dir, 'manifest.json', { baseDir: dir })
  } catch (error) {
    return { projectRoot: root, problem: problemOf(error) }
  }
  if (!manifest) return { projectRoot: root, problem: 'not_a_model' }
  const declared = (manifest.model as Record<string, unknown> | undefined)?.name
  const name = typeof declared === 'string' && boundedText(declared) ? boundedText(declared) : 'Unnamed'
  // The directory is given, not registered: read it as a registry entry would be, without echoing its path.
  const { path: _path, ...model } = await readModel({ name, path: dir }, root, { settlement })
  // Referenced models come from the model itself: no tool records them in sync.json.
  const sync = { ...(await localChangeStatus(dir)), referencedModels: await referencedModelIds(dir) }
  return { projectRoot: root, model, sync, controlLibrary: await controlLibraryCounts(dir) }
}

const InputSchema = z.object({
  directory_path: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe('One model directory to report, with its sync record and whether it changed since the last push or pull')
})

type WorkspaceStatusInput = z.infer<typeof InputSchema>

export class WorkspaceStatusTool extends ClientFreeTool<WorkspaceStatusInput, WorkspaceStatus | ModelSyncStatus> {
  readonly name = 'workspace_status'

  readonly description = `Report the local Dethereal workspace: the project root, the registered threat models (.dethernety/models.json) with each model's workflow state, quality score and stale-element count, and the commands that fit next.

Reads local files only; never contacts the platform. Use it to re-read the workflow state after a context compaction instead of relying on a summary.

With directory_path: that one model's state and quality, its sync record (platform model id, last push and pull), localChanges — whether the model changed since the last push or pull (null when that cannot be told) — and counts of its local control library (pending edits, unpushed and drifted controls, a pending recovery journal).`

  readonly inputSchema = InputSchema

  async execute(input: WorkspaceStatusInput, context: ToolContext): Promise<ToolResult<WorkspaceStatus | ModelSyncStatus>> {
    if (input.directory_path !== undefined) return { success: true, data: await collectModelSyncStatus(input.directory_path, context.settlement) }
    return { success: true, data: await collectWorkspaceStatus({ settlement: context.settlement }) }
  }
}

export const workspaceStatusTool = new WorkspaceStatusTool()
