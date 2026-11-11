#!/usr/bin/env node
/* global process, setTimeout, clearTimeout, Buffer, URL */
/**
 * Codex hook runner for Dethereal's session-start, post-write and guard hooks.
 *
 * It runs the hook in the installed runtime, and only after checking it (`runtime-check.mjs`): the
 * record in `~/.dethernety/runtime/current.json`, the runtime's whole file set and the Node binary. The
 * child gets the event on stdin and a deadline below the hook's own timeout; its output is passed on
 * only when it exits cleanly, and a guard's output only when it is empty or a well-formed decision.
 *
 * When the runtime cannot be used (tampered, missing or unverifiable), the two guards still judge the
 * call by name (`secret-fallback.mjs`): a shell command or a patch that names a secret file or
 * guarded configuration (Codex's config and plugins, Claude Code's settings and plugin cache,
 * Dethereal's state) is refused, a plain read of a plugin file included; anything else goes
 * through. A tampered runtime is never run. When the runtime is sound but its guard fails or does
 * not answer in time, the call is refused: a guard that
 * can be made to stall must not fall back to a check by name. session-start says what is degraded;
 * post-write does nothing. Exit code 0 always.
 *
 * Before any of that, two checks on a shell command (`shell-check.mjs`), which need no runtime:
 * from any caller, a command that runs input sent to it later is refused, since Codex sends that
 * input (`write_stdin`) with no hook to check it; and a Dethereal agent that may not change files
 * (its `leaf-allowlist.json` entry has no `write: true`) runs only commands that read, since Codex's
 * sandbox setting for an agent may not cover its shell. The second fails closed for a Dethereal
 * caller: an unreadable event, list or check refuses the command.
 *
 * Codex gives a hook its session's environment, not the server's: the platform URL the install set
 * reaches only the server. So before session-start, and only then, the runner asks Codex which URL
 * variables it gives Dethereal's server from this folder (`codex mcp list --json`, every trusted
 * configuration layer merged) and gives the hook the same, so the hook and the server agree on the
 * URL and on a `DETHERNETY_URL` from the shell winning. When Codex cannot say within the time limit,
 * the hook gets the session's environment unchanged. Not seen from here: a `-p` profile, `-c`
 * overrides and managed configuration, which Codex does not pass to hooks.
 */
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

const GUARDS = new Set(['secret-guard', 'config-guard'])
const EVENT_MAX_BYTES = 32 * 1024 * 1024
const EVENT_TIMEOUT_MS = 3000
const OUTPUT_MAX_BYTES = 64 * 1024
const DEFAULT_DEADLINE_MS = 8000
const SERVER_ENV_TIMEOUT_MS = 5000
const SERVER_ENV_MAX_BYTES = 1024 * 1024
const URL_KEYS = ['DETHERNETY_PLATFORM_URL', 'DETHERNETY_URL']

const args = process.argv.slice(2)
const sub = args[0] ?? ''
const isGuard = GUARDS.has(sub)

let output = ''
function write(text) {
  if (text) output += text
}

/** Print what was collected, then exit once it is flushed (stdout may be a pipe). */
function finish() {
  if (!output) process.exit(0)
  process.stdout.write(output, () => process.exit(0))
}

