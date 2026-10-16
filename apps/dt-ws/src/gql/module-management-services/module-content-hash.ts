import { createHash } from 'crypto';
import type { DTMetadata } from '@dethernety/dt-module';

/** JSON with every object's keys sorted, recursively, so the same content always serialises the same way. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/** The embedding service a fingerprint is read from: whether it is on, and the model and dimensions it embeds with. */
export interface EmbedderConfigView {
  isEnabled(): boolean;
  isPending?(): boolean;
  getModel(): string;
  getDimensions(): number;
}

/**
 * The embedder an install's class vectors are made with: the model and dimensions, or 'off'. It follows the
 * configuration, not readiness (a pending embedder counts as on), so it does not change during a run. The install
 * stamps it on the Module node and the start-up skip gate compares it, so a change of embedding model reinstalls
 * every module, whatever its content hash.
 */
export function embedderFingerprint(embedder: EmbedderConfigView): string {
  const on = embedder.isEnabled() || embedder.isPending?.();
  return on ? `${embedder.getModel()}/${embedder.getDimensions()}` : 'off';
}

/**
 * The content hash of a module that ships none (one written in code rather than a file module, whose
 * module.json carries the hash hash-module.mjs computed).
 *
 * A module install writes the Module node and its classes from getMetadata() alone, through the platform's own install
 * code. So the hash covers the metadata (without any contentHash field) and the platform version (whose install code
 * may write the same metadata differently): a change to either reinstalls, so an upgrade reinstalls these modules
 * once. The embedder is not part of it: the skip gate compares the embedder for every module (embedderFingerprint).
 *
 * Templates, guides, exposures, countermeasures and policies are not install inputs: the platform asks the module
 * for them when they are used, so a skipped install cannot keep an old one. A module that hands the install
 * pre-computed vectors through getEmbedding() reads them from somewhere the metadata does not show; it gets no
 * computed hash (null), so it is installed on every start as before.
 */
export function computedContentHash(
  metadata: DTMetadata,
  module: { getEmbedding?: unknown },
  platform: string,
): string | null {
  if (typeof module.getEmbedding === 'function') return null;
  const { contentHash: _shipped, ...content } = metadata;
  return `sha256:${createHash('sha256').update(canonicalJson({ metadata: content, platform })).digest('hex')}`;
}
