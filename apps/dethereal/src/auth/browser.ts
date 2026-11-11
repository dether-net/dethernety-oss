/**
 * Opening the sign-in page.
 *
 * The launcher opens exactly one kind of URL, the local sign-in server's
 * `http://127.0.0.1:<port>/start`, which redirects to the provider; anything
 * else is refused before a process starts. It runs a fixed system launcher, never
 * a shell and never a binary from the project:
 * - macOS: `/usr/bin/open`;
 * - Windows: `rundll32.exe url.dll,FileProtocolHandler` under a drive-rooted
 *   `SystemRoot` outside the project (else `C:\Windows`);
 * - elsewhere: `xdg-open` from `/usr/bin` or `/usr/local/bin`, else from absolute
 *   PATH entries outside the project.
 * The child gets a small allowlisted environment (no `BROWSER`, no loader or Node
 * options; no path inside the project, and a session bus only as a plain socket
 * outside it), the home directory as its working directory (refused when that is
 * inside the project), and no stdio, so it can never write into the server's
 * JSON-RPC stream. Errors are fixed texts: they
 * never carry the URL, a path, or the launcher's own output.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { debug } from '../config.js'
import { canonical, getProjectRoot, within } from '../utils/project-root.js'
import { agentWritableRoots, inDarwinUserTemp } from '../utils/runtime-trust.js'
import { resolveBinary, safePathEntries } from '../utils/git.js'

const HINT = 'Sign-in needs a desktop browser on this machine; run login where one is available.'
const XDG_OPEN_FIXED = ['/usr/bin/xdg-open', '/usr/local/bin/xdg-open']

/** Environment variables a desktop launcher needs; nothing else reaches it. */
const PASSED_ENV = [
  'HOME', 'LANG', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'XDG_CURRENT_DESKTOP', 'XDG_DATA_DIRS',
  'XDG_CONFIG_HOME', 'XDG_CONFIG_DIRS', 'DESKTOP_SESSION', 'KDE_FULL_SESSION', 'DBUS_SESSION_BUS_ADDRESS',
  'SystemRoot', 'SystemDrive', 'windir', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'PATHEXT',
]

export interface LaunchCommand {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
}

export interface LaunchContext {
  platform?: NodeJS.Platform
  /** Where the passed variables come from (PATH always comes from the process) */
  env?: NodeJS.ProcessEnv
  projectRoot?: string
  home?: string
  /** Whether `file` is an executable regular file */
  isExecutable?: (file: string) => boolean
  resolve?: (name: string, projectRoot?: string) => string | null
}

/** The port of the local sign-in URL, or null for any other URL. */
export function signInPort(url: unknown): number | null {
  if (typeof url !== 'string') return null
  const m = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/start$/.exec(url)
  if (!m) return null
  const port = Number(m[1])
  return port <= 65535 && url === `http://127.0.0.1:${port}/start` ? port : null
}

function executable(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** A drive-rooted Windows directory with no relative segments, outside the project. */
function systemRoot(value: string | undefined, projectRoot: string | undefined): string {
  const fallback = 'C:\\Windows'
  if (!value || !/^[A-Za-z]:\\[^\\/:*?"<>|]+(?:\\[^\\/:*?"<>|]+)*\\?$/.test(value)) return fallback
  if (value.split('\\').some((part) => part === '.' || part === '..')) return fallback
  if (projectRoot) {
    const rel = path.win32.relative(projectRoot.toLowerCase(), value.toLowerCase())
    // Inside the project unless `..` or a path under it (a name merely starting with dots is inside).
    if (!rel || !(rel === '..' || rel.startsWith('..\\') || path.win32.isAbsolute(rel))) return fallback
  }
  return value.replace(/\\$/, '')
}

/**
 * Whether a path lies inside the project; a relative or empty one counts as inside. POSIX paths are compared
 * by real path; Windows paths case-insensitively, as written (as `systemRoot` compares them).
 */
function insideOf(projectRoot: string, platform: NodeJS.Platform): (p: string) => boolean {
  if (platform === 'win32') {
    const root = projectRoot.toLowerCase()
    return (p: string) => {
      if (!p || !path.win32.isAbsolute(p)) return true
      const rel = path.win32.relative(root, p.toLowerCase())
      // Outside is `..` or a path under it, never a name that merely starts with dots.
      return !(rel === '..' || rel.startsWith('..\\') || path.win32.isAbsolute(rel))
    }
  }
  const root = canonical(projectRoot)
  return (p: string) => !p || !path.isAbsolute(p) || within(canonicalExisting(p), root)
}

/** A path's real form: its nearest existing ancestor resolved (a symlinked parent included), the rest appended. */
function canonicalExisting(p: string): string {
  let head = path.resolve(p)
  const tail: string[] = []
  while (!fs.existsSync(head)) {
    const parent = path.dirname(head)
    if (parent === head) break
    tail.unshift(path.basename(head))
    head = parent
  }
  return path.join(canonical(head), ...tail)
}

/** Whether a path lies in a temporary directory (which a sandboxed agent may write), by real path. */
function insideTempDirs(): (p: string) => boolean {
  const roots = agentWritableRoots({ env: process.env, projectRoot: null })
  return (p: string) => {
    const real = canonicalExisting(p)
    return inDarwinUserTemp(real) || roots.some((r) => within(real, r))
  }
}

/** Variables naming one directory or file: dropped when it lies inside the project. */
const SINGLE_PATH_ENV = new Set(['XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'XAUTHORITY', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'])
/** Variables naming a list of directories: the entries inside the project are dropped. */
const PATH_LIST_ENV = new Set(['XDG_DATA_DIRS', 'XDG_CONFIG_DIRS'])

