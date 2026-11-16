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

/** A triage run's export: each exposure also carries the lifecycle and the def_hash the server computes for it. */
export interface TriageExportedExposure extends ExportedExposure {
  lifecycle: string
  def_hash: string | null
}

export interface TriagePlatformExport extends Omit<PlatformExport, 'exposures'> {
  exposures: Record<string, TriageExportedExposure[]>
}

type ListedRow = { exposure_id?: unknown; lifecycle?: unknown; def_hash?: unknown }
type ListedPage = { model_id?: string; rows?: ListedRow[]; truncated?: boolean; next_offset?: number; listing?: string }

/** Whether a tool's refusal is `listing_changed`: by its code when the caller passes the data on, else by its message. */
function listingChanged(err: unknown): boolean {
  const codes = (err as { data?: { codes?: unknown } } | null)?.data?.codes
  if (Array.isArray(codes)) return codes.includes('listing_changed')
  return err instanceof Error && /changed since the first page/.test(err.message)
}

/**
 * Every row `list_model` holds for the directory. A server that answers the whole list in one reply (`rows` with no
 * `view`) is read as it is; otherwise the rows view is walked, `select: 'all'`, page by page with its listing. A
 * model that changes between pages restarts the walk once; a second change fails it.
 */
async function listedRows(call: CallTool, directory: string): Promise<{ model_id?: string; rows: ListedRow[] }> {
  const first = (await call('query_exposures', { action: 'list_model', directory_path: directory })) as ListedPage & { view?: string }
  if (first.view === undefined && Array.isArray(first.rows)) return { model_id: first.model_id, rows: first.rows }
  for (let attempt = 0; ; attempt++) {
    try {
      const rows: ListedRow[] = []
      let page = (await call('query_exposures', { action: 'list_model', directory_path: directory, view: 'rows', select: 'all' })) as ListedPage
      const model_id = page.model_id
      for (;;) {
        rows.push(...(page.rows ?? []))
        if (!page.truncated) return { model_id, rows }
        page = (await call('query_exposures', { action: 'list_model', directory_path: directory, view: 'rows', select: 'all', offset: page.next_offset, listing: page.listing })) as ListedPage
      }
    } catch (err) {
      if (attempt === 0 && listingChanged(err)) continue
      throw err
    }
  }
}

/**
 * The export a triage run is judged on, before its first prompt and after it ends: exportPlatformModel's, with each
 * exposure's `lifecycle` and `def_hash` from the server's own `query_exposures list_model` over the exported model
 * (export_model records which model it is). The two reads must name the same exposures, or the export fails.
 */
export async function exportTriageModel(call: CallTool, modelId: string, workDir: string, now = new Date()): Promise<TriagePlatformExport> {
  const doc = await exportPlatformModel(call, modelId, workDir, now)
  const listed = await listedRows(call, workDir)
  if (listed.model_id !== modelId) throw new Error('list_model read another model than the one exported')
  const byId = new Map<string, { lifecycle: string; def_hash: string | null }>()
  for (const r of listed.rows) {
    if (typeof r.exposure_id !== 'string' || typeof r.lifecycle !== 'string' || (r.def_hash !== null && typeof r.def_hash !== 'string')) throw new Error('list_model returned a row without its id, lifecycle or def_hash')
    byId.set(r.exposure_id, { lifecycle: r.lifecycle, def_hash: r.def_hash as string | null })
  }
  const exposures: Record<string, TriageExportedExposure[]> = {}
  const seen = new Set<string>()
  for (const [element, list] of Object.entries(doc.exposures)) {
    exposures[element] = list.map((x) => {
      const row = byId.get(x.id)
      if (!row) throw new Error(`exposure ${x.id} is in the element reads but not in list_model`)
      seen.add(x.id)
      return { ...x, ...row }
    })
  }
  const missing = [...byId.keys()].filter((id) => !seen.has(id))
  if (missing.length) throw new Error(`list_model holds ${missing.length} exposure(s) no element read returned`)
  return { ...doc, exposures }
}

