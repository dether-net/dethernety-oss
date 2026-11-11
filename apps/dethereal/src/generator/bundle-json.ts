/**
 * `bundle.json`: one per bundle, at the bundle root. The installer and the pack test read it;
 * acceptance runs record its `contentHash`.
 *
 * - `files`: every file generated for the harness except bundle.json itself, by path relative
 *   to the package root, with the sha256 of the bytes as generated.
 * - `generatedFrom`: hash of the workflow the bundle was generated from.
 * - `contentHash`: hash over the files with the package version replaced by `<VERSION>`, so two
 *   builds that differ only in version share it.
 * - `placeholders`: the installer placeholders that occur in this bundle's files.
 */

import { byCodePoint, sha256, treeHash } from './source.js'
import type { Harness } from './types.js'

export const BUNDLE_SCHEMA_VERSION = 1
export const VERSION_PLACEHOLDER = '<VERSION>'
export const INSTALLER_PLACEHOLDERS = ['<node-abs>', '<platform-url>', '<runtime>'] as const
export const RUNTIME_PATH_CONTRACT = '~/.dethernety/runtime/current.json'

export interface BundleJson {
  readonly schemaVersion: number
  readonly harness: Harness
  readonly version: string
  readonly generatedFrom: string
  readonly contentHash: string
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>
  readonly placeholders: readonly string[]
  readonly runtimePathContract: string
}

export function bundleJson(harness: Harness, version: string, generatedFrom: string, files: ReadonlyMap<string, string>): BundleJson {
  const paths = [...files.keys()].sort(byCodePoint)
  const normalised = new Map(paths.map((p) => [p, files.get(p)!.split(version).join(VERSION_PLACEHOLDER)]))
  const all = paths.map((p) => files.get(p)!).join('\n')
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    harness,
    version,
    generatedFrom,
    contentHash: treeHash(normalised),
    files: paths.map((p) => ({ path: p, sha256: sha256(files.get(p)!) })),
    placeholders: INSTALLER_PLACEHOLDERS.filter((ph) => all.includes(ph)),
    runtimePathContract: RUNTIME_PATH_CONTRACT,
  }
}
