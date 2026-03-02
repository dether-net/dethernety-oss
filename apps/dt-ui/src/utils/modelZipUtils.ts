import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
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

export function zipToSplitModel(zipData: Uint8Array): SplitModel {
  const files = unzipSync(zipData)

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
    Object.assign(attributes, consolidated)
  } else {
    // Read per-element attribute files from attributes/{type}/{elementId}.json
    for (const [type, dir] of Object.entries(ATTRIBUTE_DIRS)) {
      const prefix = `${dir}/`
      for (const [path, data] of Object.entries(files)) {
        if (path.startsWith(prefix) && path.endsWith('.json')) {
          const elementId = path.slice(prefix.length, -5)
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
