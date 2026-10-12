/**
 * Built-in embedding profiles.
 *
 * A profile pins everything that shapes a stored vector: where the weights come from (repository,
 * revision, per-file size and sha256), how the model runs (dtype, pooling, normalisation,
 * dimensions) and the prompts applied to queries and documents. It also carries the per-corpus
 * similarity thresholds (cosine) and the run they were calibrated on. `EMBEDDING_MODEL` selects one
 * by id. The id is what a node stores as `embeddingModel`, so it changes whenever anything that
 * shapes a stored vector changes.
 *
 * `embeddinggemma` describes the HTTP embedder used today: no prompts, no pinned weights.
 */

import { createHash } from 'crypto';

import { MAX_EMBEDDING_DIMENSIONS } from './embedding-text';

import embeddinggemma2TextRetrievalV1 from './embedding-profiles/embeddinggemma-2-text-retrieval-v1.json';
import embeddinggemma300mRetrievalV1 from './embedding-profiles/embeddinggemma-300m-retrieval-v1.json';
import embeddinggemmaLegacy from './embedding-profiles/embeddinggemma.json';

export type ProfileKind = 'query' | 'document';

export interface ProfileSourceFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ProfileSource {
  hub: string;
  repo: string;
  revision: string;
  gated: boolean;
  files: ProfileSourceFile[];
}

export interface ProfileThresholds {
  classes: number | null;
  mitre: number | null;
  components: number | null;
}

export interface EmbeddingProfile {
  schemaVersion: 1;
  id: string;
  label: string;
  source?: ProfileSource;
  licence?: { name: string; hubCardLicence?: string; url?: string };
  runtime: {
    engine: 'onnx' | 'http';
    dimensions: number;
    dtype?: string;
    output?: string;
    pooling?: string;
    poolingIncludesPrompt?: boolean;
    normalize?: string;
    maxTokens?: number;
    emptyInputs?: { names: string[]; shape: number[]; type: string };
  };
  prompts?: { query: string; document: string; title: 'name' | 'none' };
  thresholds: ProfileThresholds;
  /** How the thresholds were calibrated: on what query set, when, and by which rule. */
  calibration?: { set: string; date: string; rule: string };
}

const PROFILE_ID = /^[a-z0-9][a-z0-9.-]*$/;
const REPO = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function checkFilePath(path: unknown, at: string, problems: string[]): void {
  if (typeof path !== 'string' || path === '') {
    problems.push(`${at}.path must be a non-empty string`);
    return;
  }
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((s) => s === '..' || s === '')) {
    problems.push(`${at}.path must be relative, without '..', empty segments or backslashes: ${path}`);
  }
}

function checkThreshold(value: unknown, at: string, problems: string[]): void {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
    problems.push(`${at} must be a cosine value in [-1, 1] or null`);
  }
}

/**
 * Validate an embedding profile. Throws one error listing every problem, so a broken profile is
 * fixed in one pass rather than one complaint at a time.
 */
