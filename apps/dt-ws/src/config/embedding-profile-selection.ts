import { getProfile, type EmbeddingProfile } from '@dethernety/dt-module/embedding';

/**
 * Which embedding profile the platform runs, and which settings it refuses to start with.
 *
 * The platform embeds in process, with one profile in this release: `EMBEDDING_MODEL` may name it or be left unset.
 * The legacy `embeddinggemma` id (the HTTP embedder, which the platform no longer has), a built-in profile this release
 * does not offer yet, and any unknown id stop the start with a message that says what to change. With embedding off
 * nothing is refused: the platform never embeds, so the setting does not matter.
 *
 * The environment validation calls this before the database or the modules start; EmbeddingService calls it to pick
 * its profile. One rule, so the two cannot disagree.
 */

/** The profile the platform embeds with when EMBEDDING_MODEL is unset. The console's default must equal it. */
export const DEFAULT_EMBEDDING_PROFILE_ID = 'embeddinggemma-300m-retrieval-v1';

const LEGACY_PROFILE_ID = 'embeddinggemma';

/** Built-in profiles this release does not offer, and why. */
const NOT_IN_THIS_RELEASE: Record<string, string> = {
  'embeddinggemma-2-text-retrieval-v1': 'its MITRE vectors are not published yet',
};

export interface EmbeddingSettings {
  /** EMBEDDING_ENABLED as the environment holds it. */
  enabled: unknown;
  /** EMBEDDING_MODEL as the environment holds it. */
  model: unknown;
}

/** EMBEDDING_ENABLED is on when it reads `true`, ignoring case and surrounding space (the validation's reading). */
export function embeddingEnabled(raw: unknown): boolean {
  return raw === true || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
}

/** The profile id EMBEDDING_MODEL selects: the trimmed value, or the default when it is unset or blank. */
export function selectedProfileId(model: unknown): string {
  const id = typeof model === 'string' ? model.trim() : '';
  return id || DEFAULT_EMBEDDING_PROFILE_ID;
}

/** Why these settings cannot start the platform, or null when they can. */
export function embeddingProfileRefusal(settings: EmbeddingSettings): string | null {
  if (!embeddingEnabled(settings.enabled)) return null;
  const id = selectedProfileId(settings.model);
  if (id === DEFAULT_EMBEDDING_PROFILE_ID) return null;
  if (id === LEGACY_PROFILE_ID) {
    return (
      `EMBEDDING_MODEL "${id}" is no longer supported: the embedder now runs in the platform. ` +
      `Remove EMBEDDING_MODEL from the environment; the default is ${DEFAULT_EMBEDDING_PROFILE_ID}.`
    );
  }
  const reason = NOT_IN_THIS_RELEASE[id];
  if (reason) return `EMBEDDING_MODEL "${id}" is not available in this release: ${reason}. Use ${DEFAULT_EMBEDDING_PROFILE_ID}.`;
  return `Unknown EMBEDDING_MODEL "${id}". This release supports: ${DEFAULT_EMBEDDING_PROFILE_ID}.`;
}

/**
 * The profile the platform runs: the selected one. Throws the refusal for settings that cannot start the platform.
 * With embedding off it is the default profile whatever EMBEDDING_MODEL says, since nothing embeds.
 */
export function selectEmbeddingProfile(settings: EmbeddingSettings): EmbeddingProfile {
  const refusal = embeddingProfileRefusal(settings);
  if (refusal) throw new Error(refusal);
  return getProfile(embeddingEnabled(settings.enabled) ? selectedProfileId(settings.model) : DEFAULT_EMBEDDING_PROFILE_ID);
}
