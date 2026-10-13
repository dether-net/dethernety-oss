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

/**
 * The content hash of a module that ships none (one written in code rather than a file module, whose
 * module.json carries the hash hash-module.mjs computed).
 *
 * A module install writes the Module node and its classes from getMetadata() alone, plus a vector per class that
 * the active embedder makes from that same metadata, through the platform's own install code. So the hash covers the
 * metadata (without any contentHash field), the embedder (its model and dimensions, or 'off') and the platform version
 * (whose install code may write the same metadata differently): a change to any of them reinstalls, so an upgrade
 * reinstalls these modules once.
 *
 * Templates, guides, exposures, countermeasures and policies are not install inputs: the platform asks the module
 * for them when they are used, so a skipped install cannot keep an old one. A module that hands the install
 * pre-computed vectors through getEmbedding() reads them from somewhere the metadata does not show; it gets no
 * computed hash (null), so it is installed on every start as before.
 */
export function computedContentHash(
  metadata: DTMetadata,
  module: { getEmbedding?: unknown },
  embedder: string,
  platform: string,
): string | null {
  if (typeof module.getEmbedding === 'function') return null;
  const { contentHash: _shipped, ...content } = metadata;
  return `sha256:${createHash('sha256').update(canonicalJson({ metadata: content, embedder, platform })).digest('hex')}`;
}
