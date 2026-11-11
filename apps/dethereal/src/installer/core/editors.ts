/**
 * Undoing the installer's part of a shared config file the user has changed
 * since, by file format. A record whose owned part can no longer be found is
 * left for the user (null), never guessed at.
 *
 * The manifest is data, not authority: the format and the owned key paths it
 * names must be ones the writer allows for that file.
 */
import { findNodeAtLocation, getNodeValue, parseTree } from 'jsonc-parser'
import { isDeepStrictEqual } from 'node:util'
import { parse } from 'smol-toml'
import { InstallerError } from './errors.js'
import type { FileFormat, FileRecord } from './manifest.js'
import { unmergeJson } from './merge-jsonc.js'
import { unmergeToml } from './merge-toml.js'
import { sha256 } from './safe-write.js'

/** What a writer allows a record for one of its files to name. */
export interface OwnedAllowance {
  format: FileFormat
  paths: ReadonlyArray<readonly string[]>
  /** TOML: the owned table goes with every table under it, outside the managed block too. */
  wholeTree?: boolean
}

/**
 * The file without the record's owned part, or null when it cannot be found.
 * Owned keys are taken out in the reverse of the order they went in. A record
 * still pending (the install was interrupted, then the file was edited) is
 * undone only when every owned value is exactly as written.
 */
export function unmergeRecord(bytes: Buffer, record: FileRecord, label: string, allow: OwnedAllowance): Buffer | null {
  const owned = record.owned ?? []
  if (record.format !== allow.format || !owned.every((o) => allow.paths.some((p) => isDeepStrictEqual([...p], o.path)))) {
    throw new InstallerError('manifest_path_refused', label)
  }
  if (!owned.length) return null
  if (record.state === 'pending' && ownedModified(bytes, record).length) return null
  if (record.format === 'toml') return owned.length === 1 ? unmergeToml(bytes, owned[0]!.path, label, { outside: allow.wholeTree === true }) : null
  if (record.format === 'json' || record.format === 'jsonc') {
    let cur: Buffer | null = bytes
    for (const o of [...owned].reverse()) {
      cur = unmergeJson(cur, o.path, record.format, label, o.created ?? 0)
      if (!cur) return null
    }
    return cur
  }
  return null
}

/** Owned keys whose value the user changed since the install (reported on uninstall). */
export function ownedModified(bytes: Buffer, record: FileRecord): string[][] {
  const changed: string[][] = []
  let value: (path: string[]) => unknown
  try {
    if (record.format === 'toml') {
      const doc = parse(bytes.toString('utf8')) as Record<string, unknown>
      value = (path) => path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), doc)
    } else {
      const root = parseTree(bytes.toString('utf8').replace(/^\uFEFF/, ''), [], { allowTrailingComma: true })
      value = (path) => {
        const n = root ? findNodeAtLocation(root, path) : undefined
        return n ? JSON.parse(JSON.stringify(getNodeValue(n))) : undefined
      }
    }
  } catch {
    return (record.owned ?? []).map((o) => o.path)
  }
  for (const o of record.owned ?? []) {
    const v = value(o.path)
    if (v === undefined || sha256(JSON.stringify(v)) !== o.valueSha256) changed.push(o.path)
  }
  return changed
}
