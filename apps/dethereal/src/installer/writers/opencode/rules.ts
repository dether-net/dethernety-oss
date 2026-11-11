/**
 * OpenCode's own rules, as the writer and doctor need them: which versions Dethereal was checked
 * with, and how OpenCode decides a permission (the last matching rule wins, `ask` when none does).
 */

/** The oldest OpenCode the bundle was checked with. */
export const OPENCODE_FLOOR = '1.18.32'
/**
 * The OpenCode versions the bundle was checked with, oldest first.
 *
 * Adding a version: run `scripts/smoke-opencode.mjs --installed` with that OpenCode binary pinned
 * (a copy, never one that updates itself) and get every check passing; then append it here and set
 * the smoke script's OPENCODE_VERSION to it (a test ties the two). The plugin relies on hooks
 * OpenCode marks experimental, so a version is added only after that run.
 *
 * Also check, with a local MCP server that records its environment, that OpenCode still starts it
 * with its own environment under the entry's: a DETHERNETY_URL exported in the shell must reach it
 * and win over the entry's DETHERNETY_PLATFORM_URL, and a DETHERNETY_URL in a project's `.env`,
 * `.env.local` or `.env.<mode>` must not reach it.
 */
export const OPENCODE_VERIFIED: readonly string[] = ['1.18.32', '1.18.33', '1.18.34']

const parts = (v: string): number[] | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const compare = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!

export type VersionVerdict =
  | { readonly install: true; readonly note?: string; readonly unverified: boolean }
  | { readonly install: false; readonly reason: string }

/**
 * Whether to install for this OpenCode. Below the floor: never. A version the bundle was checked
 * with: yes. A newer one: only when the operator allows an unverified version, since the plugin
 * relies on hooks OpenCode marks experimental. No OpenCode found: the files can still be written.
 */
export function versionGate(version: string | null, allowUnverified = false): VersionVerdict {
  if (version === null) return { install: true, unverified: true, note: 'OpenCode was not found; its files are written, and checked when it runs.' }
  const v = parts(version)
  if (!v) return { install: false, reason: `OpenCode reported a version Dethereal cannot read (${version.slice(0, 40)}).` }
  const shown = v.join('.')
  if (compare(v, parts(OPENCODE_FLOOR)!) < 0) return { install: false, reason: `OpenCode ${shown} is older than ${OPENCODE_FLOOR}, the oldest Dethereal works with; update OpenCode.` }
  if (OPENCODE_VERIFIED.includes(shown)) return { install: true, unverified: false }
  const newest = OPENCODE_VERIFIED.at(-1)!
  if (!allowUnverified) {
    return { install: false, reason: `OpenCode ${shown} is newer than the versions Dethereal was checked with (up to ${newest}); its plugin relies on hooks OpenCode may change. Install with --allow-unverified-opencode to go ahead.` }
  }
  return { install: true, unverified: true, note: `OpenCode ${shown} is newer than the versions Dethereal was checked with (up to ${newest}).` }
}

/**
 * The OpenCode version as doctor reports it: older than the floor fails; a checked version is ok; a
 * newer one warns (installed and working, not yet checked: OpenCode updates itself, so this is the
 * common case a while after an install); no OpenCode found warns.
 */
export function versionStatus(version: string | null): { status: 'ok' | 'warn' | 'fail'; detail?: string } {
  if (version === null) return { status: 'warn', detail: 'OpenCode was not found' }
  const v = parts(version)
  if (!v) return { status: 'fail', detail: `OpenCode reported a version Dethereal cannot read (${version.slice(0, 40)})` }
  const shown = v.join('.')
  if (compare(v, parts(OPENCODE_FLOOR)!) < 0) return { status: 'fail', detail: `OpenCode ${shown} is older than ${OPENCODE_FLOOR}, the oldest Dethereal works with: update OpenCode` }
  if (OPENCODE_VERIFIED.includes(shown)) return { status: 'ok' }
  return { status: 'warn', detail: `OpenCode ${shown} is newer than the versions Dethereal was checked with (up to ${OPENCODE_VERIFIED.at(-1)}): it is installed and should work, but is not yet checked` }
}

/**
 * OpenCode's wildcard: backslashes read as slashes, `*` any run and `?` one character (both across
 * `/`), a trailing " *" also matching nothing after it, anchored, case-sensitive.
 */
export function wildcard(subject: string, pattern: string): boolean {
  const s = subject.replaceAll('\\', '/')
  let p = pattern.replaceAll('\\', '/')
  const optionalTail = p.endsWith(' *')
  if (optionalTail) p = p.slice(0, -2)
  let body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')
  if (optionalTail) body += '( .*)?'
  return new RegExp(`^${body}$`, 's').test(s)
}

export interface Rule {
  readonly permission: string
  readonly pattern: string
  readonly action: string
}

/** The action OpenCode takes for a permission and pattern: the last matching rule's, else ask. */
export function lastMatch(rules: readonly Rule[], permission: string, pattern: string): string {
  const hit = rules.findLast((r) => wildcard(permission, r.permission) && wildcard(pattern, r.pattern))
  return hit ? hit.action : 'ask'
}

/** A permission pattern with OpenCode's home spellings (`~`, `~/`, `$HOME`) written out. */
export function expandHome(pattern: string, home: string): string {
  if (pattern === '~' || pattern === '$HOME') return home
  if (pattern.startsWith('~/')) return home + pattern.slice(1)
  if (pattern.startsWith('$HOME/')) return home + pattern.slice(5)
  return pattern
}
