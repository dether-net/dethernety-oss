/**
 * Append-only audit-log writer for control-library cross-model writes and
 * considered-but-discarded edits.
 *
 * Four entry kinds, all defined in CONTROL_LIBRARY.md §6 "Audit log":
 *
 * - **`force-shared`** — operator chose "Push anyway" on a shared-ownership
 *   prompt. Records `liveAssignedModelIds`, attribute diff, mutation
 *   timestamps. The governance trail SOC 2 / ISO 27001 auditors look for.
 * - **`force-unverified`** — operator chose to push despite a failed
 *   `getControlsAssignedModels` query. Same shape as `force-shared` plus
 *   `queryFailureReason` and `queryAttempts`; `liveAssignedModelIds: null`.
 * - **`reverted`** — operator reverted all proposed values back to their
 *   pre-edit state before push. Captures the "we considered this and
 *   decided not to" governance signal that would otherwise vanish silently
 *   when `pendingEdit` is cleared. `attributesPushed = {}, effective: null`.
 * - **`first-write`** — at least one key in the outbound payload had no
 *   prior value on either the local file or the platform's IS_INSTANCE_OF
 *   edge before this push (recorded in `pendingEdit.firstWriteKeys`).
 *   Captures "this Control–ControlClass binding was newly populated."
 *   Records `firstWriteKeys` and the values pushed under those keys.
 *   `previousAttributes` is `{}` when every key in the push was first-write.
 *   Shared-ownership signals (`force-shared` / `force-unverified`) take
 *   precedence in the `kind` field — for those entries, `firstWriteKeys`
 *   appears as a sibling field so the first-write information is still
 *   captured without losing the higher-stakes governance discriminator.
 *
 * Path: `<modelDir>/.dethereal/control-audit.log` per CL §6 + DEC-CL-12.
 * **Committed to the repository** (not gitignored — overrides the typical
 * `.dethereal/` gitignore convention specifically for this filename).
 *
 * Append happens AFTER the platform mutation has acknowledged success;
 * a crash mid-append leaves the log without the entry but the platform
 * state still reflects the change. Re-running `/dethereal:sync` after a
 * crash detects the now-applied edit as already-pushed and does not
 * re-prompt.
 *
 * **Secret-handling caveat (CL Appendix A.7).** This writer records
 * `attributesPushed` and `previousAttributes` verbatim — including any
 * secret-like values (`api_key`, `password`, `vault_token_ref`, etc.).
 * Combined with the commit-to-repo convention above, secrets that flow
 * through here become permanent in git history. V1 does NOT auto-redact;
 * operators with secret-bearing Controls should either gitignore
 * `control-audit.log` for that repo OR store secrets out-of-band (vault
 * refs, env-var indirection on the platform side) rather than as literal
 * Control attribute values. The `/dethereal:sync` skill emits a one-time
 * NOTE in the post-push summary pointing at this caveat.
 *
 * **V1 trust model.** Each entry carries two attribution fields:
 *
 * - `operator` — locally-claimed identity (from `git config user.email`).
 *   The operator can spoof this by setting any value in their git config
 *   or via `GIT_AUTHOR_EMAIL`. Kept because there's a legitimate use case:
 *   a developer's commit identity legitimately differs from their corp SSO
 *   email.
 * - `authnOperator` — JWT-anchored identity (the `email` / `sub` claim
 *   from the OIDC token that authorised the platform mutation). The
 *   platform-anchored truth. A mismatch with `operator` is a forensic
 *   signal worth investigating. Three states:
 *     - field **absent** (`undefined`) → older entry, pre-dates the
 *       field. Treat as "attribution unknown for back-compat reasons."
 *     - field **present** with an email/sub value → JWT decode succeeded;
 *       this is the platform-anchored identity.
 *     - field **present** with sentinel `'unauthenticated'` → MCP entry
 *       had no token or an unparseable token; attribution is provably
 *       impossible from this side. Distinct from the back-compat absence
 *       so an auditor can tell "no token" apart from "old entry."
 *
 * **What V1 does NOT provide:** tamper-evidence on the log file itself.
 * The "git history is the second layer" defence relies on the operator
 * actually committing `.dethereal/control-audit.log`, which the skill
 * recommends but does not enforce. A malicious operator with write access
 * to the file can `sed -i` an entry out without breaking the log; only
 * external git history (already pushed to the remote) catches that.
 * V1.1 closes this gap with `prevEntryHash: sha256(prevEntry)` chaining.
 * Until then, treat the log as "honest under cooperative operators",
 * not as a tamper-resistant store.
 */

