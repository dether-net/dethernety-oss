/**
 * The path-safe writer: every file the installer creates, rewrites or removes
 * goes through here.
 *
 * A target must match one of the caller's allowed templates (a resolved root
 * plus a glob below it); the templates come from harness × scope and the
 * environment, never from the manifest. Below the root no symlink is followed:
 * each component is checked with lstat, directories are created one at a time,
 * and a file is replaced through an exclusive, no-follow temp file in the same
 * directory that carries the original mode. The content is re-checked right
 * before the rename, and the rename is checked to have landed the temp file in
 * the same parent directory.
 *
 * Residual: Node has no `renameat`, so a parent directory swapped between the
 * last check and the rename by a process running as the same user is detected
 * only afterwards (the write is then reported as `changed`), not prevented.
 */
import { randomBytes } from 'node:crypto'
import { constants as fsConstants, promises as fs } from 'node:fs'
import path from 'node:path'
import { readCheckedStat, StateFileError } from '../../utils/state-store.js'
import { InstallerError, io } from './errors.js'
import { ensureDirUnder, type InstallerEnv, verifyDirectory } from './paths.js'
import { sha256Hex } from '../../utils/hash.js'

/** Largest file the installer reads or writes. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export interface AllowedTarget {
  /** A root already resolved with `resolveRoot` (realpath, owned, not group/world writable). */
  root: string
  /** Glob relative to the root: `*` matches within a path segment, `**` across segments. */
  pattern: string
}

export interface Target {
  root: string
  /** Path relative to the root, `/`-separated. */
  rel: string
  abs: string
}

export const sha256 = sha256Hex

/**
 * Does a `/`-separated relative path match a template glob? `*` matches within
 * one path segment, `?` one character of it, and a segment that is exactly
 * two stars matches any number of whole segments (at the start, in the middle
 * or at the end). Two stars anywhere else in a segment are refused.
 */
export function matchesTemplate(rel: string, pattern: string): boolean {
  const segments = pattern.split('/')
  if (segments.some((seg) => seg.includes('**') && seg !== '**')) throw new InstallerError('outside_allowed', 'template')
  let re = ''
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1
    if (seg === '**') {
      // Zero or more whole segments, with their separator.
      re += last ? '.*' : '(?:.*/)?'
      return
    }
    for (const c of seg) {
      if (c === '*') re += '[^/]*'
      else if (c === '?') re += '[^/]'
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    if (!last) re += '/'
  })
  return new RegExp(`^${re}$`, 's').test(rel)
}

/** Find the template a path falls under, or refuse it. The path itself is not resolved: components below the root are checked instead. */
export function resolveTarget(target: string, allowed: readonly AllowedTarget[]): Target {
  const abs = path.resolve(target)
  for (const a of allowed) {
    const rel = path.relative(a.root, abs)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    const posix = rel.split(path.sep).join('/')
    if (posix.split('/').some((p) => p === '.' || p === '..')) continue
    if (matchesTemplate(posix, a.pattern)) return { root: a.root, rel: posix, abs: path.join(a.root, ...posix.split('/')) }
  }
  throw new InstallerError('outside_allowed', path.basename(abs))
}

/** Check every existing directory between the root and the target's parent. Returns false when one is missing. */
async function parentsExist(t: Target, env: InstallerEnv): Promise<boolean> {
  await verifyDirectory(t.root, env, '.')
  const parts = t.rel.split('/').slice(0, -1)
  let dir = t.root
  for (let i = 0; i < parts.length; i++) {
    dir = path.join(dir, parts[i]!)
    const st = await fs.lstat(dir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw new InstallerError('io', parts.slice(0, i + 1).join('/'))
    })
    if (!st) return false
    await verifyDirectory(dir, env, parts.slice(0, i + 1).join('/'))
  }
  return true
}

export interface ExistingFile {
  bytes: Buffer
  sha256: string
  mode: number
  dev: bigint
  ino: bigint
}

/** Read a target with the checks: no symlink, single link, owned by euid, writable by the user, capped. `null` when absent. */
export async function readTarget(t: Target, env: InstallerEnv): Promise<ExistingFile | null> {
  if (!(await parentsExist(t, env))) return null
  let read
  try {
    read = await readCheckedStat(t.abs, t.rel, MAX_FILE_BYTES)
  } catch (err) {
    if (err instanceof StateFileError) {
      const code = err.code === 'symlink' || err.code === 'not_regular' || err.code === 'hardlinked' || err.code === 'too_large' || err.code === 'changed' ? err.code : 'io'
      throw new InstallerError(code, t.rel)
    }
    throw new InstallerError('io', t.rel)
  }
  if (read === null) return null
  // Owner and mode come from the descriptor the bytes were read through.
  const { bytes, stat: st } = read
  if (st.uid !== BigInt(env.euid)) throw new InstallerError('not_owned', t.rel)
  if ((st.mode & 0o200n) === 0n) throw new InstallerError('not_writable', t.rel)
  return { bytes, sha256: sha256(bytes), mode: Number(st.mode & 0o7777n), dev: st.dev, ino: st.ino }
}

