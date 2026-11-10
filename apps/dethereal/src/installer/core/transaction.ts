/**
 * One file change as a recoverable transaction, and its undo.
 *
 * Under the install lock: the target is re-read and must still hold what the
 * caller planned against; its current content is backed up; the manifest gets a
 * `pending` record naming the content before and after and the backup; the file
 * is written atomically; the record becomes `committed`. An interruption at any
 * point leaves a record `classifyPending` can settle. Prompts never happen here:
 * the caller plans and asks first, and this re-validates.
 */
import type { FileLockHandle } from '../../utils/file-lock.js'
import { createBackup, purgeBackups, readBackup } from './backup.js'
import { ownedModified } from './editors.js'
import { InstallerError } from './errors.js'
import { classifyPending, type FileRecord, type InstallEntry, type Manifest, readManifest, referencedBackups, withStateLock, writeManifest } from './manifest.js'
import type { InstallerEnv, StatePaths } from './paths.js'
import { type AllowedTarget, readTarget, removeTarget, resolveTarget, sha256, type Target, writeTarget } from './safe-write.js'

export type Step = 'backup' | 'pending' | 'write' | 'commit'

export interface TxContext {
  paths: StatePaths
  env: InstallerEnv
  /**
   * The install lock, when the caller already holds it for a longer sequence (a
   * whole install or uninstall). The lock is not re-entrant, so every function
   * here uses this one instead of taking its own.
   */
  lock?: FileLockHandle
  /** Test hook: called before each step; a throw simulates a crash there. */
  onStep?: (step: Step) => void | Promise<void>
}

async function withInstallLock<T>(ctx: TxContext, fn: (m: Manifest, save: (m: Manifest) => Promise<void>) => Promise<T>): Promise<T> {
  const run = async (lock: FileLockHandle) => {
    const read = await readManifest(ctx.paths, ctx.env)
    const manifest = read.manifest
    let sha = read.sha
    const save = async (m: Manifest) => {
      await lock.assertHeld()
      sha = await writeManifest(ctx.paths, ctx.env, m, sha)
    }
    return fn(manifest, save)
  }
  return ctx.lock ? run(ctx.lock) : withStateLock(ctx.paths, ctx.env, run)
}

/** Change the manifest under the install lock (the caller's, when it holds it) and save it. */
export async function mutateManifest<T>(ctx: TxContext, fn: (m: Manifest) => T | Promise<T>): Promise<T> {
  return withInstallLock(ctx, async (m, save) => {
    const result = await fn(m)
    await save(m)
    return result
  })
}

/** Remove an entry's harness-CLI file records, once the CLI undid its own writes. Returns how many. */
export async function dropCliRecords(ctx: TxContext, key: string): Promise<number> {
  return mutateManifest(ctx, (m) => {
    const entry = m.installs[key]
    if (!entry) return 0
    const before = entry.files.length
    entry.files = entry.files.filter((f) => f.writer !== 'cli')
    return before - entry.files.length
  })
}

function entryOf(m: Manifest, key: string, version: string): InstallEntry {
  const e = m.installs[key] ?? { version, files: [] }
  e.version = version
  m.installs[key] = e
  return e
}

export interface FileChange {
  key: string
  version: string
  target: Target
  format: FileRecord['format']
  /** What the caller planned against: the content's sha256, or absent. */
  expectPre: string | 'absent'
  next: Buffer
  owned?: FileRecord['owned']
  /** New files get this mode (existing files keep theirs). */
  newMode?: number
}

