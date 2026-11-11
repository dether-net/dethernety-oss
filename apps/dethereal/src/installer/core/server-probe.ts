/**
 * Starting the installed server for doctor, and asking it how it sees itself.
 *
 * The only process this file starts is a checked Node binary, with exactly one of
 * two argument lists: `--version`, or the server's own entry file (no argument
 * after it, so nothing reaches the server's command line). The caller builds the
 * launch from the installer's own verified state, never from a harness's
 * configuration. The environment is cut to a fixed list, so nothing a config sets
 * (NODE_OPTIONS, a loader path, a debug switch) reaches the child.
 *
 * The probe speaks MCP over stdio: `initialize`, `tools/list`, then `auth_status`
 * with `verify: false` (read-only: it never refreshes or rewrites a session),
 * repeated until the server has loaded the platform's configuration or the time
 * runs out. Output is capped, the child gets its own process group, and the group
 * is killed at the end. Its stderr is never read.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { checkExecPath } from './runtime.js'
import type { InstallerEnv } from './paths.js'

/** Variables the server may get; anything else is dropped. */
const ENV_ALLOW: ReadonlySet<string> = new Set([
  'HOME', 'PATH', 'LANG', 'TMPDIR', 'DETHERNETY_URL', 'DETHERNETY_PLATFORM_URL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
])
const MAX_BYTES = 1024 * 1024
const MAX_LINE = 64 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const AUTH_WAIT_MS = 10_000
const AUTH_POLL_MS = 250

export interface ProbeLaunch {
  /** A Node binary; checked before it runs. */
  node: string
  /** The server's `dist/index.js` (absolute). */
  entry: string
  cwd: string
  env: Readonly<Record<string, string>>
}

export interface ProbeAuth {
  platformUrl?: string
  urlSource?: string
  projectRoot?: string | null
  /** False when the server never reached the platform within the wait. */
  reachable: boolean
  authenticated: boolean
  email?: string
}

export interface ProbeResult {
  started: boolean
  tools?: string[]
  auth?: ProbeAuth
  failure?: 'spawn' | 'timeout' | 'overflow' | 'protocol' | 'exit'
}

interface Child {
  write(line: string): void
  lines(): AsyncGenerator<string>
  end(): Promise<void>
  exited: Promise<void>
  failure(): ProbeResult['failure'] | undefined
}

/** The one process start: a checked node, with `--version` or the server entry, nothing else. */
async function spawnNode(node: string, argv: readonly ['--version'] | readonly [string], env: Readonly<Record<string, string>>, cwd: string,
  installer: InstallerEnv, timeoutMs: number): Promise<Child> {
  await checkExecPath(node, installer)
  if (argv[0] !== '--version' && (!path.isAbsolute(argv[0]) || !argv[0].endsWith(`${path.sep}dist${path.sep}index.js`))) throw new Error('entry')
  const childEnv: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) if (ENV_ALLOW.has(k)) childEnv[k] = v
  const child = spawn(node, [...argv], { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'ignore'], detached: true })
  let failure: ProbeResult['failure']
  const kill = () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
  const timer = setTimeout(() => { failure ??= 'timeout'; kill() }, timeoutMs)
  const exited = new Promise<void>((resolve) => child.on('close', () => { clearTimeout(timer); resolve() }))
  child.on('error', () => { failure ??= 'spawn' })
  let size = 0
  let buffered = ''
  const queue: string[] = []
  let wake: (() => void) | null = null
  let done = false
  child.stdout!.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size > MAX_BYTES) { failure ??= 'overflow'; kill(); return }
    buffered += chunk.toString('utf8')
    let i: number
    while ((i = buffered.indexOf('\n')) >= 0) { queue.push(buffered.slice(0, i)); buffered = buffered.slice(i + 1) }
    if (buffered.length > MAX_LINE) { failure ??= 'overflow'; kill() }
    wake?.()
  })
  child.stdout!.on('close', () => { done = true; wake?.() })
  return {
    write: (line) => { if (child.stdin!.writable) child.stdin!.write(line + '\n') },
    async *lines() {
      for (;;) {
        if (queue.length) { yield queue.shift()!; continue }
        if (done) return
        await new Promise<void>((r) => { wake = r })
        wake = null
      }
    },
    async end() {
      child.stdin!.end()
      await Promise.race([exited, new Promise((r) => setTimeout(r, 1000))])
      kill()
      await exited
    },
    exited,
    failure: () => failure,
  }
}

