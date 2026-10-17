/**
 * `module-manager embed` — pre-computed class vectors, made with the platform's own embedder.
 *
 * Walks each module's class definitions, composes the text the platform embeds at install (dt-module's
 * classEmbeddingText), and embeds it as a document, with the class name as its title, through
 * `packages/embedder/bin/embed-documents.mjs`: the same embedder, profile, prompt, truncation and normalisation as the
 * platform's install. Each vector goes to `{classDir}/embeddings/{profile id}.json` as
 * `{profile, revision, contentHash, vector}`.
 *
 * A class whose file already holds the profile, its weights revision and the current text hash is left alone, so
 * only edited classes change (delete a file to make it again). When none needs a vector, the embedder is not started and no weights are
 * needed. `scripts/check-module-embeddings.mjs` checks the result in CI.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
// Direct source import — the scripts/ tree is run via tsx (which handles
// TypeScript) and jest (via ts-jest). Both resolve the file path directly;
// using the package subpath (`@dethernety/dt-module/embedding`) works at
// tsx runtime but ts-jest cannot resolve it from outside dt-ws's rootDir.
import * as composer from '../../packages/dt-module/src/embedding-text';
import {
  type ClassEntry,
  type VectorProfile,
  collectClasses,
  moduleDataDir,
  readDefaultProfileId,
  readVectorProfile,
  vectorFileBody,
  vectorFilePath,
  vectorFileProblems,
  vectorProblems,
} from '../lib/class-vectors';

/** What the embed-documents helper says when it is ready: the profile and weights it embeds with. */
export interface EmbedderReady {
  profile: string;
  dimensions: number;
  repo: string;
  revision: string;
  dtype: string | null;
  documentTitle: string | null;
}

/** A running document embedder: one profile, its weights loaded. */
export interface DocumentEmbedder {
  ready: EmbedderReady;
  /** One vector per item, in order, embedded as documents. */
  embed(items: Array<{ title: string; text: string }>): Promise<number[][]>;
  close(): Promise<void>;
}

export interface OpenEmbedderOptions {
  ossRoot: string;
  profileId: string;
  modelsDir: string;
  /** Fetch the profile's weights at its pinned revision when they are missing (verified by sha256). */
  download: boolean;
}

export type OpenEmbedder = (options: OpenEmbedderOptions) => Promise<DocumentEmbedder>;

export interface EmbedOptions {
  /** Module directories, each with a manifest.json and data/<name>/. */
  modulePaths: string[];
  /** The oss/ directory; defaults to the one this file is in. */
  ossRoot?: string;
  /** The embedding profile; defaults to the platform's default. */
  profileId?: string;
  modelsDir?: string;
  download?: boolean;
  /** Classes per request to the embedder. */
  batchSize: number;
  /** Injected for tests; the default starts embed-documents. */
  openEmbedder?: OpenEmbedder;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

const OSS_ROOT = path.resolve(__dirname, '../..');

export async function runEmbed(opts: EmbedOptions): Promise<{ written: number; current: number }> {
  const log = opts.logger ?? console;
  const ossRoot = opts.ossRoot ?? OSS_ROOT;
  const profile = readVectorProfile(ossRoot, opts.profileId || readDefaultProfileId(ossRoot));

  const jobs: ClassEntry[] = [];
  let current = 0;
  for (const modulePath of opts.modulePaths) {
    const dataDir = moduleDataDir(modulePath);
    if (!dataDir) throw new Error(`${modulePath}: no manifest.json naming a data/<name>/ directory`);
    const { classes, skipped } = collectClasses(dataDir, composer);
    for (const s of skipped) log.warn(`[embed] skipping ${s.classDir}: ${s.reason}`);
    for (const entry of classes) {
      if (vectorFileProblems(entry, profile, composer).length === 0) current++;
      else jobs.push(entry);
    }
    log.log(`[embed] ${path.basename(modulePath)}: ${classes.length} classes`);
  }
  log.log(`[embed] profile ${profile.id}: ${jobs.length} to embed, ${current} current`);
  if (jobs.length === 0) return { written: 0, current };

  const modelsDir = opts.modelsDir || process.env.EMBEDDING_MODEL_DIR;
  if (!modelsDir) throw new Error('--models-dir (or EMBEDDING_MODEL_DIR) is required: the directory holding the profile\'s weights');

  const open = opts.openEmbedder ?? openEmbedDocuments;
  const embedder = await open({ ossRoot, profileId: profile.id, modelsDir, download: opts.download === true });
  let written = 0;
  let failed = false;
  try {
    assertSameProfile(embedder.ready, profile);
    for (let i = 0; i < jobs.length; i += opts.batchSize) {
      const batch = jobs.slice(i, i + opts.batchSize);
      const vectors = await embedder.embed(batch.map((j) => ({ title: j.name, text: j.text })));
      if (vectors.length !== batch.length) throw new Error(`the embedder returned ${vectors.length} vectors for ${batch.length} classes`);
      batch.forEach((job, k) => {
        const problems = vectorProblems(vectors[k], profile.dimensions);
        if (problems.length > 0) throw new Error(`the embedder returned an unusable vector for "${job.name}": ${problems.join('; ')}`);
        const file = vectorFilePath(job.classDir, profile, composer);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, vectorFileBody(profile, job.contentHash, vectors[k]));
        written++;
      });
      log.log(`[embed] ${Math.min(i + opts.batchSize, jobs.length)}/${jobs.length}`);
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // After a failure the first error is the one to report, not how the embedder ended.
    await embedder.close().catch((error) => {
      if (!failed) throw error;
    });
  }
  log.log(`[embed] done: wrote ${written} vectors, ${current} were current`);
  return { written, current };
}

/** The embedder must run the profile the vectors are filed under, with its pinned weights and title rule. */
function assertSameProfile(ready: EmbedderReady, profile: VectorProfile): void {
  const mismatch = [
    ready.profile !== profile.id && `profile "${ready.profile}"`,
    ready.revision !== profile.revision && `weights revision "${ready.revision}"`,
    ready.dimensions !== profile.dimensions && `${ready.dimensions} dimensions`,
    ready.documentTitle !== profile.documentTitle && `document title rule "${ready.documentTitle}"`,
  ].filter(Boolean);
  if (mismatch.length > 0) throw new Error(`the embedder runs ${mismatch.join(', ')}, not what profile "${profile.id}" pins`);
}

/** Starts embed-documents over the built embedder package and talks to it in JSON lines. */
export const openEmbedDocuments: OpenEmbedder = async (options) => {
  const helper = path.join(options.ossRoot, 'packages/embedder/bin/embed-documents.mjs');
  const args = [helper, '--profile', options.profileId, '--models-dir', options.modelsDir];
  if (options.download) args.push('--download');
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const failure = (what: string) => new Error(`embed-documents ${what}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
  const nextLine = async (): Promise<any> => {
    const { value, done } = await lines.next();
    if (done) {
      await exited;
      throw failure('stopped');
    }
    return JSON.parse(value);
  };

  const ready: EmbedderReady = await nextLine();
  return {
    ready,
    async embed(items) {
      child.stdin.write(`${JSON.stringify({ items })}\n`);
      const reply = await nextLine();
      if (!Array.isArray(reply?.vectors)) throw failure('answered without vectors');
      return reply.vectors;
    },
    async close() {
      child.stdin.end();
      const code = await exited;
      if (code !== 0) throw failure(`exited with ${code}`);
    },
  };
};
