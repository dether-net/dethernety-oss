/**
 * Pure validator for the per-Control file format (`controls/<id>.json`).
 *
 * Returns structured errors (file is invalid; sync must refuse) and
 * warnings (file is unusual but legal; surface for operator review).
 *
 * Rules per CONTROL_LIBRARY.md §4 (File Schema) and §9 Validator row:
 *
 * - `id` is a UUID OR matches greenfield temp-id pattern (`greenfield-...`).
 * - `lifecycle` ∈ {greenfield, partially-pushed, brownfield, tombstoned}.
 * - For each `classes[]` entry: if `pendingEdit` present, then
 *   `localEditedAt > pushedAt` (or `pushedAt` absent).
 * - Asymmetric state (`attributes != platformAttributes` AND `pendingEdit`
 *   absent) → warning only. The runtime guard is the brownfield Step A
 *   external-edit check.
 * - Asymmetric state (`pendingEdit` populated AND
 *   `attributes == platformAttributes`) is **valid** — the operator
 *   rolled an edit back to server value; the next push clears `pendingEdit`.
 * - `lifecycle: 'greenfield'` ⇒ `platformState` absent.
 * - `lifecycle: 'brownfield' | 'partially-pushed'` ⇒ `platformState` present.
 *
 * **Out of scope** (orchestrator's responsibility — Sprint 3 wires into
 * `validate-model.tool.ts`):
 * - Orphan-file warning (no matching `controls[]` reference) — requires
 *   reading the model directory's structure.json / dataflows.json.
 * - Cross-reference: `controls[]` ref with no matching local file.
 * - Live-platform check that `classes[].classId` resolves to an existing
 *   ControlClass (deferred via separate function below).
 */

import type {
  ControlFile,
  ControlFileClassEntry,
  ControlLifecycle,
} from '../schemas/control-file.schema.js';
import { isClassDrifted } from './drift-detector.js';

const VALID_LIFECYCLES: ReadonlySet<ControlLifecycle> = new Set([
  'greenfield',
  'partially-pushed',
  'brownfield',
  'tombstoned',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GREENFIELD_TEMP_ID_RE = /^greenfield-/;

const VALID_SOURCES = new Set(['discovered', 'declared', 'both']);

// Sprint 5 F-17: defence-in-depth against prototype-pollution-shaped keys.
// The engine uses `Object.assign` and `{...spread}` on attribute payloads at
// several sites; a `__proto__` key smuggled in by a hand-edited control file
// is benign today but one refactor away from an exploit. Reject these key
// names anywhere in the attribute graph.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function findForbiddenKeyPath(value: unknown, path: string[] = []): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findForbiddenKeyPath(value[i], [...path, String(i)]);
      if (found) return found;
    }
    return null;
  }
  for (const k of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(k)) {
      return [...path, k].join('.');
    }
    const found = findForbiddenKeyPath((value as Record<string, unknown>)[k], [...path, k]);
    if (found) return found;
  }
  return null;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validate a `ControlFile` against the §4 schema invariants.
 *
 * Pure function — no I/O, no platform calls. Returns errors + warnings;
 * the caller decides how to surface them (CLI message, MCP tool response,
 * structured error envelope).
 */
