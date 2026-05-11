/**
 * Write-Ahead Log helper for control-library id rewrites.
 *
 * Greenfield Step A's id rewrite (CONTROL_LIBRARY.md §7) and clone-and-swap
 * both touch multiple files atomically: the per-control file (rename or
 * write/delete pair) plus every `controls[]` reference in `structure.json` /
 * `dataflows.json`. POSIX gives no multi-file atomic transaction, so a naive
 * sequential implementation that crashes mid-rewrite leaves the server id
 * present on the platform but absent from the local files — and the next push
 * creates a duplicate Control on the platform.
 *
 * The mechanism is a write-ahead log:
 *   1. Write a journal describing the planned rewrite (atomic via
 *      fsync+rename) BEFORE any local mutation.
 *   2. Apply per-file content rewrites (each atomic via tmp+fsync+rename).
 *   3. Apply file-level changes (rename / write / unlink).
 *   4. Delete the journal.
 *
 * Recovery: on every skill entry, replay any journal that exists. Each
 * operation's recovery rules are content-based and idempotent, so multiple
 * concurrent replays converge to the same final state.
 *
 * **POSIX fsync sequence:** write tmp → fsync(file) → rename →
 * fsync(parent_dir). Without the directory fsync, a crash between rename
 * and dir-fsync can leave the file on disk but the rename invisible.
 *
 * **macOS caveat:** Node's `fsync` does NOT call `F_FULLFSYNC` — data may
 * sit in the device cache rather than hitting the platter. Acceptable for
 * the dev workflow this code targets (local dev, Docker Memgraph). For
 * production durability, the platform-side audit trail is the source of
 * truth; the WAL replay always reconverges from observed corruption.
 *
 * **Overlay/network FS caveat:** Some Docker overlay filesystems on macOS
 * and most network filesystems do not honor directory `fsync`. Replay
 * detects ambiguous post-crash state (e.g. both tempId and serverId files
 * present with conflicting content) and aborts with explicit error rather
 * than silently corrupting.
 */

/**
 * Node's `fs/promises` is lazy-loaded so this module can be safely
 * re-exported through the `@dethernety/dt-core` barrel without dragging
 * Node-only APIs into browser bundles. The studio frontend transitively
 * imports the barrel; any static `node:*` import would tag the whole
 * graph as browser-incompatible (`__vite-browser-external`). Mirrors
 * the dt-export.ts:167 pattern. Cached after first call; subsequent
 * awaits resolve immediately.
 */
type FsModule = typeof import('node:fs/promises');
let _fs: FsModule | undefined;
async function loadFs(): Promise<FsModule> {
  if (!_fs) _fs = await import('node:fs/promises');
  return _fs;
}

/**
 * Pure-string POSIX path helpers — same reason as the lazy fs loader:
 * static `node:path` would mark the barrel browser-incompatible. All
 * model-directory paths are constructed POSIX-style (forward slashes);
 * Node accepts forward slashes on every supported platform.
 */
