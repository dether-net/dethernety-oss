/**
 * `node dist/scripts/models-pull.js` — download and verify the embedding model's weights before the first start.
 *
 * `byodt models pull` runs it in a one-off platform container, with the platform's environment and models directory
 * and no database. It builds no Nest application: it reads the environment directly, selects the profile the platform
 * will run (EMBEDDING_MODEL, else the default; a model the platform refuses is refused here too, with the same message),
 * says which model it downloads and under which licence, and places the verified weights in EMBEDDING_MODEL_DIR, where
 * the platform's start then finds them. SIGINT and SIGTERM stop it cleanly: no partial file stays.
 */

import type { EmbeddingProfile } from '@dethernety/dt-module/embedding';
import type { AcquireOptions } from '@dethernety/embedder';

import { selectEmbeddingProfile } from '../config/embedding-profile-selection';

export interface PullDeps {
  ensureWeights(profile: EmbeddingProfile, modelDir: string, options: AcquireOptions): Promise<void>;
  out(line: string): void;
  err(line: string): void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Pulls the weights; returns the exit code: 0 placed, 1 refused or failed, 130 stopped. */
export async function run(env: Record<string, string | undefined>, signal: AbortSignal, deps: PullDeps): Promise<number> {
  let profile: EmbeddingProfile;
  try {
    // As the platform runs it with embedding on, so a model it would refuse is refused here.
    profile = selectEmbeddingProfile({ enabled: 'true', model: env.EMBEDDING_MODEL });
  } catch (error) {
    deps.err(messageOf(error));
    return 1;
  }
  const dir = env.EMBEDDING_MODEL_DIR || 'models';
  const bytes = (profile.source?.files ?? []).reduce((sum, f) => sum + f.bytes, 0);
  deps.out(`Embedding model ${profile.id}: ${(bytes / 1e9).toFixed(2)} GB into ${dir}, downloaded only where missing or wrong.`);
  if (profile.licence) deps.out(`The model is licensed under the ${profile.licence.name}${profile.licence.url ? `: ${profile.licence.url}` : ''}.`);
  try {
    await deps.ensureWeights(profile, dir, {
      token: env.HF_TOKEN || undefined,
      signal,
      log: (message, detail) => deps.out(`${message}${typeof detail?.file === 'string' ? `: ${detail.file}` : ''}`),
    });
  } catch (error) {
    if (signal.aborted) {
      deps.err('Stopped; nothing partial was kept. Run it again to continue.');
      return 130;
    }
    deps.err(`The weights could not be placed: ${messageOf(error)}`);
    return 1;
  }
  deps.out('Ready: the platform loads the model from there without downloading it.');
  return 0;
}

async function main(): Promise<void> {
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => stop.abort(new Error(`stopped by ${sig}`)));
  const { ensureWeights } = await import('@dethernety/embedder');
  const code = await run(process.env, stop.signal, {
    ensureWeights,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
  process.exitCode = code;
}

if (require.main === module) void main();