/** What the target must hold right before it is replaced: a sha256, or absent. */
export type Expectation = string | 'absent'

async function currentSha(t: Target, env: InstallerEnv): Promise<Expectation> {
  const cur = await readTarget(t, env)
  return cur ? cur.sha256 : 'absent'
}

/**
 * Replace (or create) the target with `bytes`, provided it still holds what the
 * caller planned against. Returns the resulting sha256. The mode of an existing
 * file is kept; a new file is 0600 unless `newMode` says otherwise.
 */
export async function writeTarget(t: Target, bytes: Buffer, expect: Expectation, env: InstallerEnv, newMode = 0o600): Promise<string> {
  if (bytes.length > MAX_FILE_BYTES) throw new InstallerError('too_large', t.rel)
  const parentRel = t.rel.split('/').slice(0, -1).join('/')
  const parent = parentRel ? await ensureDirUnder(t.root, parentRel, env) : t.root
  const before = await io(fs.lstat(parent, { bigint: true }), parentRel || '.')
  const existing = await readTarget(t, env)
  if ((existing ? existing.sha256 : 'absent') !== expect) throw new InstallerError('changed', t.rel)
  // Permission bits only: setuid, setgid and sticky are never carried to a rewrite.
  const mode = (existing ? existing.mode : newMode) & 0o777

  const tmp = path.join(parent, `.dethereal-tmp-${randomBytes(8).toString('hex')}`)
  const fh = await fs.open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600)
    .catch(() => { throw new InstallerError('io', t.rel) })
  let tmpIno: bigint
  try {
    await fh.writeFile(bytes)
    await fh.chmod(mode)
    await fh.sync()
    tmpIno = (await fh.stat({ bigint: true })).ino
  } catch {
    await fh.close().catch(() => {})
    await fs.rm(tmp, { force: true })
    throw new InstallerError('io', t.rel)
  }
  await io(fh.close(), t.rel)
  try {
    const after = await fs.lstat(parent, { bigint: true })
    if (after.dev !== before.dev || after.ino !== before.ino) throw new InstallerError('changed', parentRel || '.')
    // The planned content must still be there immediately before the rename.
    if ((await currentSha(t, env)) !== expect) throw new InstallerError('changed', t.rel)
    await fs.rename(tmp, t.abs)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err instanceof InstallerError ? err : new InstallerError('io', t.rel)
  }
  const landed = await fs.lstat(t.abs, { bigint: true }).catch(() => null)
  if (!landed || landed.ino !== tmpIno) throw new InstallerError('changed', t.rel)
  const parentAfter = await fs.lstat(parent, { bigint: true }).catch(() => null)
  if (!parentAfter || parentAfter.dev !== before.dev || parentAfter.ino !== before.ino) throw new InstallerError('changed', parentRel || '.')
  await syncDir(parent)
  return sha256(bytes)
}

/**
 * Remove the target if it still holds `expect`. Returns false when it was already
 * gone. The file is first renamed aside and checked there (same inode, same
 * content), so a save that replaced it in between is put back, never deleted.
 */
export async function removeTarget(t: Target, expect: string, env: InstallerEnv): Promise<boolean> {
  const cur = await readTarget(t, env)
  if (!cur) return false
  if (cur.sha256 !== expect) throw new InstallerError('changed', t.rel)
  const dir = path.dirname(t.abs)
  const aside = path.join(dir, `.dethereal-removed-${randomBytes(8).toString('hex')}`)
  await io(fs.rename(t.abs, aside), t.rel)
  const moved = await readCheckedStat(aside, t.rel, MAX_FILE_BYTES).catch(() => null)
  if (!moved || moved.stat.dev !== cur.dev || moved.stat.ino !== cur.ino || sha256(moved.bytes) !== expect) {
    // Not the file that was checked: put it back without replacing anything saved since.
    await fs.link(aside, t.abs).then(() => fs.unlink(aside)).catch(() => {})
    throw new InstallerError('changed', t.rel)
  }
  await io(fs.unlink(aside), t.rel)
  await syncDir(dir)
  return true
}

export async function syncDir(dir: string): Promise<void> {
  const fh = await fs.open(dir, fsConstants.O_RDONLY).catch(() => null)
  if (!fh) return
  try {
    await fh.sync()
  } catch {
    // Some filesystems refuse fsync on a directory; the rename is still ordered after the file sync.
  } finally {
    await fh.close()
  }
}
