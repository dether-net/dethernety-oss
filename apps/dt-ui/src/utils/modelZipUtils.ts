import { zipSync, unzipSync, strToU8, strFromU8, type UnzipFileInfo } from 'fflate'
import type { SplitModel, ConsolidatedAttributesFile } from '@dethernety/dt-core'

const FILE_NAMES = {
  manifest: 'manifest.json',
  structure: 'structure.json',
  dataFlows: 'dataflows.json',
  dataItems: 'data-items.json',
} as const

const ATTRIBUTE_DIRS = {
  boundaries: 'attributes/boundaries',
  components: 'attributes/components',
  dataFlows: 'attributes/dataFlows',
  dataItems: 'attributes/dataItems',
} as const

/**
 * Conservative decompression limits for model import. Legitimate exported models are
 * KB–MB in size; these ceilings only reject pathological archives (zip bombs, entry
 * floods, over-large files) before they can OOM/DoS the importing browser tab. Tunable.
 */
export interface ZipImportLimits {
  maxCompressedBytes: number // raw archive byte length
  maxEntries: number // number of entries in the archive
  maxEntryBytes: number // per-file uncompressed size
  maxTotalBytes: number // sum of extracted uncompressed bytes
}

const DEFAULT_ZIP_LIMITS: ZipImportLimits = {
  maxCompressedBytes: 100 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
}

// The exact set of entries zipToSplitModel consumes — unrecognised entries are never inflated.
const KNOWN_FILES = new Set<string>([...Object.values(FILE_NAMES), 'attributes.json'])
const ATTR_PREFIXES = Object.values(ATTRIBUTE_DIRS).map(dir => `${dir}/`)
const isKnownEntry = (name: string): boolean =>
  KNOWN_FILES.has(name) || ATTR_PREFIXES.some(prefix => name.startsWith(prefix) && name.endsWith('.json'))

// Keys that would mutate the prototype chain if used as a bracket-assignment target.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function splitModelToZip(splitModel: SplitModel): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [FILE_NAMES.manifest]: strToU8(JSON.stringify(splitModel.manifest, null, 2)),
    [FILE_NAMES.structure]: strToU8(JSON.stringify(splitModel.structure, null, 2)),
    [FILE_NAMES.dataFlows]: strToU8(JSON.stringify(splitModel.dataFlows, null, 2)),
    [FILE_NAMES.dataItems]: strToU8(JSON.stringify(splitModel.dataItems, null, 2)),
  }

  for (const [type, dir] of Object.entries(ATTRIBUTE_DIRS)) {
    const group = splitModel.attributes[type as keyof ConsolidatedAttributesFile]
    if (group) {
      for (const [elementId, attrs] of Object.entries(group)) {
        files[`${dir}/${elementId}.json`] = strToU8(JSON.stringify(attrs, null, 2))
      }
    }
  }

  return zipSync(files)
}

export function zipToSplitModel(zipData: Uint8Array, limits: ZipImportLimits = DEFAULT_ZIP_LIMITS): SplitModel {
  if (zipData.byteLength > limits.maxCompressedBytes) {
    throw new Error('Model archive rejected: the file is too large to import.')
  }

  // Enforce decompression limits BEFORE inflation. fflate calls this filter per entry with the
  // declared uncompressed size and pre-allocates each entry's output buffer to that size, so
  // validating originalSize up front bounds actual memory even against a spoofed header.
  // Throwing aborts the whole unzipSync; returning false skips (never inflates) that entry.
  let entryCount = 0
  let totalBytes = 0
  const files = unzipSync(zipData, {
    filter: (file: UnzipFileInfo): boolean => {
      entryCount++
      if (entryCount > limits.maxEntries) {
        throw new Error(`Model archive rejected: too many files (limit ${limits.maxEntries}).`)
      }
      if (file.originalSize > limits.maxEntryBytes) {
        throw new Error(`Model archive rejected: "${file.name}" is too large.`)
      }
      if (!isKnownEntry(file.name)) return false // never inflate unrecognised entries
      totalBytes += file.originalSize
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error('Model archive rejected: total uncompressed size exceeds the limit.')
      }
      return true
    },
  })

  const readJson = (name: string): any => {
    const data = files[name]
    if (!data) {
      throw new Error(`Missing required file in ZIP: ${name}`)
    }
    return JSON.parse(strFromU8(data))
  }

  const attributes: ConsolidatedAttributesFile = {
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {},
  }

  // Check for consolidated attributes.json (backward compat)
  if (files['attributes.json']) {
    const consolidated = JSON.parse(strFromU8(files['attributes.json']))
    // Copy only the known top-level keys — a blind Object.assign would let a `__proto__`
    // key in the parsed JSON mutate the prototype chain via [[Set]].
    for (const type of Object.keys(ATTRIBUTE_DIRS) as (keyof ConsolidatedAttributesFile)[]) {
      if (consolidated[type]) attributes[type] = consolidated[type]
    }
  } else {
    // Read per-element attribute files from attributes/{type}/{elementId}.json
    for (const [type, dir] of Object.entries(ATTRIBUTE_DIRS)) {
      const prefix = `${dir}/`
      for (const [path, data] of Object.entries(files)) {
        if (path.startsWith(prefix) && path.endsWith('.json')) {
          const elementId = path.slice(prefix.length, -5)
          // elementId is attacker-controlled (derived from the entry path); skip keys that
          // would pollute the prototype chain when used as a bracket-assignment target.
          if (UNSAFE_KEYS.has(elementId)) continue
          attributes[type as keyof ConsolidatedAttributesFile]![elementId] = JSON.parse(strFromU8(data))
        }
      }
    }
  }

  return {
    manifest: readJson(FILE_NAMES.manifest),
    structure: readJson(FILE_NAMES.structure),
    dataFlows: readJson(FILE_NAMES.dataFlows),
    dataItems: readJson(FILE_NAMES.dataItems),
    attributes,
  }
}