export function validateControlFile(file: ControlFile): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Top-level fields ---

  if (typeof file.id !== 'string' || file.id.length === 0) {
    errors.push('id: must be a non-empty string');
  } else if (!UUID_RE.test(file.id) && !GREENFIELD_TEMP_ID_RE.test(file.id)) {
    errors.push(
      `id: '${file.id}' is neither a UUID nor a greenfield temp id (expected '<uuid>' or 'greenfield-<suffix>')`,
    );
  }

  if (typeof file.name !== 'string' || file.name.length === 0) {
    errors.push('name: must be a non-empty string');
  }

  if (typeof file.source !== 'string' || !VALID_SOURCES.has(file.source)) {
    errors.push(
      `source: '${String(file.source)}' invalid (expected one of ${Array.from(VALID_SOURCES).join(', ')})`,
    );
  }

  if (
    typeof file.lifecycle !== 'string' ||
    !VALID_LIFECYCLES.has(file.lifecycle as ControlLifecycle)
  ) {
    errors.push(
      `lifecycle: '${String(file.lifecycle)}' invalid (expected one of ${Array.from(VALID_LIFECYCLES).join(', ')})`,
    );
  }

  if (!Array.isArray(file.classes)) {
    errors.push('classes: must be an array');
  }

  // --- Lifecycle ⇄ id consistency ---

  if (file.lifecycle === 'greenfield' && UUID_RE.test(file.id)) {
    warnings.push(
      `lifecycle 'greenfield' usually pairs with a 'greenfield-...' temp id; '${file.id}' is a UUID. Likely a stale lifecycle field — should it be 'brownfield'?`,
    );
  }
  if (
    (file.lifecycle === 'brownfield' || file.lifecycle === 'partially-pushed') &&
    GREENFIELD_TEMP_ID_RE.test(file.id)
  ) {
    errors.push(
      `lifecycle '${file.lifecycle}' requires a UUID; got greenfield temp id '${file.id}'. The WAL id-rewrite must complete before the lifecycle can flip.`,
    );
  }

  // --- platformState presence rules ---

  if (file.lifecycle === 'greenfield' && file.platformState) {
    warnings.push(
      'platformState is present on a greenfield file. Greenfield is local-only; platformState should appear on first successful push.',
    );
  }
  if (
    (file.lifecycle === 'brownfield' || file.lifecycle === 'partially-pushed') &&
    !file.platformState
  ) {
    errors.push(
      `lifecycle '${file.lifecycle}' requires a platformState block (lastPushedAt or lastSyncedAt at minimum).`,
    );
  }

  // --- Per-class entry validation ---

  if (Array.isArray(file.classes)) {
    file.classes.forEach((entry, idx) => {
      const classCtx = `classes[${idx}] (classId=${entry.classId ?? '<missing>'})`;
      validateClassEntry(entry, file.lifecycle, classCtx, errors, warnings);
    });
  }

  return { errors, warnings };
}