/**
 * A variable's value as the launcher may see it, or undefined to leave it out. Nothing the project
 * controls may reach it: paths inside the project are dropped, and a session bus address is passed
 * only as a plain socket outside the project (an address that runs a program, or points into the
 * project, would let the project answer the launcher's requests).
 */
function safeEnvValue(key: string, value: string, inside: (p: string) => boolean, platform: NodeJS.Platform): string | undefined {
  if (SINGLE_PATH_ENV.has(key)) return inside(value) ? undefined : value
  if (PATH_LIST_ENV.has(key)) {
    const kept = value.split(platform === 'win32' ? ';' : ':').filter((entry) => !inside(entry))
    return kept.length ? kept.join(platform === 'win32' ? ';' : ':') : undefined
  }
  if (key === 'DBUS_SESSION_BUS_ADDRESS') {
    // No `%`: the bus library unescapes it, so a checked path would not be the one it connects to.
    const m = /^unix:(path|abstract)=([^,;%]+)(,guid=[0-9a-f]{32})?$/.exec(value)
    if (!m) return undefined
    return m[1] === 'path' && inside(m[2]!) ? undefined : value
  }
  return value
}

/** The launcher for `url`, or an Error with a fixed message. */
export function launchCommand(url: string, context: LaunchContext = {}): LaunchCommand | Error {
  if (signInPort(url) === null) return new Error('Refused to open a browser: only the local sign-in page can be opened.')
  const platform = context.platform ?? process.platform
  const source = context.env ?? process.env
  const projectRoot = context.projectRoot ?? getProjectRoot()?.root ?? process.cwd()
  const isExecutable = context.isExecutable ?? executable
  const resolve = context.resolve ?? resolveBinary
  const home = context.home ?? os.homedir()

  // A home inside the project would let the project supply the launcher's configuration (mimeapps.list,
  // .desktop files, a working directory searched for libraries): refuse outright.
  const inside = insideOf(projectRoot, platform)
  for (const h of [home, source.HOME, ...(platform === 'win32' ? [source.USERPROFILE] : [])]) {
    if (h && inside(h)) return new Error(`Refused to open a browser: the home directory is inside the project. ${HINT}`)
  }
  const env: NodeJS.ProcessEnv = {}
  for (const key of PASSED_ENV) {
    const value = source[key]
    if (value === undefined) continue
    const safe = safeEnvValue(key, value, inside, platform)
    if (safe !== undefined) env[key] = safe
  }
  // PATH as the git runner reads it, less the temporary directories an agent may write.
  const tempDir = insideTempDirs()
  env.PATH = safePathEntries(projectRoot).filter((entry) => !tempDir(entry)).join(path.delimiter)
  const cwd = home || (platform === 'win32' ? 'C:\\' : '/')

  if (platform === 'darwin') return { file: '/usr/bin/open', args: [url], env, cwd }
  if (platform === 'win32') {
    const root = systemRoot(source.SystemRoot, projectRoot)
    env.SystemRoot = root
    return { file: path.win32.join(root, 'System32', 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', url], env, cwd }
  }
  const found = XDG_OPEN_FIXED.find(isExecutable) ?? resolve('xdg-open', projectRoot)
  const file = found && !tempDir(found) ? found : null
  if (!file) return new Error(`Failed to open browser: no browser launcher found. ${HINT}`)
  return { file, args: [url], env, cwd }
}

function spawnFailure(code: unknown): Error {
  if (code === 'ENOENT') return new Error(`Failed to open browser: no browser launcher found. ${HINT}`)
  if (code === 'EACCES' || code === 'EPERM') return new Error(`Failed to open browser: the browser launcher could not be started. ${HINT}`)
  return new Error(`Failed to open browser. ${HINT}`)
}

/**
 * Open the local sign-in page in the default browser. Resolves once the
 * launcher has started; rejects with a fixed message when it cannot start.
 *
 * @param url - the local sign-in URL, `http://127.0.0.1:<port>/start`
 */
export async function openBrowser(url: string, context: LaunchContext & { spawn?: typeof nodeSpawn } = {}): Promise<void> {
  debug('Opening browser for sign-in')
  const command = launchCommand(url, context)
  if (command instanceof Error) throw command
  const spawn = context.spawn ?? nodeSpawn
  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof nodeSpawn>
    try {
      child = spawn(command.file, command.args, {
        cwd: command.cwd,
        env: command.env,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        shell: false,
      })
    } catch (error) {
      reject(spawnFailure((error as NodeJS.ErrnoException | undefined)?.code))
      return
    }
    // Kept for the child's lifetime: a later error must never go unhandled.
    child.on('error', (error: NodeJS.ErrnoException) => reject(spawnFailure(error.code)))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
  debug('Browser opened successfully')
}

/**
 * Build an OAuth authorization URL
 *
 * @param params - URL parameters
 * @returns Complete authorization URL
 */
export function buildAuthorizationUrl(params: {
  authorizeEndpoint: string
  clientId: string
  redirectUri: string
  scope: string
  codeChallenge: string
  state: string
  additionalParams?: Record<string, string>
}): string {
  const url = new URL(params.authorizeEndpoint)

  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', params.scope)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.state)

  // Add any additional parameters
  if (params.additionalParams) {
    for (const [key, value] of Object.entries(params.additionalParams)) {
      url.searchParams.set(key, value)
    }
  }

  return url.toString()
}
