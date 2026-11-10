/* global process */
/**
 * The installed runtime, checked before anything runs from it: `~/.dethernety/runtime/current.json`,
 * the runtime directory it names, that directory's whole file set and the Node binary to run it with.
 * The installer reads `current.json` through this check, and the Codex hook runner carries a copy of
 * this file, so both judge a runtime the same way.
 *
 * Only `node:` builtins, and synchronous: the hook runner is a short-lived process.
 *
 * A failure is either `tampered` (something present is not as it must be: a symlink, another owner,
 * group or world write access, a second hard link, a file set that differs, a `current.json` that does
 * not parse) or `unverifiable` (something needed is missing or cannot be read). A tampered runtime is
 * never run; an unverifiable one cannot be.
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const STATE_DIR_NAME = '.dethernety'
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/
/** The oldest Node the runtime supports. */
export const NODE_FLOOR = '20.11.1'
const CURRENT_MAX_BYTES = 64 * 1024
const SHA = /^[0-9a-f]{64}$/

/** `kind` is how a hook treats the failure; `code` is the installer's error code for the same failure. */
class RuntimeCheckError extends Error {
  constructor(kind, code, what) {
    super(`${kind}: ${what}`)
    this.kind = kind
    this.code = code
    this.what = what
  }
}
const tampered = (what, code = 'runtime_tampered') => new RuntimeCheckError('tampered', code, what)
const unverifiable = (what, code = 'io') => new RuntimeCheckError('unverifiable', code, what)

/** lstat that turns a missing path into `unverifiable` and any other failure into `unverifiable` too. */
function lstatOf(p, what) {
  try {
    return lstatSync(p)
  } catch {
    throw unverifiable(what)
  }
}

/** A directory on the chain: real, owned by the user, not group/world writable. */
function checkDirectory(dir, euid, what) {
  const st = lstatOf(dir, what)
  if (st.isSymbolicLink()) throw tampered(`${what} is a symlink`, 'symlink')
  if (!st.isDirectory()) throw tampered(`${what} is not a directory`, 'not_a_directory')
  if (st.uid !== euid) throw tampered(`${what} is not owned by the user`, 'not_owned')
  if ((st.mode & 0o022) !== 0) throw tampered(`${what} is group or world writable`, 'group_or_world_writable')
}

/** Whether a Node version (`x.y.z`, optionally with a pre-release) is at least `floor`. */
export function nodeAtLeast(version, floor = NODE_FLOOR) {
  const parse = (v) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1, 4).map(Number)
  const have = parse(version)
  const need = parse(floor)
  if (!have || !need) return false
  for (let k = 0; k < 3; k++) if (have[k] !== need[k]) return have[k] > need[k]
  return true
}

/**
 * The Node binary to run: absolute, its realpath a regular executable owned by the user or root and not
 * group/world writable. Returns the realpath, which is what gets run.
 */
export function checkExecPath(execPath, euid) {
  if (typeof execPath !== 'string' || !path.isAbsolute(execPath)) throw unverifiable('execPath is not absolute', 'runtime_invalid')
  let real
  let st
  try {
    real = realpathSync(execPath)
    st = statSync(real)
  } catch {
    throw unverifiable('execPath does not exist', 'runtime_invalid')
  }
  if (!st.isFile() || (st.mode & 0o111) === 0) throw unverifiable('execPath is not an executable file', 'runtime_invalid')
  if (st.uid !== euid && st.uid !== 0) throw tampered('execPath is not owned by the user or root', 'not_owned')
  if ((st.mode & 0o022) !== 0) throw tampered('execPath is group or world writable', 'group_or_world_writable')
  return real
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))

/**
 * The runtime directory's file set: real directories and regular files only, owned by the user, not
 * group or world writable, single-linked.
 */
export function readRuntimeSet(dir, euid) {
  const files = []
  const walk = (d, rel) => {
    try {
      checkDirectory(d, euid, rel || 'the runtime directory')
    } catch (err) {
      // inside the runtime, any directory problem is the file set's
      if (rel && err instanceof RuntimeCheckError) throw tampered(err.what)
      throw err
    }
    let names
    try {
      names = readdirSync(d)
    } catch {
      throw unverifiable(`${rel || 'the runtime directory'} cannot be listed`)
    }
    for (const name of names) {
      const abs = path.join(d, name)
      const r = rel ? `${rel}/${name}` : name
      const st = lstatOf(abs, r)
      if (st.isSymbolicLink()) throw tampered(`${r} is a symlink`)
      if (st.isDirectory()) {
        walk(abs, r)
        continue
      }
      if (!st.isFile()) throw tampered(`${r} is not a regular file`)
      if (st.uid !== euid) throw tampered(`${r} is not owned by the user`)
      if ((st.mode & 0o022) !== 0) throw tampered(`${r} is group or world writable`)
      if (st.nlink !== 1) throw tampered(`${r} has another hard link`)
      let bytes
      try {
        bytes = readFileSync(abs)
      } catch {
        throw unverifiable(`${r} cannot be read`)
      }
      files.push({ rel: r, sha256: sha256(bytes), exec: (st.mode & 0o100) !== 0 })
    }
  }
  walk(dir, '')
  return files
}

