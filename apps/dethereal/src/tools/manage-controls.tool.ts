/**
 * Manage Controls Tool
 *
 * CRUD and assignment operations for security controls on the Dethernety platform.
 * Controls can be assigned to component classes, linked to exposures via countermeasures,
 * and assigned to model elements via SUPPORTS edges.
 */

import { z } from 'zod'
import {
  DtControl,
  DtClass,
  DtControlLibrary,
  ExternalEditDetectedError,
  CloneAndSwapNotImplemented,
  IllegalEditedByError,
  LockBusyError,
  acquireLock,
  releaseLock,
  applyPendingRewrites,
  inspectPendingRewrite,
  clearPendingRewrite,
  type LockHandle,
  readControlFile,
  listControlFiles,
} from '@dethernety/dt-core'
import { ClientDependentTool, ToolContext, ToolResult } from './base-tool.js'
import { validatePathConfinement } from '../utils/directory-utils.js'

/**
 * Actions that touch the model directory and therefore go through the
 * lock + WAL-replay pre-dispatch. Read-only actions on the platform
 * (`list`, `get`, `rank`) and pure CRUD that doesn't touch local files
 * (`create`, `update`, `delete`, `assign`) skip both — they don't share
 * state with concurrent control-library writes.
 */
const DIRECTORY_TOUCHING_ACTIONS = new Set([
  'pull-controls',
  'push-greenfield',
  'push-brownfield',
  'tombstone',
  'set-local-edited',
  'promote-external-edit',
  // WAL repair recovery. Lock-acquired (no concurrent mutation while
  // operator inspects/clears) but the WAL pre-replay is explicitly
  // skipped (the operator's intent is to observe or discard the
  // stranded journal, not to apply it).
  'inspect-wal',
  'clear-wal',
])

const SKIPS_WAL_REPLAY = new Set(['inspect-wal', 'clear-wal'])

/**
 * Decode the `email` / `sub` claim from a JWT. No signature verification
 * — the platform itself authenticated the token before issuing the
 * Apollo client; we only need the identity claim for audit attribution.
 *
 * Returns `undefined` on any failure (malformed token, no payload
 * segment, base64 error, JSON parse error, missing claim) — the caller
 * treats `undefined` as "audit log entry written with only the local
 * `operator` field, no `authnOperator`".
 */
function decodeJwtIdentity(token: string | undefined): string | undefined {
  if (!token) return undefined
  try {
    const segments = token.split('.')
    const payloadSegment = segments[1]
    if (!payloadSegment) return undefined
    // base64url → base64 → JSON
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      payloadSegment.length + ((4 - (payloadSegment.length % 4)) % 4),
      '='
    )
    const json = Buffer.from(padded, 'base64').toString('utf-8')
    const payload = JSON.parse(json) as { email?: unknown; sub?: unknown }
    if (typeof payload.email === 'string' && payload.email) return payload.email
    if (typeof payload.sub === 'string' && payload.sub) return payload.sub
    return undefined
  } catch {
    return undefined
  }
}