/**
 * Lazy Node-module loaders — see wal-helper.ts header for why static
 * `node:fs/promises`, `node:child_process`, and `node:path` are forbidden
 * at the top level (they would tag the @dethernety/dt-core barrel
 * browser-incompatible and break the studio bundle).
 */
type FsModule = typeof import('node:fs/promises');
let _fs: FsModule | undefined;
async function loadFs(): Promise<FsModule> {
  if (!_fs) _fs = await import('node:fs/promises');
  return _fs;
}
type ChildProcessModule = typeof import('node:child_process');
let _cp: ChildProcessModule | undefined;
async function loadChildProcess(): Promise<ChildProcessModule> {
  if (!_cp) _cp = await import('node:child_process');
  return _cp;
}

/** POSIX-style path helpers — see wal-helper.ts for why we don't use `node:path`,
 *  and for the CodeQL js/polynomial-redos rationale behind the regex-free form. */
function join(...parts: string[]): string {
  return parts
    .map((p, i) => {
      let start = 0;
      let end = p.length;
      while (end > start && p.charCodeAt(end - 1) === 47 /* '/' */) end--;
      if (i !== 0) {
        while (start < end && p.charCodeAt(start) === 47 /* '/' */) start++;
      }
      return p.slice(start, end);
    })
    .filter(p => p.length > 0)
    .join('/');
}
function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  if (idx < 0) return '.';
  if (idx === 0) return '/';
  return p.slice(0, idx);
}

const AUDIT_LOG_RELATIVE_PATH = '.dethereal/control-audit.log';

/**
 * One conflict-resolution decision recorded per per-key conflict during
 * Step D of the brownfield push (CONTROL_LIBRARY.md §7).
 */
export interface ConflictResolution {
  key: string;
  ours: unknown;
  theirs: unknown;
  chosen: 'ours' | 'theirs' | 'merge';
  /** Present only when `chosen === 'merge'`. */
  merged?: unknown;
}

/**
 * One audit-log entry. Field semantics match CONTROL_LIBRARY.md §6
 * "Audit log" schema verbatim — the published auditor contract.
 *
 * @remarks
 * **Back-compat guarantee.** Two fields are intentionally optional to
 * preserve readability of older entries that the writer has appended in
 * past releases:
 *
 * - `editedBy?` — CL §4 attribution discriminator. Earlier entries lack
 *   it; readers MUST tolerate absence (treat as "attribution unknown —
 *   could be agent or operator").
 * - `authnOperator?` — JWT anchor. Older entries lack it; see the
 *   field-level JSDoc for the three states an auditor must distinguish
 *   (absent / present-as-claim / present-as-`'unauthenticated'`).
 *
 * Future cleanups MUST NOT promote either field to required without a
 * documented migration step. The audit log is append-only and is committed
 * to the repository (DEC-CL-12); historic entries persist forever.
 */
