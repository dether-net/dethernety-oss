/**
 * Key handling, shared by both implementations.
 *
 * Small enough to inline and deliberately not inlined: every rule here is a guarantee the
 * interface makes to a caller, and a guarantee kept in two places is one that eventually is not.
 */
import { KG_KEY_SEPARATOR, KgRuleRef } from '../interfaces/kg-client-interface';

/** `classId` and `ruleId` joined as the contract joins them. The one place the pair becomes a key. */
export function kgRefKey(classId: string, ruleId: string): string {
  return classId + KG_KEY_SEPARATOR + ruleId;
}

/**
 * Drop repeats, preserving the caller's order.
 *
 * Order is preserved rather than sorted so the result map iterates the way the caller asked, in
 * **both** modes — sorting would raise the remote cache's hit rate and make the two modes disagree
 * about iteration order, which is a worse trade than it looks.
 *
 * All three local statements group on their key before returning, so a repeat collapses in Cypher
 * and dropping it changes nothing there. It is dropped for the other implementation: each key sent
 * spends one of the request's bounded slots and one unit of the caller's keyed ceiling, so a
 * duplicate charges twice for one answer.
 */
export function distinct(keys: string[]): string[] {
  return Array.from(new Set(keys));
}

/** The same, over ref pairs — deduplicated on the joined key, so the two agree by construction. */
export function distinctRefs(refs: KgRuleRef[]): Map<string, KgRuleRef> {
  const out = new Map<string, KgRuleRef>();
  for (const ref of refs) {
    const key = kgRefKey(ref.classId, ref.ruleId);
    if (!out.has(key)) out.set(key, ref);
  }
  return out;
}

/**
 * A result map holding every requested key, each empty.
 *
 * The seeding *is* the contract: a key that matched nothing comes back with an empty array rather
 * than being absent, so a caller can treat a missing key as a bug instead of as an answer. Doing
 * it before any row is read means neither implementation can express "no matches" by omission.
 */
export function seededMap<T>(keys: string[]): Map<string, T[]> {
  return new Map(keys.map((k) => [k, [] as T[]]));
}
