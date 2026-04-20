/**
 * Pure drift-detection helper for control files (Sprint 4 F-12).
 *
 * Sprint 3 left the drift-detection logic duplicated:
 *   1. {@link ../validator.ts} computed the "attributes != platformAttributes
 *      WITHOUT pendingEdit" external-edit warning inline.
 *   2. The `/dethereal:status` skill prose described the same condition for
 *      the agent to evaluate per class entry.
 *
 * Two implementations of the same predicate diverge over time — an operator
 * could see one set of drift warnings via `status` and a different set via
 * `validate-model` once the conditions inevitably split. This helper is
 * the single source of truth: validator.ts imports it, the status SKILL
 * prose references it as authoritative for what counts as drift.
 *
 * **Pure.** No I/O, no Apollo, no fs. Input: a parsed `ControlFile`.
 * Safe to call from any layer (skill, MCP tool, frontend).
 */

import type { ControlFile, ControlFileClassEntry } from '../schemas/control-file.schema.js';

export interface ClassDriftReport {
  classId: string;
  /** "external-edit" — attributes diverge from last-pulled platformAttributes
   * with no pendingEdit recording the change. The Step A external-edit
   * guard refuses to push this state at runtime. */
  reason: 'external-edit';
}

export interface ControlDriftReport {
  controlId: string;
  controlName: string;
  /** Per-class drift entries. Empty array when no drift detected. */
  driftedClasses: ClassDriftReport[];
  /** Convenience flag — true iff `driftedClasses.length > 0`. */
  hasDrift: boolean;
}

/**
 * Compute drift for a single control file.
 *
 * A class entry is considered drifted iff ALL of the following hold:
 *   - `lifecycle` is `brownfield` or `partially-pushed` (greenfield has
 *     no platformAttributes yet — divergence is expected; tombstoned
 *     entries are decoupled from platform reconciliation).
 *   - `platformAttributes` is populated.
 *   - `pendingEdit` is absent.
 *   - `attributes` differs from `platformAttributes` by shallow equality.
 *
 * Recovery: `/dethereal:sync promote-external-edit <controlId> <classId>`
 * synthesises a pendingEdit from the divergence, unblocking Step A.
 */
export function detectControlDrift(file: ControlFile): ControlDriftReport {
  const driftedClasses: ClassDriftReport[] = [];
  if (file.lifecycle !== 'brownfield' && file.lifecycle !== 'partially-pushed') {
    return { controlId: file.id, controlName: file.name, driftedClasses: [], hasDrift: false };
  }
  for (const entry of file.classes) {
    if (isClassDrifted(entry)) {
      driftedClasses.push({ classId: entry.classId, reason: 'external-edit' });
    }
  }
  return {
    controlId: file.id,
    controlName: file.name,
    driftedClasses,
    hasDrift: driftedClasses.length > 0,
  };
}

/**
 * Per-class drift predicate. Exposed for callers that already iterate
 * classes themselves (validator.ts) and only need the boolean.
 */
export function isClassDrifted(entry: ControlFileClassEntry): boolean {
  if (!entry.platformAttributes) return false;
  if (entry.pendingEdit) return false;
  return !shallowEqualAttrs(entry.attributes, entry.platformAttributes);
}

/**
 * Aggregate drift report across many control files. Convenience for
 * `/dethereal:status` and orchestrators that hold the full set.
 */
export function detectControlSetDrift(files: ControlFile[]): ControlDriftReport[] {
  return files.map(detectControlDrift).filter(r => r.hasDrift);
}

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