function deny(reason) {
  write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Dethereal: ${reason}` } }))
}

function sessionContext(text) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })
}

const UNCHECKED = "this call could not be checked for secret files (Dethereal's guard failed or took too long), so it is not run. Report this to the operator; do not reach the file another way."
const FIX = 'reinstall with `npx @dether.net/dethereal@<version> install` in your terminal, or remove the plugin with `codex plugin remove dethereal@dethereal-local`'
const NOTICE = {
  tampered: `Dethereal's runtime failed its integrity check and is not run; its guards only refuse secret files and Dethereal's configuration by name. To fix: ${FIX}.`,
  unverifiable: `Dethereal's runtime could not be verified; its guards only refuse secret files and Dethereal's configuration by name. To fix: ${FIX}.`,
  nodeFallback: "The Node binary Dethereal was installed with is gone, so Dethereal's MCP server will not start. To fix: re-run the install.",
}

/** The event from stdin, whole, or null when it is too large or not delivered in time. */
function readEvent() {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      resolve(v)
    }
    setTimeout(() => finish(null), EVENT_TIMEOUT_MS).unref()
    process.stdin.on('data', (c) => {
      size += c.length
      if (size > EVENT_MAX_BYTES) return finish(null)
      chunks.push(c)
    })
    process.stdin.on('end', () => finish(Buffer.concat(chunks)))
    process.stdin.on('error', () => finish(null))
  })
}

const AGENT_TYPE = /"agent_type"\s*:\s*"(dethereal-[^"\\]*)"/

/** The refusal of a shell command that runs input sent later (any caller), or does more than read (a read-only Dethereal agent); or null. */
async function shellRefusal(event) {
  const text = event.toString('utf8')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  const input = parsed && typeof parsed === 'object' && parsed.tool_input && typeof parsed.tool_input === 'object' ? parsed.tool_input : {}
  let shell
  try {
    shell = await import('./shell-check.mjs')
  } catch {
    shell = undefined
  }
  const later = shell?.runsLaterInput(shell.commandText(input.command))
  if (later) return `this command runs what is sent to it later, which no hook checks: ${later}. Run each command on its own`
  const agent = parsed && typeof parsed === 'object' && typeof parsed.agent_type === 'string' ? parsed.agent_type : (AGENT_TYPE.exec(text)?.[1] ?? '')
  if (!agent.startsWith('dethereal-')) return null
  if (!parsed || typeof parsed !== 'object') return `${agent}: this call could not be read, so it is not run`
  let entry
  try {
    const list = JSON.parse(readFileSync(new URL('./leaf-allowlist.json', import.meta.url), 'utf8'))
    entry = list && typeof list === 'object' && !Array.isArray(list) ? list[agent] : undefined
  } catch {
    return `${agent}: the agent tool list could not be read, so no shell command runs`
  }
  if (!entry || typeof entry !== 'object') return `${agent} is not a known Dethereal agent, so its shell commands do not run`
  if (entry.write === true) return null
  if (!shell) return `${agent}: the shell check is missing, so no shell command runs`
  const why = shell.notOnlyReading(shell.commandText(input.command))
  return why ? `${agent} runs only shell commands that read (cat, sed -n, head, tail, rg, grep, ls, find, jq, git log, show, diff or status); this one is not: ${why}` : null
}

/** The guard's judgement by name only. Anything it cannot read is refused. */
async function judgeByName(event, why) {
  let fallback
  try {
    fallback = await import('./secret-fallback.mjs')
  } catch {
    return deny(`${why}, and the list of secret files is missing, so this call is not run. To fix: ${FIX}`)
  }
  let input
  try {
    input = JSON.parse(event.toString('utf8')).tool_input
  } catch {
    return deny(`${why}, and this call could not be read, so it is not run`)
  }
  const command = input && typeof input.command === 'string' ? input.command : null
  if (command === null) return deny(`${why}, and this call names nothing that can be checked, so it is not run`)
  // `commandNamesGuarded` refuses it too; asked here first, so the reason names the length.
  if (sub === 'secret-guard' && command.length > fallback.COMMAND_MAX_LENGTH) return deny(`${why}, and this command is too long to check by name, so it is not run. To fix: ${FIX}`)
  const { codexHome, claudeConfig, vars } = fallback.guardedHomes(process.env, homedir())
  // By name only, a write cannot be told from a read, so every command that names guarded configuration is refused.
  const refused = sub === 'secret-guard' ? fallback.commandNamesGuarded(command, codexHome, claudeConfig, vars) : fallback.patchTouchesGuarded(command, codexHome, claudeConfig)
  if (refused) deny(`${why}, and this call names a secret file or guarded configuration, so it is not run. To fix: ${FIX}`)
}

/** A guard's output as Codex accepts it: nothing, or exactly one deny with a reason. */
function wellFormedDecision(text) {
  if (text === '') return true
  try {
    const o = JSON.parse(text)
    const h = o && o.hookSpecificOutput
    return Object.keys(o).length === 1 && h && h.hookEventName === 'PreToolUse' && h.permissionDecision === 'deny' &&
      typeof h.permissionDecisionReason === 'string' && h.permissionDecisionReason.length > 0
  } catch {
    return false
  }
}

function deadlineFor() {
  try {
    const d = JSON.parse(readFileSync(new URL('./hook-deadlines.json', import.meta.url), 'utf8'))[sub]
    if (Number.isInteger(d) && d > 0) return d
  } catch {
    // The default below holds.
  }
  return DEFAULT_DEADLINE_MS
}

function real(p) {
  try {
    return realpathSync.native(p)
  } catch {
    return path.resolve(p)
  }
}

const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)

/** The session's folder widened to its git root, if any: no binary is taken from inside it. */
function projectRootOf(cwd) {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    try {
      statSync(path.join(dir, '.git'))
      return dir
    } catch {
      // Not here; one folder up.
    }
    if (path.dirname(dir) === dir) return cwd
  }
}

/** Codex's CLI from an absolute PATH entry outside the project and the temp folders, never a `node_modules` one. */
function codexCli(cwd) {
  const roots = [real(projectRootOf(cwd)), real(cwd)]
  const temps = [tmpdir(), process.env.TMPDIR, '/tmp', '/var/tmp', '/dev/shm'].filter((d) => d && path.isAbsolute(d)).map(real)
  const outside = (p) => !roots.some((r) => within(p, r)) && !temps.some((t) => within(p, t))
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!entry || !path.isAbsolute(entry) || entry.split(path.sep).includes('node_modules') || !outside(real(entry))) continue
    const candidate = path.join(entry, 'codex')
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
    } catch {
      continue
    }
    if (outside(real(candidate))) return candidate
  }
  return null
}

/**
 * The URL variables Codex gives Dethereal's server: a fixed value from its `env`, the session's own
 * value when `env_vars` passes it, otherwise none (undefined). Null when Codex lists no enabled server.
 */
function serverUrlEnv(listing) {
  let servers
  try {
    servers = JSON.parse(listing.toString('utf8'))
  } catch {
    return null
  }
  const ours = Array.isArray(servers) ? servers.find((s) => s && s.name === 'dethereal') : undefined
  const t = ours && ours.enabled !== false ? ours.transport : undefined
  if (!t || typeof t !== 'object') return null
  const fixed = t.env && typeof t.env === 'object' && !Array.isArray(t.env) ? t.env : {}
  const passed = Array.isArray(t.env_vars) ? t.env_vars : []
  const out = {}
  for (const key of URL_KEYS) {
    if (typeof fixed[key] === 'string') out[key] = fixed[key]
    else if (!passed.includes(key)) out[key] = undefined
  }
  return out
}

/** Ask Codex, in its own process group, killed whole at the time limit; null when it cannot say. */
function askCodex(cwd, env) {
  const cli = codexCli(cwd)
  if (!cli) return Promise.resolve(null)
  return new Promise((resolve) => {
    let child
    let done = false
    let timer
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
    const end = (v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      stop()
      resolve(v)
    }
    try {
      child = spawn(cli, ['mcp', 'list', '--json'], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return resolve(null)
    }
    const chunks = []
    let size = 0
    timer = setTimeout(() => end(null), SERVER_ENV_TIMEOUT_MS)
    child.stdout.on('data', (c) => {
      size += c.length
      if (size > SERVER_ENV_MAX_BYTES) return end(null)
      chunks.push(c)
    })
    child.on('error', () => end(null))
    child.on('close', (code) => end(code === 0 ? serverUrlEnv(Buffer.concat(chunks)) : null))
  })
}

async function main() {
  const event = await readEvent()
  if (isGuard && event === null) return deny('this call could not be read in full, so it is not run')
  if (sub === 'secret-guard') {
    const refused = await shellRefusal(event)
    if (refused) return deny(refused)
  }

  let check
  try {
    const rc = await import('./runtime-check.mjs')
    check = rc.checkRuntime({ ...rc.currentUser(), fallbackExecPath: process.execPath, fallbackNodeVersion: process.versions.node })
  } catch {
    check = { ok: false, kind: 'unverifiable', what: 'the runtime check is missing' }
  }

  if (!check.ok) {
    if (isGuard) return judgeByName(event, check.kind === 'tampered' ? "Dethereal's runtime failed its integrity check" : "Dethereal's runtime could not be verified")
    if (sub === 'session-start') write(sessionContext(NOTICE[check.kind]))
    return
  }

  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.NODE_PATH
  const started = Date.now()
  if (sub === 'session-start') {
    const urls = await askCodex(process.cwd(), env)
    for (const [key, value] of Object.entries(urls ?? {})) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
  }
  const r = spawnSync(check.node, [path.join(check.current.runtimePath, 'dist', 'index.js'), 'hook', ...args], {
    input: event ?? Buffer.alloc(0),
    timeout: Math.max(1000, deadlineFor() - (Date.now() - started)),
    killSignal: 'SIGKILL',
    maxBuffer: OUTPUT_MAX_BYTES,
    stdio: ['pipe', 'pipe', 'ignore'],
    env,
  })
  const out = r.stdout ? r.stdout.toString('utf8').trim() : ''
  const clean = !r.error && r.status === 0

  if (isGuard) {
    if (clean && wellFormedDecision(out)) return write(out)
    return deny(UNCHECKED)
  }
  if (sub === 'session-start') {
    if (!check.nodeFallback) return clean ? write(out) : undefined
    let context = NOTICE.nodeFallback
    if (clean) {
      try {
        const own = JSON.parse(out).hookSpecificOutput.additionalContext
        if (typeof own === 'string' && own) context = `${NOTICE.nodeFallback}\n${own}`
      } catch {
        // Only the notice, then.
      }
    }
    return write(sessionContext(context))
  }
  if (clean) write(out)
}

main().then(finish, () => {
  output = ''
  if (isGuard) deny('this call could not be checked, so it is not run')
  finish()
})
