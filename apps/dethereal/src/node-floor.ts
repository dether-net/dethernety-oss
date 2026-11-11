/**
 * The entry point's Node floor check, apart from the entry so it can be tested. It must stay safe
 * to load on an old Node: no imports, and syntax an old parser reads.
 */

/** The hooks that guard a tool call: on a Node too old to run them, they block the call. */
const GUARD_HOOKS = new Set(['secret-guard', 'config-guard'])

/** Whether `version` (x.y.z) is older than `floor`; an unreadable version counts as older. */
export function olderThan(version: string, floor: readonly number[]): boolean {
  const have = version.split('.').map((part) => parseInt(part, 10))
  for (let i = 0; i < floor.length; i++) if (have[i] !== floor[i]) return !(have[i]! > floor[i]!)
  return false
}

/**
 * How the entry stops on a Node older than `floor`, or null to run. Every command stops with exit
 * code 1 and the message, except a guard hook (`hook secret-guard`, `hook config-guard`): it stops
 * with exit code 2, which Claude Code reads as a block of the tool call, its message shown to the
 * model. Exit 1 there would be a non-blocking error, and the call would run unchecked.
 */
export function floorStop(version: string, floor: readonly number[], args: readonly string[]): { code: number; message: string } | null {
  if (!olderThan(version, floor)) return null
  const floorText = floor.join('.')
  if (args[0] === 'hook' && GUARD_HOOKS.has(args[1] ?? '')) {
    // The model relays this to the operator: what is needed, and the two ways out.
    return {
      code: 2,
      message: `Dethereal needs Node.js ${floorText} or newer (found ${version}), so its ${args[1]} can't check this call and blocks it. Update Node, or turn the Dethereal plugin off with /plugin.`,
    }
  }
  return { code: 1, message: `Dethereal needs Node.js ${floorText} or newer (running ${version}).` }
}