/** Write one file as a transaction. Returns the committed record. */
export async function applyFileChange(ctx: TxContext, change: FileChange): Promise<FileRecord> {
  return withInstallLock(ctx, async (m, save) => {
    const entry = entryOf(m, change.key, change.version)
    if (Object.values(m.installs).some((e) => e.files.some((f) => f.path === change.target.abs))) {
      // An upgrade reverts the old record first, so the pre-image never holds owned content.
      throw new InstallerError('conflict', change.target.rel)
    }
    const existing = await readTarget(change.target, ctx.env)
    const pre = existing ? existing.sha256 : 'absent'
    if (pre !== change.expectPre) throw new InstallerError('changed', change.target.rel)

    await ctx.onStep?.('backup')
    const backupId = existing ? await createBackup(ctx.paths, ctx.env, change.target.abs, existing.bytes, referencedBackups(m)) : null

    await ctx.onStep?.('pending')
    const record: FileRecord = {
      path: change.target.abs, format: change.format, writer: 'installer', pre, post: sha256(change.next), backupId, state: 'pending',
      ...(change.owned ? { owned: change.owned } : {}),
    }
    entry.files.push(record)
    await save(m)

    await ctx.onStep?.('write')
    try {
      await writeTarget(change.target, change.next, pre, ctx.env, change.newMode)
    } catch (err) {
      // A write that never landed leaves nothing to undo: drop its record rather
      // than leave one that a later edit would make look committed.
      const now = await readTarget(change.target, ctx.env).catch(() => undefined)
      if (now !== undefined && (now ? now.sha256 : 'absent') === pre) {
        entry.files.splice(entry.files.indexOf(record), 1)
        if (entry.files.length === 0) delete m.installs[change.key]
        await save(m)
      }
      throw err
    }

    await ctx.onStep?.('commit')
    record.state = 'committed'
    await save(m)
    return record
  })
}

/**
 * Record a file a harness CLI wrote: the hash it held before the CLI step (`pre`,
 * captured by the caller) and the hash it left. A CLI record is never restored
 * or deleted by the installer: the writer undoes it through the same CLI, so it
 * carries no backup. Recording the same file again keeps the first `pre`, the
 * file as it was before any install touched it.
 */
export async function recordCliFile(ctx: TxContext, key: string, version: string, target: Target, format: FileRecord['format'], pre: string | 'absent',
  owned?: FileRecord['owned']): Promise<FileRecord> {
  return withInstallLock(ctx, async (m, save) => {
    const cur = await readTarget(target, ctx.env)
    if (!cur) throw new InstallerError('changed', target.rel)
    const entry = entryOf(m, key, version)
    const earlier = entry.files.find((f) => f.writer === 'cli' && f.path === target.abs)
    const record: FileRecord = { path: target.abs, format, writer: 'cli', pre: earlier?.pre ?? pre, post: cur.sha256, backupId: null, state: 'committed', ...(owned ? { owned } : {}) }
    if (earlier) entry.files.splice(entry.files.indexOf(earlier), 1, record)
    else entry.files.push(record)
    await save(m)
    return record
  })
}

/** Settle records an interrupted install left pending. Returns how each was settled. */
export async function recoverPending(ctx: TxContext, allowed: readonly AllowedTarget[]): Promise<Array<{ path: string; outcome: 'dropped' | 'committed' | 'user_edited' | 'refused' }>> {
  return withInstallLock(ctx, async (m, save) => {
    const out: Array<{ path: string; outcome: 'dropped' | 'committed' | 'user_edited' | 'refused' }> = []
    for (const e of Object.values(m.installs)) {
      for (const r of [...e.files]) {
        if (r.state !== 'pending') continue
        let current: string | 'absent'
        try {
          const cur = await readTarget(resolveTarget(r.path, allowed), ctx.env)
          current = cur ? cur.sha256 : 'absent'
        } catch {
          out.push({ path: r.path, outcome: 'refused' })
          continue
        }
        const c = classifyPending(r, current)
        if (c === 'drop') e.files.splice(e.files.indexOf(r), 1)
        // Edited since: whether the write landed is unknown, so the record stays pending.
        else if (c === 'commit') r.state = 'committed'
        out.push({ path: r.path, outcome: c === 'drop' ? 'dropped' : c === 'commit' ? 'committed' : 'user_edited' })
      }
    }
    for (const [k, e] of Object.entries(m.installs)) if (e.files.length === 0) delete m.installs[k]
    await save(m)
    return out
  })
}

export type RevertOutcome =
  | 'restored' // the file held exactly what was written: its pre-image is back, byte for byte
  | 'deleted' // the installer created it and nobody changed it
  | 'unmerged' // the user changed it: only the owned part was taken out
  | 'manual' // the user changed it and the owned part can no longer be found
  | 'missing' // already gone
  | 'cli_owned' // written by a harness CLI: the writer undoes it through that CLI
  | 'refused' // outside the allowed templates, or not a file the installer may touch

