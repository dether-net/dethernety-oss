/**
 * The persistent metadata cache — what lets a warm deployment boot fully offline
 * and, more importantly, what keeps a registered remote module on the platform's
 * *graceful* reconciliation path. The platform's obsolescence sweep hard-deletes
 * a module (and its live class bindings) the moment it fails to load, so the
 * client must never throw once it has ever registered: it serves the newest
 * authoritative metadata from here instead. That guarantee only holds if this
 * cache is placed **co-durable with the graph database** — the classes and the
 * cache that protects them must be durable together.
 *
 * Entries are immutable at a pin (the pin is a content hash), written atomically
 * (temp file + rename) so an entry is always complete or absent, never partial.
 *
 * A pin's policy hashes are served separately from its document, and may be published
 * after it, so they are kept in a file of their own beside the entry rather than by
 * rewriting it. That file is written once and never replaced.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { ModuleDocument, EmbeddingsResponse } from './wire-client';
import { DTMetadata } from '../interfaces/module-metadata-interface';

/** One cached module content version: the module document plus its embeddings. */
export interface CachedModule {
  moduleKey: string;
  pin: string;
  /** ISO timestamp of the fetch. Used only to pick the newest entry / log staleness. */
  fetchedAt: string;
  document: ModuleDocument;
  embeddings: EmbeddingsResponse[];
}

export interface MetadataCacheOptions {
  /** Explicit directory (a test seam / an operator-configured path). */
  dir?: string;
  /** True when `dir` was supplied explicitly (skip the env-unset ephemerality warning). */
  explicitDir?: boolean;
  logger?: Logger;
}

/** Ends the name of a pin's policy hashes file, beside the pin's entry. A pin's own
 * file name never contains it: `safeName` maps every `.` away. */
const POLICY_HASHES_SUFFIX = '.policy-hashes.json';

/** The five class arrays the catalog serves (analysis/issue are never served).
 * Shared by the corruption guard and the module's vector-map build so the "which
 * arrays count" definition lives in exactly one place. */
export const SERVED_CLASS_ARRAYS: Array<keyof DTMetadata> = [
  'componentClasses',
  'dataFlowClasses',
  'securityBoundaryClasses',
  'dataClasses',
  'controlClasses',
];

/** Total registered classes across the served arrays. Zero means corruption (a
 * partial/wrong document), not a legitimate module; a single empty array is fine. */
export function countClasses(module: DTMetadata): number {
  let n = 0;
  for (const key of SERVED_CLASS_ARRAYS) {
    const arr = module[key];
    if (Array.isArray(arr)) n += arr.length;
  }
  return n;
}

export class MetadataCache {
  private readonly dir: string;
  private readonly logger: Logger;
  private readonly memo = new Map<string, CachedModule>();

  constructor(options: MetadataCacheOptions = {}) {
    this.logger = options.logger ?? new Logger('DtRemoteModule');
    const envDir = process.env.MODULE_CONTENT_CACHE_DIR;
    const fromEnv = !options.dir && !!envDir;
    this.dir = options.dir ?? envDir ?? path.join(os.tmpdir(), 'dt-remote-module-cache');
    this.warnIfNotDurable({ explicit: options.explicitDir ?? !!options.dir, fromEnv });
  }

  /** Exact-pin lookup: memo, then disk. A parse failure or a zero-class document
   * is treated as absent (never a reduced answer). */
  get(moduleKey: string, pin: string): CachedModule | null {
    const key = memoKey(moduleKey, pin);
    const cached = this.memo.get(key);
    if (cached) return cached;
    const entry = this.readFile(this.fileFor(moduleKey, pin));
    // Identity check: the path is a sanitized (lossy) mapping of the key, so
    // confirm the loaded entry really is this moduleKey+pin before trusting it.
    if (!entry || entry.moduleKey !== moduleKey || entry.pin !== pin) return null;
    this.memo.set(key, entry);
    return entry;
  }