export function validateProfile(candidate: unknown): EmbeddingProfile {
  const problems: string[] = [];
  if (!isObject(candidate)) throw new Error('Invalid embedding profile: not an object');
  const p = candidate;
  const id = typeof p.id === 'string' ? p.id : '<missing id>';

  if (p.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (typeof p.id !== 'string' || !PROFILE_ID.test(p.id)) problems.push(`id must match ${PROFILE_ID}`);
  if (typeof p.label !== 'string' || p.label === '') problems.push('label must be a non-empty string');

  const runtime = isObject(p.runtime) ? p.runtime : undefined;
  if (!runtime) {
    problems.push('runtime is required');
  } else {
    if (runtime.engine !== 'onnx' && runtime.engine !== 'http') problems.push("runtime.engine must be 'onnx' or 'http'");
    const dims = runtime.dimensions;
    if (typeof dims !== 'number' || !Number.isInteger(dims) || dims < 1 || dims > MAX_EMBEDDING_DIMENSIONS) {
      problems.push(`runtime.dimensions must be an integer in 1..${MAX_EMBEDDING_DIMENSIONS}`);
    }
  }

  const thresholds = isObject(p.thresholds) ? p.thresholds : undefined;
  if (!thresholds) {
    problems.push('thresholds is required');
  } else {
    for (const corpus of ['classes', 'mitre', 'components']) {
      if (!(corpus in thresholds)) problems.push(`thresholds.${corpus} is required (null for no floor)`);
      else checkThreshold(thresholds[corpus], `thresholds.${corpus}`, problems);
    }
  }

  if (runtime?.engine === 'onnx') {
    const source = isObject(p.source) ? p.source : undefined;
    if (!source) {
      problems.push('source is required for an onnx profile');
    } else {
      if (typeof source.hub !== 'string' || !source.hub.startsWith('https://')) problems.push('source.hub must be an https URL');
      if (typeof source.repo !== 'string' || !REPO.test(source.repo)) problems.push('source.repo must be org/name');
      if (typeof source.revision !== 'string' || !REVISION.test(source.revision)) {
        problems.push('source.revision must be 40 lowercase hex characters');
      }
      if (typeof source.gated !== 'boolean') problems.push('source.gated must be a boolean');
      if (!Array.isArray(source.files) || source.files.length === 0) {
        problems.push('source.files must be a non-empty list');
      } else {
        source.files.forEach((f, i) => {
          const at = `source.files[${i}]`;
          if (!isObject(f)) {
            problems.push(`${at} must be an object`);
            return;
          }
          checkFilePath(f.path, at, problems);
          if (typeof f.bytes !== 'number' || !Number.isInteger(f.bytes) || f.bytes < 1) {
            problems.push(`${at}.bytes must be a positive integer`);
          }
          if (typeof f.sha256 !== 'string' || !SHA256.test(f.sha256)) problems.push(`${at}.sha256 must be 64 lowercase hex characters`);
        });
      }
    }
    const licence = isObject(p.licence) ? p.licence : undefined;
    if (!licence || typeof licence.name !== 'string' || licence.name === '') {
      problems.push('licence.name is required for an onnx profile');
    }
    const prompts = isObject(p.prompts) ? p.prompts : undefined;
    if (!prompts) {
      problems.push('prompts is required for an onnx profile');
    } else {
      for (const kind of ['query', 'document']) {
        const t = prompts[kind];
        if (typeof t !== 'string' || !t.includes('{text}')) problems.push(`prompts.${kind} must contain {text}`);
      }
      if (prompts.title !== 'name' && prompts.title !== 'none') problems.push("prompts.title must be 'name' or 'none'");
    }
    const calibration = isObject(p.calibration) ? p.calibration : undefined;
    if (!calibration || typeof calibration.set !== 'string' || typeof calibration.date !== 'string' || typeof calibration.rule !== 'string') {
      problems.push('calibration { set, date, rule } is required for an onnx profile');
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid embedding profile "${id}":\n- ${problems.join('\n- ')}`);
  }
  return candidate as unknown as EmbeddingProfile;
}

const BUILT_IN: ReadonlyMap<string, EmbeddingProfile> = new Map(
  [embeddinggemma300mRetrievalV1, embeddinggemma2TextRetrievalV1, embeddinggemmaLegacy]
    .map((raw) => validateProfile(raw))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => [p.id, p]),
);

/** The built-in profiles, in id order. */
export function listProfiles(): EmbeddingProfile[] {
  return [...BUILT_IN.values()];
}

/** The built-in profile with this id. An unknown id throws an error that lists the valid ids. */
export function getProfile(id: string): EmbeddingProfile {
  const profile = BUILT_IN.get(id);
  if (!profile) {
    throw new Error(`Unknown EMBEDDING_MODEL "${id}". Valid profile ids: ${[...BUILT_IN.keys()].join(', ')}`);
  }
  return profile;
}

/**
 * The text a profile embeds for one item: the query or document prompt with `{text}` and
 * `{title}` filled in. Substitution is a single pass over the template, so placeholders or `$`
 * sequences inside the inserted text are never expanded. A profile without prompts returns the
 * text unchanged. For documents, title rule `name` uses the given title (`none` when empty) and
 * rule `none` always writes the literal `none`.
 */
export function applyPrompt(profile: EmbeddingProfile, kind: ProfileKind, text: string, title?: string): string {
  if (!profile.prompts) return text;
  const template = kind === 'query' ? profile.prompts.query : profile.prompts.document;
  const titleValue = profile.prompts.title === 'name' && title ? title : 'none';
  return template.replace(/\{(text|title)\}/g, (_match, name: string) => (name === 'text' ? text : titleValue));
}

/**
 * Content hash of a vector's source: sha256 over the profile id and the prompted text, joined by a
 * newline. Including the profile means a vector file or a stored hash never verifies under another
 * profile, and a prompt change can never pass as current.
 */
export function profileContentHash(profileId: string, promptedText: string): string {
  return createHash('sha256').update(`${profileId}\n${promptedText}`).digest('hex');
}