/** The Node binary's own version, or null when it cannot be run. */
export async function nodeVersion(node: string, installer: InstallerEnv, cwd: string): Promise<string | null> {
  let child: Child
  try {
    child = await spawnNode(node, ['--version'], { PATH: '/usr/bin:/bin' }, cwd, installer, 5000)
  } catch {
    return null
  }
  let first: string | undefined
  for await (const line of child.lines()) { first ??= line; }
  await child.exited
  const m = first ? /^v(\d+\.\d+\.\d+)\s*$/.exec(first) : null
  return m ? m[1]! : null
}

/** Start the server, list its tools and read its view of the platform and the session. */
export async function probeServer(launch: ProbeLaunch, installer: InstallerEnv, opts: { timeoutMs?: number; clientVersion?: string } = {}): Promise<ProbeResult> {
  let child: Child
  try {
    child = await spawnNode(launch.node, [launch.entry], launch.env, launch.cwd, installer, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  } catch {
    return { started: false, failure: 'spawn' }
  }
  const lines = child.lines()
  let nextId = 1
  const call = async (method: string, params: unknown): Promise<Record<string, unknown> | null> => {
    const id = nextId++
    child.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    for (;;) {
      const { value, done } = await lines.next()
      if (done) return null
      let msg: { id?: unknown; result?: unknown; error?: unknown }
      try {
        msg = JSON.parse(value) as typeof msg
      } catch {
        continue
      }
      if (msg.id !== id) continue
      return msg.result && typeof msg.result === 'object' ? (msg.result as Record<string, unknown>) : null
    }
  }
  const result: ProbeResult = { started: false }
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dethereal-doctor', version: opts.clientVersion ?? '0' } })
    if (!init) return { ...result, failure: child.failure() ?? 'protocol' }
    result.started = true
    child.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    const listed = await call('tools/list', {})
    const tools = Array.isArray(listed?.tools) ? (listed!.tools as Array<{ name?: unknown }>).map((t) => String(t.name)) : null
    if (!tools) return { ...result, failure: child.failure() ?? 'protocol' }
    result.tools = tools
    const deadline = Date.now() + AUTH_WAIT_MS
    for (;;) {
      const r = await call('tools/call', { name: 'auth_status', arguments: { verify: false } })
      const text = Array.isArray(r?.content) ? (r!.content as Array<{ text?: unknown }>).map((c) => (typeof c.text === 'string' ? c.text : '')).join('') : ''
      // A tool's data is the whole result text; an error comes back flagged, as `{ error, data }`.
      let data: Record<string, unknown> | null = null
      try {
        const parsed = JSON.parse(text) as unknown
        data = !r?.isError && parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { authenticated?: unknown }).authenticated === 'boolean'
          ? (parsed as Record<string, unknown>) : null
      } catch {
        data = null
      }
      if (!data) return { ...result, failure: child.failure() ?? 'protocol' }
      const reachable = data.authDisabled !== null && data.authDisabled !== undefined
      if (reachable || Date.now() > deadline) {
        result.auth = {
          ...(typeof data.platformUrl === 'string' ? { platformUrl: data.platformUrl } : {}),
          ...(typeof data.urlSource === 'string' ? { urlSource: data.urlSource } : {}),
          ...(typeof data.projectRoot === 'string' || data.projectRoot === null ? { projectRoot: data.projectRoot as string | null } : {}),
          reachable,
          authenticated: data.authenticated === true,
          ...(typeof data.email === 'string' ? { email: data.email } : {}),
        }
        return result
      }
      await new Promise((r) => setTimeout(r, AUTH_POLL_MS))
    }
  } finally {
    await child.end()
  }
}