  /** Persist an entry atomically (temp file + rename) so it is complete or absent. */
  put(entry: CachedModule): void {
    const target = this.fileFor(entry.moduleKey, entry.pin);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8');
      fs.renameSync(tmp, target);
      this.memo.set(memoKey(entry.moduleKey, entry.pin), entry);
    } catch (err) {
      // A write failure must never crash registration — the module still serves
      // from the live fetch this turn; it just won't be warm on the next boot.
      this.logger.warn('Failed to persist remote module metadata cache entry', {
        moduleKey: entry.moduleKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** The most-recent valid cached document for a module across every cached pin —
   * the offline pin-miss fallback that keeps the module registered. */
  newestFor(moduleKey: string): CachedModule | null {
    const moduleDir = path.join(this.dir, safeName(moduleKey));
    let files: string[];
    try {
      files = fs.readdirSync(moduleDir).filter((f) => f.endsWith('.json') && !f.endsWith(POLICY_HASHES_SUFFIX));
    } catch {
      return null;
    }
    let newest: CachedModule | null = null;
    for (const file of files) {
      const entry = this.readFile(path.join(moduleDir, file));
      // Only entries that really belong to this module (the dir name is lossy).
      if (entry && entry.moduleKey === moduleKey && (!newest || entry.fetchedAt > newest.fetchedAt)) {
        newest = entry;
      }
    }
    return newest;
  }

  /** The stored policy hashes body for a pin, unvalidated (the caller checks it against
   * the pin and its document), or `null` when none is stored or it cannot be parsed. */
  getPolicyHashes(moduleKey: string, pin: string): unknown {
    let raw: string;
    try {
      raw = fs.readFileSync(this.policyHashesFileFor(moduleKey, pin), 'utf8');
    } catch {
      return null; // absent
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      this.logger.warn('Discarding a corrupt remote module policy hashes cache file', { moduleKey, pin });
      this.dropPolicyHashes(moduleKey, pin);
      return null;
    }
  }

  /** Remove a pin's stored policy hashes — only one that cannot be parsed or does not
   * check out, so that a good set can be stored in its place. Absent is fine. */
  dropPolicyHashes(moduleKey: string, pin: string): void {
    try {
      fs.unlinkSync(this.policyHashesFileFor(moduleKey, pin));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.logger.warn('Failed to remove remote module policy hashes', {
          moduleKey,
          pin,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Store a pin's policy hashes once. The body is staged in a temp file and linked into
   * place, which fails rather than replaces when the file exists, so a stored set is never
   * rewritten and never seen partial. A failure is logged, never thrown. */
  putPolicyHashes(moduleKey: string, pin: string, body: unknown): void {
    const target = this.policyHashesFileFor(moduleKey, pin);
    const tmp = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(body), 'utf8');
      fs.linkSync(tmp, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') {
        this.logger.debug('Remote module policy hashes already stored; kept as they are', { moduleKey, pin });
      } else {
        this.logger.warn('Failed to persist remote module policy hashes', {
          moduleKey,
          pin,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Never written, or already gone.
      }
    }
  }

  private fileFor(moduleKey: string, pin: string): string {
    return path.join(this.dir, safeName(moduleKey), `${safeName(pin)}.json`);
  }

  private policyHashesFileFor(moduleKey: string, pin: string): string {
    return path.join(this.dir, safeName(moduleKey), `${safeName(pin)}${POLICY_HASHES_SUFFIX}`);
  }

  private readFile(file: string): CachedModule | null {
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return null; // absent
    }
    let entry: CachedModule;
    try {
      entry = JSON.parse(raw) as CachedModule;
    } catch {
      this.logger.warn('Discarding corrupt remote module cache entry', { file });
      return null;
    }
    if (!entry?.document?.module || countClasses(entry.document.module) === 0) {
      // Zero classes across all served arrays is corruption, not a legitimate
      // module. A single empty array (a single-kind module) is fine.
      return null;
    }
    return entry;
  }

  private warnIfNotDurable(source: { explicit: boolean; fromEnv: boolean }): void {
    const underTmp = isUnder(this.dir, os.tmpdir());
    const writable = isWritable(this.dir);
    if (!writable) {
      this.logger.warn(
        'Remote module cache directory is not writable — registered classes are unprotected against the ' +
          'obsolescence sweep if the content service is unreachable. Set MODULE_CONTENT_CACHE_DIR to a ' +
          'writable path co-durable with the graph database.',
        { dir: this.dir },
      );
      return;
    }
    // Only nag about ephemerality for the env-unset fallback, not an explicit dir.
    if (!source.explicit && !source.fromEnv && underTmp) {
      this.logger.warn(
        'MODULE_CONTENT_CACHE_DIR is unset; falling back to a temporary directory that will not survive a ' +
          'restart. A registered remote module whose content service is unreachable after a restart risks ' +
          'having its classes swept. Set MODULE_CONTENT_CACHE_DIR to a path co-durable with the graph database.',
        { dir: this.dir },
      );
    }
  }
}

function memoKey(moduleKey: string, pin: string): string {
  return `${moduleKey}\0${pin}`;
}

/** Filesystem-safe name for an opaque key; used for the PATH only. The real
 * moduleKey/pin live inside the JSON and are re-checked on read, so this mapping
 * may be lossy. `.` is excluded from the allowlist so a `.`/`..` segment cannot
 * escape the cache directory via `path.join`. */
function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function isUnder(dir: string, parent: string): boolean {
  const rel = path.relative(parent, dir);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
