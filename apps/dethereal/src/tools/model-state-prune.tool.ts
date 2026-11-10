/**
 * model_state_prune — deletes the attribute files of elements the model no longer has.
 *
 * The edit tools cannot delete a file, and a model file is never changed through a shell. This call
 * names every file it deletes (the approval shows them), and the server deletes exactly the files it
 * finds orphaned itself: a structured attribute file whose name is its element id, for an id in no
 * element group of the model. Anything else that looks orphaned (a flat file, a file named for
 * another id, an id that differs from a live one only in letter case) is listed and never deleted.
 *
 * Registrations are not touched: the values registered for the gone elements stay orphaned until the
 * operator acknowledges them in model_state_settle. The call appends a signed `prune` entry to the
 * settlement log and re-signs the baseline with the same values, then deletes, then records this
 * machine's pointer. All or nothing: every file is checked before anything is written.
 *
 * With the settlement off, the call deletes the same files under the same checks, and reads and writes
 * no settlement file and no key.
 */
import path from 'node:path'
import { z } from 'zod'
import { ClientFreeTool, type ToolContext, type ToolResult } from './base-tool.js'
import { Refusal } from './model-state.tool.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import { LockBusyError, type FileLockHandle } from '../utils/file-lock.js'
import { elementRefs, loadGateInput, safeErrorMessage, updateBaselinePointers, waiverKeyState, withPointerLock, PENDING_GROUPS, type ElementRef, type GateInput, type SettleGroup } from '../utils/gates.js'
import {
  BASELINE_FILE, SETTLEMENTS_FILE, SETTLE_LIMITS, contentOf, logDigest, nextLog, operatorOnly, scanAttributeFiles, signedBaseline,
  type AttributeFile, type AttributeScan,
} from '../utils/settlement.js'
import { settlementState } from '../utils/settlement-state.js'
import { settlementOn } from '../utils/settlement-switch.js'
import { StateFileError, withSettlementLock, type SettlementIO, type SettlementOptions } from '../utils/state-store.js'

const FILE = /^attributes\/(components|dataFlows|dataItems|boundaries)\/[A-Za-z0-9_-]{1,256}\.json$/

const InputSchema = z.object({
  directory_path: z.string().max(4096).describe('Model directory'),
  files: z.array(z.string().regex(FILE)).min(1).max(SETTLE_LIMITS.items)
    .describe(`The attribute files to delete, as this tool's refusal or the previous call's next_files lists them: exactly the orphaned set, at most ${SETTLE_LIMITS.items} a call`),
}).strict()

type Input = z.infer<typeof InputSchema>

interface Found {
  /** Deletable: structured, named for its element id, and that id is in no group */
  orphans: AttributeFile[]
  /** Look orphaned, but are never deleted by this tool */
  ambiguous: Array<{ file: string; reason: string }>
}

/** The attribute files whose element the model no longer has, as the server finds them. */
function findOrphans(refs: Record<SettleGroup, Map<string, ElementRef>>, scan: AttributeScan): Found {
  const live = new Set<string>()
  for (const g of PENDING_GROUPS) for (const id of refs[g].keys()) live.add(id)
  const liveLower = new Set([...live].map((id) => id.toLowerCase()))
  const orphans: AttributeFile[] = []
  const ambiguous: Found['ambiguous'] = []
  for (const f of scan.files) {
    const stem = path.posix.basename(f.rel, '.json')
    const names = [stem, ...(f.elementId ? [f.elementId] : [])]
    if (names.some((n) => live.has(n))) continue
    if (f.flat) ambiguous.push({ file: f.rel, reason: 'not the structured {elementId, attributes} form: its element is found by name, not by file' })
    else if (f.elementId !== stem) ambiguous.push({ file: f.rel, reason: 'its name is not the element id it holds' })
    else if (liveLower.has(stem.toLowerCase())) ambiguous.push({ file: f.rel, reason: 'its name differs from a live element id only in letter case' })
    else if (!FILE.test(f.rel)) ambiguous.push({ file: f.rel, reason: 'its name is not an element id' })
    else orphans.push(f)
  }
  return { orphans, ambiguous }
}

/** The page this call deletes, checked: the files, the orphaned files left for later calls, and what only looks orphaned. */
interface Page {
  orphans: AttributeFile[]
  ambiguous: Found['ambiguous']
  /** Orphaned files beyond this page */
  remaining: number
  /** The next call's page as it will find it, unless the model changes first (then it refuses, listing the new one) */
  nextFiles: string[]
}

async function loadModelOrRefuse(dir: string): Promise<GateInput> {
  try {
    return await loadGateInput(dir)
  } catch (err) {
    throw new Refusal(`the model could not be read (${safeErrorMessage(err)})`, { codes: ['attribute_issues'] })
  }
}

