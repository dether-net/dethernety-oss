/**
 * `DtControlLibrary` — control-library engine for the dethereal plugin.
 *
 * Composes the four batched primitives on `DtControl`
 * (`getControlsByIds`, `getControlInstantiationAttributes`,
 * `getControlsAssignedModels`, `setInstantiationAttributes`) plus the
 * file-machinery helpers (WAL, audit log, validator, file IO) to drive
 * the four end-to-end control-library workflows defined in
 * CONTROL_LIBRARY.md §7:
 *
 * - **`pullControls`** (§7 Pull) — materialise/refresh `controls/<id>.json`
 *   files for a list of platform Control ids.
 * - **`pushGreenfieldControl`** (§7 push — greenfield) — Steps A–D drive
 *   a locally-authored Control to the platform with WAL-protected id
 *   write-back.
 * - **`pushBrownfieldControl`** (§7 push — brownfield) — Steps 0–F drive
 *   agent-authored attribute edits with full safety semantics
 *   (external-edit guard, partial-payload, conflict resolution,
 *   shared-ownership check, audit trail).
 * - **`markTombstoned`** (§5 brownfield → tombstoned) — flip a
 *   brownfield Control to tombstoned (preserving pendingEdit for
 *   recovery via clone-and-swap).
 *
 * Plus `setLocalEdited` — the single source of truth for `localEditedAt`
 * + `pendingEdit` (enforces the §4 two-write semantic).
 *
 * Plumbed through the `manage_controls` MCP tool actions and the
 * `/dethereal:enrich` / `/dethereal:sync` skills.
 */

import * as Apollo from '@apollo/client';
import { DtControl } from '../dt-control/dt-control.js';
import { DtClass } from '../dt-class/dt-class.js';
import {
  appendOperation,
  applyPendingRewrites,
  type GreenfieldIdRewriteOp,
} from './wal-helper.js';
import {
  appendAuditEntry,
  buildAuditEntry,
  type AuditLogEntry,
  type ConflictResolution,
} from './audit-log-writer.js';
import {
  readControlFile,
  writeControlFile,
  getControlFilePath,
} from './file-io.js';
import type {
  ControlFile,
  ControlFileClassEntry,
  PendingEditAuthor,
  PendingEditBlock,
} from '../schemas/control-file.schema.js';

// =======================================================================
// Public types — the contract the MCP tool + skills consume.
// =======================================================================

/**
 * Operator decision shape consumed by `pushBrownfieldControl`.
 *
 * The `/dethereal:sync` skill builds this from the operator's responses
 * to the §6 batched review screen.
 */
export interface BrownfieldDecision {
  /**
   * Required when the control is shared (more than one model in
   * `liveAssignedModelIds`) or when ownership query failed.
   */
  sharedOwnership: 'cancel' | 'push-anyway' | 'clone-and-swap' | 'push-unverified';
  /**
   * Per-(classIdx, key) resolution for Step D Case 3 conflicts.
   * Key format: `<classIdx>.<attributeName>`.
   * Default for unspecified conflicts is `cancel` for the entire control row
   * (CL §6 batched review screen "any conflicting key without a per-key
   * decision is treated as 'cancel'").
   */
  perKey?: Record<string, PerKeyDecision>;
  /**
   * For `push-unverified` only — required to populate the audit entry's
   * `queryFailureReason` field (CL §6 Audit log schema).
   */
  queryFailureReason?: string;
  /**
   * For `push-unverified` only — operator-acknowledged retry count.
   */
  queryAttempts?: number;
}

export type PerKeyDecision =
  | { chosen: 'keep' }
  | { chosen: 'accept-theirs' }
  | { chosen: 'merge'; merged: unknown };

/**
 * Thrown by `pushBrownfieldControl` Step A when a class entry's
 * `attributes` differs from `platformAttributes` without a `pendingEdit`
 * block recording the change. Recovery: operator runs
 * `/dethereal:sync promote-external-edit <controlId> <classId>`.
 */
export class ExternalEditDetectedError extends Error {
  readonly controlId: string;
  readonly classId: string;
  readonly recoveryHint: 'promote-external-edit';

  constructor(controlId: string, classId: string) {
    super(
      `External edit detected on Control ${controlId}, class ${classId}. ` +
        `Run /dethereal:sync promote-external-edit ${controlId} ${classId} to recover.`,
    );
    this.controlId = controlId;
    this.classId = classId;
    this.recoveryHint = 'promote-external-edit';
    this.name = 'ExternalEditDetectedError';
  }
}

/**
 * Thrown when `pushBrownfieldControl` is asked to perform a clone-and-swap.
 * The engine ships without the clone path today (it requires a
 * name-collision check via `manage_controls(action: 'list', name)`
 * which the engine has no surface for yet).
 */
export class CloneAndSwapNotImplemented extends Error {
  constructor(controlId: string) {
    super(
      `Clone-and-swap is not implemented for Control ${controlId}. ` +
        `Use cancel or push-anyway.`,
    );
    this.name = 'CloneAndSwapNotImplemented';
  }
}

/**
 * Thrown by `setLocalEdited` when the caller passes `editedBy: 'external'`.
 *
 * The `'external'` discriminator is reserved for the `promote-external-edit`
 * recovery verb (CL §7 Step A unblock) — it tags the audit log so an
 * auditor can distinguish a genuine reconciliation push from a deliberate
 * operator overwrite. Letting any caller stamp `'external'` defeats that
 * discriminator. The spoofing surface is closed at both the MCP boundary
 * (Zod enum drops `'external'`) and the engine (this guard).
 */
export class IllegalEditedByError extends Error {
  constructor(controlId: string) {
    super(
      `setLocalEdited: editedBy 'external' is reserved for the ` +
        `promote-external-edit recovery verb on Control ${controlId}. ` +
        `Use 'agent' or 'operator'.`,
    );
    this.name = 'IllegalEditedByError';
  }
}

/**
 * Result of a successful `pushBrownfieldControl` call.
 */
export interface BrownfieldPushResult {
  /** Updated file (lifecycle / pendingEdit / pushedAt / platformState). */
  file: ControlFile;
  /** Audit entries written during this push (force-shared, force-unverified, reverted). */
  auditEntries: AuditLogEntry[];
  /** True when a platform mutation actually fired (false on cancel / revert / no-op). */
  mutated: boolean;
  /**
   * True iff Step B's inline re-fetch failed transiently and Step D
   * classification proceeded against the caller-supplied (potentially
   * stale) `freshPlatformAttrs`. Lets the sync skill render a one-line
   * caveat in the post-push summary so the operator knows the TOCTOU
   * safety degraded for this push.
   */
  usedStaleSnapshot?: boolean;
}

// =======================================================================
// Implementation
// =======================================================================

