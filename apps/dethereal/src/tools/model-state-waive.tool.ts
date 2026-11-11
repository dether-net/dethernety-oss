/**
 * model_state_waive — a person's decision that one gap in the Gate 3 criteria
 * is accepted for named elements, with the reason on record.
 *
 * A waiver covers one criterion and at most a few elements that fail it right
 * now. Some gaps are never waivable (C5, C6, and per-element gaps whose fix is
 * always available), and a criterion stops passing once more than a quarter of
 * what it assesses is waived. A waiver lasts while each element stays as it was
 * when waived. Every waiver is shown wherever the
 * state is shown, as "REVIEWED (N waivers: …)".
 *
 * A grant is recorded on this machine, beside the key this server keeps in the
 * user's home, for this model directory: a record written by hand, granted on
 * another machine, or copied from another directory is listed as unverified and
 * does not count until the operator grants it here. The tool always asks for
 * approval.
 */
import { z } from 'zod'
import { ClientFreeTool, type ToolContext, type ToolResult } from './base-tool.js'
import { ElementIdsSchema, nextRevision, Refusal, writeStateChecked } from './model-state.tool.js'
import { validatePathConfinement } from '../utils/path-confinement.js'
import {
  grantMacFor,
  loadGateInput,
  loadWaiverKey,
  readWaiverGrants,
  updateWaiverGrants,
  waiverKeyRefusal,
  waiverVerifier,
  withPointerLock,
  parseWaivers,
  prepareWaiver,
  safeErrorMessage,
  WAIVER_BASES,
  WAIVER_LIMITS,
  isShowableReason,
  type Criterion,
  type WaiverRecord,
} from '../utils/gates.js'
import { readState, StateFileError, type ModelState } from '../utils/state-store.js'

// =============================================================================
// The tool
// =============================================================================

const CRITERIA = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'] as const

const InputSchema = z.object({
  directory_path: z.string().max(4096).describe('Model directory'),
  criterion: z.enum(CRITERIA).describe('The Gate 3 criterion whose failure is waived'),
  element_ids: ElementIdsSchema.describe(`Elements that fail the criterion now (at most ${WAIVER_LIMITS.perCall})`),
  reason: z.string().max(500).describe('Why the gap is accepted, in a sentence the operator agreed to (10–500 characters)'),
  basis: z.enum(WAIVER_BASES).optional()
    .describe('not_applicable: the requirement does not apply; not_observable: the value cannot be observed; ' +
      'accepted_risk: the operator accepts the gap; platform_limitation: the platform cannot record it'),
  revoke: z.boolean().optional().describe('Withdraw the waivers of this criterion for these elements instead of granting one'),
}).strict()

type Input = z.infer<typeof InputSchema>


export class ModelStateWaiveTool extends ClientFreeTool<Input, Record<string, unknown>> {
  readonly name = 'model_state_waive'
  readonly description =
    'Waive one Gate 3 criterion for up to five named elements that fail it now, with the operator\'s reason — or revoke ' +
    'such a waiver. Call only after the operator answered the workflow\'s waiver questions (waive at waiver-accept, then ' +
    'the waiver-reason reply); never ask for a waiver in your own words. Some gaps are never waivable ' +
    '(C5, C6, an unclassified or template-less Tier 1–2 component, a placeholder value, a criterion failing structurally, ' +
    'a C7 floor fixed by the data item\'s class or reached by one of its regulatory flags; a floor inferred only from the ' +
    'class name may be waived), a ' +
    'criterion stops passing when more than a quarter of what it assesses is waived, and a waiver lapses when its element changes.'
  readonly inputSchema = InputSchema

