/**
 * Backups of every file the installer changes, under `~/.dethernety/backups/`.
 *
 * Each backup is `<ts>-<rand>/<sha256>.bak` (directories 0700, files 0600), named
 * by id and content hash, never by the user's path. The index maps a target
 * path to its first backup (kept forever, for disaster recovery only) and its
 * recent ones. A restore always names a backup id and the content it must hold,
 * and the bytes are checked against both before they are used.
 */
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { InstallerError, io } from './errors.js'
import { ensureDirUnder, type InstallerEnv, type StatePaths } from './paths.js'
import { readTarget, resolveTarget, sha256, type Target, writeTarget } from './safe-write.js'

export const BACKUP_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}\/[0-9a-f]{64}\.bak$/
/** Recent backups kept per file, besides the first one and any a live record references. */
export const KEEP_RECENT = 3

export interface BackupIndex {
  schemaVersion: 1
  files: Record<string, { first: string; recent: string[] }>
}

const stateTarget = (paths: StatePaths, rel: string): Target =>
  resolveTarget(path.join(paths.root, ...rel.split('/')), [{ root: paths.root, pattern: 'backups/**' }])

async function readIndex(paths: StatePaths, env: InstallerEnv): Promise<{ index: BackupIndex; sha: string | 'absent' }> {
  const t = stateTarget(paths, 'backups/index.json')
  const cur = await readTarget(t, env)
  if (!cur) return { index: { schemaVersion: 1, files: {} }, sha: 'absent' }
  let raw: unknown
  try {
    raw = JSON.parse(cur.bytes.toString('utf8'))
  } catch {
    throw new InstallerError('backup_invalid', 'backups/index.json')
  }
  const ok = !!raw && typeof raw === 'object' && (raw as BackupIndex).schemaVersion === 1 &&
    !!(raw as BackupIndex).files && typeof (raw as BackupIndex).files === 'object' &&
    Object.values((raw as BackupIndex).files).every((f) => !!f && typeof f === 'object' && typeof f.first === 'string' && BACKUP_ID.test(f.first) &&
      Array.isArray(f.recent) && f.recent.every((r) => typeof r === 'string' && BACKUP_ID.test(r)))
  if (!ok) throw new InstallerError('backup_invalid', 'backups/index.json')
  return { index: raw as BackupIndex, sha: cur.sha256 }
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

/**
 * Store `bytes` as the backup of `targetPath` taken right before a write, and
 * record it in the index. Returns the backup id. `referenced` lists ids a live
 * manifest record still points at; they are never pruned.
 */
export async function createBackup(paths: StatePaths, env: InstallerEnv, targetPath: string, bytes: Buffer, referenced: ReadonlySet<string> = new Set(), now = new Date()): Promise<string> {
  await ensureDirUnder(paths.root, 'backups', env)
  const dirName = `${stamp(now)}-${randomBytes(4).toString('hex')}`
  // Exclusive: a directory that already exists is never reused.
  await fs.mkdir(path.join(paths.backups, dirName), { mode: 0o700 }).catch(() => { throw new InstallerError('io', `backups/${dirName}`) })
  const id = `${dirName}/${sha256(bytes)}.bak`
  await writeTarget(stateTarget(paths, `backups/${id}`), bytes, 'absent', env, 0o600)

  const { index, sha } = await readIndex(paths, env)
  const entry = index.files[targetPath] ?? { first: id, recent: [] }
  const recent = [...entry.recent, id]
  const keep = new Set([entry.first, ...recent.slice(-KEEP_RECENT), ...[...referenced].filter((r) => recent.includes(r))])
  const pruned = recent.filter((r) => !keep.has(r))
  index.files[targetPath] = { first: entry.first, recent: recent.filter((r) => keep.has(r)) }
  await writeTarget(stateTarget(paths, 'backups/index.json'), Buffer.from(JSON.stringify(index, null, 2) + '\n'), sha, env, 0o600)
  for (const r of pruned) await io(fs.rm(path.join(paths.backups, r.split('/')[0]!), { recursive: true, force: true }), 'backups')
  return id
}

/** Read a backup and prove it holds `expectedSha256`: the id's shape, its file name and its bytes must all agree. */
export async function readBackup(paths: StatePaths, env: InstallerEnv, id: string, expectedSha256: string): Promise<Buffer> {
  if (!BACKUP_ID.test(id)) throw new InstallerError('backup_invalid', 'backup id')
  const named = id.slice(id.indexOf('/') + 1, -'.bak'.length)
  if (named !== expectedSha256) throw new InstallerError('backup_mismatch', 'backup')
  const cur = await readTarget(stateTarget(paths, `backups/${id}`), env)
  if (!cur) throw new InstallerError('backup_invalid', 'backup missing')
  if (cur.sha256 !== expectedSha256) throw new InstallerError('backup_mismatch', 'backup')
  return cur.bytes
}

/** The first backup of a file, for disaster recovery only (never a restore source for uninstall). */
export async function firstBackup(paths: StatePaths, env: InstallerEnv, targetPath: string): Promise<string | null> {
  return (await readIndex(paths, env)).index.files[targetPath]?.first ?? null
}

/**
 * Remove every backup. Backups can hold secrets from the files they copy. The
 * caller holds the install lock and has checked no record references a backup
 * (`purgeAllBackups` does both).
 */
export async function purgeBackups(paths: StatePaths, env: InstallerEnv): Promise<number> {
  const st = await fs.lstat(paths.backups).catch(() => null)
  if (!st) return 0
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== env.euid) throw new InstallerError('backup_invalid', 'backups')
  const entries = await io(fs.readdir(paths.backups), 'backups')
  await io(fs.rm(paths.backups, { recursive: true, force: true }), 'backups')
  return entries.length
}
