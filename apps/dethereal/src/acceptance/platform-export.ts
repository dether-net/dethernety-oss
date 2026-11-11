/**
 * The platform export a scored run hands the scorer (`export/run-model.json`,
 * `export/key-model.json` in the run directory): the model as the platform
 * holds it, plus every element's exposures with the ATT&CK techniques that
 * exploit them. It is taken through the server's own tools, with a signed-in
 * session in the server's sandbox home; nothing here reads that home.
 * Development tooling: never part of the shipped bundle.
 */
import fs from 'node:fs'
import path from 'node:path'

export const PLATFORM_EXPORT_SCHEMA_VERSION = 1

export interface ExportedExposure {
  id: string
  name: string
  /** ATT&CK technique ids (`attack_id`) of the techniques that exploit it */
  exploitedBy: string[]
  [key: string]: unknown
}

export interface PlatformExport {
  schemaVersion: typeof PLATFORM_EXPORT_SCHEMA_VERSION
  modelId: string
  exportedAt: string
  /** The model's split files as export_model writes them, by path inside the model directory */
  files: Record<string, unknown>
  /** Exposures per element id */
  exposures: Record<string, ExportedExposure[]>
}

/** Call one server tool and return its parsed JSON result, or throw with the tool's error. */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>

function elementIds(files: Record<string, unknown>): string[] {
  const ids = new Set<string>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.id === 'string') ids.add(o.id)
      for (const [k, x] of Object.entries(o)) if (k !== 'classData' && k !== 'layout') walk(x)
    }
  }
  for (const rel of ['structure.json', 'dataflows.json', 'data-items.json']) walk(files[rel])
  return [...ids].sort()
}

function readSplit(dir: string): Record<string, unknown> {
  const files: Record<string, unknown> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = path.join(d, e.name)
      const rel = path.relative(dir, p).split(path.sep).join('/')
      if (e.isDirectory()) {
        if (rel !== '.dethereal') walk(p)
      } else if (e.name.endsWith('.json')) files[rel] = JSON.parse(fs.readFileSync(p, 'utf8'))
    }
  }
  walk(dir)
  return files
}

/**
 * Export `modelId` through the server: export_model into `workDir` (which must not exist), then
 * query_exposures for every element the export holds.
 */
export async function exportPlatformModel(call: CallTool, modelId: string, workDir: string, now = new Date()): Promise<PlatformExport> {
  if (fs.existsSync(workDir)) throw new Error('the export directory exists')
  await call('export_model', { model_id: modelId, directory_path: workDir, if_exists: 'error' })
  const files = readSplit(workDir)
  const exposures: Record<string, ExportedExposure[]> = {}
  for (const id of elementIds(files)) {
    const res = (await call('query_exposures', { action: 'list', element_id: id, limit: 500 })) as { exposures?: Array<Record<string, unknown>>; truncated?: boolean }
    if (res.truncated) throw new Error('an element holds more exposures than one read returns')
    const list = (res.exposures ?? []).map((x) => ({
      ...x,
      id: String(x.id),
      name: String(x.name ?? ''),
      exploitedBy: ((x.exploitedBy as Array<{ attack_id?: string }> | undefined) ?? []).map((t) => t.attack_id).filter((t): t is string => typeof t === 'string').sort(),
    }))
    if (list.length) exposures[id] = list
  }
  return { schemaVersion: PLATFORM_EXPORT_SCHEMA_VERSION, modelId, exportedAt: now.toISOString(), files, exposures }
}