export class DtControlLibrary {
  private readonly apolloClient: Apollo.ApolloClient;
  private readonly dtControl: DtControl;
  // dtClass is held for symmetry with the DtImport multi-dependency pattern;
  // setInstantiationAttributes is invoked via dtControl (the Control-scoped
  // seam per CL DEC-CL-11), but having dtClass available keeps future
  // class-template lookups one constructor away.
  private readonly dtClass: DtClass;

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient;
    this.dtControl = new DtControl(apolloClient);
    this.dtClass = new DtClass(apolloClient);
  }

  // -----------------------------------------------------------------
  // pullControls
  // -----------------------------------------------------------------

  /**
   * Materialise (or refresh) `controls/<id>.json` files for the supplied
   * Control ids. CL §7 "Pull" — three batched calls in parallel:
   *   - getControlsByIds        → class metadata
   *   - getControlInstantiationAttributes → per-(controlId, classId) attrs
   *   - getControlsAssignedModels → assignedModelIds for platformState
   *
   * For every Control returned, `lifecycle: 'brownfield'` is set
   * (greenfield is local-only by definition). `attributes` and
   * `platformAttributes` are initialised to the same just-pulled value;
   * `localEditedAt` / `pushedAt` / `pendingEdit` are unset.
   *
   * **Lifecycle-filtered reconciliation** (CL §6 missing-id rule):
   * ids absent from the platform result whose local lifecycle is
   * `brownfield` or `partially-pushed` get flipped to `tombstoned`
   * (preserving any `pendingEdit` block for clone-and-swap recovery).
   * `greenfield` ids should not appear in the call (greenfield Controls
   * have no platform existence yet); a defensive log fires if seen.
   *
   * **In-flight `pendingEdit` preservation contract** (CL Appendix A.5):
   * when an existing local `controls/<id>.json` has a non-empty
   * `pendingEdit` block, the re-pull does NOT overwrite local `attributes`
   * with the freshly-pulled platform value. Both the operator's edited
   * `attributes` and the `pendingEdit.previousAttributes` baseline are
   * preserved verbatim; only `platformAttributes` is updated to reflect
   * the latest server state. This prevents `/dethereal:sync pull` (or its
   * L4.5 auto-sequencing) from silently destroying an in-progress edit.
   * The next `push-brownfield` will compute conflict detection against
   * the freshly-pulled `platformAttributes`.
   *
   * Short-circuits on empty input without a Bolt round-trip.
   *
   * @see CL Appendix A.5 — "Pull preserves in-flight pendingEdit"
   */
  pullControls = async ({
    modelDir,
    controlIds,
  }: {
    modelDir: string;
    controlIds: string[];
  }): Promise<ControlFile[]> => {
    if (!controlIds?.length) return [];

    const [metadata, instantiationRows, assignedModelsMap] = await Promise.all([
      this.dtControl.getControlsByIds({ ids: controlIds }),
      this.dtControl.getControlInstantiationAttributes({ controlIds }),
      this.dtControl.getControlsAssignedModels({ ids: controlIds }),
    ]);

    // Index instantiation rows by (controlId, classId) for O(1) join.
    const attrsByControlAndClass = new Map<string, Map<string, Record<string, unknown>>>();
    for (const row of instantiationRows) {
      if (row.classId === null) continue; // Control with no IS_INSTANCE_OF edge
      let inner = attrsByControlAndClass.get(row.controlId);
      if (!inner) {
        inner = new Map();
        attrsByControlAndClass.set(row.controlId, inner);
      }
      inner.set(row.classId, row.attributes ?? {});
    }

    const returnedIds = new Set(metadata.map(c => c.id).filter((id): id is string => !!id));
    const now = new Date().toISOString();
    const composed: ControlFile[] = [];

    for (const platformCtrl of metadata) {
      // The Control interface has optional id/name (legacy GraphQL nullability).
      // Skip rows without them — getControlsByIds would never return such a
      // row in practice, but the type narrows here keeps TS happy.
      if (!platformCtrl.id || !platformCtrl.name) continue;
      const platformId = platformCtrl.id;
      const platformName = platformCtrl.name;

      // Read any pre-existing local file so we preserve `lastPushedAt` and
      // any pendingEdit blocks the operator hasn't flushed yet.
      const existing = await readControlFile(modelDir, platformId);

      const attrsForControl =
        attrsByControlAndClass.get(platformId) ?? new Map<string, Record<string, unknown>>();

      const classes: ControlFileClassEntry[] = (platformCtrl.controlClasses ?? []).map(cc => {
        const platformAttrs = attrsForControl.get(cc.id) ?? {};
        // Preserve operator's in-flight pendingEdit if the existing file had
        // one for this class (mid-edit pull would otherwise wipe local intent).
        const existingClass = existing?.classes.find(e => e.classId === cc.id);
        const preservedPendingEdit = existingClass?.pendingEdit;
        const preservedAttributes = preservedPendingEdit
          ? existingClass!.attributes
          : platformAttrs;
        const preservedLocalEditedAt = preservedPendingEdit
          ? existingClass!.localEditedAt
          : undefined;
        const preservedPushedAt = existingClass?.pushedAt;

        const entry: ControlFileClassEntry = {
          classId: cc.id,
          className: cc.name,
          moduleId:
            cc.module && typeof cc.module === 'object' && 'id' in cc.module
              ? (cc.module as { id: string }).id
              : undefined,
          attributes: preservedAttributes,
          platformAttributes: platformAttrs,
        };
        if (preservedLocalEditedAt) entry.localEditedAt = preservedLocalEditedAt;
        if (preservedPushedAt) entry.pushedAt = preservedPushedAt;
        if (preservedPendingEdit) entry.pendingEdit = preservedPendingEdit;
        return entry;
      });

      const file: ControlFile = {
        id: platformId,
        name: platformName,
        source: existing?.source ?? 'declared',
        lifecycle: 'brownfield',
        classes,
        platformState: {
          lastSyncedAt: now,
          lastPushedAt: existing?.platformState?.lastPushedAt,
          assignedModelIds: assignedModelsMap.get(platformId) ?? [],
          assignedModelCount: (assignedModelsMap.get(platformId) ?? []).length,
        },
      };

      await writeControlFile(modelDir, file);
      composed.push(file);
    }

    // Lifecycle-filtered missing-id reconciliation.
    for (const requestedId of controlIds) {
      if (returnedIds.has(requestedId)) continue;
      const existing = await readControlFile(modelDir, requestedId);
      if (!existing) continue; // never had a local file — nothing to tombstone
      if (existing.lifecycle === 'brownfield' || existing.lifecycle === 'partially-pushed') {
        const tombstoned: ControlFile = { ...existing, lifecycle: 'tombstoned' };
        await writeControlFile(modelDir, tombstoned);
        composed.push(tombstoned);
      } else if (existing.lifecycle === 'greenfield') {
        // Defensive log — the caller shouldn't have included greenfield ids
        // in the batch (their absence is expected).
        // eslint-disable-next-line no-console
        console.warn(
          `[DtControlLibrary.pullControls] greenfield id '${requestedId}' was passed to the platform query and (as expected) absent from the result. Skipping reconciliation.`,
        );
      }
      // tombstoned → already tombstoned; no-op.
    }

    return composed;
  };

  // -----------------------------------------------------------------
  // pushGreenfieldControl
  // -----------------------------------------------------------------

  /**
   * Drive a greenfield Control through the four-step push pipeline per
   * CL §7 "Push — greenfield Controls". Each step is individually
   * idempotent and resumable from `partially-pushed`.
   *
   * Step A — `dtControl.createControl` to mint a server id.
   * WAL-protected id rewrite — atomic across structure.json, dataflows.json,
   * and the per-control file rename.
   * Step B — per class entry, `setInstantiationAttributes` (skip entries
   * already pushed via `pushedAt >= localEditedAt`).
   * Step C — `assignControlToElements` to create SUPPORTS edges.
   * Step D — flip `lifecycle: 'brownfield'` and populate `platformState`.
   *
   * Failures at any step leave the file in `partially-pushed`; the next
   * call resumes from where it left off.
   *
   * @param folderId - Platform folder for `createControl`. Accepted as
   *   a method param; the MCP wiring derives this from operator context.
   * @param liveAssignedModelIds - Pre-fetched model ids for `platformState`
   *   in Step D. The caller passes this to avoid a redundant query.
   */
  pushGreenfieldControl = async ({
    modelDir,
    file,
    supportingElementIds,
    folderId,
    liveAssignedModelIds,
  }: {
    modelDir: string;
    file: ControlFile;
    supportingElementIds: string[];
    folderId: string | undefined;
    liveAssignedModelIds: string[];
  }): Promise<ControlFile> => {
    if (file.lifecycle !== 'greenfield' && file.lifecycle !== 'partially-pushed') {
      throw new Error(
        `pushGreenfieldControl: file ${file.id} has lifecycle '${file.lifecycle}' (expected 'greenfield' or 'partially-pushed').`,
      );
    }

    let working = { ...file };

    // ----- Step A — Create on platform (skip when already done) -----
    if (working.lifecycle === 'greenfield') {
      const serverControl = await this.dtControl.createControl({
        newControl: { name: working.name } as Parameters<DtControl['createControl']>[0]['newControl'],
        classIds: working.classes.map(c => c.classId),
        folderId,
      });
      if (!serverControl?.id) {
        throw new Error(`pushGreenfieldControl: createControl returned no id for '${working.name}'`);
      }
      const serverId = serverControl.id;
      const tempId = working.id;

      // WAL-protected id rewrite. Build the operation, append to the
      // journal, then drive the apply step. After the journal is consumed,
      // structure.json + dataflows.json + the renamed per-control file all
      // hold serverId.
      const op: GreenfieldIdRewriteOp = {
        kind: 'greenfield-id-rewrite',
        tempId,
        serverId,
        filePaths: ['structure.json', 'dataflows.json', `controls/${tempId}.json`],
        controlFileRename: {
          from: `controls/${tempId}.json`,
          to: `controls/${serverId}.json`,
        },
        createdAt: new Date().toISOString(),
      };

      // The local file in memory (`working`) and the on-disk file may be
      // out of sync at this point — caller may have edited `working` in
      // memory before invoking us. Persist to the temp-id path FIRST so
      // the WAL has a consistent file to rename.
      await writeControlFile(modelDir, working);
      await appendOperation(modelDir, op);
      await applyPendingRewrites(modelDir);

      // Re-read from the new path to capture the WAL-rewritten id.
      const reread = await readControlFile(modelDir, serverId);
      if (!reread) {
        throw new Error(
          `pushGreenfieldControl: post-WAL re-read failed for ${serverId}. Manual reconciliation required.`,
        );
      }
      working = { ...reread, lifecycle: 'partially-pushed' };
      await writeControlFile(modelDir, working);
    }

    // ----- Step B — Per-class setInstantiationAttributes -----
    for (let i = 0; i < working.classes.length; i++) {
      const entry = working.classes[i];
      // Skip entries already pushed (resume-from-partially-pushed semantics).
      if (
        entry.pushedAt &&
        entry.localEditedAt &&
        entry.pushedAt >= entry.localEditedAt
      ) {
        continue;
      }

      const ok = await this.dtControl.setInstantiationAttributes({
        controlId: working.id,
        classId: entry.classId,
        attributes: entry.attributes,
      });
      if (!ok) {
        throw new Error(
          `pushGreenfieldControl: setInstantiationAttributes failed for control=${working.id} class=${entry.classId}. State left at lifecycle=partially-pushed for resume.`,
        );
      }
      const now = new Date().toISOString();
      working.classes[i] = {
        ...entry,
        platformAttributes: { ...entry.attributes },
        pushedAt: now,
        pendingEdit: undefined,
      };
      await writeControlFile(modelDir, working);
    }

    // ----- Step C — SUPPORTS edges (idempotent under @neo4j/graphql connect) -----
    if (supportingElementIds.length > 0) {
      const result = await this.dtControl.assignControlToElements({
        controlId: working.id,
        elementIds: supportingElementIds,
      });
      if (!result) {
        throw new Error(
          `pushGreenfieldControl: assignControlToElements returned null for control=${working.id}. State left at lifecycle=partially-pushed for resume.`,
        );
      }
    }

    // ----- Step D — Finalise -----
    const allPushed = working.classes.every(
      e => e.pushedAt && (!e.localEditedAt || e.pushedAt >= e.localEditedAt),
    );
    if (allPushed) {
      const now = new Date().toISOString();
      working = {
        ...working,
        lifecycle: 'brownfield',
        platformState: {
          lastSyncedAt: working.platformState?.lastSyncedAt,
          lastPushedAt: now,
          assignedModelIds: liveAssignedModelIds,
          assignedModelCount: liveAssignedModelIds.length,
        },
      };
      await writeControlFile(modelDir, working);
    }

    return working;
  };

  // -----------------------------------------------------------------
  // pushBrownfieldControl
  // -----------------------------------------------------------------

  /**
   * Drive a brownfield Control through the seven-step safety pipeline
   * (Step 0 short-circuit through Step F finalise) per CL §7 "Push —
   * brownfield Controls".
   *
   * The caller (the `/dethereal:sync` skill) is responsible for the
   * batched pre-push pipeline that fetches `freshPlatformAttrs` and
   * `liveAssignedModelIds` ONCE for all touched Controls — this method
   * does not re-issue those round-trips.
   *
   * @param freshPlatformAttrs - Map<classId, attributes> from the live
   *   pre-push fetch. Step B reads from this; if a class entry's classId
   *   is missing, Step B treats `platformAttributes` as `{}`.
   * @param liveAssignedModelIds - Live model ids (from
   *   getControlsAssignedModels) used by Step E. Empty array OK (alone).
   * @param thisModelId - The id of the model being synced — used by Step E
   *   to recognise "alone vs shared".
   *
   * **Engine deferral** — Step C's `absent-but-known` classification
   * requires the ControlClass template's `properties` keys, which the
   * earlier metadata cache didn't plumb through. The engine currently
   * collapses to `present | absent-and-unknown`; future work wires
   * template properties through and adds the `absent-but-known` branch.
   *
   * **Throws** (none of these are caught inside the method; surface to
   * the MCP tool wrapper for envelope translation):
   * @throws {ExternalEditDetectedError} Step A — local `attributes`
   *   diverged from `platformAttributes` without a `pendingEdit` block.
   *   Recovery: `/dethereal:sync promote-external-edit <id> <classId>`.
   * @throws {CloneAndSwapNotImplemented} Step E — operator chose
   *   `sharedOwnership: 'clone-and-swap'`. The engine throws a typed
   *   marker instead of proceeding silently.
   * @throws {IllegalEditedByError} Guard against
   *   `setLocalEdited({editedBy: 'external'})`. The `'external'`
   *   discriminator is reserved for the `promote-external-edit` recovery
   *   verb; surfaces here only if a caller bypasses the MCP Zod enum.
   * @throws {Error} Step C `absent-and-unknown` blocked-key path — local
   *   `pendingEdit` mentions a key that's neither in the live platform
   *   attributes nor in the template `properties`. Plain `Error` because
   *   the schema-drift narrative isn't a typed-marker recovery story;
   *   the operator must fix the file or update the ControlClass template
   *   before the push can proceed.
   */
  pushBrownfieldControl = async ({
    modelDir,
    file,
    decision,
    freshPlatformAttrs,
    liveAssignedModelIds,
    thisModelId,
    authnOperator,
  }: {
    modelDir: string;
    file: ControlFile;
    decision: BrownfieldDecision;
    freshPlatformAttrs: Map<string, Record<string, unknown>>;
    liveAssignedModelIds: string[];
    thisModelId: string;
    /**
     * JWT-anchored operator identity. Pass-through to `buildAuditEntry`
     * so the audit log carries the platform-anchored identity alongside
     * the spoofable local `operator` field. Optional for tests / non-MCP
     * callers; the MCP tool always provides it when a token is available.
     */
    authnOperator?: string;
  }): Promise<BrownfieldPushResult> => {
    if (file.lifecycle !== 'brownfield') {
      throw new Error(
        `pushBrownfieldControl: file ${file.id} has lifecycle '${file.lifecycle}' (expected 'brownfield').`,
      );
    }

    let working = JSON.parse(JSON.stringify(file)) as ControlFile;
    const auditEntries: AuditLogEntry[] = [];

    // ----- Step 0 — Short-circuit -----
    const anyPending = working.classes.some(c => !!c.pendingEdit);
    const anyDivergent = working.classes.some(
      c => c.platformAttributes && !shallowEqualAttrs(c.attributes, c.platformAttributes),
    );
    if (!anyPending && !anyDivergent) {
      return { file: working, auditEntries: [], mutated: false };
    }

    // ----- Step A — External-edit guard -----
    for (const entry of working.classes) {
      if (
        entry.platformAttributes &&
        !shallowEqualAttrs(entry.attributes, entry.platformAttributes) &&
        !entry.pendingEdit
      ) {
        throw new ExternalEditDetectedError(working.id, entry.classId);
      }
    }

    // ----- Step B — Refresh platformAttributes (TOCTOU fix) -----
    // Re-fetch live attributes inline rather than trust the caller-supplied
    // freshPlatformAttrs map. The caller (sync skill) batched-fetched the map
    // at the start of P7.2, then iterates through operator review (seconds to
    // minutes). Operator B's mutation landing during that window would be
    // silently overwritten by the original snapshot — Step D conflict
    // detection would never fire because our snapshot already shows B's prior
    // value as "ours-prev". Per-control fresh-fetch closes the window.
    //
    // Scope: ALL Controls, not shared-only. An alone-Control can still be
    // touched by another system (cron, external integration, manual Cypher)
    // during the operator review window — the safety property is honest only
    // if it covers every push regardless of shared/alone.
    //
    // Cost: one extra round-trip per touched Control. Caller's pre-flight
    // batched fetch becomes structurally redundant for safety-critical
    // purposes, but kept in the API surface for the skill's own rendering
    // (operator wants to see "your value vs server value" before deciding —
    // the pre-flight map is what drives that preview). Drop in V1.1 once
    // optimistic locking ships.
    let liveByClass: Map<string, Record<string, unknown>>;
    let usedStaleSnapshot = false;
    try {
      const liveRows = await this.dtControl.getControlInstantiationAttributes({
        controlIds: [working.id],
      });
      liveByClass = new Map(
        liveRows
          .filter((row): row is typeof row & { classId: string } => typeof row.classId === 'string')
          .map(row => [row.classId, (row.attributes as Record<string, unknown> | undefined) ?? {}]),
      );
    } catch (err) {
      // Narrow the catch to network-class transient errors. Auth, schema,
      // and transaction-conflict errors are EXACTLY the condition the
      // re-fetch was added to detect — silently falling back to a stale
      // snapshot would re-introduce the TOCTOU window.
      // Network blips (Bolt connection refused, session expired) are
      // legitimate transient and degrade safely; everything else bubbles.
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        /ServiceUnavailable|SessionExpired|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH/i.test(
          msg,
        );
      if (!isTransient) throw err;
      // eslint-disable-next-line no-console
      console.warn(
        `pushBrownfieldControl: Step B re-fetch failed transiently for ` +
          `control=${working.id}; falling back to caller-supplied freshPlatformAttrs ` +
          `(TOCTOU safety property degraded for this push). Reason: ${msg}`,
      );
      liveByClass = freshPlatformAttrs;
      usedStaleSnapshot = true;
    }
    for (let i = 0; i < working.classes.length; i++) {
      const entry = working.classes[i];
      if (!entry.pendingEdit) continue;
      const fresh = liveByClass.get(entry.classId) ?? freshPlatformAttrs.get(entry.classId) ?? {};
      working.classes[i] = { ...entry, platformAttributes: fresh };
    }

    // ----- Step C — Compute outbound payload + classify keys -----
    type ClassPushPlan = {
      classIdx: number;
      outboundPayload: Record<string, unknown>;
      blockedKeys: string[];
      conflictKeys: string[];
    };
    const plans: ClassPushPlan[] = [];
    let revertedAny = false;

    for (let i = 0; i < working.classes.length; i++) {
      const entry = working.classes[i];
      if (!entry.pendingEdit) continue;

      // First-write keys join previousAttributes keys to form the full
      // set of keys the operator intended to change. They go through the
      // same outbound-payload assembly but skip the platformAttrs
      // presence check (there's no prior value to conflict with — that's
      // the whole point of "first-write").
      const previousKeys = Object.keys(entry.pendingEdit.previousAttributes);
      const firstWriteKeys = entry.pendingEdit.firstWriteKeys ?? [];
      const firstWriteKeysSet = new Set(firstWriteKeys);
      const changedKeys = [...previousKeys, ...firstWriteKeys];
      const outboundPayload: Record<string, unknown> = {};
      const blockedKeys: string[] = [];
      const conflictKeys: string[] = [];
      const platformAttrs = entry.platformAttributes ?? {};

      for (const k of changedKeys) {
        outboundPayload[k] = entry.attributes[k];

        if (firstWriteKeysSet.has(k)) {
          // First-write key: by definition no prior value on either side. The
          // 'absent-and-unknown schema drift' guard does NOT apply here — that
          // guard catches mismatches between a recorded prior value in
          // previousAttributes and an absent server-side key (genuine drift).
          // First-write keys have no recorded prior; the schema status is
          // simply "key didn't exist anywhere yet, now it will." Push as-is.
          //
          // If `(k in platformAttrs)` happens to be true here (operator's
          // local file is stale and the platform actually does have a value),
          // the engine downgrades silently to a normal brownfield update —
          // there's no conflict baseline to detect drift against, so the
          // partial-payload `r += $attributes` merge wins. The validator
          // surfaces this stale-state pattern as a warning at write time
          // so it's visible before push.
          continue;
        }

        if (!(k in platformAttrs)) {
          // Engine deferral: collapse 'absent-but-known' into 'absent-and-unknown'.
          // Block the push for this key. (Does not apply to first-write keys —
          // those are handled above.)
          blockedKeys.push(k);
          delete outboundPayload[k];
        } else {
          // Conflict if server changed since our snapshot.
          const ourPrev = entry.pendingEdit.previousAttributes[k];
          const serverCurrent = platformAttrs[k];
          if (JSON.stringify(ourPrev) !== JSON.stringify(serverCurrent)) {
            conflictKeys.push(k);
          }
        }
      }

      // Step C revert detection: if every intended new value matches the
      // pre-edit value (operator typed back what they started with) the
      // outboundPayload would still be populated but this represents a
      // meaningful "considered and discarded" event — the §7 Step C revert
      // path. Detect via comparison against pendingEdit.previousAttributes
      // (NOT platformAttributes — the operator's intent baseline).
      const allRevertedToPrevious = changedKeys.every(
        k =>
          JSON.stringify(entry.attributes[k]) ===
          JSON.stringify(entry.pendingEdit!.previousAttributes[k]),
      );
      if (allRevertedToPrevious && changedKeys.length > 0) {
        // Write reverted audit entry, clear pendingEdit, no platform mutation.
        const auditEntry = await buildAuditEntry({
          kind: 'reverted',
          controlId: working.id,
          controlName: working.name,
          classId: entry.classId,
          className: entry.className ?? entry.classId,
          modelId: thisModelId,
          liveAssignedModelIds,
          intendedKeys: changedKeys,
          attributesPushed: {},
          previousAttributes: entry.pendingEdit.previousAttributes,
          editedBy: entry.pendingEdit.editedBy,
          authnOperator,
        });
        await appendAuditEntry(modelDir, auditEntry);
        auditEntries.push(auditEntry);
        // Clear localEditedAt alongside pendingEdit. The operator typed
        // back the pre-edit value — there's no longer an outstanding
        // local edit to surface in /dethereal:status. Without this clear,
        // status would keep showing "recently edited locally" indefinitely
        // until the next genuine edit + push cycle.
        working.classes[i] = { ...entry, pendingEdit: undefined, localEditedAt: undefined };
        revertedAny = true;
        continue;
      }

      if (blockedKeys.length > 0) {
        throw new Error(
          `pushBrownfieldControl: Control ${working.id} class ${entry.classId} has ${blockedKeys.length} ` +
            `'absent-and-unknown' key(s) (${blockedKeys.join(', ')}) that would create platform schema drift. ` +
            `Fix the local file or update the ControlClass template; this push will not proceed.`,
        );
      }

      if (Object.keys(outboundPayload).length > 0) {
        plans.push({ classIdx: i, outboundPayload, blockedKeys, conflictKeys });
      }
    }

    // If every class entry reverted, we're done — persist + return.
    // Note: lastPushedAt is intentionally NOT bumped on a revert-only path —
    // §7 Step F's "regardless of per-class outcome" wording assumes at least
    // one class entry was pushed. A revert moves no bytes to the platform
    // and writes a `reverted` audit entry instead, which is the right
    // operator-facing signal.
    if (plans.length === 0) {
      if (revertedAny) await writeControlFile(modelDir, working);
      return { file: working, auditEntries, mutated: false };
    }

    // ----- Step D — Per-key conflict resolution -----
    type ResolvedPlan = ClassPushPlan & {
      conflictResolutions: ConflictResolution[];
    };
    const resolvedPlans: ResolvedPlan[] = [];

    for (const plan of plans) {
      const entry = working.classes[plan.classIdx];
      const platformAttrs = entry.platformAttributes ?? {};
      const conflictResolutions: ConflictResolution[] = [];

      for (const k of plan.conflictKeys) {
        const decisionKey = `${plan.classIdx}.${k}`;
        const perKey = decision.perKey?.[decisionKey];
        const ours = entry.attributes[k];
        const theirs = platformAttrs[k];

        if (!perKey) {
          // CL §6 batched review screen: any conflicting key without a
          // decision is treated as 'cancel' for the entire control row.
          return { file: working, auditEntries, mutated: false };
        }

        if (perKey.chosen === 'keep') {
          // outboundPayload[k] already holds our value; record the resolution.
          conflictResolutions.push({ key: k, ours, theirs, chosen: 'ours' });
        } else if (perKey.chosen === 'accept-theirs') {
          delete plan.outboundPayload[k];
          // Copy server value into local attributes; update pendingEdit baseline.
          working.classes[plan.classIdx] = {
            ...entry,
            attributes: { ...entry.attributes, [k]: theirs },
            pendingEdit: entry.pendingEdit
              ? {
                  ...entry.pendingEdit,
                  previousAttributes: {
                    ...entry.pendingEdit.previousAttributes,
                    [k]: theirs,
                  },
                }
              : undefined,
          };
          conflictResolutions.push({ key: k, ours, theirs, chosen: 'theirs' });
        } else {
          // merge
          plan.outboundPayload[k] = perKey.merged;
          conflictResolutions.push({
            key: k,
            ours,
            theirs,
            chosen: 'merge',
            merged: perKey.merged,
          });
        }
      }

      // After resolution, the outboundPayload may be empty (every conflict
      // was accepted-theirs and there were no non-conflict keys). Skip the
      // platform mutation in that case.
      if (Object.keys(plan.outboundPayload).length > 0) {
        resolvedPlans.push({ ...plan, conflictResolutions });
      } else {
        // Clear pendingEdit on this class entry — every intended key was
        // dropped or accepted-theirs, so there's no longer anything to push.
        working.classes[plan.classIdx] = {
          ...working.classes[plan.classIdx],
          pendingEdit: undefined,
        };
      }
    }

    if (resolvedPlans.length === 0) {
      await writeControlFile(modelDir, working);
      return { file: working, auditEntries, mutated: false };
    }

    // ----- Step E — Shared-ownership check -----
    const isAlone =
      liveAssignedModelIds.length === 0 ||
      (liveAssignedModelIds.length === 1 && liveAssignedModelIds[0] === thisModelId);

    // Per-control shared-ownership signal. Per-class auditKind in Step F
    // uses this when set; otherwise falls back to 'first-write' when the
    // class push contains first-write keys.
    let sharedAuditKind: AuditLogEntry['kind'] | null = null;
    if (!isAlone) {
      switch (decision.sharedOwnership) {
        case 'cancel':
          return { file: working, auditEntries, mutated: false };
        case 'push-anyway':
          sharedAuditKind = 'force-shared';
          break;
        case 'push-unverified':
          sharedAuditKind = 'force-unverified';
          break;
        case 'clone-and-swap':
          throw new CloneAndSwapNotImplemented(working.id);
      }
    }

    // ----- Step F — Mutate + finalise -----
    //
    // **Crash recovery contract (NOT WAL-protected).**
    // Brownfield Step F has no Write-Ahead Log, distinct from greenfield's
    // id rewrite. The crash-resilience story has three layers:
    //
    //   1. **No on-disk mutation until success.** All Step F mutations to
    //      `working` are in-memory until `writeControlFile` runs after the
    //      loop. A crash mid-loop leaves the on-disk file unchanged: every
    //      class entry's `pendingEdit` is intact, `pushedAt` reflects the
    //      previous push, `localEditedAt` is unchanged.
    //   2. **Re-plan from scratch on retry.** The next `push-brownfield`
    //      invocation re-runs Steps A→F from a fresh read. Step A re-checks
    //      the external-edit guard; Step B re-fetches the live platform
    //      attributes (catches concurrent mutations during the crash
    //      window); Step D re-runs conflict detection against the
    //      newly-fetched state.
    //   3. **Idempotent under the partial-payload contract** (DEC-CL-11).
    //      The Cypher mutation is `SET r += $attributes` — a class entry
    //      that was successfully pushed before the crash has its server
    //      state already at the desired value, and the retry's outbound
    //      payload merges identical values (no-op). A class entry that
    //      wasn't reached gets pushed normally.
    //
    // The `pendingEdit` block on disk is the journal. Throwing here without
    // a partial-state file write is the contract.
    const now = new Date().toISOString();
    for (const plan of resolvedPlans) {
      const entry = working.classes[plan.classIdx];

      const ok = await this.dtControl.setInstantiationAttributes({
        controlId: working.id,
        classId: entry.classId,
        attributes: plan.outboundPayload,
      });
      if (!ok) {
        // Brownfield has no `partially-pushed` lifecycle. Throwing here is
        // safe because mid-loop mutations live only on the in-memory
        // `working` copy — on-disk state still has every class entry's
        // pendingEdit intact, so the next push re-plans from scratch and
        // re-attempts ALL classes (idempotent under the partial-payload
        // contract; a class already updated server-side just no-ops).
        // See the crash recovery contract block above.
        throw new Error(
          `pushBrownfieldControl: setInstantiationAttributes failed for control=${working.id} class=${entry.classId}. State preserved for retry.`,
        );
      }

      // Update platformAttributes for k in outboundPayload only (partial-payload
      // semantic — keys not in outboundPayload were not touched on the platform).
      const newPlatformAttrs = { ...(entry.platformAttributes ?? {}) };
      for (const k of Object.keys(plan.outboundPayload)) {
        newPlatformAttrs[k] = entry.attributes[k];
      }

      working.classes[plan.classIdx] = {
        ...entry,
        platformAttributes: newPlatformAttrs,
        pushedAt: now,
        pendingEdit: undefined,
      };

      // Per-class audit kind. Shared-ownership signals (force-shared /
      // force-unverified) take precedence over first-write because they're
      // the higher-stakes governance discriminator (operator deliberately
      // overwriting another team's keys vs. a benign new attribute write).
      // First-write information is still captured via the entry's
      // `firstWriteKeys` field regardless of which `kind` won.
      const fwKeysInPush = (entry.pendingEdit?.firstWriteKeys ?? []).filter(
        k => k in plan.outboundPayload,
      );
      const auditKind: AuditLogEntry['kind'] | null =
        sharedAuditKind ?? (fwKeysInPush.length > 0 ? 'first-write' : null);

      if (auditKind) {
        // Coerce editedBy='external' → 'operator' when previousAttributes
        // doesn't match the legitimate promoteExternalEdit shape (every
        // key in previousAttributes equals the corresponding key in the
        // pre-Step-B platformAttributes). A hand-edited file that set
        // editedBy='external' to launder the audit discriminator gets the
        // honest 'operator' tag in the log, defeating the spoof. The
        // legitimate promote-external-edit path is unaffected because
        // its previousAttributes are synthesised from platformAttributes
        // verbatim.
        //
        // Second hand-edit shape: editedBy='external' + non-empty
        // firstWriteKeys. promoteExternalEdit never produces firstWriteKeys,
        // so this combination is a hand-edit by construction. Defense-in-depth
        // backstop for cases that bypassed the validator.
        let auditEditedBy = entry.pendingEdit?.editedBy;
        if (auditEditedBy === 'external' && entry.pendingEdit) {
          const hasFirstWriteSpoof =
            Array.isArray(entry.pendingEdit.firstWriteKeys) &&
            entry.pendingEdit.firstWriteKeys.length > 0;

          let looksLikePromoteExternal = true;
          if (entry.platformAttributes) {
            const prev = entry.pendingEdit.previousAttributes;
            const platform = entry.platformAttributes;
            looksLikePromoteExternal = Object.keys(prev).every(
              k => JSON.stringify(prev[k]) === JSON.stringify(platform[k]),
            );
          }

          if (hasFirstWriteSpoof || !looksLikePromoteExternal) {
            auditEditedBy = 'operator';
          }
        }
        const auditEntry = await buildAuditEntry({
          kind: auditKind,
          controlId: working.id,
          controlName: working.name,
          classId: entry.classId,
          className: entry.className ?? entry.classId,
          modelId: thisModelId,
          liveAssignedModelIds: auditKind === 'force-unverified' ? null : liveAssignedModelIds,
          // intendedKeys is the union of recorded prior keys AND
          // first-write keys — the full set of keys the operator/agent
          // intended to change in the originating pendingEdit lifecycle.
          intendedKeys: [
            ...Object.keys(entry.pendingEdit?.previousAttributes ?? {}),
            ...(entry.pendingEdit?.firstWriteKeys ?? []),
          ],
          firstWriteKeys: fwKeysInPush.length > 0 ? fwKeysInPush : undefined,
          attributesPushed: plan.outboundPayload,
          previousAttributes: entry.pendingEdit?.previousAttributes ?? {},
          // Propagate the originating pendingEdit author so an auditor
          // can distinguish a `force-shared` driven by a deliberate
          // operator overwrite (`editedBy: 'operator' | 'agent'`) from
          // one that came out of a Step A `promote-external-edit`
          // recovery (`editedBy: 'external'`). Without this, both look
          // identical in the log. Coerced above for hand-edited spoofs.
          editedBy: auditEditedBy,
          authnOperator,
          conflictResolutions:
            plan.conflictResolutions.length > 0 ? plan.conflictResolutions : undefined,
          queryFailureReason:
            auditKind === 'force-unverified' ? decision.queryFailureReason : undefined,
          queryAttempts:
            auditKind === 'force-unverified' ? decision.queryAttempts ?? 1 : undefined,
        });
        await appendAuditEntry(modelDir, auditEntry);
        auditEntries.push(auditEntry);
      }
    }

    // Bump platformState.lastPushedAt (NOT lastSyncedAt — pushing bytes is
    // not the same as having fresh server state for other operators' keys).
    working = {
      ...working,
      platformState: {
        ...(working.platformState ?? {}),
        lastPushedAt: now,
      },
    };

    await writeControlFile(modelDir, working);
    return { file: working, auditEntries, mutated: true, usedStaleSnapshot };
  };

  // -----------------------------------------------------------------
  // markTombstoned
  // -----------------------------------------------------------------

  /**
   * Flip a Control's lifecycle to `tombstoned`. Preserves any `pendingEdit`
   * blocks (operator may want to recover the edits via clone-and-swap per
   * CL §6 option 3). Persists via the WAL helper's atomic-write sequence.
   *
   * **Lifecycle contract**: this method **accepts any
   * lifecycle** as input — greenfield, partially-pushed, brownfield, or
   * a Control already tombstoned. Tombstoning a greenfield Control is
   * legal (the operator decided not to push the local-only Control); no
   * platform-side cleanup is performed because greenfield Controls have
   * no platform existence. CL §5 documents the canonical transitions
   * but the engine does not enforce them — the skill layer
   * (`/dethereal:sync tombstone`) is the operator-facing gate.
   *
   * @throws {Error} I/O failures propagate from `writeControlFile`
   *   (disk full, permission denied, atomic-rename race with another
   *   process that deleted the target directory). No typed marker —
   *   these are infrastructure-level failures the caller bubbles.
   */
  markTombstoned = async ({
    modelDir,
    file,
  }: {
    modelDir: string;
    file: ControlFile;
  }): Promise<ControlFile> => {
    const tombstoned: ControlFile = { ...file, lifecycle: 'tombstoned' };
    await writeControlFile(modelDir, tombstoned);
    return tombstoned;
  };

  // -----------------------------------------------------------------
  // setLocalEdited
  // -----------------------------------------------------------------

  /**
   * Apply local edits to a class entry's `attributes`, bumping
   * `localEditedAt` and populating `pendingEdit` per the §4 two-write
   * semantic.
   *
   * **Two-write rule (CL §4):** for each changed key `k`,
   * `pendingEdit.previousAttributes[k]` is set to the pre-edit value
   * ONLY IF `k` is not already in `previousAttributes` — preserving the
   * operator's FIRST pre-edit value as the intent baseline across
   * subsequent edits within the same pendingEdit lifecycle.
   *
   * **First-write keys.** When a changed key has no prior
   * value in `entry.attributes` (the value is `undefined`), recording
   * it in `previousAttributes` would serialise as a missing key (JSON
   * drops `undefined`) — leaving the engine unable to distinguish "no
   * prior value, intentionally pushing for the first time" from "no
   * intent recorded at all." Such keys are tracked in
   * `pendingEdit.firstWriteKeys` instead. The two arrays are mutually
   * exclusive (a key is either first-write OR has a prior value, never
   * both). The two-write rule still applies: a key already pinned in
   * either array is not re-recorded by subsequent edits.
   *
   * Single source of truth for `localEditedAt` + `pendingEdit`. All
   * All callers (skills, manual operator edits via the MCP tool) must
   * go through this function.
   *
   * **Throws**:
   * @throws {Error} `classIdx` out of range for `file.classes` — plain
   *   `Error` because it indicates a caller bug (the MCP Zod schema
   *   should have rejected this earlier; reaching here means the engine
   *   is being driven directly without Zod-side validation).
   * @throws {IllegalEditedByError} `editedBy === 'external'`
   *   is rejected. The `'external'` discriminator is reserved for the
   *   `promote-external-edit` recovery verb's synthesised pendingEdit;
   *   surfacing it through the general-purpose edit verb would let an
   *   attacker forge audit-log provenance.
   */
  setLocalEdited = async ({
    modelDir,
    file,
    classIdx,
    newAttributes,
    editedBy,
  }: {
    modelDir: string;
    file: ControlFile;
    classIdx: number;
    newAttributes: Record<string, unknown>;
    editedBy: PendingEditAuthor;
  }): Promise<ControlFile> => {
    if (classIdx < 0 || classIdx >= file.classes.length) {
      throw new Error(`setLocalEdited: classIdx ${classIdx} out of range for ${file.id}`);
    }
    if (editedBy === 'external') {
      throw new IllegalEditedByError(file.id);
    }
    const working = JSON.parse(JSON.stringify(file)) as ControlFile;
    const entry = working.classes[classIdx];
    const now = new Date().toISOString();

    // Compute changed keys (deep equality via JSON.stringify — values are
    // JSON-serialisable per the schema).
    const changedKeys = Object.keys(newAttributes).filter(
      k => JSON.stringify(entry.attributes[k]) !== JSON.stringify(newAttributes[k]),
    );

    if (changedKeys.length === 0) {
      // No-op — skip the write.
      return working;
    }

    // Two-write rule: preserve the FIRST pre-edit value (or first-write status)
    // across subsequent edits within the same pendingEdit lifecycle.
    const previousAttributes = { ...(entry.pendingEdit?.previousAttributes ?? {}) };
    const firstWriteKeysSet = new Set<string>(entry.pendingEdit?.firstWriteKeys ?? []);
    for (const k of changedKeys) {
      // Skip if the key is already pinned by an earlier edit (either as a
      // recorded prior value or as a first-write).
      if (k in previousAttributes || firstWriteKeysSet.has(k)) continue;

      if (k in entry.attributes) {
        // Real prior value exists — record it as the §4 baseline.
        previousAttributes[k] = entry.attributes[k];
      } else {
        // No prior value on disk. Track as first-write rather than
        // serialising `undefined` into previousAttributes (where JSON
        // would drop it, producing a key the engine cannot recover).
        firstWriteKeysSet.add(k);
      }
    }

    const pendingEdit: PendingEditBlock = {
      editedBy,
      editedAt: now,
      previousAttributes,
    };
    if (firstWriteKeysSet.size > 0) {
      pendingEdit.firstWriteKeys = [...firstWriteKeysSet];
    }

    working.classes[classIdx] = {
      ...entry,
      attributes: { ...entry.attributes, ...newAttributes },
      localEditedAt: now,
      pendingEdit,
    };

    await writeControlFile(modelDir, working);
    return working;
  };

  // -----------------------------------------------------------------
  // promoteExternalEdit (recovery verb for Step A guard)
  // -----------------------------------------------------------------

  /**
   * Synthesise a `pendingEdit` block that records the operator's intent
   * to keep the local `attributes` divergence from `platformAttributes`,
   * unblocking the §7 Step A external-edit guard.
   *
   * **Why this exists.** The Step A guard refuses pushes when
   * `attributes !== platformAttributes` AND `pendingEdit` is absent —
   * the asymmetric-state-without-intent signal that catches direct
   * file edits or external mutations the operator hasn't claimed
   * ownership of. The recovery path is "I know about the divergence
   * and want to push it as my intent" — this method writes the
   * `pendingEdit` block that signals that claim.
   *
   * **Design note.** A naive recovery via
   * `setLocalEdited(attributes_after_pull, attributes_after_pull)`
   * fails because the engine's diff yields zero changed keys and
   * returns no-op. This method bypasses the diff: it computes
   * `previousAttributes` directly from `platformAttributes` for
   * exactly the keys where local `attributes` already diverges,
   * preserving the operator's actual intent (only the keys they
   * meant to change end up in `pendingEdit.previousAttributes`,
   * NOT a full snapshot — that would push every key on the next
   * `pushBrownfieldControl` call).
   *
   * Throws when there is no divergence to promote (the guard wouldn't
   * have fired anyway — the caller should report "no recovery needed").
   */
  promoteExternalEdit = async ({
    modelDir,
    file,
    classIdx,
  }: {
    modelDir: string;
    file: ControlFile;
    classIdx: number;
  }): Promise<ControlFile> => {
    if (classIdx < 0 || classIdx >= file.classes.length) {
      throw new Error(`promoteExternalEdit: classIdx ${classIdx} out of range for ${file.id}`);
    }
    const working = JSON.parse(JSON.stringify(file)) as ControlFile;
    const entry = working.classes[classIdx];
    const now = new Date().toISOString();

    // Refuse to overwrite
    // an existing pendingEdit. The Step A external-edit guard would not
    // have fired with a pendingEdit present (it requires `!entry.pendingEdit`),
    // so this method has no business being called in that state — invoking
    // it would discard the operator's first pre-edit value baseline (the
    // two-write rule's invariant). Bail loudly rather than silently destroy.
    if (entry.pendingEdit) {
      throw new Error(
        `promoteExternalEdit: Control ${working.id} class ${entry.classId} ` +
          `already has a pendingEdit (editedBy=${entry.pendingEdit.editedBy}, ` +
          `editedAt=${entry.pendingEdit.editedAt}). The Step A guard would not ` +
          `have fired — push directly via /dethereal:sync push instead.`,
      );
    }

    const platformAttrs = entry.platformAttributes ?? {};

    // Compute divergence — keys where local attributes differ from platform.
    // These are the operator's effective intent: what they want to push.
    const divergingKeys = Object.keys(entry.attributes).filter(
      k => JSON.stringify(entry.attributes[k]) !== JSON.stringify(platformAttrs[k]),
    );

    if (divergingKeys.length === 0) {
      throw new Error(
        `promoteExternalEdit: Control ${working.id} class ${entry.classId} has ` +
          `no divergence between attributes and platformAttributes — Step A guard ` +
          `would not have fired and there is nothing to promote.`,
      );
    }

    const previousAttributes: Record<string, unknown> = {};
    for (const k of divergingKeys) {
      previousAttributes[k] = platformAttrs[k];
    }

    working.classes[classIdx] = {
      ...entry,
      localEditedAt: now,
      pendingEdit: {
        editedBy: 'external',
        editedAt: now,
        previousAttributes,
      },
    };

    await writeControlFile(modelDir, working);
    return working;
  };
}

