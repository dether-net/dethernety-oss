/**
 * The project's model registry, `.dethernety/models.json`: which directories hold
 * threat models. It is repository content, so it is read through the state store
 * (no links, no special files, a size cap), and every registered path resolves
 * against the project root and must pass confinement before anything reads it.
 */

import path from 'node:path'
import { randomBytes } from 'node:crypto'
import fs, { lstat } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { readRepoJson, StateFileError, type StateFileErrorCode } from './state-store.js'
import { validatePathConfinement } from './path-confinement.js'
import { LockBusyError, withFileLock } from './file-lock.js'
import { getProjectRoot, resolveProjectRoot } from './project-root.js'

export const REGISTRY_REL = '.dethernety/models.json'

const MAX_PATH_LENGTH = 4096

export type RegistryRead =
  | { registry: 'absent' }
  | { registry: 'invalid'; code: StateFileErrorCode | 'models_not_array' }
  | { registry: 'present'; entries: unknown[] }

/** Whether a registry file is present at all: a cheap check before loading the store. */
export async function registryPresent(root: string): Promise<boolean> {
  return lstat(path.join(root, REGISTRY_REL)).then(
    () => true,
    () => false
  )
}

/** Read the registry under `root`. Never throws. */
export async function readRegistry(root: string): Promise<RegistryRead> {
  let doc: Record<string, unknown> | null
  try {
    doc = await readRepoJson(root, REGISTRY_REL, { baseDir: root })
  } catch (error) {
    return { registry: 'invalid', code: error instanceof StateFileError ? error.code : 'io' }
  }
  if (doc === null) return { registry: 'absent' }
  const models = doc.models === undefined ? [] : doc.models
  if (!Array.isArray(models)) return { registry: 'invalid', code: 'models_not_array' }
  return { registry: 'present', entries: models }
}

/** A registry entry's `path`, when it is a usable path string. */
export function entryPath(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const value = (entry as Record<string, unknown>).path
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH && !value.includes('\0')
    ? value
    : null
}

/**
 * The real directory a registered path names, resolved against the project root
 * (wherever the process started) and confined. Throws when it may not be read.
 */
export function resolveModelDir(root: string, registeredPath: string): Promise<string> {
  return validatePathConfinement(path.resolve(root, registeredPath), root)
}

export type RegisterProblem = 'no_project_root' | 'outside_root' | 'models_not_array' | 'unreadable' | 'locked' | 'io'
export type RegisterResult = { registered: true } | { registered: false; code: RegisterProblem }

/** The real path of `p`, or null when it cannot be resolved. */
const realOf = (p: string): Promise<string | null> => fs.realpath(p).catch(() => null)

/**
 * The identity (device and inode) of the project root and its `.dethernety`, each a real
 * directory, or null. Equal results before and after a step mean neither was swapped
 * for a link or another directory in between.
 */
async function metaDirIdentity(rootReal: string, metaDir: string): Promise<string | null> {
  const ids: string[] = []
  for (const dir of [rootReal, metaDir]) {
    const st = await lstat(dir).catch(() => null)
    if (!st || st.isSymbolicLink() || !st.isDirectory()) return null
    ids.push(`${st.dev}:${st.ino}`)
  }
  return ids.join('/')
}

const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)

/**
 * Register a model directory in the project's registry, or update its entry.
 *
 * The directory must lie inside the project root. The registry is written under a
 * lock, atomically, never through a link, and only when something changed: an entry
 * whose path resolves to the same directory has its name updated and its `source`
 * set when it has none, keeping `createdAt` and every other key; otherwise a new
 * entry `{name, path: "./<relative>", createdAt, source}` is appended. Every other
 * entry and top-level key is kept as it is. Never throws.
 */
