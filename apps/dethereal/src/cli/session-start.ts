/**
 * `hook session-start`: the text a harness adds to the model's context when a
 * session starts, is cleared, resumes or has just been compacted.
 *
 * The model reads this as context, and the repository supplies the names in it, so
 * everything taken from the repository is reduced to enums, counts and names cut to
 * `[\w .-]{0,64}`, and names always sit in the same constant frame. The rest of the
 * text is constant.
 */

import type { WorkspaceModel, WorkspaceStatus } from '../tools/workspace-status.tool.js'
import type { SettlementMode } from '../utils/settlement-switch.js'
import { safeName } from './text.js'

export const SESSION_SOURCES = ['startup', 'resume', 'clear', 'compact'] as const
export type SessionSource = (typeof SESSION_SOURCES)[number]

export const HARNESSES = ['claude', 'codex', 'opencode'] as const
export type Harness = (typeof HARNESSES)[number]

/** How many models the compaction reminder lists. */
export const COMPACT_MODEL_LIMIT = 10

/** A command id in the invocation form of the harness. */
export function commandFor(id: string, harness?: Harness): string {
  switch (harness) {
    case 'claude':
      return `/dethereal:${id}`
    case 'codex':
      return `$dethereal:${id}`
    case 'opencode':
      return `/dethereal-${id}`
    default:
      return id
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

const STATE = '(?:INITIALIZED|SCOPE_DEFINED|DISCOVERED|STRUCTURE_COMPLETE|ENRICHING|REVIEWED)'
const QUALIFIER = '(?:quick|\\d+ waivers?: C[1-9]\u00d7\\d+|C[1-9]\u00d7\\d+|stale)'
/** The qualifiers only a server with the settlement on gives. */
const SETTLEMENT_QUALIFIER = '(?:\\d+ pending enrichment|pending enrichment unreadable|\\d+ unregistered|\\d+ values? from a pull)'
const statePattern = (qualifier: string) => new RegExp(`^${STATE}(?: \\(${qualifier}(?:, ${qualifier})*\\))?$`)
/** The server's state with qualifiers, e.g. "REVIEWED (2 waivers: C3×1, C8×1, stale)". Nothing else passes. */
export const DISPLAY_STATE = statePattern(`(?:${QUALIFIER}|${SETTLEMENT_QUALIFIER})`)
/** As `DISPLAY_STATE`, for a server with the settlement off: none of the settlement's qualifiers pass. */
export const DISPLAY_STATE_SETTLEMENT_OFF = statePattern(QUALIFIER)

/** Said of a model worked on with the settlement on, now read with it off: the switch changed. */
export const SETTLED_WHILE_ON = 'settled with the settlement on, which is now off'

/** Said when the settlement is on; off, the shipped default, goes unsaid. */
export const SETTLEMENT_ON_LINE = 'Settlement on: values the operator has not confirmed hold back REVIEWED and a push.'
/** Said when the switch is set to anything but `on`: a fixed text, never the value (a repository's settings can set it). */
export const SETTLEMENT_SET_NOT_ON_LINE = 'Settlement off: DETHEREAL_SETTLEMENT is set, but not to `on`.'

function modelLine(model: WorkspaceModel, settlement: SettlementMode): string {
  const parts: string[] = []
  if (model.problem && model.state === undefined) {
    parts.push(`state unreadable (${model.problem})`)
  } else {
    // The assessed state carries its own waiver and staleness qualifiers.
    const allowed = settlement === 'on' ? DISPLAY_STATE : DISPLAY_STATE_SETTLEMENT_OFF
    const display = model.displayState && allowed.test(model.displayState) ? model.displayState : undefined
    parts.push(display ?? model.state ?? 'unknown')
    if (model.qualityScore !== undefined) parts.push(`quality ${model.qualityScore}/100`)
    if (model.staleElements) parts.push(plural(model.staleElements, 'stale element', 'stale elements'))
    if (model.waivers && !display) parts.push(plural(model.waivers, 'waiver', 'waivers'))
    if (model.problem) parts.push(`some files unreadable (${model.problem})`)
    if (model.settledWithSettlementOn) parts.push(SETTLED_WHILE_ON)
  }
  return `  model "${safeName(model.name)}": ${parts.join(', ')}`
}

function platformLines(status: WorkspaceStatus, harness?: Harness): string[] {
  // Compared as text: the server adds problem codes; any code this banner does not name falls through.
  const problem: string | undefined = status.platform.problem
  if (problem === 'untrusted_runtime') {
    return ['', "  Platform calls are refused: this runtime isn't trusted with the session (see workspace_status)."]
  }
  if (problem === 'invalid_url') {
    return ['', '  The platform URL is not usable (it must use HTTPS unless it is local); platform tools will report why.']
  }
  if (status.platform.urlSource === 'default') {
    return ['', `  Platform URL not set; using the local default. Sign in with ${commandFor('login', harness)} when needed.`]
  }
  return []
}

function noRoot(status: WorkspaceStatus): string {
  return [
    'Dethereal is active, but it has no project root here:',
    `  ${status.projectRootDetail ?? 'unknown reason'}.`,
    '  Start from the project directory, or set DETHEREAL_PROJECT_ROOT.'
  ].join('\n')
}

function orientation(status: WorkspaceStatus, harness?: Harness): string {
  const cmd = (id: string) => commandFor(id, harness)
  if (status.registry === 'unavailable') return noRoot(status)

  const lines: string[] = []
  if (status.modelCount === 0) {
    lines.push(
      'Dethereal threat modeling is active.',
      '',
      `  ${cmd('create')}   -- Create or import your first threat model`,
      `  ${cmd('status')}   -- Check connection and sign-in`,
      `  ${cmd('help')}     -- See all available commands`,
      '',
      '  Or describe your system in plain language, for example:',
      '  "a React frontend talking to a Go API with a PostgreSQL database"'
    )
    if (status.registry === 'invalid') {
      lines.push('', `  The model registry (.dethernety/models.json) could not be read (${status.registryProblem ?? 'io'}).`)
    }
  } else if (status.modelCount > 1) {
    lines.push(`Dethereal is active. ${status.modelCount} local threat models. Run ${cmd('status')} for details.`)
  } else {
    lines.push('Dethereal is active.', '', modelLine(status.models[0]!, status.settlement))
    if (status.suggestions.length > 0) {
      lines.push('', '  Suggested next:')
      for (const s of status.suggestions) lines.push(`  ${cmd(s.command)}   -- ${s.reason}`)
    }
  }
  if (status.settlement === 'on') lines.push('', `  ${SETTLEMENT_ON_LINE}`)
  else if (status.settlementSwitchNotOn) lines.push('', `  ${SETTLEMENT_SET_NOT_ON_LINE}`)
  lines.push(...platformLines(status, harness))
  return lines.join('\n')
}

function compactReminder(status: WorkspaceStatus): string {
  if (status.registry === 'unavailable') return noRoot(status)
  const lines = [
    'Dethereal state after compaction. Before continuing, re-read it: the workspace_status tool, then model_state get for the model you work on; do not rely on this summary alone.'
  ]
  if (status.registry === 'invalid') {
    lines.push(`  The model registry (.dethernety/models.json) could not be read (${status.registryProblem ?? 'io'}).`)
  } else if (status.modelCount === 0) {
    lines.push('  No threat model is registered in this project yet.')
  } else {
    for (const model of status.models.slice(0, COMPACT_MODEL_LIMIT)) lines.push(modelLine(model, status.settlement))
    const more = status.modelCount - Math.min(status.models.length, COMPACT_MODEL_LIMIT)
    if (more > 0) lines.push(`  ... and ${more} more`)
  }
  // Under the model lines, without a blank line: the reminder is one block.
  if (status.settlement === 'on') lines.push(`  ${SETTLEMENT_ON_LINE}`)
  else if (status.settlementSwitchNotOn) lines.push(`  ${SETTLEMENT_SET_NOT_ON_LINE}`)
  return lines.join('\n')
}

/**
 * The hook's stdout: one JSON object in the shape Claude-compatible hooks read; for OpenCode, whose
 * plugin hands the text to the session itself, the bare text.
 */
export function renderSessionStart(status: WorkspaceStatus, source: SessionSource, harness?: Harness): string {
  const additionalContext = source === 'compact' ? compactReminder(status) : orientation(status, harness)
  if (harness === 'opencode') return additionalContext
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } })
}
