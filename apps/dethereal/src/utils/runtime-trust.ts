/**
 * Whether this Node runtime can be trusted with the session's bearer.
 *
 * The bearer reaches the platform over TLS. A trust anchor or an OpenSSL
 * configuration the agent could have planted, a TLS key log, or TLS checks
 * turned off would let someone on the network read it: those are refused
 * (`tls`). Code loaded before this server started (a preload, an inspector, a
 * library injected by the loader) is refused as a tripwire (`tripwire`): it ran
 * before any check, and could have hidden itself, so the refusal asks for the
 * session to be signed out and revoked.
 *
 * "Agent-writable" is the project and the temporary directories (a sandboxed
 * agent may write both), compared by real path. A dependency's own file (under
 * a `node_modules` directory) is not judged: the package's tooling loads from
 * there. Computed once per process from its environment and options.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getProjectRoot, resolveProjectRoot } from './project-root.js'

export interface RuntimeProblem {
  /** `tls`: the connection could be read; `tripwire`: code ran before this server's checks */
  kind: 'tls' | 'tripwire'
  message: string
}

export interface RuntimeContext {
  env: NodeJS.ProcessEnv
  execArgv: readonly string[]
  execPath: string
  cwd: string
  projectRoot: string | null
}

const DEBUGGING = 'Platform calls stay refused under a debugger wherever the server runs (there is no bypass); local tools keep working. Attach a debugger only in a sandboxed dev plugin root (dev/dev-plugin-root.mjs) with a throwaway sign-in, never with a real session; to trace platform calls, set DEBUG=true.'
const REVOKE = 'This was found after the fact: sign out (logout) and revoke the session at the identity provider.'

/** NODE_OPTIONS split as Node splits it: on whitespace, with double quotes grouping and a backslash escaping inside them. */
export function nodeOptionTokens(value: string): string[] {
  const out: string[] = []
  let current = ''
  let started = false
  let quoted = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    if (quoted) {
      if (ch === '\\' && i + 1 < value.length) current += value[++i]
      else if (ch === '"') quoted = false
      else current += ch
    } else if (ch === '"') {
      quoted = true
      started = true
    } else if (/\s/.test(ch)) {
      if (started) out.push(current)
      current = ''
      started = false
    } else {
      current += ch
      started = true
    }
  }
  if (started) out.push(current)
  return out
}

/** Options that take a value (so `--x v` reads the next token), by their normalised name. */
const VALUED = new Set([
  '--require', '--import', '--loader', '--experimental-loader', '--env-file', '--env-file-if-exists', '--openssl-config',
  '--tls-keylog', '--snapshot-blob', '--diagnostic-dir', '--report-directory', '--report-dir', '--inspect-port',
  '--heapsnapshot-near-heap-limit', '--conditions', '-C', '-r',
])

/** The options given, normalised (`_` read as `-` in the name), each with its value when it takes one. */
export function nodeOptions(tokens: readonly string[]): Array<{ name: string; value?: string }> {
  const out: Array<{ name: string; value?: string }> = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (!t.startsWith('-')) continue
    const eq = t.indexOf('=')
    const rawName = eq < 0 ? t : t.slice(0, eq)
    const name = rawName.startsWith('--') ? `--${rawName.slice(2).replace(/_/g, '-')}` : rawName
    if (eq >= 0) out.push({ name, value: t.slice(eq + 1) })
    else if (VALUED.has(name) && i + 1 < tokens.length && !tokens[i + 1]!.startsWith('-')) out.push({ name, value: tokens[++i] })
    else out.push({ name })
  }
  return out
}

/** A path's real form: its nearest existing ancestor resolved (a symlinked parent included), the rest appended. */
function realish(p: string): string {
  let head = path.resolve(p)
  const tail: string[] = []
  while (!fs.existsSync(head)) {
    const parent = path.dirname(head)
    if (parent === head) break
    tail.unshift(path.basename(head))
    head = parent
  }
  let real = head
  try {
    real = fs.realpathSync.native(head)
  } catch {
    // keep the resolved form
  }
  return path.join(real, ...tail)
}

const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)

/** The places a sandboxed agent may write: the project and the temporary directories. */
export function agentWritableRoots(ctx: Pick<RuntimeContext, 'env' | 'projectRoot'>): string[] {
  const roots = [ctx.projectRoot, os.tmpdir(), '/tmp', '/var/tmp', '/dev/shm', ctx.env.TMPDIR].filter((r): r is string => !!r && path.isAbsolute(r))
  return [...new Set(roots.map(realish))]
}

/**
 * macOS's per-user temporary directory (`/var/folders/<x>/<y>/T`, real path under `/private/var`),
 * which `os.tmpdir()` names only while TMPDIR is set: a server started with a trimmed environment
 * would otherwise not count it.
 */
const DARWIN_USER_TEMP = /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T(?:\/|$)/

/** Whether a real path lies in macOS's per-user temporary directory. */
export const inDarwinUserTemp = (real: string): boolean => DARWIN_USER_TEMP.test(real)

/** Whether `p` (absolute, or relative to `cwd`) lies where an agent could have written it. */
export function agentWritable(p: string, ctx: Pick<RuntimeContext, 'env' | 'projectRoot' | 'cwd'>): boolean {
  const real = realish(path.isAbsolute(p) ? p : path.join(ctx.cwd, p))
  return inDarwinUserTemp(real) || agentWritableRoots(ctx).some((root) => within(real, root))
}

