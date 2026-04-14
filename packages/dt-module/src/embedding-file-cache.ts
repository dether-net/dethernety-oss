import * as fs from 'fs';
import * as path from 'path';
import { slugifyModelName } from './embedding-text';

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
    return modelCache.get(className) ?? null;
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

        const className = this.readClassName(defPath);
        if (!className) continue;

        const vector = this.readVector(vectorPath);
        if (!vector) continue;

        result.set(className, vector);
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

  private readClassName(defPath: string): string | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(defPath, 'utf8'));
      const name = parsed?.name;
      return typeof name === 'string' && name.length > 0 ? name : null;
    } catch {
      return null;
    }
  }

  private readVector(vectorPath: string): number[] | null {
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

    if (!Array.isArray(parsed)) {
      this.logger.warn('Embedding file must be a top-level JSON array', { vectorPath });
      return null;
    }

    if (parsed.length === 0 || parsed.length > MAX_VECTOR_DIMENSIONS) {
      this.logger.warn('Embedding vector length out of bounds', {
        vectorPath,
        length: parsed.length,
        max: MAX_VECTOR_DIMENSIONS,
      });
      return null;
    }

    for (const v of parsed) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        this.logger.warn('Embedding vector contains non-finite or non-numeric entry', {
          vectorPath,
        });
        return null;
      }
    }

    return parsed as number[];
  }
}
