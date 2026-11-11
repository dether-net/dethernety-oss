/**
 * `hook approve`: a Claude Code PreToolUse hook that approves the Dethereal tools the tool manifest
 * marks `auto` — tools that only read, or whose every change the server validates — so Claude asks
 * for them no more than Codex or OpenCode do. A skill's `allowed-tools` would approve them only
 * until the operator's next message.
 *
 * It approves those exact tool names, and the calls of `AUTO_ACTIONS` that record nothing, and nothing
 * else. For any other tool or action, a malformed event or an error it prints nothing, and the harness
 * asks as usual; it never denies and never asks. The operator's own deny and ask rules still apply over it.
 *
 * Its only imports are the tool manifest, which is plain data, and the settlement switch.
 */

import { TOOL_MANIFEST } from '../tools/manifest.js'
import { SETTLEMENT_ONLY_TOOLS, settlementOn, type SettlementMode } from '../utils/settlement-switch.js'

/** How Claude Code names a tool of this plugin's MCP server. */
export const CLAUDE_MCP_PREFIX = 'mcp__plugin_dethereal_dethereal__'

/** The manifest's auto-approved tools, by manifest name. */
export const AUTO_TOOLS: readonly string[] = TOOL_MANIFEST.filter((t) => t.approval === 'auto').map((t) => t.name)

const APPROVED = new Set(AUTO_TOOLS.map((name) => `${CLAUDE_MCP_PREFIX}${name}`))

/**
 * Tools that ask, but not for these actions: a settlement's prepare checks the decisions and records nothing in the
 * model (on a fresh machine it may create this machine's key and the model's lock file), and its commit, which
 * records them, still asks.
 */
export const AUTO_ACTIONS: Readonly<Record<string, readonly string[]>> = { model_state_settle: ['prepare'] }

/** The auto actions of a server with the settlement on or off: with it off, its tools are not served. */
export const autoActions = (on: boolean): Readonly<Record<string, readonly string[]>> =>
  (on ? AUTO_ACTIONS : Object.fromEntries(Object.entries(AUTO_ACTIONS).filter(([name]) => !SETTLEMENT_ONLY_TOOLS.includes(name))))

const approvedActions = (on: boolean) =>
  new Map(Object.entries(autoActions(on)).map(([name, actions]) => [`${CLAUDE_MCP_PREFIX}${name}`, new Set(actions)]))
const APPROVED_ACTIONS = { on: approvedActions(true), off: approvedActions(false) }

/** The hook's stdout for a PreToolUse event: an allow for an auto tool, otherwise nothing. `settlement`: the hook's mode. */
export function approveOutput(raw: string | null, settlement?: SettlementMode): string {
  if (!raw) return ''
  let event: unknown
  try {
    event = JSON.parse(raw)
  } catch {
    return ''
  }
  const tool = event && typeof event === 'object' ? (event as Record<string, unknown>).tool_name : undefined
  if (typeof tool !== 'string') return ''
  if (APPROVED.has(tool)) return allow('Dethereal: this tool only reads, or the server validates every change it makes.')
  const input = (event as Record<string, unknown>).tool_input
  const action = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).action : undefined
  if (typeof action === 'string' && APPROVED_ACTIONS[settlementOn(settlement) ? 'on' : 'off'].get(tool)?.has(action)) {
    return allow('Dethereal: this call checks the decisions and records nothing in the model; the commit that records them asks.')
  }
  return ''
}

function allow(reason: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: reason } })
}