/** A preload's target as a path to judge, or a reason it is refused whatever it names. */
function preloadTarget(value: string): { path: string } | { refuse: string } {
  if (/^(data|https?):/i.test(value)) return { refuse: `a ${value.split(':')[0]!.toLowerCase()}: URL` }
  if (/^file:/i.test(value)) {
    try {
      return { path: fileURLToPath(value) }
    } catch {
      return { refuse: 'an unreadable file: URL' }
    }
  }
  return { path: value }
}

const isDependencyFile = (p: string) => p.split(/[\\/]/).includes('node_modules')

/** Why this runtime cannot be trusted with the bearer, or undefined. */
export function runtimeProblemOf(ctx: RuntimeContext): RuntimeProblem | undefined {
  const { env } = ctx
  const writable = (p: string) => agentWritable(p, ctx)
  const tls = (message: string): RuntimeProblem => ({ kind: 'tls', message })
  const tripwire = (message: string): RuntimeProblem => ({ kind: 'tripwire', message })

  // TLS: the connection itself.
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return tls('NODE_TLS_REJECT_UNAUTHORIZED=0 turns off TLS certificate checks, and the platform receives the session; unset it.')
  if (env.SSLKEYLOGFILE) return tls(`SSLKEYLOGFILE writes the TLS keys, so a capture could read the session; unset it. ${DEBUGGING}`)
  for (const name of ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENSSL_CONF', 'OPENSSL_MODULES', 'OPENSSL_ENGINES']) {
    const value = env[name]
    if (value && writable(value)) return tls(`${name} points into the project or a temporary directory, which an agent could have written; move it elsewhere (e.g. under your home directory or /etc) and point ${name} there.`)
  }

  const options = nodeOptions([...nodeOptionTokens(env.NODE_OPTIONS ?? ''), ...ctx.execArgv])
  for (const o of options) {
    if (o.name === '--tls-keylog') return tls(`--tls-keylog writes the TLS keys, so a capture could read the session; remove it. ${DEBUGGING}`)
    if (o.name === '--openssl-config' && o.value && writable(o.value)) return tls('--openssl-config points into the project or a temporary directory, which an agent could have written; move the file elsewhere.')
  }

  // Tripwires: code that ran, or could run, before this server's checks.
  for (const o of options) {
    if (['--inspect', '--inspect-brk', '--inspect-wait', '--inspect-port'].includes(o.name)) {
      return tripwire(`${o.name} lets any local process attach to this server and run code in it; remove it. ${DEBUGGING}`)
    }
    if (['--require', '-r', '--import', '--loader', '--experimental-loader', '--env-file', '--env-file-if-exists'].includes(o.name) && o.value) {
      const target = preloadTarget(o.value)
      if ('refuse' in target) return tripwire(`${o.name} loads ${target.refuse} before this server starts; remove it. ${REVOKE}`)
      if (!isDependencyFile(target.path) && writable(target.path)) {
        return tripwire(`${o.name} loads a file from the project or a temporary directory, which an agent could have written, before this server starts; remove it. ${REVOKE}`)
      }
    }
    if (o.name === '--snapshot-blob' && o.value && writable(o.value)) return tripwire(`--snapshot-blob loads a startup snapshot an agent could have written; remove it. ${REVOKE}`)
  }
  const dumps = options.filter((o) => o.name.startsWith('--heapsnapshot') || /^--report-(on|uncaught|compact)/.test(o.name))
  if (dumps.length) {
    const dir = options.find((o) => ['--diagnostic-dir', '--report-directory', '--report-dir'].includes(o.name))?.value ?? ctx.cwd
    if (writable(dir)) return tripwire(`${dumps[0]!.name} writes this server's memory or environment into the project or a temporary directory; remove it or point --diagnostic-dir elsewhere. ${DEBUGGING}`)
  }
  if (env.NODE_COMPILE_CACHE && writable(env.NODE_COMPILE_CACHE)) return tripwire(`NODE_COMPILE_CACHE points into the project or a temporary directory, where an agent could have planted compiled code; unset it. ${REVOKE}`)
  for (const name of ['LD_PRELOAD', 'DYLD_INSERT_LIBRARIES']) {
    const entries = (env[name] ?? '').split(/[:\s]+/).filter(Boolean)
    if (entries.some((e) => writable(e))) return tripwire(`${name} loads a library from the project or a temporary directory into this server; unset it. ${REVOKE}`)
  }
  if (writable(ctx.execPath)) return tripwire(`Node itself runs from the project or a temporary directory, which an agent could have written; run the server with a Node installed elsewhere. ${REVOKE}`)
  return undefined
}

let cached: { value: RuntimeProblem | undefined } | undefined

/** This process's verdict, computed once (a CA file is read at startup: a later swap only hides it). */
export function runtimeProblem(): RuntimeProblem | undefined {
  if (!cached) {
    cached = {
      value: runtimeProblemOf({
        env: process.env, execArgv: process.execArgv, execPath: process.execPath, cwd: process.cwd(),
        projectRoot: getProjectRoot()?.root ?? resolveProjectRoot().root,
      }),
    }
  }
  return cached.value
}

/** Tests only: compute the verdict again. */
export function resetRuntimeProblem(): void {
  cached = undefined
}
