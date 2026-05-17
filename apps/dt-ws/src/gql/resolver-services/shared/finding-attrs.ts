import { Countermeasure, Exposure } from '@dethernety/dt-module';

/**
 * Positive allowlist of attribute keys forwarded to the §4.7 Cypher upsert
 * as `$attributes`. Mirrors the dt-module `Exposure` interface (see
 * oss/packages/dt-module/src/interfaces/exposure-interface.ts).
 *
 * Excludes:
 *  - `id` (resolver owns it via randomUUID()).
 *  - `createdBy` (resolver forces 'SYSTEM' explicitly to prevent
 *    module-side override of the authorship marker).
 *  - `exploitedBy` (handled separately as MITRE technique links).
 *
 * Includes `authoredBy` so module-provided attribution strings flow
 * through. A buggy or malicious module returning extra keys
 * (`priority`, `internalNotes`, etc.) sees them dropped at this
 * boundary. Shared between `SetInstantiationAttributesService`
 * (`setInstantiationAttributes` mutation) and `ElementBindingService`
 * (`changeElementBinding` mutation) so both write paths apply the same
 * allowlist.
 *
 * Known follow-up — tracked in the internal issue tracker: dt-module's
 * `reference`, `mitigationTechniques`, `detectionTechniques` don't match
 * schema `references`, `mitigationSuggestions`, `detectionMethods` —
 * fields pass through verbatim and the schema-named slots stay null on
 * SYSTEM findings. Pre-existing.
 */
export const EXPOSURE_ATTR_KEYS = [
  'name',
  'description',
  'type',
  'category',
  'score',
  'reference',
  'attackVector',
  'mitigationTechniques',
  'detectionTechniques',
  'tags',
  'authoredBy',
] as const;

export const COUNTERMEASURE_ATTR_KEYS = [
  'name',
  'description',
  'type',
  'category',
  'score',
  'reference',
  'addressedExposures',
  'tags',
  'authoredBy',
] as const;

/**
 * Apply the positive allowlist to a module-supplied exposure object,
 * returning only the keys safe to forward into `$attributes`. Skips
 * `undefined` values so they don't overwrite stored properties via
 * `SET e += $attributes`.
 */
export function sanitiseExposureAttrs(
  exposure: Exposure,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EXPOSURE_ATTR_KEYS) {
    const v = (exposure as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function sanitiseCountermeasureAttrs(
  countermeasure: Countermeasure,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of COUNTERMEASURE_ATTR_KEYS) {
    const v = (countermeasure as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
