/**
 * Whether this server holds values to the operator's registrations (the settlement): off unless the operator turns it
 * on. With it off, the settle tool is not served, nothing is registered, and neither unregistered values nor pending
 * enrichment block REVIEWED or a push; Gates 2 and 3, the waivers and the orphaned-file prune stay.
 *
 * It is on only for the exact value `on` in the environment. A hook is on as well when its command carries
 * `--settlement`: the generator turns a bundle's settlement on that way where the harness gives hooks no environment.
 * A tool call may name the mode itself (`ToolContext.settlement`): the acceptance scorer replays a run with the mode
 * the run's server had.
 */
import { manifestToolNames } from '../tools/manifest.js'

export const SETTLEMENT_ENV = 'DETHEREAL_SETTLEMENT'
export const SETTLEMENT_ON = 'on'
export const SETTLEMENT_FLAG = '--settlement'

/** Whether a server had the settlement switched on (`DETHEREAL_SETTLEMENT`). */
export type SettlementMode = 'on' | 'off'

/** The tools the server lists only with the settlement on. */
export const SETTLEMENT_ONLY_TOOLS: readonly string[] = ['model_state_settle']

/** The tools a server lists with the settlement off, as it ships. */
export const shippedToolNames = (): string[] => manifestToolNames().filter((t) => !SETTLEMENT_ONLY_TOOLS.includes(t))

/** The caller's mode when it names one; otherwise the environment's, read now. */
export function settlementOn(mode?: SettlementMode, env: NodeJS.ProcessEnv = process.env): boolean {
  if (mode !== undefined) return mode === SETTLEMENT_ON
  return env[SETTLEMENT_ENV] === SETTLEMENT_ON
}

/**
 * A hook's mode from its arguments: on when the command carries the flag; otherwise its environment decides. The flag
 * can only turn the settlement on: a hook that reads on while its server reads off shows more than the server holds
 * to, never less.
 */
export function hookSettlement(args: readonly string[]): SettlementMode | undefined {
  return args.includes(SETTLEMENT_FLAG) ? 'on' : undefined
}

/**
 * A value of the variable that is neither unset nor `on`, an empty one included: the server says once that it reads as
 * off. The value itself is never echoed, since a repository's own settings can set it.
 */
export function settlementEnvProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env[SETTLEMENT_ENV]
  if (v === undefined || v === SETTLEMENT_ON) return null
  return `${SETTLEMENT_ENV} is set to a value other than "${SETTLEMENT_ON}": the settlement is off`
}