/**
 * Undo one record. `unmerge` takes the current bytes and returns them without the
 * owned part, or null when it cannot find it (the file is then reported). A
 * backup, an unmerge or a write that fails leaves the file as it is and reports
 * it `manual`, so one file never stops the rest of an uninstall.
 */
export async function revertFile(ctx: TxContext, key: string, recordPath: string, allowed: readonly AllowedTarget[],
  unmerge?: (bytes: Buffer, record: FileRecord) => Buffer | null): Promise<RevertOutcome> {
  return withInstallLock(ctx, async (m, save) => {
    const entry = m.installs[key]
    const record = entry?.files.find((f) => f.path === recordPath)
    if (!entry || !record) return 'missing'
    if (record.writer === 'cli') return 'cli_owned'
    let target: Target
    let cur
    try {
      target = resolveTarget(record.path, allowed)
      cur = await readTarget(target, ctx.env)
    } catch {
      return 'refused'
    }
    const drop = async (outcome: RevertOutcome): Promise<RevertOutcome> => {
      entry.files.splice(entry.files.indexOf(record), 1)
      if (entry.files.length === 0) delete m.installs[key]
      await save(m)
      return outcome
    }
    if (!cur) return drop('missing')
    if (record.state === 'pending' && cur.sha256 === record.pre) return drop('missing')
    let outcome: RevertOutcome
    try {
      if (cur.sha256 === record.post && record.pre === 'absent') {
        await removeTarget(target, record.post, ctx.env)
        outcome = 'deleted'
      } else if (cur.sha256 === record.post) {
        const bytes = await readBackup(ctx.paths, ctx.env, record.backupId!, record.pre)
        await writeTarget(target, bytes, record.post, ctx.env)
        outcome = 'restored'
      } else {
        const next = unmerge?.(cur.bytes, record) ?? null
        if (!next) return 'manual'
        await writeTarget(target, next, cur.sha256, ctx.env)
        outcome = 'unmerged'
      }
    } catch (err) {
      if (!(err instanceof InstallerError)) throw err
      return err.code === 'manifest_path_refused' ? 'refused' : 'manual'
    }
    return drop(outcome)
  })
}

/**
 * Remove every backup (`uninstall --purge-backups`), under the install lock.
 * Refused while any record still points at a backup: that backup is the only
 * way back to the file as it was before the install.
 */
export async function purgeAllBackups(ctx: TxContext): Promise<number> {
  return withInstallLock(ctx, async (m) => {
    if (referencedBackups(m).size > 0) throw new InstallerError('backup_referenced', 'backups')
    return purgeBackups(ctx.paths, ctx.env)
  })
}

export interface OwnedDrift {
  key: string
  path: string
  /** Owned keys whose value is no longer what was installed; `unreadable` or `missing` when the file cannot be checked. */
  changed: string[][] | 'unreadable' | 'missing'
}

/**
 * For doctor: every committed record with owned keys whose values changed
 * since the install (an approval downgraded inside our own entry, a command
 * swapped). Read-only; files outside the allowed templates are reported
 * `unreadable`, never read.
 */
export async function inspectOwned(ctx: TxContext, allowed: readonly AllowedTarget[]): Promise<OwnedDrift[]> {
  const { manifest } = await readManifest(ctx.paths, ctx.env)
  const out: OwnedDrift[] = []
  for (const [key, entry] of Object.entries(manifest.installs)) {
    for (const r of entry.files) {
      if (r.state !== 'committed' || !r.owned?.length) continue
      let cur
      try {
        cur = await readTarget(resolveTarget(r.path, allowed), ctx.env)
      } catch {
        out.push({ key, path: r.path, changed: 'unreadable' })
        continue
      }
      if (!cur) { out.push({ key, path: r.path, changed: 'missing' }); continue }
      const changed = ownedModified(cur.bytes, r)
      if (changed.length) out.push({ key, path: r.path, changed })
    }
  }
  return out
}
