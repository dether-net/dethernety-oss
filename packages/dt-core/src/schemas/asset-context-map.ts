/**
 * Asset-context transform boundary.
 *
 * The single place that converts user-asserted asset-context values between the
 * LOCAL split-file shape (grouped, snake_case, lowercase enums) and the PLATFORM
 * shape (flat camelCase `Model` properties, SCREAMING_SNAKE enum tokens).
 *
 * Pull (export) uses the `*ToLocal` direction; push (import/update) uses the
 * `*ToPlatform` direction. Keeping both here ensures the two never drift.
 */

import type { ModelScopeLocal } from './manifest.schema.js';

/** Canonical LOCAL (lowercase) enum vocabularies. */
export const MODELING_DEPTHS = ['architecture', 'design', 'implementation'] as const;
export const MODELING_INTENTS = ['initial', 'security_review', 'compliance', 'incident_response'] as const;
export const SENSITIVITY_LEVELS = ['public', 'internal', 'confidential', 'restricted'] as const;

/**
 * Recommended (NOT exhaustive) regulatory-flag vocabulary, mirroring the single
 * source of truth in `docs/architecture/dethereal/THREAT_MODELING_WORKFLOW.md`
 * (§ "Canonical sensitivity and regulatory-flag vocabulary"). Regulatory flags
 * are free-text and the set is extensible — these are the labels the dethereal
 * `security-enricher` agent emits and the ones GUI/tooling suggest. Casing is
 * significant: `dataInRegulatoryScope(flag)` matches exactly and case-sensitively,
 * so suggestions must use the canonical casing below. Keep this in sync with the
 * doc table; do not add frameworks here without updating the doc (and vice versa).
 */
export const RECOMMENDED_REGULATORY_FLAGS = [
  { flag: 'PCI cardholder', framework: 'PCI-DSS' },
  { flag: 'PHI', framework: 'HIPAA' },
  { flag: 'GDPR personal', framework: 'GDPR' },
  { flag: 'PII', framework: 'general' },
  { flag: 'SOX financial', framework: 'SOX' },
  { flag: 'CCPA personal', framework: 'CCPA' },
] as const;

/** Flat platform-shaped scope fields (mirror the GraphQL `Model` node). */
export interface PlatformScopeFields {
  depth?: string | null;
  modelingIntent?: string | null;
  complianceDrivers?: string[] | null;
  exclusions?: string[] | null;
  trustAssumptions?: string[] | null;
}

// ── enum case ────────────────────────────────────────────────────────────────

/** Platform SCREAMING_SNAKE token → local lowercase. Platform is authoritative, so this is lossless. */
export function platformEnumToLocal(token?: string | null): string | undefined {
  return token ? token.toLowerCase() : undefined;
}

/**
 * Local token → platform SCREAMING_SNAKE, validated against `validLocal`.
 * An unknown value (e.g. a hand-edit typo) is **dropped with a warning** rather
 * than emitting an invalid enum the platform would reject.
 */
export function localEnumToPlatform(
  token: string | undefined | null,
  validLocal: readonly string[],
): string | undefined {
  if (!token) return undefined;
  const normalized = token.toLowerCase();
  if (!validLocal.includes(normalized)) {
    console.warn(`[asset-context] dropping unknown enum value "${token}" (expected one of ${validLocal.join(', ')})`);
    return undefined;
  }
  return normalized.toUpperCase();
}

// ── scope (model-level) ────────────────────────────────────────────────────────

const nonEmpty = (a?: string[] | null): string[] | undefined => (a && a.length > 0 ? a : undefined);

/**
 * Platform flat scope → local grouped snake_case.
 * Returns `undefined` when nothing is set (so no empty `scope: {}` is written —
 * keeps the on-disk output deterministic and the content hash stable).
 */
export function platformScopeToLocal(m: PlatformScopeFields): ModelScopeLocal | undefined {
  const scope: ModelScopeLocal = {};
  const depth = platformEnumToLocal(m.depth);
  const intent = platformEnumToLocal(m.modelingIntent);
  if (depth) scope.depth = depth;
  if (intent) scope.modeling_intent = intent;
  const drivers = nonEmpty(m.complianceDrivers);
  const exclusions = nonEmpty(m.exclusions);
  const trust = nonEmpty(m.trustAssumptions);
  if (drivers) scope.compliance_drivers = drivers;
  if (exclusions) scope.exclusions = exclusions;
  if (trust) scope.trust_assumptions = trust;
  return Object.keys(scope).length > 0 ? scope : undefined;
}

/**
 * Local grouped scope → platform flat fields (push direction).
 * Returns `undefined` when nothing is set. Unknown enum values are dropped (see `localEnumToPlatform`).
 */
export function localScopeToPlatform(scope?: ModelScopeLocal | null): PlatformScopeFields | undefined {
  if (!scope) return undefined;
  const out: PlatformScopeFields = {};
  const depth = localEnumToPlatform(scope.depth, MODELING_DEPTHS);
  const intent = localEnumToPlatform(scope.modeling_intent, MODELING_INTENTS);
  if (depth) out.depth = depth;
  if (intent) out.modelingIntent = intent;
  const drivers = nonEmpty(scope.compliance_drivers);
  const exclusions = nonEmpty(scope.exclusions);
  const trust = nonEmpty(scope.trust_assumptions);
  if (drivers) out.complianceDrivers = drivers;
  if (exclusions) out.exclusions = exclusions;
  if (trust) out.trustAssumptions = trust;
  return Object.keys(out).length > 0 ? out : undefined;
}