/**
 * The page this call deletes: refused unless every attribute file reads as element attributes, the caller named exactly
 * the page, and each file still holds the bytes the scan read. Nothing is written before this passes.
 */
async function checkedPage(input: Input, io: SettlementIO, gate: GateInput, refs: Record<SettleGroup, Map<string, ElementRef>>, scan: AttributeScan): Promise<Page> {
  if (scan.consolidated) throw new Refusal('the model keeps its attributes in one attributes.json; split it into per-element files first', { codes: ['consolidated_attributes'] })
  if (gate.attributeIssues.length || scan.unreadable.length) {
    const files = [...new Set([...gate.attributeIssues.map((i) => i.file), ...scan.unreadable])].slice(0, SETTLE_LIMITS.items)
    throw new Refusal(`${gate.attributeIssues.length + scan.unreadable.length} attribute file(s) cannot be read as element attributes; fix or remove them by hand first, then prune: nothing was deleted`, { codes: ['attribute_issues'], files })
  }

  const { orphans: all, ambiguous } = findOrphans(refs, scan)
  // At most one page a call, in a stable order: the refusal lists exactly this page, and the next call the rest.
  const sorted = [...all].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const orphans = sorted.slice(0, SETTLE_LIMITS.items)
  const found = orphans.map((f) => f.rel)
  const asked = [...input.files].sort()
  if (found.length !== asked.length || found.some((f, i) => f !== asked[i])) {
    throw new Refusal(`the files named are not the orphaned attribute files: show these to the operator and ask again (${all.length} orphaned; this call takes the ${found.length} listed, the next call the rest)`,
      { codes: ['files_differ'], orphaned_files: found, orphaned_files_total: all.length, ...(ambiguous.length ? { not_deleted: ambiguous } : {}) })
  }

  // Every file checked before anything is written: still the bytes the scan read.
  for (const f of orphans) {
    const now = await io.read(f.rel)
    if (!now || !now.equals(f.bytes)) throw new StateFileError('changed', f.rel)
  }
  return { orphans, ambiguous, remaining: all.length - orphans.length, nextFiles: sorted.slice(SETTLE_LIMITS.items, 2 * SETTLE_LIMITS.items).map((f) => f.rel) }
}

/** What a prune says it did. */
function outcome(page: Page): Record<string, unknown> {
  return {
    deleted: page.orphans.map((f) => f.rel),
    ...(page.remaining > 0 ? { remaining: page.remaining, next_files: page.nextFiles } : {}),
    ...(page.ambiguous.length ? { not_deleted: page.ambiguous } : {}),
    hint: page.remaining > 0
      ? `${page.remaining} more orphaned attribute file(s): ask the operator to approve next_files, then validate the model with validate_model_json (action "gates")`
      : 'validate the model with validate_model_json (action "gates")',
  }
}

const DESCRIPTION =
  "Delete the attribute files of elements the model no longer has (orphaned attribute files), after the operator " +
  `approves the list: pass exactly the files the server finds orphaned, at most ${SETTLE_LIMITS.items} a call ` +
  "(a refusal, or the previous call's next_files, lists them). A file that only looks orphaned (a flat file, one named for another id) is listed and never " +
  'deleted.'
const SETTLE_NOTE = " Registered values of the gone elements are not dropped here: model_state_settle drops them with the operator's acknowledgement."
const DESCRIPTION_END = ' All or nothing: a refused call deletes nothing. Never call this on your own.'

export class ModelStatePruneTool extends ClientFreeTool<Input, Record<string, unknown>> {
  readonly name = 'model_state_prune'
  // As the tool list: read once, when the server starts.
  readonly description = `${DESCRIPTION}${settlementOn() ? SETTLE_NOTE : ''}${DESCRIPTION_END}`
  readonly inputSchema = InputSchema

  /** Tests only: passed to the store so a failure part-way can be injected. */
  storeOptions: SettlementOptions = {}