export interface AuditLogEntry {
  timestamp: string;
  /**
   * Locally-claimed operator identity (from `git config user.email`).
   * Spoofable; see {@link authnOperator} for the platform-anchored truth.
   */
  operator: string;
  /**
   * JWT-anchored operator identity (the `email` / `sub` claim from the
   * OIDC token that authorised the platform mutation that drove this
   * entry). Three states:
   *
   * - **absent** (`undefined`) → older entry pre-dates the field.
   *   Back-compat. An auditor cannot infer attribution from the absence.
   * - **present** as an email or sub claim → JWT decode succeeded.
   * - **present** as the sentinel `'unauthenticated'` → MCP entry had no
   *   token or an unparseable token. Distinct from back-compat absence
   *   so the audit reader can tell them apart.
   *
   * A mismatch with {@link operator} is a forensic signal — the operator
   * may have set a different `git config user.email` than the corp SSO
   * identity (legitimate, but worth flagging for investigation).
   */
  authnOperator?: string;
  kind: 'force-shared' | 'force-unverified' | 'reverted' | 'first-write';
  controlId: string;
  controlName: string;
  classId: string;
  className: string;
  modelId: string;
  /** `null` only on `force-unverified` (the unknown-blast-radius marker). */
  liveAssignedModelIds: string[] | null;
  /**
   * Equal to `keys(pendingEdit.previousAttributes) ∪ pendingEdit.firstWriteKeys`
   * at push time — the union of "keys with a prior value" and "keys that had
   * no prior value but were intended to be set."
   */
  intendedKeys: string[];
  /** `intendedKeys` projected through `attributes` after Step D resolution. */
  attributesPushed: Record<string, unknown>;
  /** Pre-edit snapshot from `pendingEdit.previousAttributes`. */
  previousAttributes: Record<string, unknown>;
  /**
   * Subset of `intendedKeys` that had no prior value at the time of the
   * first `setLocalEdited` call (no entry in `previousAttributes` because
   * none existed locally). Surfaced on `first-write` entries (where every
   * key in the push is first-write) AND on `force-shared` / `force-unverified`
   * entries that happen to include first-write keys — keeps the first-write
   * information in the audit trail regardless of which `kind` won.
   *
   * Optional / absent on older entries and on entries where every
   * pushed key had a prior value (the common `force-shared` /
   * `force-unverified` case).
   */
  firstWriteKeys?: string[];
  /** Derived field for cheap auditor readability. See {@link computeEffective}. */
  effective: 'ours' | 'theirs' | 'novel' | null;
  /**
   * Author of the originating `pendingEdit` block (CL §4 — `agent` |
   * `operator` | `external`). Critical for distinguishing a genuine
   * `force-shared` (operator deliberately overwriting another team's
   * keys) from a reconciliation push following a Step A
   * `promote-external-edit` recovery (`editedBy: 'external'`). Without
   * this discriminator the audit reader cannot tell a malicious
   * laundering of someone else's edit from a legitimate reconciliation.
   * Optional only because older entries pre-dating this field exist
   * in the wild.
   */
  editedBy?: 'agent' | 'operator' | 'external';
  /** Populated only when Step D Case 3 detected per-key conflicts. */
  conflictResolutions?: ConflictResolution[];
  /** Step D Case 1 — `absent-and-unknown` keys that aborted push. */
  blockedKeys?: string[];
  /** Step D Case 2 → operator chose `keep`. */
  readdedKeys?: string[];
  /** Step D Case 2 → operator chose `drop`. */
  droppedKeys?: string[];
  /** Populated only on `force-unverified`. */
  queryFailureReason?: string;
  /** Populated only on `force-unverified`. */
  queryAttempts?: number;
}

/**
 * Append a single audit entry to the per-model audit log.
 *
 * Durability: `fs.open` with `'a'` flag → write the JSON-line → `fdatasync`
 * → close. The fdatasync ensures the line is on disk before the calling
 * operation continues (durability requirement); without it, a crash between our
 * `write` and the eventual flush could lose the entry while the platform
 * mutation it documents already succeeded.
 *
 * Throws on I/O error (caller should not silently swallow — losing audit
 * entries is a governance failure).
 */
export async function appendAuditEntry(
  modelDir: string,
  entry: AuditLogEntry,
): Promise<void> {
  const fs = await loadFs();
  const logPath = join(modelDir, AUDIT_LOG_RELATIVE_PATH);
  await fs.mkdir(dirname(logPath), { recursive: true });

  const line = JSON.stringify(entry) + '\n';

  const fileFd = await fs.open(logPath, 'a');
  try {
    await fileFd.write(line, null, 'utf-8');
    await fileFd.datasync();
  } finally {
    await fileFd.close();
  }
}

/**
 * Compute the `effective` derived field per CL §6 field semantics.
 *
 * - `'theirs'` if every conflicting key resolved to `accept-theirs`
 *   AND no non-conflicting keys were pushed (the push is purely a
 *   capitulation to the server state).
 * - `'ours'` if every conflicting key resolved to `keep` AND no merge
 *   produced a value matching the server state.
 * - `'novel'` if any merge produced a value not equal to either
 *   `ours` or `theirs`, OR for `first-write` entries where every key
 *   is genuinely new on both sides (no `ours` / `theirs` distinction
 *   applies).
 * - `null` for `force-unverified` (no conflict detection ran) and for
 *   `reverted` (no push happened).
 */
