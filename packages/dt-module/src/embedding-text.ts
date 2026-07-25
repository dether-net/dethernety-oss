/**
 * Shared embedding helpers used by both the runtime (dt-ws EmbeddingService)
 * and build-time tooling (scripts/module-manager embed CLI).
 *
 * Keeping text composition, response parsing, class-type normalization, and
 * model-name slugification in one place guarantees that the text the CLI
 * embeds is byte-equal to the text the runtime would have embedded.
 */

import { createHash } from 'crypto';

/** Valid ComponentType values from the GraphQL schema for component classes. */
export const VALID_COMPONENT_TYPES = new Set([
  'PROCESS',
  'EXTERNAL_ENTITY',
  'STORE',
]);

/** Forced type overrides for non-component classTypes whose type must match the GraphQL enum. */
export const FORCED_TYPES: Record<string, string> = {
  dataFlow: 'DATA_FLOW',
  securityBoundary: 'SECURITY_BOUNDARY',
  control: 'CONTROL',
  data: 'DATA',
};

/**
 * Compose the embedding text for a class node.
 *
 * The format is pinned: changing it would invalidate all pre-computed vectors.
 * Any change here must be coordinated with a regenerate-all-embeddings migration.
 */
export function composeClassText(cls: {
  name: string;
  description?: string;
  category?: string;
  type?: string;
}): string {
  return `${cls.name}. ${cls.description || ''}. Category: ${cls.category || 'General'}. Type: ${cls.type || 'Unknown'}.`;
}

/**
 * Compose the embedding text for a query element (match_classes input side).
 */
export function composeElementText(element: {
  name: string;
  description?: string;
  type?: string;
}): string {
  return `${element.name}. ${element.description || ''}. Type: ${element.type || 'Unknown'}.`;
}

/**
 * Compose the embedding text for a MITRE technique node (ATT&CK or D3FEND).
 *
 * Format is pinned: changing it invalidates all stored MITRE vectors and
 * forces a mitre-frameworks module rebuild + republish.
 */
export function composeTechniqueText(t: {
  name: string;
  description?: string;
  tactic?: string;
}): string {
  return `${t.name}. ${t.description || ''}. Tactic: ${t.tactic || 'Unknown'}.`;
}

/**
 * Compose the embedding text for a MITRE mitigation node.
 *
 * Format is pinned: same constraints as composeTechniqueText. Mitigations
 * have no tactic field — the composer is intentionally shorter than the
 * technique variant.
 */
export function composeMitigationText(m: {
  name: string;
  description?: string;
}): string {
  return `${m.name}. ${m.description || ''}.`;
}

/**
 * Parse the embedding response, supporting OpenAI and Ollama formats.
 *
 *   OpenAI              : { data: [{ index, embedding: [...] }, ...] }
 *   Ollama /api/embed   : { embeddings: [[...], [...]] }
 *   Ollama legacy single: { embedding: [...] }
 *
 * Callers zip the returned vectors back onto their inputs BY POSITION, so order
 * and count must match the request exactly:
 *   - OpenAI carries a per-item `index` precisely because array order is not
 *     guaranteed; results are sorted by it before mapping (a stable no-op when
 *     `index` is absent, e.g. Ollama or older stubs).
 *   - Every entry is validated to be a non-empty finite-numeric array, and the
 *     total is checked against `expectedCount`. A malformed, reordered, or
 *     short response throws instead of silently mis-assigning vectors to classes.
 */
export function parseEmbeddingResponse(
  data: any,
  expectedCount: number,
): number[][] {
  let vectors: number[][];
  if (Array.isArray(data?.data)) {
    vectors = [...data.data]
      .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0))
      .map((item: any) => item?.embedding);
  } else if (Array.isArray(data?.embeddings)) {
    vectors = data.embeddings;
  } else if (Array.isArray(data?.embedding)) {
    vectors = [data.embedding];
  } else {
    throw new Error(
      `Unexpected embedding API response format. Expected OpenAI ({ data: [...] }) or Ollama ({ embeddings: [...] }) format, got keys: [${Object.keys(data || {}).join(', ')}]`,
    );
  }

  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (
      !Array.isArray(v) ||
      v.length === 0 ||
      !v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      throw new Error(
        `Embedding response item ${i} is not a non-empty numeric array — malformed response, refusing to store a mis-shaped vector.`,
      );
    }
  }

  if (vectors.length !== expectedCount) {
    throw new Error(
      `Embedding response returned ${vectors.length} vectors for ${expectedCount} inputs — count mismatch, refusing to mis-align vectors to inputs.`,
    );
  }

  return vectors;
}

/**
 * Normalize a class's `type` field the same way the runtime does before it
 * reaches `composeClassText`. Needed so the CLI's pre-computed embedding text
 * matches the runtime's text byte-for-byte.
 *
 * Behavior mirrors `DtFileOpaModule.getMetadata`:
 *   - V2 OPA layout non-component types (`dataFlow`, `securityBoundary`,
 *     `control`, `data`) are replaced with the matching forced enum value.
 *   - V2 OPA `component` classes have their `type` upper-cased and are
 *     rejected unless the result is in `VALID_COMPONENT_TYPES`.
 *   - JSON-layout directories (`ComponentClasses`, …) are returned as-is —
 *     the retired JSON-Logic module layout never normalized them.
 *
 * Returns `null` when the class should be skipped (invalid component type).
 */
export function normalizeClassType(
  classTypeDir: string,
  rawType: string | undefined,
): string | null {
  const forced = FORCED_TYPES[classTypeDir];
  if (forced) return forced;

  if (classTypeDir === 'component') {
    const upper = String(rawType || '').toUpperCase();
    if (!VALID_COMPONENT_TYPES.has(upper)) return null;
    return upper;
  }

  return rawType ?? '';
}

/**
 * The exact embedding text for a class, composed the same way at write time (CLI) and at read
 * time (cache staleness check). Both sides MUST route through this so a stored content-hash and
 * a recomputed one agree — any divergence would make the cache mis-verify and recompute forever.
 * `normalizeClassType` already encodes the layout distinction, so this is correct for both the
 * OPA and (retired) JSON layouts. The `?? rawType ?? ''` fallback only matters for a class whose
 * type no longer normalizes (skipped at write time, so never verified from a real vector).
 */
export function classEmbeddingText(
  def: { name: string; description?: string; category?: string; type?: string },
  classTypeDir: string,
): string {
  return composeClassText({
    name: def.name,
    description: def.description,
    category: def.category,
    type: normalizeClassType(classTypeDir, def.type) ?? def.type ?? '',
  });
}

/**
 * Content hash of a composed embedding text, stamped into each pre-computed vector file so a
 * stale vector (class text edited without regenerating) is detected instead of silently served.
 */
export function hashEmbeddingText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Slugify a model identifier so it is safe to use as a filename path segment.
 *
 * Model names legitimately contain '/' (e.g. "sentence-transformers/all-MiniLM-L6-v2"),
 * backslashes, or whitespace — none of which are safe to pass to path.join.
 * The cache (at read) and the CLI (at write) MUST both go through this helper
 * or the two sides will disagree about the filename.
 */
export function slugifyModelName(model: string): string {
  return model.replace(/[\/\\\s]+/g, '-');
}
