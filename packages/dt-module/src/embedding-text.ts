/**
 * Shared embedding helpers used by both the runtime (dt-ws EmbeddingService)
 * and build-time tooling (scripts/module-manager embed CLI in Sprint 2).
 *
 * Keeping text composition, response parsing, class-type normalization, and
 * model-name slugification in one place guarantees that the text the CLI
 * embeds is byte-equal to the text the runtime would have embedded.
 */

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
 * Parse the embedding response, supporting OpenAI and Ollama formats.
 *
 *   OpenAI              : { data: [{ embedding: [...] }, ...] }
 *   Ollama /api/embed   : { embeddings: [[...], [...]] }
 *   Ollama legacy single: { embedding: [...] }
 */
export function parseEmbeddingResponse(
  data: any,
  _expectedCount: number,
): number[][] {
  if (Array.isArray(data?.data)) {
    return data.data.map((item: any) => item.embedding);
  }
  if (Array.isArray(data?.embeddings)) {
    return data.embeddings;
  }
  if (Array.isArray(data?.embedding)) {
    return [data.embedding];
  }
  throw new Error(
    `Unexpected embedding API response format. Expected OpenAI ({ data: [...] }) or Ollama ({ embeddings: [...] }) format, got keys: [${Object.keys(data || {}).join(', ')}]`,
  );
}

/**
 * Normalize a class's `type` field the same way the runtime does before it
 * reaches `composeClassText`. Needed so the CLI's pre-computed embedding text
 * matches the runtime's text byte-for-byte.
 *
 * Behavior mirrors `DtFileOpaModule.getMetadata` (see spec §8.4):
 *   - V2 OPA layout non-component types (`dataFlow`, `securityBoundary`,
 *     `control`, `data`) are replaced with the matching forced enum value.
 *   - V2 OPA `component` classes have their `type` upper-cased and are
 *     rejected unless the result is in `VALID_COMPONENT_TYPES`.
 *   - JSON-layout directories (`ComponentClasses`, …) are returned as-is
 *     because `DtFileJsonModule.getMetadata` does not normalize.
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
