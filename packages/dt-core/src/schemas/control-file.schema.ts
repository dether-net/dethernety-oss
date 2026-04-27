/**
 * Per-Control configuration file schema (`controls/<id>.json`).
 *
 * Captures per-instance ControlClass attributes, lifecycle state, and platform
 * drift tracking for each Control referenced by a threat model. See
 * CONTROL_LIBRARY.md §4 for full field semantics and DEC-CL-11 for the
 * partial-payload push contract.
 */

import type { UUID } from './common.schema.js';

/**
 * Lifecycle state of a Control file.
 *
 * - `greenfield`: local-authored, not yet pushed to platform. Uses a temporary
 *   id (`greenfield-<short-uuid>`) until first successful push.
 * - `partially-pushed`: platform create succeeded, some classes still pending
 *   attribute push. Resumable on next sync.
 * - `brownfield`: fully pushed; platform is authoritative.
 * - `tombstoned`: platform-side Control deleted; local file retained for
 *   operator-driven recovery via clone-and-swap.
 */
export type ControlLifecycle = 'greenfield' | 'partially-pushed' | 'brownfield' | 'tombstoned';

/**
 * Who authored a pending attribute edit on a brownfield class entry.
 */
export type PendingEditAuthor = 'agent' | 'operator' | 'external';

/**
 * Marker block recording that a brownfield class entry has local edits
 * pending a push to the platform.
 *
 * `previousAttributes` is keyed by the changed-attribute name only — NOT the
 * full attribute payload. On push, Step C sends only these keys (partial
 * payload; the platform's `r += $attributes` merge leaves untouched keys on
 * the IS_INSTANCE_OF edge alone). See CONTROL_LIBRARY.md DEC-CL-11.
 */
export interface PendingEditBlock {
  editedBy: PendingEditAuthor;
  /** ISO-8601 timestamp of the edit. */
  editedAt: string;
  /**
   * Pre-edit values of the keys the operator/agent intended to change.
   * Keyed by attribute name. Two-write semantic: a subsequent edit to the
   * same key MUST NOT overwrite the original pre-edit value already recorded
   * here — that value represents the operator's intent baseline.
   *
   * Keys recorded here are mutually exclusive with {@link firstWriteKeys}:
   * a key is either first-write (no prior value existed) OR has a prior
   * value recorded here — never both.
   */
  previousAttributes: Record<string, unknown>;
  /**
   * Keys the operator/agent intended to set for which no prior value
   * existed in `attributes` at the time of the first `setLocalEdited`
   * call. These keys are pushed to the platform without conflict
   * detection (there's nothing to conflict with), and the
   * `(k in platformAttributes)` "absent-and-unknown schema drift"
   * guard does NOT apply to them.
   *
   * Optional / absent on Sprint-3-era files (back-compat — read sites
   * use `?? []`). Engine writes the field only when non-empty so
   * unaffected files keep their pre-Sprint-7 shape on disk.
   *
   * Mutually exclusive with {@link previousAttributes} keys. The
   * validator rejects overlap.
   */
  firstWriteKeys?: string[];
}

/**
 * One entry per ControlClass the Control is `IS_INSTANCE_OF`. A single
 * Control can be an instance of multiple classes; each has its own template
 * and its own attribute payload.
 */
export interface ControlFileClassEntry {
  /** ControlClass UUID. Drives the `setInstantiationAttributes` mutation. */
  classId: UUID;
  /** Cached for human readability and to skip a get_classes round-trip. */
  className?: string;
  /** Cached for human readability and tooling context. */
  moduleId?: UUID;
  /**
   * Agent-editable per-instance values. Keys must match the ControlClass
   * template's `properties`. Empty object `{}` is valid (agent has not yet
   * observed values).
   */
  attributes: Record<string, unknown>;
  /**
   * Raw payload as returned by the platform on last successful push or pull.
   * Diff is computed against this, not against `attributes` itself. Only
   * present on brownfield / partially-pushed entries.
   */
  platformAttributes?: Record<string, unknown>;
  /**
   * ISO-8601 of the last agent or operator write to `attributes`. Bumped
   * explicitly by writers — filesystem mtime is not used. Required when
   * `attributes` differs from `platformAttributes`, or on greenfield entries.
   */
  localEditedAt?: string;
  /**
   * ISO-8601 of the last successful `setInstantiationAttributes` for this
   * class entry. Only present on brownfield / partially-pushed entries.
   * Enables resume-from-partially-pushed (skip entries where
   * `pushedAt >= localEditedAt`).
   */
  pushedAt?: string;
  /**
   * Present only between agent edit and next push. Records exactly which
   * keys were intended to change and their pre-edit values. See
   * {@link PendingEditBlock} and CONTROL_LIBRARY.md §4 / DEC-CL-11.
   */
  pendingEdit?: PendingEditBlock;
}

/**
 * Cached snapshot of platform-wide state at last interaction.
 *
 * Used by `/dethereal:status` for drift display only — NOT by the
 * shared-ownership check, which always queries fresh. Greenfield files have
 * no `platformState` until first successful push.
 */
export interface ControlFilePlatformState {
  /**
   * ISO-8601 of the most recent successful pull (auto-pull at start of
   * control pass, or explicit `/dethereal:sync pull`). Never bumped by push.
   */
  lastSyncedAt?: string;
  /**
   * ISO-8601 of the most recent successful push (any class entry on this
   * Control had `setInstantiationAttributes` mutated successfully). Distinct
   * from `lastSyncedAt` because pushing bytes does not refresh the local
   * snapshot of other operators' values.
   */
  lastPushedAt?: string;
  /** Cached count at last interaction — for display only. */
  assignedModelCount?: number;
  /** Cached ids at last interaction — for display only, never used as source of truth. */
  assignedModelIds?: UUID[];
}

/**
 * Origin/confirmation source for a control reference. Mirrors the `source`
 * field on the corresponding `controls[]` entry in `structure.json` /
 * `dataflows.json`.
 */
export type ControlSource = 'discovered' | 'declared' | 'both';

/**
 * Full per-Control configuration file, persisted as `controls/<id>.json`.
 *
 * See CONTROL_LIBRARY.md §4 for field semantics and §5 for lifecycle
 * transitions.
 */
export interface ControlFile {
  /**
   * Platform Control UUID once promoted to brownfield. While
   * `lifecycle === 'greenfield'`, a temporary local id
   * (`greenfield-<short-uuid>`) — replaced via the WAL-protected id rewrite
   * immediately after the platform create succeeds.
   */
  id: string;
  /**
   * Mirrors the `name` in `controls[]` references; useful for human review
   * of the file. Platform-authoritative for brownfield Controls — overwritten
   * on every pull.
   */
  name: string;
  /** Mirrors the `source` field on the `controls[]` reference. */
  source: ControlSource;
  /** See {@link ControlLifecycle}. */
  lifecycle: ControlLifecycle;
  /**
   * One entry per ControlClass the Control is an instance of. Platform
   * mutation is per-(Control, ControlClass) pair, so the local file mirrors
   * that shape: one entry per class, one mutation per entry on push.
   */
  classes: ControlFileClassEntry[];
  /**
   * Cached platform-wide state — brownfield / partially-pushed only.
   * Greenfield files have no `platformState` until first successful push.
   */
  platformState?: ControlFilePlatformState;
}
