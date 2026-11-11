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

// =============================================================================
// Links and special files
// =============================================================================

/**
 * Everything below a model directory comes from the repository, and a
 * repository can commit links. Every read, write, rename and unlink here goes
 * through the helpers below: each directory component under the model
 * directory must be a real directory, each file a regular single-link file,
 * and files are opened no-follow and non-blocking (a link to a FIFO or
 * `/dev/stdin` would otherwise hang the server). Errors name a path relative to
 * the model directory and a code, never an absolute path.
 *
 * Residual: Node has no `openat`/`renameat`, so a directory swapped for a link
 * between the last check and the `rename` syscall is not caught, and the tmp
 * file is written inside a swapped directory before the re-check before the
 * rename notices it. Closing that needs a directory-fd API.
 */
export class UnsafePathError extends Error {
  constructor(
    readonly code: 'symlink' | 'not_directory' | 'not_regular' | 'hardlinked' | 'too_large' | 'changed' | 'outside',
    readonly rel: string,
  ) {
    super(`${rel}: ${code.replace('_', ' ')}`);
    this.name = 'UnsafePathError';
  }
}

type FsConstants = typeof import('node:fs').constants;
let _constants: FsConstants | undefined;
async function loadConstants(): Promise<FsConstants> {
  if (!_constants) _constants = (await import('node:fs')).constants;
  return _constants;
}

