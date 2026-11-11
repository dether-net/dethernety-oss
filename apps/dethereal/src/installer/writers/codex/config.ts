/**
 * Reading and filling Codex configuration for the writer: the server fragment the
 * bundle ships, whether Codex trusts a project, where our marketplace points, and
 * how many of the plugin's hooks the user has trusted. Only reads and pure text
 * work here; writes go through the installer core.
 */
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'smol-toml'
import { InstallerError } from '../../core/errors.js'
import { CODEX_MARKETPLACE_NAME, CODEX_PLUGIN_ID } from '../../core/manifest.js'
import { tomlString } from './toml-text.js'

/** The server table the installer owns in a Codex config. */
export const SERVER_TABLE = ['mcp_servers', 'dethereal'] as const
/** Hooks the plugin declares; trust is reported against this count. */
export const HOOK_COUNT = 8

const PLACEHOLDER = /<(node-abs|runtime|platform-url)>/g

export interface FragmentValues {
  /** The Node binary the server runs on (absolute). */
  node: string
  /** The installed runtime's directory (absolute). */
  runtime: string
  /** The validated platform URL. */
  platformUrl: string
}

/**
 * The bundle's `config.fragment.toml` with its placeholders filled. Each quoted
 * string holding a placeholder is rebuilt as a fully escaped TOML string, so no
 * value can end its string early or add a key.
 */
export function renderFragment(template: string, values: FragmentValues): string {
  const fill = { 'node-abs': values.node, runtime: values.runtime, 'platform-url': values.platformUrl }
  for (const v of [values.node, values.runtime]) if (!path.isAbsolute(v)) throw new InstallerError('argument_refused', 'config.fragment.toml')
  const out = template.replace(/"([^"\\\n]*)"/g, (whole, body: string) =>
    PLACEHOLDER.test(body) ? tomlString(body.replace(PLACEHOLDER, (_m, name: keyof typeof fill) => fill[name])) : whole)
  PLACEHOLDER.lastIndex = 0
  if (PLACEHOLDER.test(out)) throw new InstallerError('guard_failed', 'config.fragment.toml (a placeholder is left)')
  PLACEHOLDER.lastIndex = 0
  return out
}

/**
 * A deep copy with every table given the ordinary object prototype. The TOML parser returns
 * tables as null-prototype objects, which a structural compare (`isDeepStrictEqual`) reads as
 * unequal to a plain object parsed from elsewhere. Arrays and the dates the parser returns are
 * kept as they are; tables nested inside arrays are copied too.
 */
function plainTables<T>(value: T): T {
  if (Array.isArray(value)) return value.map(plainTables) as unknown as T
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  // Object.fromEntries defines each key as an own property, so a literal `__proto__` key stays
  // data and does not reset the new object's prototype.
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).map((k) => [k, plainTables((value as Record<string, unknown>)[k])])) as unknown as T
}

/** A parsed Codex config, or an empty one when the file is absent; a file that does not parse is refused. */
export function readConfig(bytes: Buffer | null, label: string): Record<string, unknown> {
  if (!bytes) return {}
  try {
    return plainTables(parse(bytes.toString('utf8')) as Record<string, unknown>)
  } catch {
    throw new InstallerError('parse_error', label)
  }
}

const table = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/** A folder's real path, or its resolved form when it does not exist. */
function realOrResolved(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return path.resolve(p)
  }
}

/** The nearest folder at or above `dir` holding `.git` (a folder, or a worktree's file), or null. */
function gitRootOf(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    try {
      lstatSync(path.join(d, '.git'))
      return d
    } catch {
      // Not here; one folder up.
    }
    if (path.dirname(d) === d) return null
  }
}

/** For a linked worktree (`.git` is a file), the main checkout its common git folder belongs to; otherwise null. */
function mainCheckoutOf(root: string): string | null {
  try {
    const dotGit = path.join(root, '.git')
    if (!lstatSync(dotGit).isFile()) return null
    const gitdir = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
    if (!gitdir) return null
    const own = path.resolve(root, gitdir)
    const common = path.resolve(own, readFileSync(path.join(own, 'commondir'), 'utf8').trim())
    return path.basename(common) === '.git' ? realOrResolved(path.dirname(common)) : null
  } catch {
    return null
  }
}

/**
 * Whether Codex loads `projectReal/.codex/` (a realpath), by its own rule: the trust setting of the
 * folder itself decides; without one, that of the project root (the nearest folder above holding
 * `.git`); for a linked worktree without either, that of its main checkout. A setting on any other
 * folder above does not count. With project root markers other than Codex's default, nothing is
 * assumed trusted.
 */
export function projectTrusted(userConfig: Record<string, unknown>, projectReal: string): boolean {
  const markers = userConfig.project_root_markers
  if (markers !== undefined && !(Array.isArray(markers) && markers.length === 1 && markers[0] === '.git')) return false
  const levels = new Map<string, unknown>()
  for (const [key, value] of Object.entries(table(userConfig.projects) ?? {})) {
    if (!path.isAbsolute(key)) continue
    const level = table(value)?.trust_level
    for (const k of new Set([path.resolve(key), realOrResolved(key)])) if (!levels.has(k)) levels.set(k, level)
  }
  const decide = (dir: string | null): boolean | null => {
    if (!dir || !levels.has(dir)) return null
    const level = levels.get(dir)
    return level === 'trusted' ? true : level === 'untrusted' ? false : null
  }
  const root = gitRootOf(projectReal)
  return decide(projectReal) ?? decide(root) ?? decide(root ? mainCheckoutOf(root) : null) ?? false
}

