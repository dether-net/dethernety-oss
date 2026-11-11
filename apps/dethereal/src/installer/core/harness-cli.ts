/**
 * The one place a harness's own CLI runs (`claude plugin …`, `codex …`, `opencode …`).
 *
 * The installer prefers each harness's CLI over writing its files, and runs it as
 * the git runner runs git:
 * - only a name from a closed set; the binary is resolved to an absolute path, from
 *   absolute PATH entries outside the project and the temp directories, and never
 *   from a `node_modules` folder entry (a package's own bin shadows nothing here). A
 *   global npm install links its bin into a `node_modules` tree, which is fine: only
 *   the PATH entry is judged;
 * - no shell; arguments are passed as a list, and any argument that came from
 *   input goes through `inputArg`, so it can never read as an option;
 * - its own process group, killed on timeout or on too much output;
 * - an environment built from a fixed pass-through list, with HOME set to the
 *   installer's home so the CLI and the installer's own reads agree;
 * - the CLI's stderr is never passed on whole: a failure is reported by code with
 *   the first line the CLI wrote there, made safe to show (`errorLine`), and JSON
 *   output is accepted only whole and only in the shape the caller expects.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { z } from 'zod'
import { NEUTRAL_DIR, safePathEntries } from '../../utils/git.js'
import { canonical, within } from '../../utils/project-root.js'
import { InstallerError } from './errors.js'
import type { InstallerEnv } from './paths.js'

export type HarnessCli = 'claude' | 'codex' | 'opencode'

/** Variables a harness CLI needs from the user's environment, and nothing else. */
const PASS_THROUGH = [
  'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // Set by doctor for its live OpenCode check, so OpenCode neither updates itself nor fetches models, and, outside a
  // project, reads no project configuration.
  'OPENCODE_DISABLE_AUTOUPDATE', 'OPENCODE_DISABLE_MODELS_FETCH', 'OPENCODE_DISABLE_PROJECT_CONFIG',
] as const

/** Pass-through variables that name a path. */
const PATH_VARS: ReadonlySet<string> = new Set([
  'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
])

/** Set for every run: no self-update in the middle of an install, no traffic it does not need. */
const FIXED_ENV = { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } as const

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_BYTES = 1024 * 1024

export interface HarnessCliOptions {
  env: InstallerEnv
  /** Working directory; the neutral root unless the command acts on a project. */
  cwd?: string
  /** The project a command acts on: PATH entries and binaries inside it are never used. */
  projectRoot?: string
  timeoutMs?: number
  maxBytes?: number
  /**
   * Take stdout through a file rather than a pipe (a CLI that cuts its output
   * short on a pipe): a private file in a fresh private folder, read once the CLI
   * exits, capped at `maxBytes`, and removed.
   */
  stdoutFile?: boolean
  /** Take stderr the same way and return it as `stderr`: for a check that reads a CLI's logs, never to show them. */
  stderrFile?: boolean
}

export interface HarnessCliResult {
  code: number
  stdout: string
  /** Only with `stderrFile` */
  stderr?: string
  failure?: 'spawn' | 'timeout' | 'overflow'
  /** When the CLI exited non-zero: the first line it wrote to stderr, made safe to show. */
  errorLine?: string
}

/** How much of a CLI's stderr is kept to find its error line. */
const STDERR_HEAD = 8 * 1024

/**
 * The first non-empty line of a CLI's error output, safe to show: no ANSI codes, the
 * home folder as `~`, every path as `<path>`, every URL as `<url>`, values of
 * secret-looking settings, bearer and known token prefixes and long hex or base64
 * runs as `<redacted>`, printable ASCII only, at most 200 characters. When in doubt,
 * redacted.
 */