const InputSchema = z.object({
  action: z.enum([
    'list', 'get', 'create', 'update', 'delete', 'assign', 'rank',
    // Control-library actions backed by DtControlLibrary
    'pull-controls', 'push-greenfield', 'push-brownfield', 'tombstone', 'set-local-edited',
    'promote-external-edit',
    // WAL repair recovery
    'inspect-wal', 'clear-wal',
  ]).describe('Action to perform'),
  folder_id: z.string().optional().describe('Folder ID for listing or creating controls. For update: omitted = current folder preserved'),
  // Security: control_id is interpolated into filesystem paths
  // (controls/<id>.json) by the engine. Restrict to characters that cannot
  // form path traversal — letters, digits, underscore, hyphen. UUIDs and
  // greenfield-* prefixes both satisfy this. Anything containing `/`, `.`,
  // or backslash is rejected at the MCP boundary so it never reaches
  // getControlFilePath.
  control_id: z.string().regex(/^[A-Za-z0-9_-]+$/, 'control_id must contain only [A-Za-z0-9_-] (no path separators or .. segments)').optional().describe('Control ID (required for get, update, delete, assign, push-*, tombstone, set-local-edited)'),
  class_ids: z.array(z.string()).optional().describe('Control class IDs for filtering (list) or assignment (create/update). For update: omitted = current class bindings preserved; pass the FULL desired list to change bindings (it replaces, not appends)'),
  name: z.string().optional().describe('Control name — required for create, substring filter for list. For update: omitted = unchanged'),
  description: z.string().optional().describe('Control description. For update: omitted = unchanged'),
  class_type: z.string().optional().describe('Control class type filter (for list action)'),
  element_ids: z.array(z.string()).optional().describe('Element IDs — for list: filter controls supporting these elements; for assign: elements to link'),
  module_id: z.string().optional().describe('Module ID filter (for list action)'),
  module_name: z.string().optional().describe('Module name filter (for list action)'),
  element_types: z.array(z.string()).optional().describe('Element types for rank action (e.g. PROCESS, STORE, EXTERNAL_ENTITY)'),
  top_n: z.number().optional().describe('Number of top candidates to return for rank action (default 5)'),
  // Control-library
  directory_path: z.string().optional().describe('Path to the model directory (required for pull-controls / push-* / tombstone / set-local-edited)'),
  // Same security constraint as control_id — pull-controls writes one
  // controls/<id>.json per id, so each must be safe for filesystem use.
  control_ids: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/, 'control_ids[] entries must contain only [A-Za-z0-9_-]')).optional().describe('Control IDs to pull in a single batched call (pull-controls)'),
  supporting_element_ids: z.array(z.string()).optional().describe('Element IDs to attach via SUPPORTS edges during push-greenfield'),
  live_assigned_model_ids: z.array(z.string()).nullable().optional().describe('Pre-fetched assignedModelIds — caller passes result of getControlsAssignedModels to avoid a redundant round-trip'),
  this_model_id: z.string().optional().describe('The id of the model being synced (push-brownfield Step E — recognises alone-vs-shared)'),
  decision: z.any().optional().describe('BrownfieldDecision object: { sharedOwnership: "cancel"|"push-anyway"|"clone-and-swap"|"push-unverified", perKey?: Record<`${classIdx}.${key}`, { chosen: "keep"|"accept-theirs"|"merge", merged? }>, queryFailureReason?, queryAttempts? }'),
  fresh_platform_attrs: z.record(z.string(), z.record(z.string(), z.any())).optional().describe('Map<classId, Record<attrKey, value>> — fresh server attributes from the pre-push batched fetch (push-brownfield Step B)'),
  class_idx: z.number().int().nonnegative().optional().describe('Index into classes[] for set-local-edited'),
  new_attributes: z.record(z.string(), z.any()).optional().describe('Attribute map to merge into classes[class_idx].attributes (set-local-edited)'),
  edited_by: z.enum(['agent', 'operator']).optional().describe('Author of the pending edit (set-local-edited). Only "agent" or "operator" — the "external" discriminator is reserved for the dedicated promote-external-edit recovery action (closes the audit-discriminator spoofing surface).'),
}).superRefine((data, ctx) => {
  if (['get', 'update', 'delete'].includes(data.action) && !data.control_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for this action', path: ['control_id'] })
  }
  if (data.action === 'create' && !data.name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"name" is required for "create" action', path: ['name'] })
  }
  if (data.action === 'assign' && (!data.control_id || !data.element_ids || data.element_ids.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" and "element_ids" are required for "assign" action', path: ['control_id'] })
  }
  if (data.action === 'rank' && (!data.element_types || data.element_types.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"element_types" is required for "rank" action', path: ['element_types'] })
  }
  // Control-library actions
  if (data.action === 'pull-controls') {
    if (!data.directory_path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"directory_path" is required for "pull-controls"', path: ['directory_path'] })
    if (!data.control_ids) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_ids" is required for "pull-controls" (empty array is OK — short-circuits)', path: ['control_ids'] })
  }
  if (data.action === 'push-greenfield') {
    if (!data.directory_path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"directory_path" is required for "push-greenfield"', path: ['directory_path'] })
    if (!data.control_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for "push-greenfield" (local temp greenfield-* id)', path: ['control_id'] })
    if (!data.supporting_element_ids) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"supporting_element_ids" is required for "push-greenfield" (empty array OK)', path: ['supporting_element_ids'] })
    if (data.live_assigned_model_ids === undefined || data.live_assigned_model_ids === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"live_assigned_model_ids" is required for "push-greenfield" — caller pre-fetches via getControlsAssignedModels', path: ['live_assigned_model_ids'] })
  }
  if (data.action === 'push-brownfield') {
    if (!data.directory_path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"directory_path" is required for "push-brownfield"', path: ['directory_path'] })
    if (!data.control_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for "push-brownfield"', path: ['control_id'] })
    if (!data.decision) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"decision" (BrownfieldDecision shape) is required for "push-brownfield"', path: ['decision'] })
    if (!data.fresh_platform_attrs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"fresh_platform_attrs" is required for "push-brownfield" — caller pre-fetches via getControlInstantiationAttributes', path: ['fresh_platform_attrs'] })
    if (data.live_assigned_model_ids === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"live_assigned_model_ids" is required for "push-brownfield" (pass null when the query failed and you are pushing unverified)', path: ['live_assigned_model_ids'] })
    if (!data.this_model_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"this_model_id" is required for "push-brownfield"', path: ['this_model_id'] })
  }
  if (data.action === 'tombstone') {
    if (!data.directory_path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"directory_path" is required for "tombstone"', path: ['directory_path'] })
    if (!data.control_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for "tombstone"', path: ['control_id'] })
  }
  if (data.action === 'set-local-edited') {
    if (!data.directory_path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"directory_path" is required for "set-local-edited"', path: ['directory_path'] })
    if (!data.control_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for "set-local-edited"', path: ['control_id'] })
    if (data.class_idx === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"class_idx" is required for "set-local-edited"', path: ['class_idx'] })
    if (!data.new_attributes) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"new_attributes" is required for "set-local-edited"', path: ['new_attributes'] })
    if (!data.edited_by) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"edited_by" is required for "set-local-edited" (one of: agent, operator)', path: ['edited_by'] })
  }
  if (data.action === 'promote-external-edit') {
    if (!data.directory_path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"directory_path" is required for "promote-external-edit"', path: ['directory_path'] })
    if (!data.control_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"control_id" is required for "promote-external-edit"', path: ['control_id'] })
    if (data.class_idx === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"class_idx" is required for "promote-external-edit"', path: ['class_idx'] })
  }
  // WAL repair recovery
  if (data.action === 'inspect-wal' || data.action === 'clear-wal') {
    if (!data.directory_path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"directory_path" is required for "${data.action}"`, path: ['directory_path'] })
  }
})

type ManageControlsInput = z.infer<typeof InputSchema>

export class ManageControlsTool extends ClientDependentTool<ManageControlsInput, unknown> {
  readonly name = 'manage_controls'
  readonly description = 'Create, read, update, delete, assign, and rank security controls on the Dethernety platform. Controls can be assigned to component classes, linked to exposures via countermeasures, and assigned to model elements. Use "list" with filters (name, class_type, element_ids, module_name) for flexible search. Use "rank" with element_types to get pre-scored control candidates for a boundary or element set. Control-library actions (require directory_path): "pull-controls" materialises controls/<id>.json files for the given control_ids; "push-greenfield" drives a local temp-id Control through create + WAL-protected id rewrite + setInstantiationAttributes + assignControlToElements; "push-brownfield" runs the §7 Steps 0–F safety pipeline (caller passes fresh_platform_attrs, live_assigned_model_ids, decision); "tombstone" flips lifecycle to tombstoned while preserving pendingEdit; "set-local-edited" applies an edit through the two-write rule (caller MUST use this rather than editing controls/<id>.json directly so pendingEdit semantics are preserved). Never hand-edit lifecycle or platformState in controls/<id>.json — they are owned by the sync state machine; after any platform-side change run "pull-controls" to regenerate canonical files.'
  readonly inputSchema = InputSchema

  /**
   * Fail fast when a class id does not resolve to a CONTROL class. Binding a
   * non-Control class (e.g. a Kubernetes ComponentClass like
   * "NetworkPolicy") to a Control behaves inconsistently on the platform —
   * `create` silently produces a classless control, `update` errors with no
   * reason, and `push-greenfield` dies mid-pipeline at setInstantiationAttributes
   * leaving a partially-pushed control. Catching it here, before any mutation,
   * names the offending id's actual kind and the CONTROL classes available in
   * its module so the agent can self-correct.
   *
   * Returns an error envelope to return directly, or null when every id is a
   * valid CONTROL class (or the list is empty/omitted — happy path costs
   * nothing).
   */
  private async validateControlClassIds(
    dtClass: DtClass,
    classIds: readonly string[] | null | undefined,
  ): Promise<ToolResult<unknown> | null> {
    if (!classIds || classIds.length === 0) return null
    const OTHER_KINDS = ['component', 'boundary', 'dataflow', 'data'] as const
    for (const classId of classIds) {
      const asControl = await dtClass.getClassById({ classId, classType: 'control' })
      if (asControl) continue

      // Not a CONTROL class — probe the other kinds to name the actual one.
      let actualKind: string | null = null
      let actual: Awaited<ReturnType<DtClass['getClassById']>> | undefined
      for (const kind of OTHER_KINDS) {
        const found = await dtClass.getClassById({ classId, classType: kind })
        if (found) {
          actualKind = kind
          actual = found
          break
        }
      }

      if (!actualKind || !actual) {
        return {
          success: false,
          error: `class_ids contains "${classId}", which does not resolve to any class on the platform. Verify the id with get_classes(class_type: 'CONTROL') or match_classes(classLabel: 'CONTROL').`,
        }
      }

      // Best-effort suggestion: CONTROL classes from the same module.
      let suggestion = ''
      const moduleId = actual.module?.id
      const moduleName = actual.module?.name
      if (moduleId) {
        try {
          const modules = await dtClass.getControlClasses({
            moduleWhere: { id: moduleId },
            classWhere: {},
          })
          const controlClasses = modules.flatMap(
            (m: { controlClasses?: Array<{ id: string; name: string }> }) =>
              m.controlClasses ?? [],
          )
          if (controlClasses.length > 0) {
            suggestion = ` CONTROL classes in module "${moduleName ?? moduleId}": ${controlClasses
              .map(c => `${c.name} (${c.id})`)
              .join(', ')}.`
          }
        } catch {
          // Suggestions are best-effort — never let the lookup mask the error.
        }
      }

      return {
        success: false,
        error: `class_ids contains "${classId}" ("${actual.name}"), a ${actualKind.toUpperCase()} class${
          moduleName ? ` from module "${moduleName}"` : ''
        } — Controls can only bind CONTROL classes.${suggestion} Use match_classes(classLabel: 'CONTROL') or get_classes(class_type: 'CONTROL') to find the right id.`,
      }
    }
    return null
  }

  /**
   * Build an actionable "control file not found" message for the push paths.
   *
   * push-greenfield renames `controls/<temp-id>.json` →
   * `controls/<platform-id>.json` mid-pipeline (the WAL-protected id rewrite,
   * CONTROL_LIBRARY §7). If the platform create succeeds but a later step
   * (e.g. setInstantiationAttributes) fails, the control now lives under its
   * platform id with `lifecycle: "partially-pushed"`, so a retry by the
   * original temp id lands on a bare "not found" with no hint. Point the
   * operator at the right id to resume. Best-effort: any diagnosis failure
   * falls back to the plain message.
   */
  private async diagnoseMissingControlFile(
    modelDir: string,
    controlId: string,
  ): Promise<string> {
    const base = `Control file not found: ${controlId} under ${modelDir}.`
    try {
      // 1. If a pending id-rewrite journal still maps this temp id (rare —
      //    pre-dispatch usually replays and deletes it), name the exact
      //    platform id.
      const wal = await inspectPendingRewrite(modelDir)
      for (const op of wal.operations) {
        if (op.kind === 'greenfield-id-rewrite' && op.tempId === controlId) {
          return `${base} The push renamed this file to controls/${op.serverId}.json during the id rewrite — resume with control_id: ${op.serverId}.`
        }
      }
      // 2. Journal already consumed (the common case: a successful rename
      //    followed by a later push failure). Surface any control left at
      //    partially-pushed as a resume candidate.
      const ids = await listControlFiles(modelDir)
      const resumable: string[] = []
      for (const id of ids) {
        if (id === controlId) continue
        const f = await readControlFile(modelDir, id).catch(() => null)
        if (f && f.lifecycle === 'partially-pushed') resumable.push(id)
      }
      if (resumable.length > 0) {
        return `${base} push-greenfield renames controls/<temp-id>.json to controls/<platform-id>.json mid-pipeline, so if the platform create succeeded the file now lives under its platform id. Partially-pushed control(s) you can resume: ${resumable.join(', ')}. Re-run the push with one of those ids (do not create+assign a fresh control — that strands the partial and loses its instantiation attributes).`
      }
    } catch {
      // Diagnosis is best-effort — never let it mask the not-found result.
    }
    return base
  }

  async execute(input: ManageControlsInput, context: ToolContext): Promise<ToolResult<unknown>> {
    // Serialise concurrent invocations against the same model directory
    // and replay any stranded WAL journal before the action runs. The
    // lock is held only for actions that touch the model directory;
    // pure GraphQL CRUD bypasses both.
    //
    // Security: validate path confinement BEFORE acquireLock. Without this,
    // a caller controlling input.directory_path (e.g. via prompt injection
    // on the agent) could cause acquireLock -> fs.mkdir to create
    // <attacker_path>/.dethereal/.control-library.lock anywhere the operator
    // can write. The confinement check rejects paths outside CWD or the
    // registered models allowlist before any filesystem mutation.
    let lockHandle: LockHandle | undefined
    if (DIRECTORY_TOUCHING_ACTIONS.has(input.action) && input.directory_path) {
      try {
        await validatePathConfinement(input.directory_path)
      } catch (err) {
        return {
          success: false,
          error: 'PATH_CONFINEMENT_VIOLATION',
          data: {
            modelDir: input.directory_path,
            message: err instanceof Error ? err.message : String(err),
          },
        } as ToolResult<unknown>
      }
      try {
        lockHandle = await acquireLock(input.directory_path)
      } catch (err) {
        if (err instanceof LockBusyError) {
          return {
            success: false,
            error: 'LOCK_BUSY',
            data: {
              modelDir: input.directory_path,
              holderPid: err.holderPid,
              holderAcquiredAt: err.holderAcquiredAt,
              message: err.message,
            },
          } as ToolResult<unknown>
        }
        throw err
      }
      // With the lock held (so two concurrent sessions don't replay
      // the same journal twice), apply any stranded greenfield id-rewrite
      // operations. Idempotent — no-op when the journal is absent.
      // Skip the auto-replay for inspect-wal / clear-wal — those are the
      // operator's escape hatch when replay itself fails.
      if (!SKIPS_WAL_REPLAY.has(input.action)) try {
        await applyPendingRewrites(input.directory_path)
      } catch (err) {
        // Replay aborted with an ambiguous-state diagnostic. The
        // /dethereal:sync repair-wal verb is backed by the inspect-wal
        // and clear-wal MCP actions. Release the lock and surface the
        // recovery hint so the skill can render guidance without
        // string-matching the error code.
        if (lockHandle) await releaseLock(lockHandle)
        return {
          success: false,
          error: 'WAL_REPLAY_FAILED',
          data: {
            modelDir: input.directory_path,
            recoveryHint: 'repair-wal',
            recoveryMessage:
              `WAL replay failed for ${input.directory_path}. Journal at ` +
              `.dethereal/pending-id-rewrite.json is in an ambiguous state. ` +
              `Run /dethereal:sync repair-wal to inspect the journal and choose ` +
              `a recovery action (delete journal, retry replay, or manual rename).`,
            message: err instanceof Error ? err.message : String(err),
          },
        } as ToolResult<unknown>
      }
    }

    try {
      // ManageControlsTool extends ClientDependentTool, so
      // base-tool.ts:86-91 already short-circuits with a clearer
      // "call login first" message before execute() runs.

      // Decode JWT identity once for audit attribution. Use the explicit
      // 'unauthenticated' sentinel when token decode fails, so an auditor
      // can distinguish an audit entry whose token was missing /
      // malformed (sentinel present, attribution provably impossible)
      // from an older entry that pre-dates the field (field absent
      // entirely). Without the sentinel, both look operationally identical.
      if (context.authnOperator === undefined) {
        context.authnOperator = decodeJwtIdentity(context.token) ?? 'unauthenticated'
      }

      // ClientDependentTool.run() guarantees apolloClient is set
      // before execute() runs (base-tool.ts:86-91). Narrow once for the
      // action dispatch instead of asserting at every call site.
      const apolloClient = context.apolloClient!
      const dtControl = new DtControl(apolloClient)
      const dtClass = new DtClass(apolloClient)

      switch (input.action) {
        case 'list': {
          const hasAdvancedFilters = input.name || input.class_type || input.element_ids || input.module_id || input.module_name

          if (!hasAdvancedFilters) {
            // Legacy path: folder_id + optional client-side class_ids filter
            let controls = await dtControl.getControls({ folderId: input.folder_id })
            if (input.class_ids && input.class_ids.length > 0) {
              const classIdSet = new Set(input.class_ids)
              controls = controls.filter(c =>
                c.controlClasses?.some(cc => cc.id && classIdSet.has(cc.id))
              )
            }
            return { success: true, data: { controls, total: controls.length } }
          }

          // Advanced path: server-side filtering via findControls.
          // findControls accepts a single classId — surface the truncation
          // instead of silently dropping ids past the first.
          const listWarnings: string[] = []
          if (input.class_ids && input.class_ids.length > 1) {
            listWarnings.push(
              `Advanced list filters by class_ids[0] only — ${input.class_ids.length} ids passed, using "${input.class_ids[0]}". Run one list per class id, or use the legacy folder_id path which filters client-side across all ids.`
            )
          }
          const controls = await dtControl.findControls({
            controlId: input.control_id,
            name: input.name,
            classId: input.class_ids?.[0],
            classType: input.class_type,
            elementIds: input.element_ids,
            moduleId: input.module_id,
            moduleName: input.module_name,
          })
          return {
            success: true,
            data: {
              controls,
              total: controls.length,
              ...(listWarnings.length > 0 ? { warnings: listWarnings } : {})
            }
          }
        }

        case 'get': {
          const control = await dtControl.getControl({ controlId: input.control_id! })
          if (!control) {
            return { success: false, error: `Control ${input.control_id} not found` }
          }
          return { success: true, data: { control } }
        }

        case 'create': {
          const classError = await this.validateControlClassIds(dtClass, input.class_ids)
          if (classError) return classError
          const control = await dtControl.createControl({
            newControl: { name: input.name!, description: input.description } as any,
            classIds: input.class_ids || null,
            folderId: input.folder_id
          })
          if (!control) {
            return { success: false, error: 'Failed to create control' }
          }
          return { success: true, data: { control } }
        }

        case 'update': {
          // updateControl is full-replace on the platform side: an empty name/
          // description blanks the field, an empty controlClasses list unbinds
          // EVERY class (kind: 'NONE'), and an undefined folderId disconnects
          // the folder. Controls are shared across models, so omitted inputs
          // must preserve the current values — fetch them first and merge.
          //
          // Validate only when class_ids is explicitly provided: omitted
          // preserves the current bindings (already valid), and an explicit
          // empty array is an intentional unbind-all.
          if (input.class_ids && input.class_ids.length > 0) {
            const classError = await this.validateControlClassIds(dtClass, input.class_ids)
            if (classError) return classError
          }
          const current = await dtControl.getControl({ controlId: input.control_id! })
          if (!current) {
            return { success: false, error: `Control ${input.control_id} not found` }
          }
          const result = await dtControl.updateControl({
            controlId: input.control_id!,
            name: input.name ?? current.name ?? '',
            description: input.description ?? current.description ?? '',
            controlClasses: input.class_ids
              ?? current.controlClasses?.map(c => c.id).filter((id): id is string => !!id)
              ?? [],
            folderId: input.folder_id ?? current.folder?.id
          })
          if (!result.control || !result.residualOk) {
            return {
              success: false,
              error: `Failed to update control ${input.control_id}`,
              data: { residualOk: result.residualOk }
            }
          }
          return { success: true, data: { control: result.control } }
        }

        case 'delete': {
          const deleted = await dtControl.deleteControl({ controlId: input.control_id! })
          return { success: true, data: { deleted, control_id: input.control_id } }
        }

        case 'assign': {
          const control = await dtControl.assignControlToElements({
            controlId: input.control_id!,
            elementIds: input.element_ids!,
          })
          if (!control) {
            return { success: false, error: `Failed to assign control ${input.control_id} to elements` }
          }
          return { success: true, data: { control, assigned_elements: input.element_ids!.length } }
        }

        case 'rank': {
          const candidates = await dtControl.controlCandidatesForType({
            elementTypes: input.element_types!,
            moduleIds: input.module_id ? [input.module_id] : [],
          })

          const topN = input.top_n ?? 5

          // Score each candidate using deterministic formula from CI §6.3
          const scored = candidates
            .filter(c => c.classes.length > 0) // Skip orphaned controls (zero classes = data corruption)
            .map(c => {
              const totalClasses = c.classes.length
              const compatibleConfigured = c.classes.filter(cl => cl.compatible && cl.countermeasureCount > 0).length
              const incompatibleConfigured = c.classes.filter(cl => !cl.compatible && cl.countermeasureCount > 0).length

              const score = (compatibleConfigured / totalClasses) - (1.0 * incompatibleConfigured / totalClasses)

              let relevance: 'strong' | 'good' | 'weak'
              if (score >= 0.8 && incompatibleConfigured === 0) {
                relevance = 'strong'
              } else if (score >= 0.5) {
                relevance = 'good'
              } else {
                relevance = 'weak'
              }

              return {
                controlId: c.controlId,
                controlName: c.controlName,
                score: Math.round(score * 100) / 100,
                relevance,
                totalCountermeasures: c.totalCountermeasures,
                assignedElementIds: c.assignedElementIds,
                classes: c.classes,
              }
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, topN)

          return { success: true, data: { candidates: scored, total: scored.length } }
        }

        // -----------------------------------------------------------------
        // Control-library actions
        // Each delegates to DtControlLibrary. The engine owns the invariants
        // (two-write rule, external-edit guard, partial-payload semantic,
        // shared-ownership check, audit-log writes); the MCP boundary only
        // translates the typed errors into ToolResult envelopes the sync
        // skill recognises.
        // -----------------------------------------------------------------

        case 'pull-controls': {
          await validatePathConfinement(input.directory_path!)
          const lib = new DtControlLibrary(apolloClient)
          const files = await lib.pullControls({
            modelDir: input.directory_path!,
            controlIds: input.control_ids!,
          })
          return { success: true, data: { files, pulled: files.length } }
        }

        case 'push-greenfield': {
          await validatePathConfinement(input.directory_path!)
          const file = await readControlFile(input.directory_path!, input.control_id!)
          if (!file) {
            return {
              success: false,
              error: await this.diagnoseMissingControlFile(input.directory_path!, input.control_id!),
            }
          }
          // Reject wrong-kind class bindings before the push pipeline runs, so
          // a bad classId fails here instead of mid-pipeline at
          // setInstantiationAttributes (which would strand a partially-pushed
          // control on the platform).
          const gfClassError = await this.validateControlClassIds(
            dtClass,
            file.classes.map(c => c.classId),
          )
          if (gfClassError) return gfClassError
          const lib = new DtControlLibrary(apolloClient)
          // superRefine already enforces presence + non-null on
          // push-greenfield, so a `?? []` fallback would be dead but mask
          // contract violations. Pass the value through strictly — any
          // path that reaches here without a populated array indicates a
          // Zod / refine inconsistency that should fail loudly.
          const result = await lib.pushGreenfieldControl({
            modelDir: input.directory_path!,
            file,
            supportingElementIds: input.supporting_element_ids!,
            folderId: input.folder_id,
            liveAssignedModelIds: input.live_assigned_model_ids as string[],
          })
          return { success: true, data: { file: result } }
        }

        case 'push-brownfield': {
          await validatePathConfinement(input.directory_path!)
          const file = await readControlFile(input.directory_path!, input.control_id!)
          if (!file) {
            return {
              success: false,
              error: await this.diagnoseMissingControlFile(input.directory_path!, input.control_id!),
            }
          }
          const bfClassError = await this.validateControlClassIds(
            dtClass,
            file.classes.map(c => c.classId),
          )
          if (bfClassError) return bfClassError
          const freshMap = new Map<string, Record<string, unknown>>(
            Object.entries(input.fresh_platform_attrs as Record<string, Record<string, unknown>>)
          )
          const lib = new DtControlLibrary(apolloClient)
          try {
            const result = await lib.pushBrownfieldControl({
              modelDir: input.directory_path!,
              file,
              decision: input.decision,
              freshPlatformAttrs: freshMap,
              liveAssignedModelIds: input.live_assigned_model_ids ?? [],
              thisModelId: input.this_model_id!,
              authnOperator: context.authnOperator,
            })
            return { success: true, data: result }
          } catch (err) {
            if (err instanceof ExternalEditDetectedError) {
              return {
                success: false,
                error: 'EXTERNAL_EDIT_DETECTED',
                data: {
                  controlId: err.controlId,
                  classId: err.classId,
                  recoveryHint: err.recoveryHint,
                  message: err.message,
                },
              } as ToolResult<unknown>
            }
            if (err instanceof CloneAndSwapNotImplemented) {
              return {
                success: false,
                error: 'CLONE_AND_SWAP_NOT_IMPLEMENTED',
                data: {
                  controlId: input.control_id,
                  hint: 'Future feature; choose cancel, push-anyway, or push-unverified',
                  message: err.message,
                },
              } as ToolResult<unknown>
            }
            throw err
          }
        }

        case 'tombstone': {
          await validatePathConfinement(input.directory_path!)
          const file = await readControlFile(input.directory_path!, input.control_id!)
          if (!file) {
            return { success: false, error: `Control file not found: ${input.control_id} under ${input.directory_path}` }
          }
          const lib = new DtControlLibrary(apolloClient)
          const tombstoned = await lib.markTombstoned({ modelDir: input.directory_path!, file })
          return { success: true, data: { file: tombstoned } }
        }

        case 'set-local-edited': {
          await validatePathConfinement(input.directory_path!)
          const file = await readControlFile(input.directory_path!, input.control_id!)
          if (!file) {
            return { success: false, error: `Control file not found: ${input.control_id} under ${input.directory_path}` }
          }
          const lib = new DtControlLibrary(apolloClient)
          try {
            const updated = await lib.setLocalEdited({
              modelDir: input.directory_path!,
              file,
              classIdx: input.class_idx!,
              newAttributes: input.new_attributes!,
              editedBy: input.edited_by!,
            })
            return { success: true, data: { file: updated } }
          } catch (err) {
            if (err instanceof IllegalEditedByError) {
              // Defence-in-depth — Zod already drops 'external' at the
              // boundary, but engine guard catches a future caller that
              // bypasses Zod (e.g. a programmatic test).
              return {
                success: false,
                error: 'ILLEGAL_EDITED_BY',
                data: {
                  controlId: input.control_id,
                  classIdx: input.class_idx,
                  message: err.message,
                },
              } as ToolResult<unknown>
            }
            throw err
          }
        }

        case 'promote-external-edit': {
          // Recovery verb (CL §7 Step A unblock). Synthesises a
          // pendingEdit block whose previousAttributes mirror platformAttributes
          // for the keys where local attributes already diverge — does NOT
          // re-pull (re-pulling would destroy the local divergence the
          // operator wants to promote). The caller (skill) is expected to
          // have refreshed the file via `pull-controls` BEFORE the divergence
          // happened, OR to be operating against a stale local platformAttributes
          // snapshot (in which case the next push's P7.2 fresh-fetch picks up
          // the live state).
          await validatePathConfinement(input.directory_path!)
          const file = await readControlFile(input.directory_path!, input.control_id!)
          if (!file) {
            return { success: false, error: `Control file not found: ${input.control_id} under ${input.directory_path}` }
          }
          const lib = new DtControlLibrary(apolloClient)
          try {
            const promoted = await lib.promoteExternalEdit({
              modelDir: input.directory_path!,
              file,
              classIdx: input.class_idx!,
            })
            return { success: true, data: { file: promoted } }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes('no divergence')) {
              return {
                success: false,
                error: 'NO_DIVERGENCE',
                data: {
                  controlId: input.control_id,
                  classIdx: input.class_idx,
                  message: msg,
                },
              } as ToolResult<unknown>
            }
            throw err
          }
        }

        case 'inspect-wal': {
          // Read-only inspector. Surfaces the WAL journal contents +
          // per-operation on-disk state so the skill can render recovery
          // options to the operator.
          await validatePathConfinement(input.directory_path!)
          const inspection = await inspectPendingRewrite(input.directory_path!)
          return { success: true, data: inspection }
        }

        case 'clear-wal': {
          // Hard-delete the WAL journal without applying. Skill confirms
          // with the operator before invoking; engine has no confirmation
          // gate — calling this discards the journal.
          await validatePathConfinement(input.directory_path!)
          const cleared = await clearPendingRewrite(input.directory_path!)
          return {
            success: true,
            data: {
              modelDir: input.directory_path,
              cleared,
              message: cleared
                ? 'WAL journal deleted. Local files left as-is — manual reconciliation may be required.'
                : 'No WAL journal present (already cleared, or never staged).',
            },
          }
        }

        default:
          return { success: false, error: `Unknown action: ${input.action}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Control operation failed'
      }
    } finally {
      // Always release. ENOENT on release (already removed by another
      // writer's recovery path) is swallowed inside releaseLock.
      if (lockHandle) {
        await releaseLock(lockHandle)
      }
    }
  }
}

export const manageControlsTool = new ManageControlsTool()