/** The source our marketplace name points at in the user config, if any. */
export function marketplaceSource(userConfig: Record<string, unknown>): string | null {
  const m = table(table(userConfig.marketplaces)?.[CODEX_MARKETPLACE_NAME])
  return typeof m?.source === 'string' ? m.source : null
}

/** Whether `source` is exactly the Codex bundle of a runtime version under `runtimeDir`; returns that version. */
export function runtimeOfSource(source: string, runtimeDir: string): string | null {
  const rel = path.relative(runtimeDir, source)
  const m = /^([^/]+)\/bundles\/codex$/.exec(rel.split(path.sep).join('/'))
  return m && path.join(runtimeDir, m[1]!, 'bundles', 'codex') === source ? m[1]! : null
}

/** The `hooks.state` keys Codex keeps for our plugin's hooks (trust entries). */
export function hookStateKeys(userConfig: Record<string, unknown>): string[] {
  const state = table(table(userConfig.hooks)?.state) ?? {}
  return Object.keys(state).filter((k) => k.startsWith(`${CODEX_PLUGIN_ID}:hooks/hooks.json:`)).sort()
}

export interface CodexHookTrust {
  /** Hooks trusted and switched on, in the configuration that counts. */
  trusted: number
  expected: number
  /** Hooks the user switched off (`enabled = false`). */
  disabled: number
  /** Hooks or plugins switched off as a whole (`[features] hooks/plugins = false`): nothing of ours runs. */
  featuresOff: boolean
  /** Codex's trust hashes cannot be checked here: a changed hook is caught by Codex, which asks again. */
  hashesVerified: false
  /** Profiles (`<name>.config.toml`) that hold their own trust for our hooks: it counts only when Codex runs with that profile. */
  profiles: Array<{ name: string; trusted: number; disabled: number }>
}

function trustIn(config: Record<string, unknown>): { trusted: number; disabled: number; featuresOff: boolean } {
  const state = table(table(config.hooks)?.state) ?? {}
  const keys = hookStateKeys(config)
  const disabled = keys.filter((k) => table(state[k])?.enabled === false).length
  const trusted = keys.filter((k) => typeof table(state[k])?.trusted_hash === 'string' && table(state[k])?.enabled !== false).length
  const features = table(config.features) ?? {}
  const featuresOff = features.hooks === false || features.codex_hooks === false || features.plugins === false
  return { trusted, disabled, featuresOff }
}

/**
 * The plugin's hook trust as Codex records it. The user config counts for a plain
 * run; a run with a profile (`codex -p <name>`) saves its trust in that profile's
 * file instead, so each profile file is reported on its own. Presence only: the
 * hashes are Codex's own and are not checked here.
 */
export function codexHookTrust(configBytes: Buffer | null, profileFiles: ReadonlyArray<{ name: string; bytes: Buffer }> = []): CodexHookTrust {
  const parse_ = (b: Buffer | null) => {
    try {
      return readConfig(b, 'config.toml')
    } catch {
      return null
    }
  }
  const base = parse_(configBytes)
  const t = base ? trustIn(base) : { trusted: 0, disabled: 0, featuresOff: false }
  const profiles = profileFiles.flatMap((p) => {
    const c = parse_(p.bytes)
    if (!c) return []
    const r = trustIn(c)
    return r.trusted || r.disabled ? [{ name: p.name, trusted: r.trusted, disabled: r.disabled }] : []
  })
  return { trusted: t.featuresOff ? 0 : t.trusted, expected: HOOK_COUNT, disabled: t.disabled, featuresOff: t.featuresOff, hashesVerified: false, profiles }
}

/**
 * The versions of Codex's background app-server Codex has installed for this user
 * (`packages/app-server-daemon/releases/<version>-<platform>`), from folder names
 * only. A running app-server serves sessions with the plugin it loaded at its start.
 */
export function codexAppServerVersions(codexHome: string): string[] {
  try {
    return readdirSync(path.join(codexHome, 'packages', 'app-server-daemon', 'releases'))
      .map((n) => /^(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)[0-9A-Za-z.]*)?)-/.exec(n)?.[1])
      .filter((v): v is string => !!v)
      .sort()
  } catch {
    return []
  }
}

/**
 * The platform URL the config pins for our server, and the variable it is in: the install writes it
 * to `DETHERNETY_PLATFORM_URL`; an older install wrote `DETHERNETY_URL`, which nothing overrides.
 */
export function serverUrlOf(config: Record<string, unknown>): { name: 'DETHERNETY_PLATFORM_URL' | 'DETHERNETY_URL'; url: string } | null {
  const env = table(table(table(config.mcp_servers)?.dethereal)?.env)
  if (typeof env?.DETHERNETY_URL === 'string') return { name: 'DETHERNETY_URL', url: env.DETHERNETY_URL }
  if (typeof env?.DETHERNETY_PLATFORM_URL === 'string') return { name: 'DETHERNETY_PLATFORM_URL', url: env.DETHERNETY_PLATFORM_URL }
  return null
}

/** Whether the config already defines our server in any form. */
export function hasServer(config: Record<string, unknown>): boolean {
  return table(config.mcp_servers)?.dethereal !== undefined
}