function validateClassEntry(
  entry: ControlFileClassEntry,
  lifecycle: ControlLifecycle | string,
  ctx: string,
  errors: string[],
  warnings: string[],
): void {
  // Sprint 5 F-18: refuse to run class-entry checks on an unknown lifecycle.
  // The downstream branches all gate on lifecycle === 'brownfield' |
  // 'partially-pushed'; if the value is corrupt, those gates silently skip
  // and the operator sees a clean validate result on a file the runtime will
  // reject. Surface an explicit warning so the lifecycle error from §86-92 is
  // not the only signal.
  if (!VALID_LIFECYCLES.has(lifecycle as ControlLifecycle)) {
    warnings.push(
      `${ctx}: lifecycle '${String(lifecycle)}' is not in the known enum — class-entry checks skipped to avoid misleading downstream signals.`,
    );
    return;
  }

  if (typeof entry.classId !== 'string' || entry.classId.length === 0) {
    errors.push(`${ctx}: classId must be a non-empty string`);
  }

  if (typeof entry.attributes !== 'object' || entry.attributes === null) {
    errors.push(`${ctx}: attributes must be an object (use {} when empty)`);
    return;
  }

  // Sprint 5 F-17: prototype-pollution key check on attributes,
  // platformAttributes, and pendingEdit.previousAttributes (recursive).
  for (const [field, payload] of [
    ['attributes', entry.attributes as unknown],
    ['platformAttributes', entry.platformAttributes as unknown],
    ['pendingEdit.previousAttributes', entry.pendingEdit?.previousAttributes as unknown],
  ] as const) {
    if (payload === undefined || payload === null) continue;
    const found = findForbiddenKeyPath(payload);
    if (found) {
      errors.push(
        `${ctx}.${field}: forbidden key '${found}' (matches prototype-pollution pattern). ` +
          `Reserved names {__proto__, constructor, prototype} are rejected at any depth.`,
      );
    }
  }

  // pendingEdit ⇒ localEditedAt > pushedAt (or pushedAt absent) per §4.
  if (entry.pendingEdit) {
    if (
      typeof entry.pendingEdit.editedBy !== 'string' ||
      !['agent', 'operator', 'external'].includes(entry.pendingEdit.editedBy)
    ) {
      errors.push(
        `${ctx}.pendingEdit: editedBy must be 'agent' | 'operator' | 'external'`,
      );
    }
    // Sprint 4 Tier-2 cross-review (threat-modeler F-01 hand-edit bypass):
    // 'external' is reserved for the promote-external-edit recovery verb,
    // which produces a pendingEdit whose previousAttributes mirror the
    // platformAttributes for diverging keys only. A hand-edit that sets
    // editedBy='external' typically has previousAttributes that does NOT
    // match this shape — flag for operator review. Engine-side coercion
    // in pushBrownfieldControl downgrades to 'operator' before writing the
    // audit entry, but the validator surfaces the suspicious state at
    // /dethereal:status / validate-model time so it doesn't reach push silently.
    else if (
      entry.pendingEdit.editedBy === 'external' &&
      entry.platformAttributes &&
      typeof entry.pendingEdit.previousAttributes === 'object' &&
      entry.pendingEdit.previousAttributes !== null
    ) {
      const prev = entry.pendingEdit.previousAttributes as Record<string, unknown>;
      const platform = entry.platformAttributes;
      const mismatchedKeys = Object.keys(prev).filter(
        k => JSON.stringify(prev[k]) !== JSON.stringify(platform[k]),
      );
      if (mismatchedKeys.length > 0) {
        warnings.push(
          `${ctx}.pendingEdit: editedBy='external' but previousAttributes does not match ` +
            `platformAttributes for keys [${mismatchedKeys.join(', ')}] — this discriminator ` +
            `is reserved for the /dethereal:sync promote-external-edit recovery verb, which ` +
            `synthesises previousAttributes from platformAttributes. The engine will coerce ` +
            `editedBy='operator' on push so the audit entry doesn't misrepresent provenance.`,
        );
      }
    }
    // Sprint 7 — promoteExternalEdit synthesises previousAttributes from
    // platformAttributes for diverging keys; it NEVER produces firstWriteKeys.
    // A pendingEdit claiming editedBy='external' with non-empty firstWriteKeys
    // is necessarily a hand-edit spoofing the discriminator. Hard error so
    // /dethereal:status and validate-model surface it before push. Independent
    // of the previous check (platformAttributes presence is irrelevant here —
    // the spoof is detectable from the editedBy + firstWriteKeys combination
    // alone).
    if (
      entry.pendingEdit.editedBy === 'external' &&
      Array.isArray(entry.pendingEdit.firstWriteKeys) &&
      entry.pendingEdit.firstWriteKeys.length > 0
    ) {
      errors.push(
        `${ctx}.pendingEdit: editedBy='external' must NOT carry firstWriteKeys — ` +
          `the promote-external-edit recovery verb (the only legitimate producer ` +
          `of editedBy='external') synthesises previousAttributes from ` +
          `platformAttributes and never emits firstWriteKeys. This pattern indicates ` +
          `a hand-edit; reset pendingEdit and re-run /dethereal:sync pull or use ` +
          `set-local-edited to record the intent.`,
      );
    }
    if (typeof entry.pendingEdit.editedAt !== 'string') {
      errors.push(`${ctx}.pendingEdit: editedAt must be an ISO-8601 string`);
    }
    if (
      typeof entry.pendingEdit.previousAttributes !== 'object' ||
      entry.pendingEdit.previousAttributes === null
    ) {
      errors.push(
        `${ctx}.pendingEdit: previousAttributes must be an object keyed by attribute name`,
      );
    }
    // Sprint 7 — first-write keys must be a string array, mutually exclusive
    // with previousAttributes keys. The engine writes the field only when
    // non-empty; pre-Sprint-7 files have no field (back-compat — undefined
    // is fine).
    if (entry.pendingEdit.firstWriteKeys !== undefined) {
      if (
        !Array.isArray(entry.pendingEdit.firstWriteKeys) ||
        !entry.pendingEdit.firstWriteKeys.every(k => typeof k === 'string')
      ) {
        errors.push(
          `${ctx}.pendingEdit: firstWriteKeys must be an array of strings (Sprint 7 — first-write key tracking)`,
        );
      } else if (
        typeof entry.pendingEdit.previousAttributes === 'object' &&
        entry.pendingEdit.previousAttributes !== null
      ) {
        const prevKeys = new Set(Object.keys(entry.pendingEdit.previousAttributes));
        const overlap = entry.pendingEdit.firstWriteKeys.filter(k => prevKeys.has(k));
        if (overlap.length > 0) {
          errors.push(
            `${ctx}.pendingEdit: keys [${overlap.join(', ')}] appear in both ` +
              `previousAttributes and firstWriteKeys — these sets must be disjoint ` +
              `(a key is either first-write OR has a prior value, never both).`,
          );
        }
        // Soft warning: firstWriteKeys also present in platformAttributes
        // suggests the local file is stale (operator should /dethereal:sync pull
        // before pushing). Engine still copes — pushBrownfieldControl falls
        // through to the partial-payload `r += $attributes` semantic for these
        // keys — but the operator should know.
        if (entry.platformAttributes && typeof entry.platformAttributes === 'object') {
          const stale = entry.pendingEdit.firstWriteKeys.filter(
            k => k in (entry.platformAttributes as Record<string, unknown>),
          );
          if (stale.length > 0) {
            warnings.push(
              `${ctx}.pendingEdit: firstWriteKeys [${stale.join(', ')}] also appear in ` +
                `platformAttributes — local file may be stale; consider /dethereal:sync ` +
                `pull before pushing. The engine will downgrade to a normal brownfield ` +
                `update for these keys at push time.`,
            );
          }
        }
      }
    }
    if (!entry.localEditedAt) {
      errors.push(
        `${ctx}: pendingEdit is populated but localEditedAt is absent (CL §4 — writer must bump localEditedAt on every edit)`,
      );
    } else if (entry.pushedAt && entry.pushedAt >= entry.localEditedAt) {
      errors.push(
        `${ctx}: pendingEdit is populated but pushedAt (${entry.pushedAt}) >= localEditedAt (${entry.localEditedAt}). The pendingEdit should have been cleared on the last successful push.`,
      );
    }
  }

  // External-edit warning: routed through the shared drift-detector helper
  // (Sprint 4 F-12) so /dethereal:status and validate-model agree on what
  // counts as drift. The drift predicate already encodes the
  // brownfield/partially-pushed lifecycle gate and the platformAttributes /
  // pendingEdit checks.
  if ((lifecycle === 'brownfield' || lifecycle === 'partially-pushed') && isClassDrifted(entry)) {
    // Sprint 5 F-38: include the classId in the recovery hint so the operator
    // can paste the verb exactly. The promote-external-edit verb requires
    // both the control id and the class id (one Control can be an instance of
    // multiple classes, each with independent drift state).
    warnings.push(
      `${ctx}: attributes differ from platformAttributes but no pendingEdit block records the change. The brownfield push will refuse this state at runtime (Step A external-edit guard) — run /dethereal:sync promote-external-edit <controlId> ${entry.classId} to recover.`,
    );
  }

  // Per §4: brownfield / partially-pushed entries should have platformAttributes
  // (set by pull or by a successful push). Missing it is suspicious.
  if (
    (lifecycle === 'brownfield' || lifecycle === 'partially-pushed') &&
    !entry.platformAttributes
  ) {
    warnings.push(
      `${ctx}: platformAttributes is absent on a ${lifecycle} entry. Re-pull recommended to populate it.`,
    );
  }
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

/**
 * Live-platform validation: confirm every `classes[].classId` resolves to
 * an existing ControlClass on the platform. Caller supplies the templates
 * map (typically built from a Sprint-1 batched `getControlsByIds` result).
 *
 * Skipped at validate-time when the platform is unreachable; the orchestrator
 * decides whether to invoke this branch.
 */
export function validateControlFileWithPlatform(
  file: ControlFile,
  classTemplates: Map<string, { id: string }>,
): ValidationResult {
  const result = validateControlFile(file);

  if (Array.isArray(file.classes)) {
    file.classes.forEach((entry, idx) => {
      if (entry.classId && !classTemplates.has(entry.classId)) {
        result.errors.push(
          `classes[${idx}]: classId '${entry.classId}' does not resolve to any ControlClass on the platform.`,
        );
      }
    });
  }

  return result;
}