export async function registerModel(modelDir: string, entry: { name: string; source: string }): Promise<RegisterResult> {
  const root = (getProjectRoot() ?? resolveProjectRoot()).root
  if (!root) return { registered: false, code: 'no_project_root' }
  const rootReal = await realOf(root)
  const dirReal = await realOf(modelDir)
  if (!rootReal || !dirReal || dirReal === rootReal || !within(dirReal, rootReal)) return { registered: false, code: 'outside_root' }

  const metaDir = path.join(rootReal, '.dethernety')
  const file = path.join(metaDir, 'models.json')
  let identity: string | null
  try {
    const st = await lstat(metaDir).catch(() => null)
    if (!st) await fs.mkdir(metaDir).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e })
    const again = await lstat(metaDir)
    if (!again.isDirectory() || again.isSymbolicLink() || (await realOf(metaDir)) !== metaDir) return { registered: false, code: 'outside_root' }
    identity = await metaDirIdentity(rootReal, metaDir)
    if (!identity) return { registered: false, code: 'outside_root' }
  } catch {
    return { registered: false, code: 'io' }
  }
  // Every later step goes through the same path string: each re-checks that it still names the
  // directory checked here. (Node has no openat/renameat, so a swap within one syscall's window
  // remains possible; what it can reach is one empty lock file or one registry file.)
  const unchanged = async () => (await metaDirIdentity(rootReal, metaDir)) === identity

  try {
    return await withFileLock(
      path.join(metaDir, '.models.lock'),
      async (handle) => {
        if (!(await unchanged())) return { registered: false, code: 'outside_root' } as const
        let doc: Record<string, unknown> | null
        try {
          doc = await readRepoJson(rootReal, REGISTRY_REL, { baseDir: rootReal })
        } catch {
          return { registered: false, code: 'unreadable' } as const
        }
        const current = doc ?? { version: 1, models: [] }
        const models = current.models === undefined ? [] : current.models
        if (!Array.isArray(models)) return { registered: false, code: 'models_not_array' } as const

        const next = structuredClone({ ...current, models }) as Record<string, unknown> & { models: unknown[] }
        let found = -1
        for (let i = 0; i < next.models.length; i++) {
          const p = entryPath(next.models[i])
          if (p === null) continue
          if ((await realOf(path.resolve(rootReal, p))) === dirReal) {
            found = i
            break
          }
        }
        if (found >= 0) {
          const e = next.models[found] as Record<string, unknown>
          e.name = entry.name
          if (e.source === undefined) e.source = entry.source
        } else {
          next.models.push({
            name: entry.name,
            path: `./${path.relative(rootReal, dirReal).split(path.sep).join('/')}`,
            createdAt: new Date().toISOString(),
            source: entry.source,
          })
        }
        if (doc !== null && isDeepStrictEqual(next, doc)) return { registered: true } as const

        const target = await lstat(file).catch(() => null)
        if (target && !target.isFile()) return { registered: false, code: 'unreadable' } as const
        const tmp = `${file}.tmp.${randomBytes(8).toString('hex')}`
        let written: { dev: number; ino: number }
        try {
          if (!(await unchanged())) return { registered: false, code: 'outside_root' } as const
          const fh = await fs.open(tmp, 'wx', target ? target.mode & 0o777 : 0o644)
          try {
            await fh.writeFile(JSON.stringify(next, null, 2) + '\n', 'utf8')
            await fh.sync()
            written = await fh.stat()
          } finally {
            await fh.close()
          }
          await handle.assertHeld()
          if (!(await unchanged())) {
            await fs.unlink(tmp).catch(() => {})
            return { registered: false, code: 'outside_root' } as const
          }
          await fs.rename(tmp, file)
        } catch {
          await fs.unlink(tmp).catch(() => {})
          return { registered: false, code: 'io' } as const
        }
        // The file now at the registry's path must be the one just written, in the directory checked.
        const placed = await lstat(file).catch(() => null)
        if (!placed || placed.dev !== written.dev || placed.ino !== written.ino || !(await unchanged())) {
          return { registered: false, code: 'outside_root' } as const
        }
        return { registered: true } as const
      },
      { label: '.dethernety/.models.lock' },
    )
  } catch (error) {
    return { registered: false, code: error instanceof LockBusyError ? 'locked' : 'io' }
  }
}

/** The warning a tool adds when a model could not be registered. */
export function registerWarning(code: RegisterProblem): string {
  return `The model was not registered in .dethernety/models.json (${code}).`
}
