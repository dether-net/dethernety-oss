/**
 * The document embedder as a long-lived process, for a build that is not written in TypeScript: the MITRE data build
 * embeds its documents through it, so the vectors it ships come from the same embedder, profile and prompt as the
 * platform's.
 *
 * Start-up: the profile (an onnx one), its weights verified (or first downloaded, with --download), the session. Then
 * one line on stdout says what embeds: `{"profile", "dimensions", "repo", "revision", "dtype", "documentTitle"}`, the
 * last being the profile's document title rule (`name` or `none`). After that, each request line
 * `{"items": [{"title", "text"}, …]}` gets one reply line `{"vectors": [[…], …]}`, in input order, embedded as
 * documents. Anything wrong ends the process: a message on stderr, a non-zero exit, and nothing more on stdout. The end
 * of input releases the session and exits 0.
 */

import './no-telemetry';

import { getProfile, type EmbeddingProfile } from '@dethernety/dt-module/embedding';

import { ensureWeights, verifyWeights } from './acquire';
import { createOnnxEmbedder, type Embedder, type EmbedItem, type OnnxEmbedderOptions } from './embedder';

export const HELPER_USAGE = 'usage: embed-documents --profile <id> --models-dir <dir> [--threads <n>] [--download]';

export interface HelperArgs {
  profile: string;
  modelsDir: string;
  threads?: number;
  download: boolean;
}

/** The command line, or an Error whose message says what is wrong with it. */
export function parseHelperArgs(argv: string[]): HelperArgs {
  let profile: string | undefined;
  let modelsDir: string | undefined;
  let threads: number | undefined;
  let download = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--profile') profile = value();
    else if (flag === '--models-dir') modelsDir = value();
    else if (flag === '--threads') {
      const raw = value();
      if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`--threads must be a positive integer, got "${raw}"`);
      threads = Number(raw);
    } else if (flag === '--download') download = true;
    else throw new Error(`unknown argument "${flag}"`);
  }
  if (!profile) throw new Error('--profile is required');
  if (!modelsDir) throw new Error('--models-dir is required');
  return { profile, modelsDir, threads, download };
}

export interface HelperIo {
  /** The request lines, without their line ends. */
  lines: AsyncIterable<string>;
  /** Writes one line to stdout. */
  out(line: string): void;
  /** Reports a problem on stderr. */
  err(message: string): void;
}

export interface HelperDeps {
  getProfile(id: string): EmbeddingProfile;
  verifyWeights(profile: EmbeddingProfile, modelsDir: string): Promise<void>;
  ensureWeights(profile: EmbeddingProfile, modelsDir: string): Promise<void>;
  open(profile: EmbeddingProfile, modelsDir: string, options: OnnxEmbedderOptions): Promise<Embedder>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One request line's items, or an Error saying why the line is not a request. */
export function parseRequest(line: string): EmbedItem[] {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch {
    throw new Error('a request line is not JSON');
  }
  const items = (request as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new Error('a request must be {"items": [...]}');
  return items.map((item: unknown, i) => {
    const { text, title } = (item ?? {}) as { text?: unknown; title?: unknown };
    if (typeof text !== 'string') throw new Error(`item ${i}: "text" must be a string`);
    if (title !== undefined && title !== null && typeof title !== 'string') throw new Error(`item ${i}: "title" must be a string`);
    return typeof title === 'string' ? { text, title } : { text };
  });
}

/** Runs the helper over `io` and returns its exit code: 0 at the end of input, 1 on any failure, 2 on a usage error. */
export async function runEmbedDocuments(argv: string[], io: HelperIo, deps: HelperDeps = defaultDeps): Promise<number> {
  let args: HelperArgs;
  try {
    args = parseHelperArgs(argv);
  } catch (error) {
    io.err(`${messageOf(error)}\n${HELPER_USAGE}`);
    return 2;
  }

  let embedder: Embedder;
  let ready: string;
  try {
    const profile = deps.getProfile(args.profile);
    if (profile.runtime.engine !== 'onnx' || !profile.source) {
      throw new Error(`profile "${profile.id}" is not an onnx profile: it has no weights to embed with here`);
    }
    if (args.download) await deps.ensureWeights(profile, args.modelsDir);
    else await deps.verifyWeights(profile, args.modelsDir);
    embedder = await deps.open(profile, args.modelsDir, { threads: args.threads });
    ready = JSON.stringify({
      profile: embedder.profileId,
      dimensions: embedder.dimensions,
      repo: profile.source.repo,
      revision: profile.source.revision,
      dtype: profile.runtime.dtype ?? null,
      documentTitle: profile.prompts?.title ?? null,
    });
  } catch (error) {
    io.err(messageOf(error));
    return 1;
  }

  try {
    io.out(ready);
    for await (const line of io.lines) {
      if (line.trim() === '') continue;
      const items = parseRequest(line);
      const vectors = await embedder.embed('document', items);
      if (vectors.length !== items.length) throw new Error(`the embedder returned ${vectors.length} vectors for ${items.length} items`);
      io.out(JSON.stringify({ vectors }));
    }
    return 0;
  } catch (error) {
    io.err(messageOf(error));
    return 1;
  } finally {
    await embedder.release().catch(() => undefined);
  }
}

const defaultDeps: HelperDeps = {
  getProfile,
  verifyWeights,
  ensureWeights: (profile, modelsDir) =>
    ensureWeights(profile, modelsDir, { log: (message, detail) => process.stderr.write(`embed-documents: ${message} ${JSON.stringify(detail ?? {})}\n`) }),
  open: createOnnxEmbedder,
};