  async execute(input: Input, context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const dir = await validatePathConfinement(input.directory_path)
      if (new Set(input.files).size !== input.files.length) throw new Refusal('the call names a file twice', { codes: ['files_differ'] })
      if (!settlementOn(context.settlement)) {
        return { success: true, data: await withSettlementLock(dir, (io) => this.pruneFiles(dir, input, io), this.storeOptions) }
      }
      // As in model_state_settle: the key first (the pointer lock lives beside it), then the pointer lock, then the model's.
      const key = await waiverKeyState(true, dir)
      if (!key.key) throw new Refusal(`this machine's key cannot be used (${key.code ?? 'key_absent'}), so nothing can be pruned; fix the key first`, { codes: ['baseline_key_unavailable'] })
      const data = await withPointerLock((lock) => withSettlementLock(dir, (io) => this.prune(dir, input, io, lock), this.storeOptions))
      return { success: true, data }
    } catch (err) {
      if (err instanceof Refusal) return { success: false, error: err.message, ...(Object.keys(err.details).length ? { data: err.details } : {}) }
      if (err instanceof LockBusyError) return { success: false, error: 'another settlement is writing (this model, or this machine\'s settlement pointer); retry', data: { codes: ['busy'] } }
      if (err instanceof StateFileError) {
        return { success: false, error: `${err.message}; nothing more was deleted. Look again with model_state get, then ask the operator again.`, data: { codes: [err.code === 'changed' ? 'changed' : 'unreadable'] } }
      }
      return { success: false, error: safeErrorMessage(err, 'model_state_prune failed') }
    }
  }

  /** With the settlement off: the checked page deleted, and nothing else read or written. */
  private async pruneFiles(dir: string, input: Input, io: SettlementIO): Promise<Record<string, unknown>> {
    const gate = await loadModelOrRefuse(dir)
    const scan = await scanAttributeFiles(dir)
    const page = await checkedPage(input, io, gate, elementRefs(gate), scan)
    for (const f of page.orphans) await io.remove(f.rel, f.bytes)
    return outcome(page)
  }

  private async prune(dir: string, input: Input, io: SettlementIO, pointerLock: FileLockHandle): Promise<Record<string, unknown>> {
    const gate = await loadModelOrRefuse(dir)
    const st = await settlementState(dir, gate)
    if (!st.key || !st.modelHash || !st.pointers.usable || st.baseline.status === 'unavailable') {
      throw new Refusal("this machine's key or settlement pointer cannot be used, so nothing can be pruned; fix the files beside the key first", { codes: [st.pointers.usable ? 'baseline_key_unavailable' : 'pointer_unavailable'] })
    }
    // A baseline that exists but does not verify, or one this machine saw and is now gone (rolled back), is
    // never re-signed here: settle restarts it, under a question that says so.
    if (st.baseline.status !== 'verified' && (st.baseline.bytes !== null || st.baseline.code)) {
      throw new Refusal(`the settlement baseline does not verify (${st.baseline.code ?? st.baseline.status}); register the model's values with model_state_settle first`, { codes: ['baseline_unverified'] })
    }
    const page = await checkedPage(input, io, gate, st.refs, st.scan)
    const { orphans } = page

    const logBytes = await io.read(SETTLEMENTS_FILE)
    const baselineBytes = await io.read(BASELINE_FILE)
    const pointers = st.pointers.revisions
    const verified = st.baseline.status === 'verified' ? st.baseline.baseline! : null
    const carried = st.baseline.carriedFrom
    if (carried && verified) {
      try {
        await updateBaselinePointers({ [carried]: Math.max(pointers[carried] ?? 0, verified.revision + 1) }, pointerLock, st.modelPath)
      } catch {
        throw new Refusal("this machine's settlement pointer could not be updated, so nothing was written; fix the file beside the key first", { codes: ['pointer_unavailable'] })
      }
    }
    // The log first, then the baseline that signs it with the same values: no deletion is ever unlogged.
    const log = nextLog(st.baseline, logBytes, { at: new Date().toISOString(), action: 'prune', files: orphans.map((f) => f.rel), element_ids: orphans.map((f) => f.elementId!) })
    await io.replace(SETTLEMENTS_FILE, log.content, logBytes)
    const revision = Math.max(verified?.revision ?? 0, pointers[st.modelHash] ?? 0, carried ? pointers[carried] ?? 0 : 0) + 1
    // The same registrations, with the machine's own (a carried baseline keeps only the operator's).
    const content = carried ? operatorOnly(contentOf(verified)) : contentOf(verified)
    await io.replace(BASELINE_FILE, signedBaseline(st.key, st.modelHash, { ...content, revision, log_digest: logDigest(log.content) }), baselineBytes)
    for (const f of orphans) await io.remove(f.rel, f.bytes)
    let warning: string | undefined
    try {
      await updateBaselinePointers({ [st.modelHash]: revision }, pointerLock, st.modelPath)
    } catch {
      warning = "the files were deleted, but this machine's settlement pointer could not be updated; the next settlement updates it"
    }
    return {
      ...outcome(page),
      ...(st.drift.orphaned.keys.length ? { orphaned_registrations: st.drift.orphaned.keys.length, note: 'values registered for the gone elements stay until the operator acknowledges them in model_state_settle' } : {}),
      ...(log.restarted ? { log_restarted: log.restarted } : {}),
      ...(warning ? { warning } : {}),
    }
  }
}

export const modelStatePruneTool = new ModelStatePruneTool()
