/**
 * File-IO helpers for the per-Control file format (`controls/<id>.json`).
 *
 * Pure I/O — no platform calls, no business logic. Sits below
 * `DtControlLibrary` so the orchestrator can stay focused on state
 * machine + GraphQL composition.
 *
 * Writes go through `atomicWriteWithFsync` from the WAL helper for the
 * same POSIX durability guarantees the WAL itself relies on.
 */

import { atomicWriteWithFsync } from './wal-helper.js';

/** POSIX-style join — see wal-helper.ts header for why static `node:path` is forbidden. */
function join(...parts: string[]): string {
  return parts
    .map((p, i) => {
      if (i === 0) return p.replace(/\/+$/, '');
      return p.replace(/^\/+|\/+$/g, '');
    })
    .filter(p => p.length > 0)
    .join('/');
}
import type { ControlFile } from '../schemas/control-file.schema.js';

/**
 * Lazy `fs/promises` loader — keeps this module browser-bundleable when
 * re-exported through the @dethernety/dt-core barrel. See wal-helper.ts
 * header for the rationale.
 */
type FsModule = typeof import('node:fs/promises');
let _fs: FsModule | undefined;
async function loadFs(): Promise<FsModule> {
  if (!_fs) _fs = await import('node:fs/promises');
  return _fs;
}

const CONTROLS_FOLDER = 'controls';

/**
 * Defence-in-depth: reject controlIds that could escape the controls/ folder.
 *
 * The MCP-boundary Zod schema in `manage-controls.tool.ts` already restricts
 * `control_id` to `[A-Za-z0-9_-]+`. This check enforces the same rule at
 * the engine layer so direct dt-core callers (tests, future tools, the
 * Studio backend) cannot bypass it. UUIDs and `greenfield-*` prefixes
 * satisfy the regex; anything containing `/`, `.`, `\`, or null bytes
 * is rejected before the path is built.
 *
 * Without this guard, `controlId = "../structure"` makes
 * `<modelDir>/controls/../structure.json` resolve to `<modelDir>/structure.json`,
 * letting `markTombstoned` / `writeControlFile` overwrite the model's
 * structure file with attacker-shaped JSON.
 */
const CONTROL_ID_REGEX = /^[A-Za-z0-9_-]+$/;

function assertSafeControlId(controlId: string): void {
  if (typeof controlId !== 'string' || controlId.length === 0) {
    throw new Error('controlId must be a non-empty string');
  }
  if (!CONTROL_ID_REGEX.test(controlId)) {
    throw new Error(
      `controlId contains invalid characters (allowed: [A-Za-z0-9_-]): ${JSON.stringify(controlId)}`,
    );
  }
}

/**
 * Resolve the absolute path to a per-Control file inside a model directory.
 */
export function getControlFilePath(modelDir: string, controlId: string): string {
  assertSafeControlId(controlId);
  return join(modelDir, CONTROLS_FOLDER, `${controlId}.json`);
}

/**
 * Read a per-Control file. Returns `null` if the file does not exist.
 * Throws on I/O error or malformed JSON (the caller decides whether to
 * surface as a schema error or treat as missing).
 */
export async function readControlFile(
  modelDir: string,
  controlId: string,
): Promise<ControlFile | null> {
  const fs = await loadFs();
  const path = getControlFilePath(modelDir, controlId);
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw) as ControlFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write a per-Control file. Atomic via the WAL helper's tmp+fsync+rename
 * sequence; the parent `controls/` directory is created if absent.
 */
export async function writeControlFile(
  modelDir: string,
  file: ControlFile,
): Promise<void> {
  const path = getControlFilePath(modelDir, file.id);
  await atomicWriteWithFsync(path, JSON.stringify(file, null, 2) + '\n');
}

/**
 * Enumerate the Control ids represented by files under `<modelDir>/controls/`.
 * Returns the basenames (without the `.json` suffix) sorted alphabetically.
 *
 * Returns an empty array if the `controls/` directory does not exist
 * (a fresh model that has not yet referenced any Controls).
 */
export async function listControlFiles(modelDir: string): Promise<string[]> {
  const fs = await loadFs();
  const dir = join(modelDir, CONTROLS_FOLDER);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter(e => e.endsWith('.json'))
    .map(e => e.slice(0, -'.json'.length))
    .sort();
}

/**
 * Delete a per-Control file. Returns `true` if the file existed and was
 * removed; `false` if it was already absent.
 */
export async function deleteControlFile(
  modelDir: string,
  controlId: string,
): Promise<boolean> {
  const fs = await loadFs();
  const path = getControlFilePath(modelDir, controlId);
  try {
    await fs.unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