function join(...parts: string[]): string {
  // CodeQL flagged the previous regex form (`p.replace(/\/+$/, '')` and
  // `p.replace(/^\/+|\/+$/g, '')`) as js/polynomial-redos. The patterns
  // are anchored single quantifiers — V8 runs them in O(n) so they are
  // not actually exploitable — but rewriting as character-by-character
  // trims silences the static analyser without changing behaviour.
  return parts
    .map((p, i) => {
      let start = 0;
      let end = p.length;
      // Strip trailing `/` always; strip leading `/` only on continuation parts.
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

/**
 * Reject WAL-journal-supplied paths that could escape the model directory.
 *
 * The journal lives on disk and is consumed without authentication — any
 * actor able to plant a hostile `.dethereal/pending-id-rewrite.json` (a
 * cloned repo containing a malicious journal, a shared model dir on a
 * multi-tenant fileshare, a prompt-injection attack on the agent that
 * caused it to invoke `manage_controls` with a path the operator did not
 * intend) gets arbitrary file rewrite/rename/unlink via the replay path.
 *
 * Rejection rules — applied to every relative path before it is joined
 * onto `modelDir` and passed to `fs.rename` / `fs.unlink` / `replaceIdInFile`:
 *   - empty string
 *   - null bytes (POSIX path separator boundary trick)
 *   - leading `/` (would escape via the join helper, which strips leading
 *     slashes only on continuation parts — but malicious input is rejected
 *     here regardless)
 *   - leading `\` or any backslash (Windows path separator; we are
 *     POSIX-only but the replay should still refuse mixed separators)
 *   - any `..` path component (parent traversal)
 *
 * Throws on any violation. Caller is `applyGreenfieldRewrite` /
 * `applyCloneAndSwap` — both bail out of the entire replay on throw,
 * leaving the journal intact for `/dethereal:sync repair-wal` review.
 */
function assertSafeRelPath(relPath: string, fieldName: string): void {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error(
      `WAL journal validation failed: ${fieldName} must be a non-empty string`,
    );
  }
  if (relPath.includes('\0')) {
    throw new Error(
      `WAL journal validation failed: ${fieldName} contains a null byte`,
    );
  }
  if (relPath.includes('\\')) {
    throw new Error(
      `WAL journal validation failed: ${fieldName} contains a backslash (POSIX paths only)`,
    );
  }
  if (relPath.startsWith('/')) {
    throw new Error(
      `WAL journal validation failed: ${fieldName} must be a relative path (got absolute: ${relPath})`,
    );
  }
  // Reject any `..` segment. Splitting on `/` catches `../foo`,
  // `foo/..`, `foo/../bar`, and `..` on its own.
  const segments = relPath.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new Error(
        `WAL journal validation failed: ${fieldName} contains a parent-traversal segment (..): ${relPath}`,
      );
    }
  }
}

const JOURNAL_RELATIVE_PATH = '.dethereal/pending-id-rewrite.json';

/**
 * One pending operation in the journal — either a greenfield id rewrite
 * (temp → server) or a clone-and-swap (old control → new clone).
 */
export type PendingOperation = GreenfieldIdRewriteOp | CloneAndSwapOp;

export interface GreenfieldIdRewriteOp {
  kind: 'greenfield-id-rewrite';
  /** Temporary local id (e.g. `greenfield-abc`). */
  tempId: string;
  /** Platform-assigned server id (UUID). */
  serverId: string;
  /**
   * Paths whose contents must be rewritten (every `controls[]` reference
   * holding `tempId` is replaced by `serverId`). Paths are relative to the
   * model directory.
   */
  filePaths: string[];
  /**
   * Per-control file rename. Both paths are relative to the model directory.
   * `from` typically `controls/<tempId>.json`; `to` typically
   * `controls/<serverId>.json`.
   */
  controlFileRename: { from: string; to: string };
  /** ISO-8601 timestamp the journal entry was written. */
  createdAt: string;
}

export interface CloneAndSwapOp {
  kind: 'clone-and-swap';
  /** Original Control id (the one being forked away from this model). */
  oldId: string;
  /** Newly-cloned Control id (the one this model now references). */
  newId: string;
  /** Paths whose `controls[]` references must be retargeted from oldId to newId. */
  filePaths: string[];
  /**
   * Path (relative to model directory) where the new control file's content
   * lives. Written via tmp+fsync+rename. Typically `controls/<newId>.json`.
   */
  controlFileWrite: string;
  /**
   * Initial content for `controlFileWrite` (serialised JSON). Carried in
   * the journal so replay after crash can recreate the file from scratch.
   */
  controlFileContent: string;
  /**
   * Path (relative to model directory) of the old control file to unlink
   * after the new one is in place. Typically `controls/<oldId>.json`.
   */
  controlFileDelete: string;
  /** ISO-8601 timestamp the journal entry was written. */
  createdAt: string;
}

export interface PendingIdRewriteJournal {
  operations: PendingOperation[];
}

/**
 * Atomic write with full POSIX fsync sequence.
 *
 * Steps: write to `<targetPath>.tmp.<pid>.<rand>` → fsync(file) → rename →
 * fsync(parent_dir). The parent-directory fsync is what guarantees the
 * rename survives a crash; without it, a crash between rename and the
 * subsequent flush can leave the rename invisible after reboot even though
 * the file content is on disk.
 *
 * Throws on any I/O error; cleans up the tmp file on failure.
 */