export function errorLine(text: string, home: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const line = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '')
  if (!line) return undefined
  let s = home.length > 1 ? line.split(home).join('~') : line
  s = s
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\b(bearer|basic|token)\s+\S+/gi, '$1 <redacted>')
    .replace(/([\w.-]*(?:token|secret|password|passwd|pwd|key|auth|credential|session|cookie)[\w.-]*\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s)\]}'",;]+)/gi, '$1<redacted>')
    .replace(/\b(?:(?:sk|pk|rk)-|gh[pousr]_|github_pat_|xox[a-z]-|glpat-|(?:AKIA|ASIA)(?=[0-9A-Z]{12})|eyJ)[A-Za-z0-9_\-.]{6,}/g, '<redacted>')
    .replace(/(?:~|\.{1,2})?(?:\/[^\s'"`:;,()<>]+)+\/?/g, '<path>')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, '<redacted>')
  s = s.replace(/[^\x20-\x7e]/g, '?')
  return s.length > 200 ? `${s.slice(0, 197)}...` : s
}

/** A CLI run that failed, as the installer reports it: its label, and the CLI's own error line when it gave one. */
export function cliFailed(label: string, r: HarnessCliResult): InstallerError {
  return new InstallerError('harness_cli_failed', label, r.failure === 'timeout' ? 'it did not finish in time' : r.errorLine)
}

const isModuleBin = (entry: string) => entry.split(path.sep).includes('node_modules')

/** PATH entries a harness CLI may come from, and the child's PATH. */
export function harnessPath(projectRoot?: string): string[] {
  return safePathEntries(projectRoot).filter((entry) => !isModuleBin(entry))
}

/** The harness CLI's absolute path, or null when none is on the safe PATH entries. */
export function resolveHarnessCli(name: HarnessCli, projectRoot?: string): string | null {
  const root = projectRoot ? canonical(projectRoot) : undefined
  for (const entry of harnessPath(projectRoot)) {
    const candidate = path.join(entry, name)
    try {
      if (!fs.statSync(candidate).isFile()) continue
      fs.accessSync(candidate, fs.constants.X_OK)
    } catch {
      continue
    }
    const real = canonical(candidate)
    if (root && within(real, root)) continue
    return candidate
  }
  return null
}

/** The child's environment: HOME from the installer, the pass-through list, the fixed settings. */
export function harnessEnv(env: InstallerEnv, projectRoot?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { HOME: env.home, PATH: harnessPath(projectRoot).join(path.delimiter), ...FIXED_ENV }
  for (const key of PASS_THROUGH) {
    const value = env.vars[key]
    // A relative path would resolve against wherever the CLI runs (a project, for project commands).
    if (value !== undefined && (!PATH_VARS.has(key) || path.isAbsolute(value))) out[key] = value
  }
  return out
}

/**
 * A value that came from input (a marketplace name, a URL, a path), checked before
 * it becomes an argument: never empty, never option-like, no control characters.
 */
export function inputArg(value: string, label: string): string {
  // eslint-disable-next-line no-control-regex
  if (value.length === 0 || value.length > 4096 || value.startsWith('-') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new InstallerError('argument_refused', label)
  }
  return value
}

/** Run a harness CLI. Never throws for the child's own failure; never passes its stderr on (it returns it only with `stderrFile`). */
export function runHarnessCli(name: HarnessCli, args: readonly string[], options: HarnessCliOptions): Promise<HarnessCliResult> {
  const binary = resolveHarnessCli(name, options.projectRoot)
  if (!binary) return Promise.resolve({ code: -1, stdout: '', failure: 'spawn' })
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  type Sink = { file: string; fd: number }
  let out: { dir: string; stdout: Sink | null; stderr: Sink | null } | null = null
  if (options.stdoutFile || options.stderrFile) {
    let dir: string | null = null
    const opened: number[] = []
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-cli-'))
      fs.chmodSync(dir, 0o700)
      const sink = (name: string): Sink => {
        const file = path.join(dir!, name)
        const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
        opened.push(fd)
        return { file, fd }
      }
      out = { dir, stdout: options.stdoutFile ? sink('stdout') : null, stderr: options.stderrFile ? sink('stderr') : null }
    } catch {
      for (const fd of opened) try { fs.closeSync(fd) } catch { /* closed already */ }
      if (dir) fs.rmSync(dir, { recursive: true, force: true })
      return Promise.resolve({ code: -1, stdout: '', failure: 'spawn' })
    }
  }
  const sinks = () => (out ? [out.stdout, out.stderr].filter((s): s is Sink => s !== null) : [])
  const cleanup = () => {
    if (!out) return
    for (const s of sinks()) try { fs.closeSync(s.fd) } catch { /* closed already */ }
    fs.rmSync(out.dir, { recursive: true, force: true })
  }
  const fileOutput = (sink: Sink): string | null => {
    // Read at most one byte past the cap: what is still running cannot grow the read.
    const fd = fs.openSync(sink.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      const buf = Buffer.alloc(maxBytes + 1)
      let n = 0
      for (let r; n < buf.length && (r = fs.readSync(fd, buf, n, buf.length - n, n)) > 0;) n += r
      return n > maxBytes ? null : buf.subarray(0, n).toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  }

  return new Promise((resolve) => {
    let settled = false
    let size = 0
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    let errSize = 0
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binary, [...args], {
        cwd: options.cwd ?? NEUTRAL_DIR,
        env: harnessEnv(options.env, options.projectRoot),
        stdio: ['ignore', out?.stdout ? out.stdout.fd : 'pipe', out?.stderr ? out.stderr.fd : 'pipe'],
        // Its own process group, so a timeout also reaches the npm and git it started.
        detached: true,
      })
    } catch {
      cleanup()
      resolve({ code: -1, stdout: '', failure: 'spawn' })
      return
    }
    const finish = (result: HarnessCliResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(watch)
      cleanup()
      resolve(result)
    }
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const timer = setTimeout(() => {
      killGroup()
      finish({ code: -1, stdout: '', failure: 'timeout' })
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    // A file grows without back-pressure: its size is watched during the run, not only at the end.
    const watch = setInterval(() => {
      let grown = false
      try { grown = sinks().some((s) => fs.fstatSync(s.fd).size > maxBytes) } catch { /* closed by finish */ }
      if (grown) {
        killGroup()
        finish({ code: -1, stdout: '', failure: 'overflow' })
      }
    }, 100)
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        killGroup()
        finish({ code: -1, stdout: '', failure: 'overflow' })
        return
      }
      chunks.push(chunk)
    })
    // Only the head is kept, for the error line; the rest is read and dropped.
    child.stderr?.on('data', (chunk: Buffer) => {
      if (errSize < STDERR_HEAD) errChunks.push(chunk.subarray(0, STDERR_HEAD - errSize))
      errSize += chunk.length
    })
    child.on('error', () => finish({ code: -1, stdout: '', failure: 'spawn' }))
    // What it started may still hold the file open: nothing outlives the run.
    child.on('exit', () => { if (out) killGroup() })
    const failedLine = (code: number | null, errText?: string) => {
      if (code === 0) return {}
      const l = errorLine(errText ?? Buffer.concat(errChunks).toString('utf8'), options.env.home)
      return l ? { errorLine: l } : {}
    }
    child.on('close', (code) => {
      if (!out) return finish({ code: code ?? -1, stdout: Buffer.concat(chunks).toString('utf8'), ...failedLine(code) })
      const read = (s: Sink): string | null => {
        try {
          return fileOutput(s)
        } catch {
          return null
        }
      }
      const text = out.stdout ? read(out.stdout) : Buffer.concat(chunks).toString('utf8')
      const errText = out.stderr ? read(out.stderr) : undefined
      finish(text === null || errText === null ? { code: -1, stdout: '', failure: 'overflow' } : { code: code ?? -1, stdout: text, ...(errText !== undefined ? { stderr: errText } : {}), ...failedLine(code, errText) })
    })
  })
}

/**
 * Run a harness CLI that answers in JSON, and accept the answer only whole and
 * only in the expected shape: exit 0, stdout one JSON value, `schema` satisfied.
 * Anything else is `harness_cli_failed` with the command's label.
 */
export async function runHarnessJson<T>(name: HarnessCli, args: readonly string[], schema: z.ZodType<T>, label: string, options: HarnessCliOptions): Promise<T> {
  const r = await runHarnessCli(name, args, options)
  if (r.failure === 'spawn' && !resolveHarnessCli(name, options.projectRoot)) {
    throw new InstallerError('harness_cli_missing', name)
  }
  if (r.failure || r.code !== 0) throw cliFailed(label, r)
  let value: unknown
  try {
    value = JSON.parse(r.stdout)
  } catch {
    throw new InstallerError('harness_cli_failed', label)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new InstallerError('harness_cli_failed', label)
  return parsed.data
}
