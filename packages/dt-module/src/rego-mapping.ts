import { VALID_ATTACK_VECTORS, Exposure } from './interfaces/exposure-interface';
import { Countermeasure } from './interfaces/countermeasure-interface';

/**
 * Shared finding mapping — the snake→camel projection of one raw Rego policy finding into the
 * platform's Exposure / Countermeasure shape. Kept as pure functions so every consumer of a Rego
 * module (the local file module and any other) projects findings identically; there is exactly one
 * definition of this adaptation.
 */

/**
 * Project one raw `exposures` finding into an Exposure.
 *
 * The attack vector is normalized to the CVSS enum (or `UNSPECIFIED`). Because the mapper is pure, the
 * invalid-vector side effect is surfaced through the optional `onInvalidAttackVector` callback rather
 * than a logger dependency — the caller decides how to report it.
 */
export function mapExposureFinding(
  e: any,
  onInvalidAttackVector?: (rawValue: string, exposureName: string) => void,
): Exposure {
  const rawAV = (e.attack_vector ?? e.attackVector ?? null)?.toUpperCase();
  const attackVector = rawAV && VALID_ATTACK_VECTORS.has(rawAV) ? rawAV : 'UNSPECIFIED';
  if (rawAV && !VALID_ATTACK_VECTORS.has(rawAV)) {
    onInvalidAttackVector?.(rawAV, e.name);
  }
  return {
    name: e.name,
    description: e.description,
    type: e.type,
    category: e.category,
    score: e.score,
    attackVector,
    // Whole ref array passes through verbatim — each ref's `attributes` (e.g.
    // justification) survives for the edge writer. Only the interface type widened.
    exploitedBy: e.exploited_by || e.exploitedBy,
  };
}

/**
 * Project one raw `countermeasures` finding into a Countermeasure.
 *
 * The verb blocks are the snake→camel adaptation of the frozen policy shape and the only place it is
 * read. Unknown verb keys (a future verb, or a stray key) are simply not projected — the closed set is
 * enforced here by omission, and again downstream by the dt-ws verb→edge allowlist.
 */
export function mapCountermeasureFinding(c: any): Countermeasure {
  return {
    name: c.name,
    description: c.description,
    type: c.type,
    category: c.category,
    score: c.score,
    // Identity block → RESPONDS_WITH (snake or camel as the policy emits it).
    respondsWith: c.responds_with || c.respondsWith,
    mitigates: c.mitigates,
    protectsAgainst: c.protects_against,
    detects: c.detects,
    isolates: c.isolates,
    deceives: c.deceives,
    evicts: c.evicts,
    restores: c.restores,
    respondsTo: c.responds_to,
  };
}
