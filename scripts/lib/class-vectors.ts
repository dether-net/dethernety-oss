/**
 * Pre-computed class vectors: where they live, which profile they are for, and what a valid file holds. Shared by the
 * producer (`module-manager embed`) and the CI gate (`check-module-embeddings.mjs`), so the two cannot disagree.
 *
 * This file imports only Node built-ins. The class-text composer is passed in, so the gate can load it from dt-module's
 * source by type stripping and the producer can import it normally.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** The class-type directories whose classes the platform embeds at install. */
export const CLASS_VECTOR_DIRS = ['component', 'dataFlow', 'securityBoundary', 'control', 'data', 'issue'] as const;

/** The file that defines the platform's default profile id, relative to the oss root. */
export const DEFAULT_PROFILE_SOURCE = 'apps/dt-ws/src/config/embedding-profile-selection.ts';

/** How far a vector's norm may stray from 1: the profile normalises every vector it makes. */
export const UNIT_NORM_TOLERANCE = 1e-3;

/** What the producer and the gate need from dt-module's embedding-text. */
export interface ClassTextComposer {
  classEmbeddingText(def: { name: string; description?: string; category?: string; type?: string }, classTypeDir: string): string;
  hashEmbeddingText(text: string): string;
  normalizeClassType(classTypeDir: string, rawType: string | undefined): string | null;
  slugifyModelName(model: string): string;
}

/** The parts of an embedding profile the class vectors depend on. */
export interface VectorProfile {
  id: string;
  revision: string;
  dimensions: number;
  documentTitle: string | null;
}

/** The platform's default profile id, read from its one definition. */
export function readDefaultProfileId(ossRoot: string): string {
  const file = path.join(ossRoot, DEFAULT_PROFILE_SOURCE);
  const source = fs.readFileSync(file, 'utf8');
  const found = [...source.matchAll(/^export const DEFAULT_EMBEDDING_PROFILE_ID = '([^']+)';$/gm)];
  if (found.length !== 1) {
    throw new Error(`${DEFAULT_PROFILE_SOURCE}: expected one DEFAULT_EMBEDDING_PROFILE_ID definition, found ${found.length}`);
  }
  return found[0][1];
}

