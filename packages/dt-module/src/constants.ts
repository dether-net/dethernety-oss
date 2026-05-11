/**
 * UUID namespaces for deterministic class-id derivation.
 *
 * NEVER change these values — every existing class id stored across every
 * deployment is derived against them. Mutating either constant invalidates
 * the entire on-disk identity space and forces full migration.
 *
 * The contract: each module is the authoritative source for its class
 * `id` values; ids are derived deterministically from `(moduleName,
 * classKind, className)` using `MODULE_CLASS_NAMESPACE_UUID`, or from
 * the graph name using `ASSISTANT_NAMESPACE_UUID` for aegra-derived
 * AnalysisClass entries (see `dt-lg-module.ts`).
 */

/**
 * Aegra-owned namespace for `assistant_id = uuid5(NAMESPACE, graphName)`.
 * Forked into dt-module so the platform can compute identical UUIDs without
 * round-tripping aegra. Source: aegra repo,
 * `libs/aegra-api/src/aegra_api/constants.py:5`.
 */
export const ASSISTANT_NAMESPACE_UUID = '6ba7b821-9dad-11d1-80b4-00c04fd430c8';

/**
 * Platform-owned namespace for `deriveClassId(moduleName, classKind, className)`.
 * Used by base classes (and the legacy-module backwards-compat fallback) to
 * produce stable ids without an external authority. Stable arbitrary UUID,
 * picked once for this codebase. Documented as load-bearing.
 */
export const MODULE_CLASS_NAMESPACE_UUID = 'b2c6e3d4-7f8a-4d5e-9c1a-3b4d5e6f7a8b';