async function lstatOrNull(p: string): Promise<import('node:fs').Stats | null> {
  const fs = await loadFs();
  try {
    return await fs.lstat(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** `abs` relative to `root`; throws when it is not strictly below it. */
function relUnder(root: string, abs: string): string {
  const base = root.endsWith('/') ? root : `${root}/`;
  if (!abs.startsWith(base) || abs.length === base.length) throw new UnsafePathError('outside', '.');
  return abs.slice(base.length);
}

/**
 * Check the directories of `relDir` under `root`, component by component: each
 * existing one must be a real directory. Returns false when one is absent.
 */
export async function checkRealDirs(root: string, relDir: string): Promise<boolean> {
  const top = await lstatOrNull(root);
  if (!top) return false;
  if (top.isSymbolicLink()) throw new UnsafePathError('symlink', '.');
  if (!top.isDirectory()) throw new UnsafePathError('not_directory', '.');
  let cur = root;
  let rel = '';
  for (const part of relDir.split('/').filter(p => p.length > 0 && p !== '.')) {
    cur = join(cur, part);
    rel = rel ? `${rel}/${part}` : part;
    const st = await lstatOrNull(cur);
    if (!st) return false;
    if (st.isSymbolicLink()) throw new UnsafePathError('symlink', rel);
    if (!st.isDirectory()) throw new UnsafePathError('not_directory', rel);
  }
  return true;
}

/** Create the directories of `relDir` under `root` one level at a time, never through a link. */
export async function ensureRealDirs(root: string, relDir: string): Promise<void> {
  const fs = await loadFs();
  if (!(await checkRealDirs(root, '.'))) throw new UnsafePathError('not_directory', '.');
  let cur = root;
  let rel = '';
  for (const part of relDir.split('/').filter(p => p.length > 0 && p !== '.')) {
    cur = join(cur, part);
    rel = rel ? `${rel}/${part}` : part;
    try {
      await fs.mkdir(cur);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const st = await lstatOrNull(cur);
    if (!st || st.isSymbolicLink()) throw new UnsafePathError('symlink', rel);
    if (!st.isDirectory()) throw new UnsafePathError('not_directory', rel);
  }
}

/** A file at `abs` must be absent or a regular single-link file; returns its stats, or null when absent. */
async function regularOrAbsent(abs: string, rel: string): Promise<import('node:fs').Stats | null> {
  const st = await lstatOrNull(abs);
  if (!st) return null;
  if (st.isSymbolicLink()) throw new UnsafePathError('symlink', rel);
  if (!st.isFile()) throw new UnsafePathError('not_regular', rel);
  if (st.nlink !== 1) throw new UnsafePathError('hardlinked', rel);
  return st;
}

/**
 * Read a regular file without following a link at its own path and without
 * blocking on a special file; the same file from inspection to read, at most
 * `maxBytes`. `rel` names it in errors. Null when absent.
 */
export async function readLeafNoFollow(abs: string, rel: string, maxBytes: number): Promise<string | null> {
  const fs = await loadFs();
  const c = await loadConstants();
  const before = await regularOrAbsent(abs, rel);
  if (!before) return null;
  if (before.size > maxBytes) throw new UnsafePathError('too_large', rel);
  let fh;
  try {
    fh = await fs.open(abs, c.O_RDONLY | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new UnsafePathError('symlink', rel);
    throw err;
  }
  try {
    const st = await fh.stat();
    if (st.dev !== before.dev || st.ino !== before.ino || st.nlink === 0) throw new UnsafePathError('changed', rel);
    if (!st.isFile()) throw new UnsafePathError('not_regular', rel);
    if (st.nlink !== 1) throw new UnsafePathError('hardlinked', rel);
    if (st.size > maxBytes) throw new UnsafePathError('too_large', rel);
    const text = await fh.readFile('utf-8');
    if (Buffer.byteLength(text) > maxBytes) throw new UnsafePathError('too_large', rel);
    return text;
  } finally {
    await fh.close();
  }
}

/** Read `rel` under the model directory `root`, checking every directory on the way. Null when absent. */
export async function readRegularNoFollow(root: string, rel: string, maxBytes: number): Promise<string | null> {
  if (!(await checkRealDirs(root, dirname(rel)))) return null;
  return readLeafNoFollow(join(root, rel), rel, maxBytes);
}

/** fsync a directory, opened without following a link and without blocking. Best effort. */
async function syncDir(dir: string): Promise<void> {
  const fs = await loadFs();
  const c = await loadConstants();
  try {
    const fh = await fs.open(dir, c.O_RDONLY | (c.O_DIRECTORY ?? 0) | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0));
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // Overlay and network filesystems may refuse; replay is idempotent.
  }
}

/** Remove `rel` under `root` if it is a regular file; absent → false. Never follows a link. */
async function unlinkRegular(root: string, rel: string): Promise<boolean> {
  const fs = await loadFs();
  if (!(await checkRealDirs(root, dirname(rel)))) return false;
  const abs = join(root, rel);
  if (!(await regularOrAbsent(abs, rel))) return false;
  await fs.unlink(abs);
  await syncDir(dirname(abs));
  return true;
}

/** Largest model file this module reads (structure, dataflows, a control file). */
const MAX_MODEL_FILE_BYTES = 32 * 1024 * 1024;
/** Largest journal replayed. */
const MAX_JOURNAL_BYTES = 1024 * 1024;
/** Most operations one journal may hold: the writer appends one, and every caller drains first. */
const MAX_JOURNAL_OPS = 4;

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
 * Steps: write a hidden tmp next to the target (`.<name>.<pid>.<rand>.tmp`,
 * created exclusively) → fsync(file) → rename → fsync(parent_dir). The
 * parent-directory fsync is what guarantees the rename survives a crash;
 * without it, a crash between rename and the subsequent flush can leave the
 * rename invisible after reboot even though the file content is on disk.
 *
 * With `root` (the model directory), every directory between `root` and the
 * target must be a real directory — missing ones are created one level at a
 * time — and they are checked again right before the rename. The target must be
 * absent or a regular single-link file: a link, FIFO or hard link at its path is
 * refused, never replaced or written through, and the target itself is never
 * opened. An existing file's mode is kept.
 *
 * Throws on any I/O error; cleans up the tmp file on failure.
 */
export async function atomicWriteWithFsync(targetPath: string, content: string, root?: string): Promise<void> {
  const fs = await loadFs();
  const parentDir = dirname(targetPath);
  const base = root ?? parentDir;
  const rel = root ? relUnder(root, targetPath) : targetPath.slice(parentDir.length + 1);
  const relDir = root ? dirname(rel) : '.';
  if (root) await ensureRealDirs(root, relDir);
  else await fs.mkdir(parentDir, { recursive: true });
  const existing = await regularOrAbsent(targetPath, rel);
  const name = targetPath.slice(parentDir.length + 1);
  const tmpPath = join(parentDir, `.${name}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);

  let created = false;
  try {
    // 1. Write content to a tmp only this call can have created.
    const fh = await fs.open(tmpPath, 'wx', 0o600);
    created = true;
    try {
      await fh.chmod(existing ? existing.mode & 0o777 : 0o644);
      await fh.writeFile(content, 'utf-8');
      // 2. fsync the file's content
      await fh.sync();
    } finally {
      await fh.close();
    }

    // 3. Nothing on the way was swapped for a link meanwhile; then the atomic rename.
    if (!(await checkRealDirs(base, relDir))) throw new UnsafePathError('changed', relDir);
    await regularOrAbsent(targetPath, rel);
    await fs.rename(tmpPath, targetPath);
    created = false;

    // 4. fsync the parent directory so the rename hits disk
    await syncDir(parentDir);
  } finally {
    if (created) await fs.unlink(tmpPath).catch(() => undefined);
  }
}

// =============================================================================
// The journal
// =============================================================================

/** Bumped when the journal format or what its MAC covers changes. */
const JOURNAL_VERSION = 1;

/**
 * Signs and verifies journals. A journal is a machine-local crash-recovery
 * artifact: replay trusts only a journal this process wrote, or one carrying a
 * MAC this machine's authenticator accepts. A journal from another machine or
 * checkout, an unsigned one, or one planted in a repository is never replayed;
 * it can only be inspected and cleared.
 */
export interface JournalAuthenticator {
  /** The MAC of `payload`, or null when this machine has no usable key for `modelDir` (its real path). */
  sign(payload: string, modelDir: string): Promise<string | null>;
  verify(payload: string, mac: string, modelDir: string): Promise<boolean>;
}

let authenticator: JournalAuthenticator | null = null;

/**
 * Install the authenticator journals are signed and verified with. Set once,
 * at startup, before any journal is written or replayed: a second call throws,
 * so nothing loaded later in the process can swap in one that accepts anything.
 */
export function setJournalAuthenticator(next: JournalAuthenticator): void {
  if (authenticator) throw new Error('WAL journal authenticator is already installed');
  authenticator = next;
}

/** Digests of journals this process wrote: trusted without a MAC, so replay works without a key. */
const writtenHere = new Set<string>();

async function digest(text: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}

/** A journal that will not be replayed. The message carries no string from the journal. */
export class JournalRejectedError extends Error {
  constructor(
    readonly code: 'malformed' | 'unverified' | 'unreadable',
    readonly rejected: Array<{ index: number; code: string }> = [],
  ) {
    super(
      `WAL journal rejected (${code}): it is not replayed. Inspect it and clear it ` +
        `with /dethereal:sync repair-wal, then reconcile the control files by hand.`,
    );
    this.name = 'JournalRejectedError';
  }
}

/** A greenfield Control's temporary local id, replaced by the platform id once the Control is created. */
export const GREENFIELD_TEMP_ID = /^greenfield-[A-Za-z0-9_-]{1,120}$/;
const CONTROL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Why `op` is not an operation this module's writer produces, or null when it is.
 * Only the exact greenfield shape passes: nothing writes a clone-and-swap op.
 */
function opProblem(op: unknown): string | null {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return 'not_object';
  const o = op as Record<string, unknown>;
  if (o.kind !== 'greenfield-id-rewrite') return 'unsupported_kind';
  const { tempId, serverId, filePaths, controlFileRename, createdAt } = o;
  if (typeof tempId !== 'string' || !GREENFIELD_TEMP_ID.test(tempId)) return 'bad_temp_id';
  if (typeof serverId !== 'string' || !CONTROL_ID.test(serverId) || serverId.startsWith('greenfield-')) return 'bad_server_id';
  // The rewrite covers data-items.json since data items carry controls; a journal written before that names the
  // two structural files only, and still replays.
  const shapes = [
    ['structure.json', 'dataflows.json', 'data-items.json', `controls/${tempId}.json`],
    ['structure.json', 'dataflows.json', `controls/${tempId}.json`],
  ];
  const sameAs = (expected: string[]) =>
    Array.isArray(filePaths) && filePaths.length === expected.length && filePaths.every((p, i) => p === expected[i]);
  if (!shapes.some(sameAs)) return 'bad_paths';
  const r = controlFileRename as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || r.from !== `controls/${tempId}.json` || r.to !== `controls/${serverId}.json`) {
    return 'bad_rename';
  }
  if (typeof createdAt !== 'string' || !ISO_8601.test(createdAt)) return 'bad_created_at';
  return null;
}

/** What the MAC covers: the journal version, the model's real path, and the exact operations. */
async function macPayload(modelDir: string, operations: unknown[]): Promise<{ payload: string; realDir: string }> {
  const fs = await loadFs();
  const realDir = await fs.realpath(modelDir);
  return { payload: JSON.stringify({ v: JOURNAL_VERSION, modelDir: realDir, operations }), realDir };
}

interface LoadedJournal {
  operations: GreenfieldIdRewriteOp[];
  payload: string;
}

/** Read the raw journal; null when absent. Throws JournalRejectedError when it cannot be read safely. */
async function readRawJournal(modelDir: string): Promise<{ operations: unknown[]; mac?: unknown } | null> {
  let text: string | null;
  try {
    text = await readRegularNoFollow(modelDir, JOURNAL_RELATIVE_PATH, MAX_JOURNAL_BYTES);
  } catch (err) {
    if (err instanceof UnsafePathError) throw new JournalRejectedError('unreadable');
    throw err;
  }
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new JournalRejectedError('malformed');
  }
  const j = parsed as { operations?: unknown; mac?: unknown } | null;
  if (!j || typeof j !== 'object' || !Array.isArray(j.operations)) throw new JournalRejectedError('malformed');
  return { operations: j.operations, mac: j.mac };
}

function problemsOf(operations: unknown[]): Array<{ index: number; code: string }> {
  if (operations.length > MAX_JOURNAL_OPS) return [{ index: -1, code: 'too_many_operations' }];
  const out: Array<{ index: number; code: string }> = [];
  operations.forEach((op, index) => {
    const code = opProblem(op);
    if (code) out.push({ index, code });
  });
  return out;
}

async function isTrusted({ payload, realDir }: { payload: string; realDir: string }, mac: unknown): Promise<boolean> {
  if (writtenHere.has(await digest(payload))) return true;
  if (typeof mac !== 'string' || !authenticator) return false;
  return authenticator.verify(payload, mac, realDir).catch(() => false);
}

/** The journal, validated and verified; null when absent. Throws JournalRejectedError otherwise. */
async function loadJournal(modelDir: string): Promise<LoadedJournal | null> {
  const raw = await readRawJournal(modelDir);
  if (!raw) return null;
  const problems = problemsOf(raw.operations);
  if (problems.length > 0) throw new JournalRejectedError('malformed', problems);
  const signed = await macPayload(modelDir, raw.operations);
  if (raw.operations.length > 0 && !(await isTrusted(signed, raw.mac))) throw new JournalRejectedError('unverified');
  return { operations: raw.operations as GreenfieldIdRewriteOp[], payload: signed.payload };
}

/**
 * Read the pending-rewrite journal for a model directory.
 * Returns `null` if no journal exists; throws JournalRejectedError for a journal
 * that is malformed, unverified or cannot be read safely.
 */
export async function readJournal(modelDir: string): Promise<PendingIdRewriteJournal | null> {
  const loaded = await loadJournal(modelDir);
  return loaded ? { operations: loaded.operations } : null;
}

/**
 * Append a new operation to the journal (creating it if absent), signed when
 * an authenticator is installed and has a key. Atomic via tmp+fsync+rename —
 * a crash mid-append leaves either the old journal intact or the new one fully
 * written.
 */
export async function appendOperation(modelDir: string, op: PendingOperation): Promise<void> {
  const problem = opProblem(op);
  if (problem) throw new Error(`WAL journal: refusing to write an operation of an unsupported shape (${problem})`);
  const existing = await loadJournal(modelDir);
  const operations: unknown[] = [...(existing?.operations ?? []), op];
  if (operations.length > MAX_JOURNAL_OPS) throw new Error('WAL journal: too many pending operations; replay it first');
  const { payload, realDir } = await macPayload(modelDir, operations);
  const mac = authenticator ? await authenticator.sign(payload, realDir).catch(() => null) : null;
  writtenHere.add(await digest(payload));
  const journal = { version: JOURNAL_VERSION, operations, ...(mac ? { mac } : {}) };
  await atomicWriteWithFsync(join(modelDir, JOURNAL_RELATIVE_PATH), JSON.stringify(journal, null, 2), modelDir);
}

/**
 * Replay every operation in the journal in declared order. Idempotent:
 * each step's recovery rules use content-based checks ("if file contains
 * tempId → rewrite; if file contains serverId → skip"), so replay after
 * any crash point converges to the same final state.
 *
 * Only a journal of the writer's exact shape that this process wrote, or that
 * carries a MAC this machine accepts, is replayed; anything else throws
 * JournalRejectedError before any file is touched.
 *
 * After all operations apply cleanly, the journal is unlinked.
 *
 * `afterOperation`, when given, is awaited after each operation's rewrite and
 * before the journal is unlinked, with the operation's ids only. A throw
 * propagates and keeps the journal, so the next replay runs every operation,
 * and the callback, again: the callback must be idempotent.
 *
 * Returns the number of operations replayed (0 if no journal).
 */
export async function applyPendingRewrites(
  modelDir: string,
  options: { afterOperation?: (op: { tempId: string; serverId: string }) => Promise<void> } = {},
): Promise<number> {
  const journal = await loadJournal(modelDir);
  if (!journal || journal.operations.length === 0) {
    // No-op fast path — under 5ms when journal absent (the common case).
    return 0;
  }

  for (const op of journal.operations) {
    await applyGreenfieldRewrite(modelDir, op);
    if (options.afterOperation) await options.afterOperation({ tempId: op.tempId, serverId: op.serverId });
  }

  // All operations applied cleanly — unlink + dir fsync.
  await unlinkRegular(modelDir, JOURNAL_RELATIVE_PATH);
  writtenHere.delete(await digest(journal.payload));
  return journal.operations.length;
}

async function applyGreenfieldRewrite(modelDir: string, op: GreenfieldIdRewriteOp): Promise<void> {
  // Step 1 — content rewrite per filePath. Idempotent: if the file already
  // has serverId (rewrite previously completed), skip.
  for (const relPath of op.filePaths) {
    await replaceIdInFile(join(modelDir, relPath), op.tempId, op.serverId, modelDir);
  }

  // Step 2 — control-file rename (atomic on POSIX). Idempotent: if the
  // destination exists and the source does not, the rename was already done.
  const fs = await loadFs();
  const { from, to } = op.controlFileRename;
  const fromPath = join(modelDir, from);
  const toPath = join(modelDir, to);
  if (!(await checkRealDirs(modelDir, dirname(from)))) return;
  const fromExists = (await regularOrAbsent(fromPath, from)) !== null;
  const toExists = (await regularOrAbsent(toPath, to)) !== null;
  if (fromExists && toExists) {
    // Both present — this is the ambiguous-state case the macOS overlay-FS
    // caveat warns about. Bail to manual reconciliation rather than guess.
    throw new Error(
      'WAL replay detected ambiguous state: both control files of a pending id rewrite are present. ' +
        'Manual reconciliation required — see /dethereal:sync repair-wal.',
    );
  }
  if (fromExists && !toExists) {
    if (!(await checkRealDirs(modelDir, dirname(from)))) throw new UnsafePathError('changed', dirname(from));
    await fs.rename(fromPath, toPath);
    await syncDir(dirname(toPath));
  }
  // else: !fromExists && (toExists || !toExists) → already done or nothing
  // to do; either way skip silently. Without the from-file there is no
  // safe way to "undo" a partial rename, so trust the content-rewrite
  // step's idempotency.
}

/**
 * Replace every JSON string token `"<oldId>"` with `"<newId>"` in a file.
 * Only whole quoted tokens are replaced, so an id that is a prefix of another
 * (or of any other string) is left alone.
 *
 * If the file does not exist, returns silently (the rewrite is a no-op
 * for files that never had the temp id, e.g. `dataflows.json` in a model
 * that only references controls from `structure.json`).
 *
 * Idempotent: if `oldId` is not present in the file content, no write
 * occurs (preserving fsync cost on already-replayed files).
 *
 * With `root` (the model directory), the file is read and written with the
 * link checks described above.
 */
export async function replaceIdInFile(
  filePath: string,
  oldId: string,
  newId: string,
  root?: string,
): Promise<void> {
  const parentDir = dirname(filePath);
  const content = root
    ? await readRegularNoFollow(root, relUnder(root, filePath), MAX_MODEL_FILE_BYTES)
    : await readLeafNoFollow(filePath, filePath.slice(parentDir.length + 1), MAX_MODEL_FILE_BYTES);
  if (content === null) return;
  const from = JSON.stringify(oldId);
  if (!content.includes(from)) return; // already done or never present
  const replaced = content.split(from).join(JSON.stringify(newId));
  await atomicWriteWithFsync(filePath, replaced, root);
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
 * A journal that is not of the writer's exact shape is reported only as
 * `rejected` entries (an index and a code): none of its strings is echoed and
 * none of its paths is read. `verified` says whether replay would trust it.
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

/** No longer produced: clone-and-swap journals are never replayed. Kept for type compatibility. */
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
  /** Whether replay would trust this journal (written here, or signed on this machine). */
  verified: boolean;
  /** Why the journal or an operation in it is refused; index -1 means the journal as a whole. */
  rejected: Array<{ index: number; code: string }>;
  operations: WalOperationInspection[];
}

async function fileState(modelDir: string, rel: string): Promise<string | null | 'unsafe'> {
  try {
    return await readRegularNoFollow(modelDir, rel, MAX_MODEL_FILE_BYTES);
  } catch (err) {
    if (err instanceof UnsafePathError) return 'unsafe';
    throw err;
  }
}

export async function inspectPendingRewrite(modelDir: string): Promise<WalInspection> {
  const journalPath = getJournalPath(modelDir);
  let raw: { operations: unknown[]; mac?: unknown } | null;
  try {
    raw = await readRawJournal(modelDir);
  } catch (err) {
    if (!(err instanceof JournalRejectedError)) throw err;
    return { present: true, journalPath, verified: false, rejected: [{ index: -1, code: err.code }], operations: [] };
  }
  if (!raw) return { present: false, journalPath, verified: false, rejected: [], operations: [] };

  const rejected = problemsOf(raw.operations);
  if (rejected.length > 0) return { present: true, journalPath, verified: false, rejected, operations: [] };
  const verified = await isTrusted(await macPayload(modelDir, raw.operations), raw.mac);

  const operations: WalOperationInspection[] = [];
  for (const op of raw.operations as GreenfieldIdRewriteOp[]) {
    const from = await fileState(modelDir, op.controlFileRename.from);
    const to = await fileState(modelDir, op.controlFileRename.to);
    const filePaths: WalGreenfieldInspection['filePaths'] = [];
    for (const relPath of op.filePaths) {
      const content = await fileState(modelDir, relPath);
      const exists = typeof content === 'string';
      filePaths.push({
        path: relPath,
        exists,
        containsTempId: exists && content.includes(JSON.stringify(op.tempId)),
        containsServerId: exists && content.includes(JSON.stringify(op.serverId)),
      });
    }
    const fromExists = typeof from === 'string';
    const toExists = typeof to === 'string';
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
  }

  return { present: true, journalPath, verified, rejected: [], operations };
}

/**
 * Hard-delete the journal without applying its operations.
 *
 * Used by the `repair-wal` recovery verb when the operator decides the
 * journal is stale (e.g. the platform-side rewrite was undone, or the
 * operator is willing to manually re-create the local files). The skill is
 * responsible for confirming with the operator before invoking — there is
 * no engine-level confirmation gate.
 *
 * A link at the journal's path is removed as a link (its target is never
 * touched); a linked `.dethereal/` is refused.
 */
export async function clearPendingRewrite(modelDir: string): Promise<boolean> {
  const fs = await loadFs();
  if (!(await checkRealDirs(modelDir, dirname(JOURNAL_RELATIVE_PATH)))) return false;
  const journalPath = getJournalPath(modelDir);
  const st = await lstatOrNull(journalPath);
  if (!st) return false;
  if (st.isDirectory()) throw new UnsafePathError('not_regular', JOURNAL_RELATIVE_PATH);
  await fs.unlink(journalPath);
  await syncDir(dirname(journalPath));
  writtenHere.clear();
  return true;
}