/** A built-in profile, read from dt-module's profile JSON. Only an onnx profile has weights to embed with. */
export function readVectorProfile(ossRoot: string, id: string): VectorProfile {
  const file = path.join(ossRoot, 'packages/dt-module/src/embedding-profiles', `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`no built-in embedding profile "${id}" (${file})`);
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (profile.id !== id) throw new Error(`${file}: its id is "${profile.id}", not "${id}"`);
  const revision = profile.source?.revision;
  const dimensions = profile.runtime?.dimensions;
  if (profile.runtime?.engine !== 'onnx' || typeof revision !== 'string') {
    throw new Error(`profile "${id}" is not an onnx profile with pinned weights`);
  }
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error(`profile "${id}" has no dimensions`);
  return { id, revision, dimensions, documentTitle: profile.prompts?.title ?? null };
}

/** One class whose vector a module ships. */
export interface ClassEntry {
  /** The module's data directory, `<module>/data/<name>`. */
  dataDir: string;
  classTypeDir: string;
  classDir: string;
  name: string;
  /** The text the platform embeds for this class. */
  text: string;
  contentHash: string;
}

/** A class directory the walk did not use, and why. `invalid` is a defect; otherwise the platform skips it too. */
export interface SkippedClass {
  classDir: string;
  reason: string;
  invalid: boolean;
}

/**
 * The modules under `roots` that hold class data: each `<root>/<module>` with a manifest.json naming it, whose
 * `data/<name>/` has at least one class-type directory. A module is excluded when its path, or one of its parents,
 * is in `excludes`.
 */
export function findClassModules(roots: string[], excludes: string[] = []): string[] {
  const excluded = excludes.map((e) => path.resolve(e));
  const isExcluded = (dir: string) => excluded.some((e) => dir === e || dir.startsWith(e + path.sep));
  const modules: string[] = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const modulePath = path.resolve(root, entry.name);
      if (isExcluded(modulePath)) continue;
      const dataDir = moduleDataDir(modulePath);
      if (dataDir && CLASS_VECTOR_DIRS.some((d) => fs.existsSync(path.join(dataDir, d)))) modules.push(modulePath);
    }
  }
  return modules.sort();
}

/** `<module>/data/<name>`, the name taken from the module's manifest.json; null when there is none. */
export function moduleDataDir(modulePath: string): string | null {
  const manifest = path.join(modulePath, 'manifest.json');
  if (!fs.existsSync(manifest)) return null;
  const name = JSON.parse(fs.readFileSync(manifest, 'utf8')).name;
  if (typeof name !== 'string' || name.length === 0) return null;
  const dataDir = path.join(modulePath, 'data', name);
  return fs.existsSync(dataDir) ? dataDir : null;
}

/**
 * Every class of a module's data directory that gets a vector, with the text the platform embeds for it. A component
 * whose type the platform rejects is skipped, as the platform skips it.
 */
export function collectClasses(dataDir: string, composer: ClassTextComposer): { classes: ClassEntry[]; skipped: SkippedClass[] } {
  const classes: ClassEntry[] = [];
  const skipped: SkippedClass[] = [];
  for (const classTypeDir of CLASS_VECTOR_DIRS) {
    const typeRoot = path.join(dataDir, classTypeDir);
    if (!fs.existsSync(typeRoot)) continue;
    for (const entry of fs.readdirSync(typeRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const classDir = path.join(typeRoot, entry.name);
      const defPath = path.join(classDir, 'class.json');
      if (!fs.existsSync(defPath)) continue;
      let def: any;
      try {
        def = JSON.parse(fs.readFileSync(defPath, 'utf8'));
      } catch (error) {
        skipped.push({ classDir, reason: `malformed class.json (${error instanceof Error ? error.message : String(error)})`, invalid: true });
        continue;
      }
      if (typeof def?.name !== 'string' || def.name.length === 0) {
        skipped.push({ classDir, reason: 'class.json has no "name"', invalid: true });
        continue;
      }
      if (composer.normalizeClassType(classTypeDir, def.type) === null) {
        skipped.push({ classDir, reason: `the platform skips a ${classTypeDir} class of type "${def.type}"`, invalid: false });
        continue;
      }
      const text = composer.classEmbeddingText(def, classTypeDir);
      classes.push({ dataDir, classTypeDir, classDir, name: def.name, text, contentHash: composer.hashEmbeddingText(text) });
    }
  }
  return { classes, skipped };
}

/** The file a class's vector for `profile` lives in. */
export function vectorFilePath(classDir: string, profile: VectorProfile, composer: ClassTextComposer): string {
  return path.join(classDir, 'embeddings', `${composer.slugifyModelName(profile.id)}.json`);
}

/** The JSON a vector file holds. The platform reads only `vector` and `contentHash`; the rest is for this check. */
export function vectorFileBody(profile: VectorProfile, contentHash: string, vector: number[]): string {
  return `${JSON.stringify({ profile: profile.id, revision: profile.revision, contentHash, vector })}\n`;
}

/** What is wrong with a class's vector file, or [] when it is current. */
export function vectorFileProblems(entry: ClassEntry, profile: VectorProfile, composer: ClassTextComposer): string[] {
  const file = vectorFilePath(entry.classDir, profile, composer);
  if (!fs.existsSync(file)) return ['no vector file'];
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return ['the vector file is not JSON'];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ['the vector file is not a {profile, revision, contentHash, vector} object'];
  const problems: string[] = [];
  if (parsed.profile !== profile.id) problems.push(`made for profile "${parsed.profile}", not "${profile.id}"`);
  if (parsed.revision !== profile.revision) problems.push(`made with weights revision "${parsed.revision}", not "${profile.revision}"`);
  if (parsed.contentHash !== entry.contentHash) problems.push('stale: its contentHash does not match the class text; run the module\'s embed script');
  problems.push(...vectorProblems(parsed.vector, profile.dimensions));
  return problems;
}

/** What is wrong with a vector: its length, a value that is not finite, or a norm that is not 1. */
export function vectorProblems(vector: unknown, dimensions: number): string[] {
  if (!Array.isArray(vector)) return ['no vector'];
  if (vector.length !== dimensions) return [`${vector.length} values, not ${dimensions}`];
  if (!vector.every((v) => typeof v === 'number' && Number.isFinite(v))) return ['a value is not a finite number'];
  const norm = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
  if (Math.abs(norm - 1) > UNIT_NORM_TOLERANCE) return [`norm ${norm.toFixed(6)}, not 1`];
  return [];
}

/** The files in a class's embeddings/ directory other than the profile's: there must be none. */
export function strayVectorFiles(classDir: string, profile: VectorProfile, composer: ClassTextComposer): string[] {
  const dir = path.join(classDir, 'embeddings');
  if (!fs.existsSync(dir)) return [];
  const own = path.basename(vectorFilePath(classDir, profile, composer));
  return fs.readdirSync(dir).filter((f) => f !== own).map((f) => path.join(dir, f));
}

/** Every embeddings/ directory under a data directory that is not in a class directory of CLASS_VECTOR_DIRS. */
export function strayEmbeddingDirs(dataDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'embeddings') {
        const rel = path.relative(dataDir, full).split(path.sep);
        const inClassDir = rel.length === 3 && (CLASS_VECTOR_DIRS as readonly string[]).includes(rel[0]);
        if (!inClassDir) out.push(full);
        continue;
      }
      if (depth < 4) walk(full, depth + 1);
    }
  };
  walk(dataDir, 0);
  return out;
}
