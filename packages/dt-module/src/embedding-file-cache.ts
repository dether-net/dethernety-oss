import * as fs from 'fs';
import * as path from 'path';
import { classEmbeddingText, hashEmbeddingText, slugifyModelName } from './embedding-text';

/**
 * Maximum vector length accepted from a pre-computed file. Vectors longer than
 * this are rejected as malformed. Current embedding models top out around 4096
 * dimensions; 8192 is a comfortable sanity bound.
 */
const MAX_VECTOR_DIMENSIONS = 8192;

export interface EmbeddingFileCacheOptions {
  /** Absolute path to the module's data root (already includes the moduleName segment). */
  moduleDataDir: string;

  /**
   * Ordered list of class-type directory names to walk.
   * V2 / OPA layout: ['component', 'dataFlow', 'securityBoundary', 'control', 'data']
   * JSON layout:     ['ComponentClasses', 'DataFlowClasses', 'SecurityBoundaryClasses', 'ControlClasses', 'DataClasses']
   */
  classTypeDirs: string[];

  /** Filename of the class-definition JSON inside each class directory. */
  classDefinitionFile: 'class.json' | 'metadata.json';

  /** Optional structured logger. Falls back to console.warn when not provided. */
  logger?: { warn: (msg: string, meta?: object) => void };
}

/**
 * File-backed per-class embedding cache. Walks the module-data tree once per
 * model on first lookup; subsequent lookups are in-memory.
 *
 * Security invariants:
 * - `className` is never interpolated into a filesystem path — it is only ever
 *   used as a Map key. Directory names (controlled by the module author at
 *   pack time) are the only path segments.
 * - The model name is always slugified via `slugifyModelName` before being
 *   used as a filename, so path-traversal via `EMBEDDING_MODEL` env is not
 *   possible even for model identifiers containing '/'.
 * - Values read from JSON files are passed to the logger as structured
 *   metadata, never interpolated into log message format strings.
 */
export class EmbeddingFileCache {
  private readonly cache = new Map<string, Map<string, number[]>>();
  private readonly moduleDataDir: string;
  private readonly classTypeDirs: string[];
  private readonly classDefinitionFile: 'class.json' | 'metadata.json';
  private readonly logger: { warn: (msg: string, meta?: object) => void };

  constructor(options: EmbeddingFileCacheOptions) {
    this.moduleDataDir = options.moduleDataDir;
    this.classTypeDirs = options.classTypeDirs;
    this.classDefinitionFile = options.classDefinitionFile;
    this.logger = options.logger ?? {
      warn: (msg, meta) => console.warn(msg, meta ?? {}),
    };
  }

  /** Look up a pre-computed embedding. Returns null when not available for any reason. */
  get(className: string, embeddingModel: string): number[] | null {
    if (!embeddingModel) return null;
    const slug = slugifyModelName(embeddingModel);
    let modelCache = this.cache.get(slug);
    if (!modelCache) {
      modelCache = this.load(slug);
      this.cache.set(slug, modelCache);
    }
    // Return a copy: the cached array is shared across the process lifetime, so a consumer that
    // normalizes it in place must not corrupt the cache for every other caller.
    const vector = modelCache.get(className);
    return vector ? vector.slice() : null;
  }