/** One hash over a file set: its names sorted by bytes, each with its hash and exec bit. */
export function setSha256(files) {
  return sha256([...files].sort((a, b) => byBytes(a.rel, b.rel)).map((f) => `${f.rel}\0${f.sha256}\0${f.exec ? 1 : 0}\n`).join(''))
}

/**
 * Check the runtime `current.json` names. `realHome` is the realpath of the user's home. Returns
 * `{ ok: true, current, node, nodeFallback }`, where `node` is the realpath of the binary to run (the
 * recorded one, or `fallbackExecPath` when the recorded one is unusable and the fallback passes the same
 * checks and the Node floor), or `{ ok: false, kind: 'tampered' | 'unverifiable', code, what }`.
 */
export function checkRuntime({ realHome, euid, fallbackExecPath, fallbackNodeVersion }) {
  try {
    const root = path.join(realHome, STATE_DIR_NAME)
    const runtimeDir = path.join(root, 'runtime')
    const currentPath = path.join(runtimeDir, 'current.json')
    checkDirectory(root, euid, '~/.dethernety')
    checkDirectory(runtimeDir, euid, 'runtime')
    let st
    try {
      st = lstatSync(currentPath)
    } catch {
      throw unverifiable('current.json is missing', 'runtime_invalid')
    }
    if (st.isSymbolicLink()) throw tampered('current.json is a symlink', 'symlink')
    if (!st.isFile()) throw tampered('current.json is not a regular file', 'runtime_invalid')
    if (st.uid !== euid) throw tampered('current.json is not owned by the user', 'not_owned')
    if ((st.mode & 0o022) !== 0) throw tampered('current.json is group or world writable', 'group_or_world_writable')
    if (st.nlink !== 1) throw tampered('current.json has another hard link', 'runtime_invalid')
    if (st.size > CURRENT_MAX_BYTES) throw tampered('current.json is too large', 'runtime_invalid')
    let c
    try {
      c = JSON.parse(readFileSync(currentPath, 'utf8'))
    } catch {
      throw tampered('current.json does not parse', 'runtime_invalid')
    }
    if (!c || c.schemaVersion !== 2 || typeof c.version !== 'string' || !SEMVER.test(c.version) || typeof c.setSha256 !== 'string' ||
      !SHA.test(c.setSha256) || typeof c.execPath !== 'string' || typeof c.runtimePath !== 'string' ||
      c.runtimePath !== path.join(runtimeDir, c.version) || typeof c.nodeVersion !== 'string' || typeof c.installedAt !== 'string' ||
      Number.isNaN(Date.parse(c.installedAt)) || !(c.previous === null || (typeof c.previous === 'string' && SEMVER.test(c.previous)))) {
      throw tampered('current.json is not a runtime record', 'runtime_invalid')
    }
    checkDirectory(c.runtimePath, euid, `runtime/${c.version}`)
    if (setSha256(readRuntimeSet(c.runtimePath, euid)) !== c.setSha256) throw tampered(`runtime/${c.version} holds other files than recorded`)
    let node
    let nodeFallback = false
    try {
      node = checkExecPath(c.execPath, euid)
    } catch (recorded) {
      if (recorded.kind === 'tampered' || !fallbackExecPath || !nodeAtLeast(fallbackNodeVersion ?? '')) throw recorded
      node = checkExecPath(fallbackExecPath, euid)
      nodeFallback = true
    }
    return { ok: true, current: c, node, nodeFallback }
  } catch (err) {
    if (err instanceof RuntimeCheckError) return { ok: false, kind: err.kind, code: err.code, what: err.what }
    return { ok: false, kind: 'unverifiable', code: 'io', what: 'the check failed' }
  }
}

/** The user's real home and id, as the installer resolves them. */
export function currentUser() {
  const home = homedir()
  let realHome = home
  try {
    realHome = realpathSync(home)
  } catch {
    // An unresolvable home leaves the check to fail on the state directory.
  }
  return { realHome, euid: process.geteuid ? process.geteuid() : -1 }
}