// =======================================================================
// Helpers
// =======================================================================

function shallowEqualAttrs(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

// Re-export the file-IO helpers + audit-log + WAL types from one barrel
// position so callers can import everything via `@dethernety/dt-core`.
export {
  readControlFile,
  writeControlFile,
  listControlFiles,
  deleteControlFile,
  getControlFilePath,
} from './file-io.js';
export {
  appendAuditEntry,
  buildAuditEntry,
  computeEffective,
  getAuditLogPath,
  getOperatorEmail,
} from './audit-log-writer.js';
export type {
  AuditLogEntry,
  ConflictResolution,
} from './audit-log-writer.js';
export {
  appendOperation,
  applyPendingRewrites,
  atomicWriteWithFsync,
  readJournal,
  replaceIdInFile,
  getJournalPath,
  inspectPendingRewrite,
  clearPendingRewrite,
} from './wal-helper.js';
export type {
  PendingOperation,
  GreenfieldIdRewriteOp,
  CloneAndSwapOp,
  PendingIdRewriteJournal,
  WalInspection,
  WalOperationInspection,
  WalGreenfieldInspection,
  WalCloneAndSwapInspection,
} from './wal-helper.js';
export { validateControlFile, validateControlFileWithPlatform } from './validator.js';
export type { ValidationResult } from './validator.js';
export {
  acquireLock,
  releaseLock,
  withLock,
  getLockPath,
  LockBusyError,
} from './lock-helper.js';
export type { LockHandle } from './lock-helper.js';
export {
  detectControlDrift,
  detectControlSetDrift,
  isClassDrifted,
} from './drift-detector.js';
export type { ControlDriftReport, ClassDriftReport } from './drift-detector.js';