export function computeEffective(
  kind: AuditLogEntry['kind'],
  conflictResolutions: ConflictResolution[] | undefined,
): 'ours' | 'theirs' | 'novel' | null {
  if (kind === 'force-unverified' || kind === 'reverted') return null;
  if (kind === 'first-write') return 'novel';
  if (!conflictResolutions || conflictResolutions.length === 0) {
    // No conflicts detected — the push was straightforward "ours".
    return 'ours';
  }

  let allTheirs = true;
  let anyNovel = false;

  for (const r of conflictResolutions) {
    if (r.chosen === 'merge') {
      // The operator chose `merge` AND the merge function ran. We classify by
      // the *value the merge function produced* (`r.merged`), not by the
      // chosen verb. Three sub-cases:
      //   - merged value differs from both ours and theirs → genuinely novel.
      //   - merged value equals theirs → effectively a capitulation; keep
      //     `allTheirs` alive.
      //   - merged value equals ours → effectively a keep-ours; break
      //     `allTheirs` (final classification falls through to `'ours'`).
      // Clarification: "merge equals ours" here is NOT the same as
      // "merge was rejected because ours == theirs". The merge
      // function genuinely ran; its output simply matched the ours-value.
      if (
        !shallowEqual(r.merged, r.ours) &&
        !shallowEqual(r.merged, r.theirs)
      ) {
        anyNovel = true;
        allTheirs = false;
      } else if (shallowEqual(r.merged, r.theirs)) {
        // merge produced a value equal to theirs — counts as theirs.
      } else {
        // merge produced a value equal to ours — counts as ours.
        allTheirs = false;
      }
    } else if (r.chosen === 'ours') {
      allTheirs = false;
    }
    // r.chosen === 'theirs' keeps allTheirs candidate alive
  }

  if (anyNovel) return 'novel';
  if (allTheirs) return 'theirs';
  return 'ours';
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Stringify with a key-sorting replacer so two objects with identical
  // content but different key orders compare equal. Without this,
  // `{a:1,b:2}` and `{b:2,a:1}` produce different `effective` values and
  // the audit log becomes non-deterministic across operators or platforms.
  try {
    return canonicalStringify(a) === canonicalStringify(b);
  } catch {
    return false;
  }
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Resolve the operator email for audit attribution.
 *
 * Tries `git config user.email` first (the authoritative attribution per
 * CL §6 / DEC-CL-12). Falls back to `${USER}@unknown` so the writer never
 * throws on a non-git environment (CI, restricted shells). The fallback
 * marker `@unknown` makes un-attributable entries trivially greppable.
 */
export async function getOperatorEmail(): Promise<string> {
  try {
    const { execSync } = await loadChildProcess();
    const email = execSync('git config user.email', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (email) return email;
  } catch {
    // git not installed, no config, etc — fall through.
  }
  const user = process.env.USER ?? process.env.USERNAME ?? 'unknown';
  return `${user}@unknown`;
}

/**
 * Resolve the absolute path to a model directory's audit log.
 * Exposed for tests and operator tooling.
 */
export function getAuditLogPath(modelDir: string): string {
  return join(modelDir, AUDIT_LOG_RELATIVE_PATH);
}

/**
 * Build a complete `AuditLogEntry` from the call-site context, deriving
 * `effective` automatically. Convenience wrapper so callers don't have to
 * remember to call `computeEffective`.
 */
export async function buildAuditEntry(
  partial: Omit<AuditLogEntry, 'timestamp' | 'operator' | 'effective'> & {
    timestamp?: string;
    operator?: string;
  },
): Promise<AuditLogEntry> {
  return {
    timestamp: partial.timestamp ?? new Date().toISOString(),
    operator: partial.operator ?? (await getOperatorEmail()),
    authnOperator: partial.authnOperator,
    kind: partial.kind,
    controlId: partial.controlId,
    controlName: partial.controlName,
    classId: partial.classId,
    className: partial.className,
    modelId: partial.modelId,
    liveAssignedModelIds: partial.liveAssignedModelIds,
    intendedKeys: partial.intendedKeys,
    attributesPushed: partial.attributesPushed,
    previousAttributes: partial.previousAttributes,
    firstWriteKeys: partial.firstWriteKeys,
    effective: computeEffective(partial.kind, partial.conflictResolutions),
    editedBy: partial.editedBy,
    conflictResolutions: partial.conflictResolutions,
    blockedKeys: partial.blockedKeys,
    readdedKeys: partial.readdedKeys,
    droppedKeys: partial.droppedKeys,
    queryFailureReason: partial.queryFailureReason,
    queryAttempts: partial.queryAttempts,
  };
}