  /**
   * Walk all class-type directories looking for `{classDir}/embeddings/{slug}.json`.
   * Pairs each vector with its canonical class name (read from the class-definition
   * file in the same directory).
   */
  private load(modelSlug: string): Map<string, number[]> {
    const result = new Map<string, number[]>();

    if (!fs.existsSync(this.moduleDataDir)) return result;

    for (const classTypeDir of this.classTypeDirs) {
      const typeRoot = path.join(this.moduleDataDir, classTypeDir);
      if (!fs.existsSync(typeRoot)) continue;

      let entries: string[];
      try {
        entries = fs.readdirSync(typeRoot);
      } catch (err) {
        this.logger.warn('Failed to read class-type directory', {
          classTypeDir,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const entry of entries) {
        const classDir = path.join(typeRoot, entry);
        if (!this.isDirectorySafe(classDir)) continue;

        const defPath = path.join(classDir, this.classDefinitionFile);
        if (!fs.existsSync(defPath)) continue;

        const vectorPath = path.join(classDir, 'embeddings', `${modelSlug}.json`);
        if (!fs.existsSync(vectorPath)) continue;

        const def = this.readClassDef(defPath);
        if (!def) continue;

        const parsed = this.readVector(vectorPath);
        if (!parsed) continue;

        // Content-hash staleness check. A stamped hash that no longer matches the current class
        // text means the vector was computed from stale text (class edited without regenerating)
        // — treat it as a cache miss so it is recomputed. A legacy file with no stamped hash is
        // served unchanged (unverified), exactly as before this shipped.
        if (parsed.contentHash !== null) {
          const expected = hashEmbeddingText(classEmbeddingText(def, classTypeDir));
          if (parsed.contentHash !== expected) {
            this.logger.warn('Stale embedding vector (content-hash mismatch); recomputing', {
              vectorPath,
            });
            continue;
          }
        }

        result.set(def.name, parsed.vector);
      }
    }

    return result;
  }

  private isDirectorySafe(p: string): boolean {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  private readClassDef(
    defPath: string,
  ): { name: string; description?: string; category?: string; type?: string } | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(defPath, 'utf8'));
      const name = parsed?.name;
      if (typeof name !== 'string' || name.length === 0) return null;
      // Pass the raw description/category/type through UNCOERCED — the CLI writer feeds the raw
      // class.json values into the same composer, and composeClassText coerces them identically
      // on both sides. Sanitizing them here (e.g. nulling a non-string) would make the recomputed
      // hash diverge from the stamped one and permanently miss the cache for that class.
      return {
        name,
        description: parsed.description,
        category: parsed.category,
        type: parsed.type,
      };
    } catch {
      return null;
    }
  }

  /**
   * Read and validate a pre-computed vector file. Accepts two on-disk shapes: a bare JSON array
   * (legacy — `contentHash: null`, served unverified) or a `{ vector, contentHash }` wrapper
   * (new — verified by the caller against the current class text). Never throws — every failure
   * mode returns `null` (a cache miss), so an old/mismatched/malformed file degrades to recompute.
   */
  private readVector(
    vectorPath: string,
  ): { vector: number[]; contentHash: string | null } | null {
    let raw: string;
    try {
      raw = fs.readFileSync(vectorPath, 'utf8');
    } catch (err) {
      this.logger.warn('Failed to read embedding file', {
        vectorPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn('Malformed embedding JSON', { vectorPath });
      return null;
    }

    let candidate: unknown;
    let contentHash: string | null;
    if (Array.isArray(parsed)) {
      candidate = parsed;
      contentHash = null;
    } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).vector)) {
      // A wrapper file is verified by contract — the writer always stamps a sha256. A
      // missing/mangled hash means the file is corrupted; reject it (cache miss) rather
      // than silently downgrading to unverified serving.
      const h = (parsed as any).contentHash;
      if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) {
        this.logger.warn('Embedding wrapper file has a missing or malformed contentHash', {
          vectorPath,
        });
        return null;
      }
      candidate = (parsed as any).vector;
      contentHash = h;
    } else {
      this.logger.warn('Embedding file must be a JSON array or { vector, contentHash } object', {
        vectorPath,
      });
      return null;
    }

    const arr = candidate as unknown[];
    if (arr.length === 0 || arr.length > MAX_VECTOR_DIMENSIONS) {
      this.logger.warn('Embedding vector length out of bounds', {
        vectorPath,
        length: arr.length,
        max: MAX_VECTOR_DIMENSIONS,
      });
      return null;
    }

    let sumSq = 0;
    for (const v of arr) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        this.logger.warn('Embedding vector contains non-finite or non-numeric entry', {
          vectorPath,
        });
        return null;
      }
      sumSq += v * v;
    }

    // A zero-magnitude vector yields degenerate/NaN cosine similarity downstream — reject it.
    if (sumSq === 0) {
      this.logger.warn('Embedding vector has zero magnitude', { vectorPath });
      return null;
    }

    return { vector: arr as number[], contentHash };
  }
}