  async execute(input: Input, _context: ToolContext): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const dir = await validatePathConfinement(input.directory_path)
      return { success: true, data: input.revoke ? await this.revoke(dir, input) : await this.grant(dir, input) }
    } catch (err) {
      if (err instanceof Refusal) return { success: false, error: err.message, ...(Object.keys(err.details).length ? { data: err.details } : {}) }
      if (err instanceof StateFileError && err.code === 'too_large') {
        return { success: false, error: "this machine's waiver grants file is full for this model; revoke waivers no longer used first", data: { codes: ['waiver_grants_full'] } }
      }
      if (err instanceof StateFileError) return { success: false, error: err.message }
      return { success: false, error: safeErrorMessage(err, 'model_state_waive failed') }
    }
  }

  private async write(dir: string, before: ModelState, next: (s: ModelState) => ModelState): Promise<ModelState> {
    return writeStateChecked(dir, before, next)
  }

  private async grant(dir: string, input: Input): Promise<Record<string, unknown>> {
    const reason = input.reason.trim()
    if (!isShowableReason(reason)) {
      throw new Refusal('reason must be a sentence of 10–500 characters without control, line-separator or invisible characters')
    }
    if (input.element_ids.length === 0) throw new Refusal('name the elements to waive')
    const before = await readState(dir)
    if (!before) throw new Refusal('the model has no workflow state yet: transition to SCOPE_DEFINED first')
    const refusedKey = waiverKeyRefusal(dir)
    if (refusedKey) {
      throw new Refusal(`this machine's waiver key cannot be used here (${refusedKey.replaceAll('_', ' ')}), so no waiver can be granted`, { codes: [refusedKey] })
    }
    const key = await loadWaiverKey(true, dir)
    if (!key) throw new Refusal('this machine has no usable waiver key, so no waiver can be granted', { codes: ['no_waiver_key'] })
    if (!(await readWaiverGrants(dir)).usable) {
      throw new Refusal("this machine's waiver grants file beside the key cannot be used, so no waiver can be granted; fix it first", { codes: ['waiver_grants_unavailable'] })
    }
    const verify = await waiverVerifier(dir)
    let gateInput
    try {
      gateInput = await loadGateInput(dir)
    } catch (err) {
      throw new Refusal(`the model could not be read (${safeErrorMessage(err)})`)
    }
    const criterion = input.criterion as Criterion
    const { fingerprints, refused } = prepareWaiver(gateInput, criterion, input.element_ids, before.waivers, verify)
    if (refused.length) throw new Refusal(`waiver refused: ${refused.map((r) => `${r.id}: ${r.why}`).join('; ')}`, { refused })
    const record: WaiverRecord = {
      criterion,
      element_ids: Object.keys(fingerprints),
      reason,
      ...(input.basis ? { basis: input.basis } : {}),
      waived_at: new Date().toISOString(),
      revision: nextRevision(before),
      fingerprints,
    }
    // Under this machine's pointer lock, then the state's (the settlement's order): the grant first, so a record in
    // the state file always has its grant, and taken back if the state write fails, so a refused call grants nothing.
    const mac = await grantMacFor(dir, record)
    if (!mac) throw new Refusal('this machine has no usable waiver key, so no waiver can be granted', { codes: ['no_waiver_key'] })
    const stored = await withPointerLock(async (lock) => {
      await updateWaiverGrants(dir, { add: [mac] }, lock)
      try {
        return await this.write(dir, before, (s) => ({ ...s, waivers: [...(Array.isArray(s.waivers) ? s.waivers : []), record] }))
      } catch (err) {
        await updateWaiverGrants(dir, { remove: [mac] }, lock).catch(() => undefined)
        throw err
      }
    })
    return { granted: { criterion, element_ids: record.element_ids }, waiver_records: parseWaivers(stored.waivers).records.length, revision: stored.revision }
  }

  private async revoke(dir: string, input: Input): Promise<Record<string, unknown>> {
    const before = await readState(dir)
    if (!before) throw new Refusal('the model has no workflow state yet')
    // A revoke must be able to withdraw this machine's grants: otherwise a copy of the record put back would count again.
    const refusedKey = waiverKeyRefusal(dir)
    if (refusedKey || !(await loadWaiverKey(false, dir)) || !(await readWaiverGrants(dir)).usable) {
      throw new Refusal("this machine's waiver key or grants file cannot be used here, so no waiver can be revoked; fix it first",
        { codes: [refusedKey ?? 'waiver_grants_unavailable'] })
    }
    const verify = await waiverVerifier(dir)
    const ids = new Set(input.element_ids)
    let removed = 0
    const kept: unknown[] = []
    const grants: { add: string[]; remove: string[] } = { add: [], remove: [] }
    for (const raw of Array.isArray(before.waivers) ? before.waivers : []) {
      const r = raw as Partial<WaiverRecord>
      if (r?.criterion !== input.criterion || !Array.isArray(r.element_ids) || !r.element_ids.some((id) => ids.has(id))) { kept.push(raw); continue }
      const left = r.element_ids.filter((id) => !ids.has(id))
      removed += r.element_ids.length - left.length
      // A withdrawn grant of this machine's goes from the grants too: a copy of the record put back never counts again.
      const mine = verify(r as WaiverRecord)
      if (mine) grants.remove.push((await grantMacFor(dir, r as WaiverRecord))!)
      if (!left.length) continue
      // What is left keeps its fingerprints; it is granted again only if the record was this machine's to begin with.
      const { mac: _old, ...rest } = { ...r, element_ids: left, fingerprints: Object.fromEntries(left.map((id) => [id, r.fingerprints?.[id] ?? ''])) } as WaiverRecord
      if (mine) grants.add.push((await grantMacFor(dir, rest))!)
      kept.push(rest)
    }
    if (!removed) throw new Refusal(`no waiver of ${input.criterion} names these elements`)
    // What stays is granted before the state write (taken back if it fails); what goes is withdrawn only after it.
    const stored = await withPointerLock(async (lock) => {
      if (grants.add.length) await updateWaiverGrants(dir, { add: grants.add }, lock)
      let written
      try {
        written = await this.write(dir, before, (s) => ({ ...s, waivers: kept }))
      } catch (err) {
        if (grants.add.length) await updateWaiverGrants(dir, { remove: grants.add }, lock).catch(() => undefined)
        throw err
      }
      if (grants.remove.length) await updateWaiverGrants(dir, { remove: grants.remove }, lock)
      return written
    })
    return { revoked: { criterion: input.criterion, removed }, revision: stored.revision }
  }
}

export const modelStateWaiveTool = new ModelStateWaiveTool()