export async function atomicWriteWithFsync(targetPath: string, content: string): Promise<void> {
  const fs = await loadFs();
  const parentDir = dirname(targetPath);
  await fs.mkdir(parentDir, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;

  try {
    // 1. Write content to tmp
    await fs.writeFile(tmpPath, content);

    // 2. fsync the file's content
    const fileFd = await fs.open(tmpPath, 'r+');
    try {
      await fileFd.sync();
    } finally {
      await fileFd.close();
    }

    // 3. Atomic rename
    await fs.rename(tmpPath, targetPath);

    // 4. fsync the parent directory so the rename hits disk
    const dirFd = await fs.open(parentDir, 'r');
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

/**
 * Read the pending-rewrite journal for a model directory.
 * Returns `null` if no journal exists.
 */
export async function readJournal(modelDir: string): Promise<PendingIdRewriteJournal | null> {
  const fs = await loadFs();
  const journalPath = join(modelDir, JOURNAL_RELATIVE_PATH);
  try {
    const raw = await fs.readFile(journalPath, 'utf-8');
    const parsed = JSON.parse(raw) as PendingIdRewriteJournal;
    if (!parsed || !Array.isArray(parsed.operations)) {
      throw new Error(`Malformed journal at ${journalPath}: missing operations[]`);
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Append a new operation to the journal (creating it if absent).
 * Atomic via tmp+fsync+rename — a crash mid-append leaves either the old
 * journal intact or the new one fully written.
 */
export async function appendOperation(modelDir: string, op: PendingOperation): Promise<void> {
  const existing = (await readJournal(modelDir)) ?? { operations: [] };
  existing.operations.push(op);
  const journalPath = join(modelDir, JOURNAL_RELATIVE_PATH);
  await atomicWriteWithFsync(journalPath, JSON.stringify(existing, null, 2));
}

/**
 * Replay every operation in the journal in declared order. Idempotent:
 * each step's recovery rules use content-based checks ("if file contains
 * tempId → rewrite; if file contains serverId → skip"), so replay after
 * any crash point converges to the same final state.
 *
 * After all operations apply cleanly, the journal is unlinked.
 *
 * Returns the number of operations replayed (0 if no journal).
 */
export async function applyPendingRewrites(modelDir: string): Promise<number> {
  const journal = await readJournal(modelDir);
  if (!journal || journal.operations.length === 0) {
    // No-op fast path — under 5ms when journal absent (the common case).
    return 0;
  }

  for (const op of journal.operations) {
    if (op.kind === 'greenfield-id-rewrite') {
      await applyGreenfieldRewrite(modelDir, op);
    } else if (op.kind === 'clone-and-swap') {
      await applyCloneAndSwap(modelDir, op);
    } else {
      // TypeScript exhaustiveness check; defensive runtime guard.
      throw new Error(`Unknown WAL operation kind: ${(op as { kind: string }).kind}`);
    }
  }

  // All operations applied cleanly — atomic unlink + dir fsync.
  const fs = await loadFs();
  const journalPath = join(modelDir, JOURNAL_RELATIVE_PATH);
  await fs.unlink(journalPath);
  // Best-effort dir fsync so the unlink survives crash. Same caveat as
  // atomicWriteWithFsync — overlay/network FS may not honor it.
  try {
    const dirFd = await fs.open(dirname(journalPath), 'r');
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch {
    // ENOENT on the directory is impossible (we just had a file in it);
    // any other failure is non-fatal — replay is idempotent.
  }
  return journal.operations.length;
}

async function applyGreenfieldRewrite(
  modelDir: string,
  op: GreenfieldIdRewriteOp,
): Promise<void> {
  // Security: validate every journal-supplied path before joining onto
  // modelDir. A hostile journal otherwise gets arbitrary file rewrite via
  // replaceIdInFile or arbitrary rename via fs.rename. See assertSafeRelPath
  // header for rejection rules.
  for (let i = 0; i < op.filePaths.length; i++) {
    assertSafeRelPath(op.filePaths[i], `op.filePaths[${i}]`);
  }
  assertSafeRelPath(op.controlFileRename.from, 'op.controlFileRename.from');
  assertSafeRelPath(op.controlFileRename.to, 'op.controlFileRename.to');

  // Step 1 — content rewrite per filePath. Idempotent: if the file already
  // has serverId (rewrite previously completed), skip.
  for (const relPath of op.filePaths) {
    await replaceIdInFile(join(modelDir, relPath), op.tempId, op.serverId);
  }

  // Step 2 — control-file rename (atomic on POSIX). Idempotent: if the
  // destination exists and the source does not, the rename was already done.
  const fs = await loadFs();
  const fromPath = join(modelDir, op.controlFileRename.from);
  const toPath = join(modelDir, op.controlFileRename.to);
  const fromExists = await pathExists(fromPath);
  const toExists = await pathExists(toPath);
  if (fromExists && toExists) {
    // Both present — this is the ambiguous-state case the macOS overlay-FS
    // caveat warns about. Bail to manual reconciliation rather than guess.
    throw new Error(
      `WAL replay detected ambiguous state: both '${op.controlFileRename.from}' ` +
        `and '${op.controlFileRename.to}' present in '${modelDir}' ` +
        `(tempId=${op.tempId}, serverId=${op.serverId}). ` +
        `Manual reconciliation required — see /dethereal:sync repair-wal.`,
    );
  }
  if (fromExists && !toExists) {
    await fs.rename(fromPath, toPath);
    // Best-effort dir fsync.
    try {
      const dirFd = await fs.open(dirname(toPath), 'r');
      try {
        await dirFd.sync();
      } finally {
        await dirFd.close();
      }
    } catch {
      // Non-fatal — replay is idempotent.
    }
  }
  // else: !fromExists && (toExists || !toExists) → already done or nothing
  // to do; either way skip silently. Without the from-file there is no
  // safe way to "undo" a partial rename, so trust the content-rewrite
  // step's idempotency.
}

async function applyCloneAndSwap(modelDir: string, op: CloneAndSwapOp): Promise<void> {
  // Security: validate every journal-supplied path before joining onto
  // modelDir. Without this, a hostile journal's controlFileWrite +
  // controlFileContent gives arbitrary file write (e.g. ssh authorized_keys).
  // See assertSafeRelPath header for rejection rules.
  for (let i = 0; i < op.filePaths.length; i++) {
    assertSafeRelPath(op.filePaths[i], `op.filePaths[${i}]`);
  }
  assertSafeRelPath(op.controlFileWrite, 'op.controlFileWrite');
  assertSafeRelPath(op.controlFileDelete, 'op.controlFileDelete');

  // Step 1 — content rewrite per filePath (oldId → newId).
  for (const relPath of op.filePaths) {
    await replaceIdInFile(join(modelDir, relPath), op.oldId, op.newId);
  }

  // Step 2 — write the new control file if absent (idempotent).
  const writePath = join(modelDir, op.controlFileWrite);
  if (!(await pathExists(writePath))) {
    await atomicWriteWithFsync(writePath, op.controlFileContent);
  }

  // Step 3 — unlink the old control file if present (idempotent).
  const deletePath = join(modelDir, op.controlFileDelete);
  if (await pathExists(deletePath)) {
    const fs = await loadFs();
    await fs.unlink(deletePath);
  }
}

/**
 * Content-based search/replace for an id within a JSON-or-text file.
 * Uses string replacement — works regardless of JSON structure (the id may
 * appear as `"id":"..."` or `"controls":[{"id":"...",...}]`).
 *
 * If the file does not exist, returns silently (the rewrite is a no-op
 * for files that never had the temp id, e.g. `dataflows.json` in a model
 * that only references controls from `structure.json`).
 *
 * Idempotent: if `oldId` is not present in the file content, no write
 * occurs (preserving fsync cost on already-replayed files).
 */
export async function replaceIdInFile(
  filePath: string,
  oldId: string,
  newId: string,
): Promise<void> {
  const fs = await loadFs();
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (!content.includes(oldId)) return; // already done or never present
  // Use split/join for whole-string replacement (replaceAll requires Node 15+,
  // available everywhere we run, but this style is also slightly safer
  // against accidental regex special-character interpretation).
  const replaced = content.split(oldId).join(newId);
  await atomicWriteWithFsync(filePath, replaced);
}

async function pathExists(path: string): Promise<boolean> {
  const fs = await loadFs();
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the absolute path to a model directory's pending-rewrite journal.
 * Exposed for tests; production callers should use the higher-level helpers.
 */
export function getJournalPath(modelDir: string): string {
  return join(modelDir, JOURNAL_RELATIVE_PATH);
}

/**
 * Read-only inspector for the WAL state.
 *
 * `applyPendingRewrites` aborts on the ambiguous-state case (both `from` and
 * `to` files of a greenfield rewrite present with potentially conflicting
 * content) and gives the operator no recovery path. The `repair-wal` skill
 * verb consumes this inspector to surface the journal contents, the on-disk
 * file state for each operation, and the resolution options.
 *
 * Pure read — never mutates the filesystem.
 */
export interface WalGreenfieldInspection {
  kind: 'greenfield-id-rewrite';
  tempId: string;
  serverId: string;
  controlFileRename: { from: string; to: string };
  fromExists: boolean;
  toExists: boolean;
  filePaths: Array<{
    path: string;
    exists: boolean;
    containsTempId: boolean;
    containsServerId: boolean;
  }>;
  ambiguous: boolean;
  createdAt: string;
}

export interface WalCloneAndSwapInspection {
  kind: 'clone-and-swap';
  oldId: string;
  newId: string;
  controlFileWrite: string;
  controlFileDelete: string;
  writeExists: boolean;
  deleteExists: boolean;
  filePaths: Array<{
    path: string;
    exists: boolean;
    containsOldId: boolean;
    containsNewId: boolean;
  }>;
  createdAt: string;
}

export type WalOperationInspection = WalGreenfieldInspection | WalCloneAndSwapInspection;

export interface WalInspection {
  present: boolean;
  journalPath: string;
  operations: WalOperationInspection[];
}

export async function inspectPendingRewrite(modelDir: string): Promise<WalInspection> {
  const journalPath = getJournalPath(modelDir);
  const journal = await readJournal(modelDir);
  if (!journal) {
    return { present: false, journalPath, operations: [] };
  }

  const fs = await loadFs();
  const operations: WalOperationInspection[] = [];

  for (const op of journal.operations) {
    if (op.kind === 'greenfield-id-rewrite') {
      const fromExists = await pathExists(join(modelDir, op.controlFileRename.from));
      const toExists = await pathExists(join(modelDir, op.controlFileRename.to));
      const filePaths = await Promise.all(
        op.filePaths.map(async (relPath): Promise<WalGreenfieldInspection['filePaths'][number]> => {
          const abs = join(modelDir, relPath);
          if (!(await pathExists(abs))) {
            return { path: relPath, exists: false, containsTempId: false, containsServerId: false };
          }
          const content = await fs.readFile(abs, 'utf-8');
          return {
            path: relPath,
            exists: true,
            containsTempId: content.includes(op.tempId),
            containsServerId: content.includes(op.serverId),
          };
        }),
      );
      operations.push({
        kind: 'greenfield-id-rewrite',
        tempId: op.tempId,
        serverId: op.serverId,
        controlFileRename: op.controlFileRename,
        fromExists,
        toExists,
        filePaths,
        ambiguous: fromExists && toExists,
        createdAt: op.createdAt,
      });
    } else {
      const writeExists = await pathExists(join(modelDir, op.controlFileWrite));
      const deleteExists = await pathExists(join(modelDir, op.controlFileDelete));
      const filePaths = await Promise.all(
        op.filePaths.map(async (relPath): Promise<WalCloneAndSwapInspection['filePaths'][number]> => {
          const abs = join(modelDir, relPath);
          if (!(await pathExists(abs))) {
            return { path: relPath, exists: false, containsOldId: false, containsNewId: false };
          }
          const content = await fs.readFile(abs, 'utf-8');
          return {
            path: relPath,
            exists: true,
            containsOldId: content.includes(op.oldId),
            containsNewId: content.includes(op.newId),
          };
        }),
      );
      operations.push({
        kind: 'clone-and-swap',
        oldId: op.oldId,
        newId: op.newId,
        controlFileWrite: op.controlFileWrite,
        controlFileDelete: op.controlFileDelete,
        writeExists,
        deleteExists,
        filePaths,
        createdAt: op.createdAt,
      });
    }
  }

  return { present: true, journalPath, operations };
}

/**
 * Hard-delete the journal without applying its operations.
 *
 * Used by the `repair-wal` recovery verb when the operator decides the
 * journal is stale (e.g. the platform-side rewrite was undone, or the
 * operator is willing to manually re-create the local files). The skill is
 * responsible for confirming with the operator before invoking — there is
 * no engine-level confirmation gate.
 */
export async function clearPendingRewrite(modelDir: string): Promise<boolean> {
  const fs = await loadFs();
  const journalPath = getJournalPath(modelDir);
  try {
    await fs.unlink(journalPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  // Best-effort dir fsync.
  try {
    const dirFd = await fs.open(dirname(journalPath), 'r');
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch {
    // Non-fatal.
  }
  return true;
}
